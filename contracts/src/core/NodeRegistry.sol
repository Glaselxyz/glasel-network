// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Types} from "../libraries/Types.sol";
import {INodeRegistry} from "../interfaces/INodeRegistry.sol";

/// @title NodeRegistry
/// @notice Stores the cryptographic identity of each Arx node operator: its BLS
///         attestation key, X25519 DKG contribution, hardware fingerprint and
///         jurisdiction. The system routes work and verifies results against
///         this registry.
contract NodeRegistry is INodeRegistry, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    /// @dev Held by the StakingManager so slashing can force-deactivate a node.
    bytes32 public constant SLASHER_ROLE = keccak256("SLASHER_ROLE");

    mapping(address nodeId => Types.ArxNode) private _nodes;
    mapping(bytes32 blsPubKeyHash => address nodeId) public nodeByBls;
    address[] private _allNodes;

    event NodeRegistered(address indexed nodeId, bytes blsPubKey, string jurisdiction);
    event NodeDeactivated(address indexed nodeId);
    event NodeReactivated(address indexed nodeId);
    event NodeMetadataUpdated(address indexed nodeId);

    error InvalidBlsKeyLength();
    error InvalidG1Point();
    error AlreadyRegistered();
    error BlsKeyAlreadyRegistered();
    error NodeNotActive();
    error Unauthorized();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function registerNode(
        bytes calldata blsPubKey,
        bytes32 x25519PubKey,
        bytes32 hardwareHash,
        string calldata jurisdiction
    ) external {
        if (blsPubKey.length != 48) revert InvalidBlsKeyLength();
        if (_nodes[msg.sender].registeredAt != 0) revert AlreadyRegistered();
        if (!_isValidG1Point(blsPubKey)) revert InvalidG1Point();

        bytes32 blsHash = keccak256(blsPubKey);
        if (nodeByBls[blsHash] != address(0)) revert BlsKeyAlreadyRegistered();

        _nodes[msg.sender] = Types.ArxNode({
            blsPubKey: blsPubKey,
            x25519PubKey: x25519PubKey,
            hardwareHash: hardwareHash,
            jurisdiction: jurisdiction,
            operatorAddress: msg.sender,
            ownerAddress: msg.sender,
            registeredAt: uint64(block.timestamp),
            active: true
        });

        nodeByBls[blsHash] = msg.sender;
        _allNodes.push(msg.sender);
        emit NodeRegistered(msg.sender, blsPubKey, jurisdiction);
    }

    /// @notice Rotate the X25519 DKG key. Off-chain this triggers cluster re-keying.
    function rotateX25519Key(bytes32 newX25519PubKey) external {
        if (!_nodes[msg.sender].active) revert NodeNotActive();
        _nodes[msg.sender].x25519PubKey = newX25519PubKey;
        emit NodeMetadataUpdated(msg.sender);
    }

    function deactivateNode(address nodeId) external {
        if (msg.sender != _nodes[nodeId].ownerAddress && !hasRole(SLASHER_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        _nodes[nodeId].active = false;
        emit NodeDeactivated(nodeId);
    }

    /// @notice Re-activate a previously deactivated (e.g. unjailed) node.
    function reactivateNode(address nodeId) external {
        if (msg.sender != _nodes[nodeId].ownerAddress && !hasRole(SLASHER_ROLE, msg.sender)) {
            revert Unauthorized();
        }
        if (_nodes[nodeId].registeredAt == 0) revert NodeNotActive();
        _nodes[nodeId].active = true;
        emit NodeReactivated(nodeId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getNode(address nodeId) external view returns (Types.ArxNode memory) {
        return _nodes[nodeId];
    }

    function isActive(address nodeId) external view returns (bool) {
        return _nodes[nodeId].active;
    }

    function operatorOf(address nodeId) external view returns (address) {
        return _nodes[nodeId].operatorAddress;
    }

    function isRegistered(address nodeId) external view returns (bool) {
        return _nodes[nodeId].registeredAt != 0;
    }

    function nodeCount() external view returns (uint256) {
        return _allNodes.length;
    }

    function nodeAt(uint256 index) external view returns (address) {
        return _allNodes[index];
    }

    // ─── Internal ────────────────────────────────────────────────────────────

    /// @dev Phase-1 validity check for a compressed BLS12-381 G1 point. Full
    ///      subgroup validation requires the EIP-2537 precompiles; until Base
    ///      ships them we enforce length and non-zero. Documented as a known
    ///      gap to be replaced by `BLS12_381_G1_MSM`-backed validation.
    function _isValidG1Point(bytes calldata blsPubKey) internal pure returns (bool) {
        if (blsPubKey.length != 48) return false;
        bytes32 lo;
        bytes16 hi;
        assembly {
            lo := calldataload(blsPubKey.offset)
            hi := calldataload(add(blsPubKey.offset, 32))
        }
        return !(lo == bytes32(0) && hi == bytes16(0));
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
