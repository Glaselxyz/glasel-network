// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Types} from "../libraries/Types.sol";
import {IClusterManager} from "../interfaces/IClusterManager.sol";
import {INodeRegistry} from "../interfaces/INodeRegistry.sol";
import {IStakingManager} from "../interfaces/IStakingManager.sol";
import {ThresholdSig} from "../libraries/ThresholdSig.sol";
import {BLS} from "../libraries/BLS.sol";

/// @title ClusterManager
/// @notice Forms and activates clusters of Arx nodes. A cluster's combined
///         X25519 key (from an off-chain DKG) is committed here and is what
///         clients encrypt inputs to. Activation requires a threshold signature
///         from the cluster members over (clusterId, combinedKey).
contract ClusterManager is IClusterManager, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    uint256 public constant MAX_CLUSTER_NODES = 64;

    INodeRegistry public registry;
    IStakingManager public staking; // optional economic gate; skipped if unset

    mapping(bytes32 clusterId => Types.Cluster) private _clusters;
    bytes32[] public activeClusterIds;
    mapping(bytes32 clusterId => uint256 index1) private _activeIndex; // 1-based

    event ClusterProposed(bytes32 indexed clusterId, address[] nodes, uint32 minThreshold);
    event ClusterActivated(bytes32 indexed clusterId, bytes32 clusterPubKey);
    event ClusterDissolved(bytes32 indexed clusterId);
    event ClusterMigrating(bytes32 indexed clusterId, address offlineNode, address replacementNode);
    event BlsGroupKeySet(bytes32 indexed clusterId);

    error TooFewNodes();
    error TooManyNodes();
    error ThresholdTooLow();
    error ThresholdTooHigh();
    error NodeNotActive();
    error OperatorAppearsTwice();
    error NodeNotEligible();
    error NotForming();
    error NotActiveCluster();
    error InsufficientSigners();
    error InvalidGroupKey();
    error Unauthorized();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address registry_, address staking_) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        registry = INodeRegistry(registry_);
        staking = IStakingManager(staking_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function setStaking(address staking_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        staking = IStakingManager(staking_);
    }

    /// @notice Set/replace a cluster's BN254 threshold-BLS group key (from the
    ///         off-chain DKG), in ecPairing G2 order [x.c1, x.c0, y.c1, y.c0].
    ///         Used by ComputationCoordinator.submitResultBLS. Callable by the
    ///         cluster owner or admin; the X25519 key path is unchanged.
    function setBlsGroupKey(bytes32 clusterId, uint256[4] calldata key) external {
        Types.Cluster storage c = _clusters[clusterId];
        if (msg.sender != c.owner && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        // Reject the all-zero identity (valid point but a useless key) and any
        // off-curve / wrong-subgroup point (validated by the pairing precompile).
        if (key[0] == 0 && key[1] == 0 && key[2] == 0 && key[3] == 0) revert InvalidGroupKey();
        if (!BLS.isValidGroupKey(key)) revert InvalidGroupKey();
        c.blsGroupKey = key;
        emit BlsGroupKeySet(clusterId);
    }

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    function proposeCluster(
        address[] calldata nodeAddresses,
        Types.ClusterPermission permission,
        uint32 minThreshold,
        address owner
    ) external returns (bytes32 clusterId) {
        uint256 n = nodeAddresses.length;
        if (n < 3) revert TooFewNodes();
        // Cap cluster size so downstream loops (threshold verify, slashing, fee
        // distribution) can never exceed the block gas limit and brick a
        // computation (audit M-2).
        if (n > MAX_CLUSTER_NODES) revert TooManyNodes();
        if (minThreshold < n / 2 + 1) revert ThresholdTooLow();
        if (minThreshold > n) revert ThresholdTooHigh();

        address[] memory operators = new address[](n);
        for (uint256 i; i < n; ++i) {
            if (!registry.isActive(nodeAddresses[i])) revert NodeNotActive();
            if (address(staking) != address(0) && !staking.isEligible(nodeAddresses[i])) {
                revert NodeNotEligible();
            }
            address op = registry.operatorOf(nodeAddresses[i]);
            // Sybil check: an operator may appear at most once per cluster.
            for (uint256 j; j < i; ++j) {
                if (operators[j] == op) revert OperatorAppearsTwice();
            }
            operators[i] = op;
        }

        clusterId = keccak256(abi.encode(nodeAddresses, block.timestamp, msg.sender));

        Types.Cluster storage c = _clusters[clusterId];
        c.nodes = nodeAddresses;
        c.minThreshold = minThreshold;
        c.maxComputations = uint32(n * 10);
        c.permission = permission;
        c.status = Types.ClusterStatus.Forming;
        c.owner = owner;

        emit ClusterProposed(clusterId, nodeAddresses, minThreshold);
    }

    function activateCluster(
        bytes32 clusterId,
        bytes32 combinedX25519Key,
        bytes calldata aggregatedSig,
        address[] calldata signers
    ) external {
        Types.Cluster storage c = _clusters[clusterId];
        if (c.status != Types.ClusterStatus.Forming && c.status != Types.ClusterStatus.Migrating) {
            revert NotForming();
        }
        if (signers.length < c.minThreshold) revert InsufficientSigners();

        bytes32 message = keccak256(abi.encode(clusterId, combinedX25519Key));
        ThresholdSig.verify(message, aggregatedSig, signers, c.nodes, c.minThreshold);

        c.clusterPubKey = combinedX25519Key;
        c.status = Types.ClusterStatus.Active;
        c.activatedAt = uint64(block.timestamp);

        if (_activeIndex[clusterId] == 0) {
            activeClusterIds.push(clusterId);
            _activeIndex[clusterId] = activeClusterIds.length;
        }
        emit ClusterActivated(clusterId, combinedX25519Key);
    }

    /// @notice Mark a cluster as Migrating and swap an offline node for a
    ///         replacement. A fresh DKG runs off-chain; the new key is then
    ///         committed via activateCluster().
    function initiateNodeMigration(bytes32 clusterId, address offlineNode, address replacementNode) external {
        Types.Cluster storage c = _clusters[clusterId];
        if (c.status != Types.ClusterStatus.Active) revert NotActiveCluster();
        if (msg.sender != c.owner && !_isMember(c.nodes, msg.sender) && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        if (!registry.isActive(replacementNode)) revert NodeNotActive();

        bool replaced;
        for (uint256 i; i < c.nodes.length; ++i) {
            if (c.nodes[i] == offlineNode) {
                c.nodes[i] = replacementNode;
                replaced = true;
                break;
            }
        }
        if (!replaced) revert NodeNotActive();

        c.status = Types.ClusterStatus.Migrating;
        emit ClusterMigrating(clusterId, offlineNode, replacementNode);
    }

    function dissolveCluster(bytes32 clusterId) external {
        Types.Cluster storage c = _clusters[clusterId];
        if (msg.sender != c.owner && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        c.status = Types.ClusterStatus.Dissolved;
        c.dissolvedAt = uint64(block.timestamp);

        uint256 idx1 = _activeIndex[clusterId];
        if (idx1 != 0) {
            uint256 i = idx1 - 1;
            uint256 last = activeClusterIds.length - 1;
            if (i != last) {
                bytes32 moved = activeClusterIds[last];
                activeClusterIds[i] = moved;
                _activeIndex[moved] = i + 1;
            }
            activeClusterIds.pop();
            delete _activeIndex[clusterId];
        }
        emit ClusterDissolved(clusterId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getCluster(bytes32 clusterId) external view returns (Types.Cluster memory) {
        return _clusters[clusterId];
    }

    function clusterPubKey(bytes32 clusterId) external view returns (bytes32) {
        return _clusters[clusterId].clusterPubKey;
    }

    function isActive(bytes32 clusterId) external view returns (bool) {
        return _clusters[clusterId].status == Types.ClusterStatus.Active;
    }

    function getNodes(bytes32 clusterId) external view returns (address[] memory) {
        return _clusters[clusterId].nodes;
    }

    function activeClusterCount() external view returns (uint256) {
        return activeClusterIds.length;
    }

    function _isMember(address[] storage nodes, address who) private view returns (bool) {
        for (uint256 i; i < nodes.length; ++i) {
            if (nodes[i] == who) return true;
        }
        return false;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
