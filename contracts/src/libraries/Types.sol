// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Glasel shared types
/// @notice Enums and structs shared across the Glasel protocol contracts and
///         their interfaces. Centralised here so cross-contract calls can pass
///         and return the same value types without duplication.
library Types {
    // ─── NodeRegistry ─────────────────────────────────────────────────────────

    struct ArxNode {
        bytes blsPubKey; // BLS12-381 G1 compressed (48 bytes) — used for result attestation
        bytes32 x25519PubKey; // node's contribution to cluster DKG
        bytes32 hardwareHash; // keccak256(cpu_id || ram_bytes || disk_bytes)
        string jurisdiction; // ISO 3166-1 alpha-2
        address operatorAddress; // receives rewards / signs results
        address ownerAddress; // can update metadata / deregister
        uint64 registeredAt;
        bool active;
    }

    // ─── ClusterManager ─────────────────────────────────────────────────────────

    enum ClusterStatus {
        Forming,
        Active,
        Migrating,
        Dissolved
    }

    enum ClusterPermission {
        Permissionless,
        SemiPermissioned,
        FullyPermissioned
    }

    struct Cluster {
        address[] nodes; // ordered list; index = party ID in MPC
        bytes32 clusterPubKey; // combined X25519 from off-chain DKG
        uint32 minThreshold; // min signers to accept a result
        uint32 maxComputations; // concurrent computation capacity
        ClusterPermission permission;
        ClusterStatus status;
        address owner; // for permissioned clusters
        uint64 activatedAt;
        uint64 dissolvedAt;
        uint256[4] blsGroupKey; // BN254 G2 group key [x.c1,x.c0,y.c1,y.c0] (threshold BLS)
    }

    // ─── MXEFactory ─────────────────────────────────────────────────────────────

    enum Protocol {
        Cerberus,
        Manticore
    }

    struct MXE {
        bytes32 clusterId;
        Protocol protocol;
        bytes32[] allowedComputationDefs; // empty = allow all
        address owner;
        bool active;
        uint64 createdAt;
        bytes32 fallbackClusterId;
    }

    // ─── ComputationRegistry ─────────────────────────────────────────────────────

    struct ComputationDefinition {
        bytes32 bytecodeHash; // keccak256 of full circuit bytecode
        bytes bytecode; // stored inline if len <= MAX_INLINE_SIZE
        string ipfsCid; // non-empty if stored off-chain
        uint32 estimatedGates; // approximate gate count for fee estimation
        uint32 inputCount;
        uint32 outputCount;
        address deployer;
        uint64 deployedAt;
        bool deprecated;
    }

    // ─── ComputationCoordinator ───────────────────────────────────────────────────

    enum ComputationStatus {
        None, // never commissioned (default mapping value)
        Pending, // commissioned, not yet picked up
        InProgress, // nodes acknowledged, running MPC
        Completed, // result submitted and callback fired
        Failed, // timed out or nodes could not agree
        Slashed // nodes slashed for misbehavior
    }

    struct Computation {
        bytes32 mxeId;
        bytes32 compDefId;
        bytes encInputs; // X25519-encrypted, Rescue-ciphered
        string inputIpfsCid; // for large inputs (EIP-4844 flow)
        address callbackContract;
        bytes4 callbackSelector;
        uint256 callbackGasLimit;
        uint256 feeDeposit; // in $GLASEL
        uint256 priorityFee; // tip for faster scheduling
        address requester;
        uint64 commissionedAt;
        uint64 deadline;
        ComputationStatus status;
        bytes encResult;
        bytes32 resultCommitment; // keccak256(computationId || encResult)
        bool callbackSucceeded;
        // Cluster participants + threshold snapshotted at commission time, so that
        // result verification and slashing bind to the nodes that were actually
        // assigned — immune to later cluster migration (audit H-2).
        address[] participants;
        uint32 threshold;
        // BN254 threshold-BLS group key snapshotted at commission (for submitResultBLS).
        uint256[4] blsGroupKey;
    }

    // ─── StakingManager ──────────────────────────────────────────────────────────

    enum SlashReason {
        MissedDeadline,
        IncorrectResult,
        OfflineDuringComputation
    }

    struct NodeStakeInfo {
        uint256 selfStaked;
        uint256 delegatedStake;
        uint256 totalStake;
        uint256 reputationScore; // 0–10_000 (basis points)
        uint256 computationsCompleted;
        uint256 computationsFailed;
        uint256 accumulatedRewards;
        uint256 pendingSlash;
        uint64 lastActivityAt;
        bool jailed;
    }
}
