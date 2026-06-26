// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {Types} from "../libraries/Types.sol";
import {IComputationRegistry} from "../interfaces/IComputationRegistry.sol";

/// @title ComputationRegistry
/// @notice Stores compiled Arcis circuit definitions. Small circuits (<= 24KB)
///         are stored inline; larger ones reference an IPFS CID and nodes verify
///         the fetched bytecode against the on-chain hash.
contract ComputationRegistry is IComputationRegistry, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    uint256 public constant MAX_INLINE_SIZE = 24_576; // 24KB

    mapping(bytes32 compDefId => Types.ComputationDefinition) private _defs;
    uint256 private _nonce;

    event ComputationDefinitionDeployed(bytes32 indexed compDefId, address indexed deployer, uint32 estimatedGates);
    event ComputationDefinitionDeprecated(bytes32 indexed compDefId);

    error EmptyDefinition();
    error NotDeployer();
    error UnknownDefinition();

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

    function deployComputationDefinition(
        bytes calldata bytecode,
        string calldata ipfsCid,
        uint32 estimatedGates_,
        uint32 inputCount,
        uint32 outputCount
    ) external returns (bytes32 compDefId) {
        if (bytecode.length == 0 && bytes(ipfsCid).length == 0) {
            revert EmptyDefinition();
        }

        bytes32 bytecodeHash = keccak256(bytecode.length > 0 ? bytecode : bytes(ipfsCid));

        // Include a monotonic nonce so two definitions deployed in the same block
        // by the same sender never collide (which would silently overwrite state).
        compDefId = keccak256(abi.encode(bytecodeHash, msg.sender, block.timestamp, _nonce++));

        _defs[compDefId] = Types.ComputationDefinition({
            bytecodeHash: bytecodeHash,
            bytecode: bytecode.length <= MAX_INLINE_SIZE ? bytecode : bytes(""),
            ipfsCid: ipfsCid,
            estimatedGates: estimatedGates_,
            inputCount: inputCount,
            outputCount: outputCount,
            deployer: msg.sender,
            deployedAt: uint64(block.timestamp),
            deprecated: false
        });

        emit ComputationDefinitionDeployed(compDefId, msg.sender, estimatedGates_);
    }

    function deprecate(bytes32 compDefId) external {
        Types.ComputationDefinition storage d = _defs[compDefId];
        if (d.deployedAt == 0) revert UnknownDefinition();
        if (d.deployer != msg.sender && !hasRole(DEFAULT_ADMIN_ROLE, msg.sender)) {
            revert NotDeployer();
        }
        d.deprecated = true;
        emit ComputationDefinitionDeprecated(compDefId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getDefinition(bytes32 compDefId) external view returns (Types.ComputationDefinition memory) {
        return _defs[compDefId];
    }

    function estimatedGates(bytes32 compDefId) external view returns (uint32) {
        return _defs[compDefId].estimatedGates;
    }

    function exists(bytes32 compDefId) external view returns (bool) {
        return _defs[compDefId].deployedAt != 0;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
