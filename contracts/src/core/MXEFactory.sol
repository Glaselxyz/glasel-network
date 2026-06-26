// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Types} from "../libraries/Types.sol";
import {IMXEFactory} from "../interfaces/IMXEFactory.sol";
import {IClusterManager} from "../interfaces/IClusterManager.sol";

/// @title MXEFactory
/// @notice Creates MXEs (MPC eXecution Environments): named bindings of a
///         cluster + protocol + allowed-circuit policy that applications target.
contract MXEFactory is IMXEFactory, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    IClusterManager public clusterManager;

    mapping(bytes32 mxeId => Types.MXE) private _mxes;

    event MXECreated(bytes32 indexed mxeId, bytes32 clusterId, Types.Protocol protocol);
    event MXEDeactivated(bytes32 indexed mxeId);

    error ClusterNotActive();
    error ManticoreRequiresPermissioned();
    error NotOwner();
    error UnknownMXE();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address clusterManager_) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        clusterManager = IClusterManager(clusterManager_);
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    function createMXE(
        bytes32 clusterId,
        Types.Protocol protocol,
        bytes32[] calldata allowedComputationDefs,
        bytes32 fallbackClusterId
    ) external returns (bytes32 mxeId) {
        Types.Cluster memory c = clusterManager.getCluster(clusterId);
        if (c.status != Types.ClusterStatus.Active) revert ClusterNotActive();

        // Manticore (honest-but-curious) is only allowed on permissioned clusters.
        if (protocol == Types.Protocol.Manticore) {
            if (c.permission == Types.ClusterPermission.Permissionless) {
                revert ManticoreRequiresPermissioned();
            }
        }

        mxeId = keccak256(abi.encode(clusterId, protocol, msg.sender, block.timestamp, block.number));

        Types.MXE storage m = _mxes[mxeId];
        m.clusterId = clusterId;
        m.protocol = protocol;
        m.allowedComputationDefs = allowedComputationDefs;
        m.owner = msg.sender;
        m.active = true;
        m.createdAt = uint64(block.timestamp);
        m.fallbackClusterId = fallbackClusterId;

        emit MXECreated(mxeId, clusterId, protocol);
    }

    function deactivateMXE(bytes32 mxeId) external {
        Types.MXE storage m = _mxes[mxeId];
        if (m.createdAt == 0) revert UnknownMXE();
        if (m.owner != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) revert NotOwner();
        m.active = false;
        emit MXEDeactivated(mxeId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getMXE(bytes32 mxeId) external view returns (Types.MXE memory) {
        return _mxes[mxeId];
    }

    function isActive(bytes32 mxeId) external view returns (bool) {
        return _mxes[mxeId].active;
    }

    /// @notice True if `compDefId` may run on this MXE (empty allow-list = all).
    function isAllowed(bytes32 mxeId, bytes32 compDefId) external view returns (bool) {
        Types.MXE storage m = _mxes[mxeId];
        if (m.allowedComputationDefs.length == 0) return true;
        for (uint256 i; i < m.allowedComputationDefs.length; ++i) {
            if (m.allowedComputationDefs[i] == compDefId) return true;
        }
        return false;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
