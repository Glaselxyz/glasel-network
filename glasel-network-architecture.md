# Glasel Network — Production Architecture
## A Confidential Computing Network on Base, inspired by Arcium

**Version:** 1.0  
**Target Chain:** Base (L2, OP Stack)  
**Status:** Architecture Specification  

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Design Principles](#2-design-principles)
3. [Network Topology](#3-network-topology)
4. [Smart Contract Architecture](#4-smart-contract-architecture)
   - 4.1 Contract Dependency Graph
   - 4.2 `$CONFIDE` Token
   - 4.3 `NodeRegistry`
   - 4.4 `ClusterManager`
   - 4.5 `MXEFactory`
   - 4.6 `ComputationRegistry`
   - 4.7 `ComputationCoordinator`
   - 4.8 `StakingManager`
   - 4.9 `FeeOracle`
   - 4.10 `Governance` + Timelock
   - 4.11 `ConfidentialBase` (abstract)
   - 4.12 Upgradeability Strategy
5. [Off-Chain Node Infrastructure](#5-off-chain-node-infrastructure)
   - 5.1 Node Daemon Architecture
   - 5.2 Cerberus MPC Engine
   - 5.3 Manticore MPC Engine
   - 5.4 Key Management & HSM
   - 5.5 P2P Communication Layer
   - 5.6 BLS Signature Aggregation
6. [Encryption Stack](#6-encryption-stack)
   - 6.1 X25519 + DKG
   - 6.2 Rescue Cipher
   - 6.3 Type System (`Enc<Owner, T>`)
   - 6.4 Sealing / Re-encoding
7. [Circuit Compiler (Arcis DSL)](#7-circuit-compiler-arcis-dsl)
   - 7.1 Language Design
   - 7.2 Compilation Pipeline
   - 7.3 Arithmetic Circuit Representation
8. [Developer Tooling](#8-developer-tooling)
   - 8.1 `glaselvm` CLI
   - 8.2 `@glasel/client` SDK
   - 8.3 `ConfidentialBase.sol`
   - 8.4 Testing Infrastructure
   - 8.5 `glasel.toml`
9. [Computation Lifecycle (End-to-End)](#9-computation-lifecycle-end-to-end)
10. [Network Economics](#10-network-economics)
    - 10.1 Fee Model
    - 10.2 Staking & Slashing
    - 10.3 Delegation
    - 10.4 Epoch Structure
11. [Security Model](#11-security-model)
    - 11.1 Threat Model
    - 11.2 Sybil Resistance
    - 11.3 MEV & Front-Running Protection
    - 11.4 Emergency Mechanisms
12. [Infrastructure & DevOps](#12-infrastructure--devops)
    - 12.1 Node Hardware Requirements
    - 12.2 Deployment Architecture
    - 12.3 Monitoring & Alerting
    - 12.4 Key Rotation
13. [Testing Strategy](#13-testing-strategy)
14. [Phased Roadmap](#14-phased-roadmap)

---

## 1. System Overview

Glasel Network is a **decentralized confidential computing layer** native to Base. It allows any smart contract or off-chain application to run arbitrary computation over fully encrypted inputs, returning verifiable results — without any single node, operator, or insider ever seeing the raw data.

The core insight borrowed from Arcium: computation is broken at the point of execution. Traditional cryptography protects data at rest and in transit, but the moment a server processes it, confidentiality collapses. Glasel replaces that server with a **cluster of independent MPC nodes** that collectively compute the function using secret-shared inputs. No quorum of fewer than `threshold` nodes can reconstruct any input or intermediate value.

### What changes vs. Arcium

| Concern              | Arcium (Solana)          | Glasel (Base / EVM)                    |
|----------------------|--------------------------|-----------------------------------------|
| On-chain state       | Anchor accounts          | Solidity contract storage + mappings    |
| Developer framework  | Anchor macros + Rust     | `ConfidentialBase.sol` + Foundry        |
| Callback mechanism   | Solana CPI               | EVM contract call from Coordinator      |
| Token standard       | SPL                      | ERC-20 (EIP-2612 permit)                |
| Computation inputs   | Solana calldata          | EVM calldata + EIP-4844 blobs           |
| Result submission    | Individual node txns     | BLS aggregate signature, single txn     |
| Scheduling           | On-chain mempool         | `ComputationRequested` event queue      |
| Gas                  | Solana fees (~$0.001)    | Base L2 fees (~$0.001–0.01)             |

The MPC protocols (Cerberus, Manticore), the encryption stack (X25519 + Rescue cipher), and the circuit DSL (Arcis) are **chain-agnostic** and carried over unchanged.

---

## 2. Design Principles

**1. Zero-trust by default.**  
Every computation must be secure under the assumption that all-but-one nodes are actively malicious. Cerberus is the default protocol. Manticore (honest-but-curious) is opt-in and only usable in explicitly permissioned clusters.

**2. Verifiability over trust.**  
Every result is accompanied by a BLS threshold signature over `keccak256(computationId || encResult)`. Anyone can verify on-chain that the threshold was met and the result is authentic.

**3. Upgradeability with governance delay.**  
All core contracts are upgradeable via UUPS proxies. All upgrades require a 48-hour timelock governed by $CONFIDE holders. No multisig can bypass the timelock after the bootstrap period.

**4. Separation of concerns.**  
On-chain contracts handle only orchestration, payments, and slashing. All heavy cryptography happens off-chain. The contracts are a coordination layer, not a computation layer.

**5. Developer ergonomics first.**  
A developer with Solidity and TypeScript experience should be able to ship a confidential application in one day. The `ConfidentialBase.sol` abstract contract and `@glasel/client` SDK handle all cryptographic complexity.

**6. Economic sustainability.**  
Node operators earn fees proportional to computation tasks completed and response time. There are no emissions-funded rewards — all yield comes from real computation demand. This ensures the network only grows if it is actually used.

---

## 3. Network Topology

```
┌─────────────────────────────────────────────────────────────┐
│  Application Layer                                          │
│  DarkPool.sol / SealedAuction.sol / ConfidentialVote.sol    │
│  inherits ConfidentialBase.sol                              │
└────────────────────┬────────────────────────────────────────┘
                     │ commission() / onComputationComplete()
┌────────────────────▼────────────────────────────────────────┐
│  Glasel Protocol Contracts (Base mainnet)                  │
│  ComputationCoordinator ← MXEFactory ← ClusterManager      │
│  NodeRegistry  StakingManager  FeeOracle  Governance        │
│  ComputationRegistry  $CONFIDE ERC-20                       │
└──────────┬───────────────────────────────┬──────────────────┘
           │ ComputationRequested event     │ submitResult()
           │ (detected by all cluster nodes)│ (single BLS-agg txn)
┌──────────▼──────────────────────────────▼──────────────────┐
│  Off-Chain MPC Network                                      │
│                                                             │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐              │
│   │  Arx     │   │  Arx     │   │  Arx     │  Cluster A   │
│   │  Node 1  │◄──►  Node 2  │◄──►  Node 3  │  (Cerberus)  │
│   │ (GlaselOS)  │   │ (GlaselOS)  │   │ (GlaselOS)  │              │
│   └──────────┘   └──────────┘   └──────────┘              │
│                                                             │
│   ┌──────────┐   ┌──────────┐                             │
│   │  Arx     │   │  Arx     │  Cluster B                  │
│   │  Node 4  │◄──►  Node 5  │  (Manticore, permissioned)  │
│   └──────────┘   └──────────┘                             │
└────────────────────────────────────────────────────────────┘
           ▲
           │ X25519-encrypted inputs (client-side)
┌──────────┴──────────────────────────────────────────────────┐
│  Client Layer                                               │
│  @glasel/client (TypeScript)                               │
│  X25519 keygen → Rescue cipher → encrypted calldata         │
└────────────────────────────────────────────────────────────┘
```

---

## 4. Smart Contract Architecture

All contracts are deployed behind **UUPS transparent proxies**. The implementation contracts are owned by a `TimelockController` (48h delay) governed by $CONFIDE holders. During the bootstrap period (first 6 months), a 4-of-7 multisig has emergency pause authority.

### 4.1 Contract Dependency Graph

```
$CONFIDE (ERC-20)
    ├── StakingManager       (holds staked $CONFIDE)
    └── Governance           (voting, locked $CONFIDE)
            └── TimelockController
                    └── upgrades all contracts

NodeRegistry
    └── ClusterManager       (reads node keys/metadata)
            └── MXEFactory   (reads cluster state)

ComputationRegistry          (stores circuit bytecode / IPFS CIDs)

FeeOracle                    (reads gas price + circuit complexity)

ComputationCoordinator
    ├── reads  MXEFactory
    ├── reads  ComputationRegistry
    ├── reads  ClusterManager
    ├── reads  FeeOracle
    ├── writes StakingManager (distribute fees / slash)
    └── calls  app's onComputationComplete()

ConfidentialBase.sol         (abstract, inherited by app contracts)
    └── calls  ComputationCoordinator.commission()
```

---

### 4.2 `$CONFIDE` Token (`GlaselToken.sol`)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20VotesUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract GlaselToken is
    ERC20PermitUpgradeable,
    ERC20VotesUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant BURNER_ROLE   = keccak256("BURNER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    uint256 public constant MAX_SUPPLY = 1_000_000_000 ether; // 1B tokens

    function initialize(address admin) external initializer {
        __ERC20_init("Glasel", "CONFIDE");
        __ERC20Permit_init("Glasel");
        __ERC20Votes_init();
        __AccessControl_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        require(totalSupply() + amount <= MAX_SUPPLY, "exceeds max supply");
        _mint(to, amount);
    }

    // Called by Governance when a failed proposal's deposit is burned
    function burn(address from, uint256 amount) external onlyRole(BURNER_ROLE) {
        _burn(from, amount);
    }

    // ERC20Votes + ERC20Permit require override
    function _afterTokenTransfer(address from, address to, uint256 amount)
        internal override(ERC20Upgradeable, ERC20VotesUpgradeable)
    {
        super._afterTokenTransfer(from, to, amount);
    }

    function _mint(address to, uint256 amount)
        internal override(ERC20Upgradeable, ERC20VotesUpgradeable)
    {
        super._mint(to, amount);
    }

    function _burn(address account, uint256 amount)
        internal override(ERC20Upgradeable, ERC20VotesUpgradeable)
    {
        super._burn(account, amount);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
```

**Token distribution (suggested):**

| Allocation          | %  | Vesting                              |
|---------------------|----|--------------------------------------|
| Node operator pool  | 25 | Earned via computation fees          |
| Ecosystem grants    | 20 | 4-year linear, 1-year cliff          |
| Team                | 15 | 4-year linear, 1-year cliff          |
| Protocol treasury   | 20 | Governance-controlled                |
| Community/airdrop   | 10 | TGE + 12-month linear                |
| Investors           | 10 | 2-year linear, 6-month cliff         |

---

### 4.3 `NodeRegistry.sol`

Each Arx node operator registers once. The registry stores the cryptographic identifiers the system needs to route work to nodes and verify their results.

```solidity
struct ArxNode {
    bytes   blsPubKey;         // BLS12-381 G1 compressed (48 bytes)
                               // used for threshold signature aggregation
    bytes32 x25519PubKey;      // node's contribution to cluster DKG
    bytes32 hardwareHash;      // keccak256(cpu_id || ram_bytes || disk_bytes)
    string  jurisdiction;      // ISO 3166-1 alpha-2, e.g. "US", "DE"
    address operatorAddress;   // receives rewards
    address ownerAddress;      // can update metadata / deregister
    uint64  registeredAt;
    bool    active;
}

mapping(address nodeId => ArxNode) public nodes;
mapping(bytes32 blsPubKeyHash => address nodeId) public nodeByBls;

event NodeRegistered(address indexed nodeId, bytes blsPubKey, string jurisdiction);
event NodeDeactivated(address indexed nodeId);
event NodeMetadataUpdated(address indexed nodeId);

function registerNode(
    bytes   calldata blsPubKey,
    bytes32          x25519PubKey,
    bytes32          hardwareHash,
    string  calldata jurisdiction
) external {
    require(blsPubKey.length == 48, "invalid BLS key length");
    require(nodes[msg.sender].registeredAt == 0, "already registered");

    // Verify BLS key is a valid G1 point (precompile call or lib)
    require(_isValidG1Point(blsPubKey), "invalid BLS G1 point");

    bytes32 blsHash = keccak256(blsPubKey);
    require(nodeByBls[blsHash] == address(0), "BLS key already registered");

    nodes[msg.sender] = ArxNode({
        blsPubKey:       blsPubKey,
        x25519PubKey:    x25519PubKey,
        hardwareHash:    hardwareHash,
        jurisdiction:    jurisdiction,
        operatorAddress: msg.sender,
        ownerAddress:    msg.sender,
        registeredAt:    uint64(block.timestamp),
        active:          true
    });

    nodeByBls[blsHash] = msg.sender;
    emit NodeRegistered(msg.sender, blsPubKey, jurisdiction);
}

// Node operators can rotate their X25519 key (triggers cluster re-keying)
function rotateX25519Key(bytes32 newX25519PubKey) external {
    require(nodes[msg.sender].active, "node not active");
    nodes[msg.sender].x25519PubKey = newX25519PubKey;
    emit NodeMetadataUpdated(msg.sender);
}

function deactivateNode(address nodeId) external {
    require(
        msg.sender == nodes[nodeId].ownerAddress || msg.sender == address(slashingModule),
        "unauthorized"
    );
    nodes[nodeId].active = false;
    emit NodeDeactivated(nodeId);
}
```

---

### 4.4 `ClusterManager.sol`

A cluster is a fixed set of nodes that jointly execute MPC. The cluster's combined X25519 public key (derived via a distributed key generation ceremony off-chain) is stored here and is what clients use to encrypt inputs.

```solidity
enum ClusterStatus { Forming, Active, Migrating, Dissolved }
enum ClusterPermission { Permissionless, SemiPermissioned, FullyPermissioned }

struct Cluster {
    address[]         nodes;             // ordered list; index = party ID in MPC
    bytes32           clusterPubKey;     // combined X25519 from off-chain DKG
    uint32            minThreshold;      // min BLS signers to accept result
    uint32            maxComputations;   // concurrent computation capacity
    ClusterPermission permission;
    ClusterStatus     status;
    address           owner;             // for permissioned clusters
    uint64            activatedAt;
    uint64            dissolvedAt;
}

mapping(bytes32 clusterId => Cluster)          public clusters;
mapping(bytes32 clusterId => bytes32[])        public clusterComputationQueue;

// Sybil check: no operator can appear in same cluster twice
// and no two nodes from same operator in same cluster
mapping(bytes32 clusterId => mapping(address operator => uint256 nodeCount))
    private _operatorNodeCount;

bytes32[] public activeClusterIds;

event ClusterProposed(bytes32 indexed clusterId, address[] nodes);
event ClusterActivated(bytes32 indexed clusterId, bytes32 clusterPubKey);
event ClusterDissolved(bytes32 indexed clusterId);

// Step 1: Propose cluster (any node can propose, must include self)
function proposeCluster(
    address[]        calldata nodeAddresses,
    ClusterPermission        permission,
    uint32                   minThreshold,
    address                  owner
) external returns (bytes32 clusterId) {
    require(nodeAddresses.length >= 3, "min 3 nodes");
    require(minThreshold >= nodeAddresses.length / 2 + 1, "threshold too low");
    require(minThreshold <= nodeAddresses.length, "threshold too high");

    // Validate all nodes are registered and active
    for (uint i; i < nodeAddresses.length; ++i) {
        require(registry.nodes(nodeAddresses[i]).active, "node not active");

        // Sybil check: same operator cannot appear more than once per cluster
        address op = registry.nodes(nodeAddresses[i]).operatorAddress;
        _operatorNodeCount[clusterId][op]++;
        require(_operatorNodeCount[clusterId][op] == 1, "operator appears twice");
    }

    clusterId = keccak256(abi.encode(nodeAddresses, block.timestamp, msg.sender));

    clusters[clusterId] = Cluster({
        nodes:           nodeAddresses,
        clusterPubKey:   bytes32(0),    // set during activation
        minThreshold:    minThreshold,
        maxComputations: uint32(nodeAddresses.length * 10),
        permission:      permission,
        status:          ClusterStatus.Forming,
        owner:           owner,
        activatedAt:     0,
        dissolvedAt:     0
    });

    emit ClusterProposed(clusterId, nodeAddresses);
}

// Step 2: After off-chain DKG completes, nodes submit the combined key
// Requires minThreshold node signatures over (clusterId || combinedKey)
function activateCluster(
    bytes32          clusterId,
    bytes32          combinedX25519Key,
    bytes   calldata aggregatedBlsSig,
    address[] calldata signers
) external {
    Cluster storage c = clusters[clusterId];
    require(c.status == ClusterStatus.Forming, "not forming");
    require(signers.length >= c.minThreshold, "insufficient signers");

    bytes32 message = keccak256(abi.encode(clusterId, combinedX25519Key));
    _verifyBLSAggregate(message, aggregatedBlsSig, signers, c.nodes);

    c.clusterPubKey = combinedX25519Key;
    c.status        = ClusterStatus.Active;
    c.activatedAt   = uint64(block.timestamp);

    activeClusterIds.push(clusterId);
    emit ClusterActivated(clusterId, combinedX25519Key);
}

// Node replacement (migration) when a node goes offline
function initiateNodeMigration(
    bytes32 clusterId,
    address offlineNode,
    address replacementNode
) external {
    // Called by remaining nodes after threshold agrees node is offline
    // Triggers re-keying ceremony off-chain; new cluster key submitted via activateCluster()
}
```

---

### 4.5 `MXEFactory.sol`

An MXE (MPC eXecution Environment) is a named configuration that binds a cluster, a protocol, and security parameters. Developers create one MXE per application (or one per security profile). Multiple applications can share an MXE.

```solidity
enum Protocol { Cerberus, Manticore }

struct MXE {
    bytes32   clusterId;
    Protocol  protocol;
    bytes32[] allowedComputationDefs;  // empty = allow all
    address   owner;
    bool      active;
    uint64    createdAt;
    // Fallback cluster if primary is at capacity
    bytes32   fallbackClusterId;
}

mapping(bytes32 mxeId => MXE) public mxes;

event MXECreated(bytes32 indexed mxeId, bytes32 clusterId, Protocol protocol);
event MXEDeactivated(bytes32 indexed mxeId);

function createMXE(
    bytes32   clusterId,
    Protocol  protocol,
    bytes32[] calldata allowedComputationDefs,
    bytes32   fallbackClusterId
) external returns (bytes32 mxeId) {
    require(clusterManager.clusters(clusterId).status == ClusterStatus.Active, "cluster not active");

    // Manticore requires the cluster to be permissioned (trusted operators only)
    if (protocol == Protocol.Manticore) {
        require(
            clusterManager.clusters(clusterId).permission != ClusterPermission.Permissionless,
            "Manticore requires permissioned cluster"
        );
    }

    mxeId = keccak256(abi.encode(clusterId, protocol, msg.sender, block.timestamp));

    mxes[mxeId] = MXE({
        clusterId:              clusterId,
        protocol:               protocol,
        allowedComputationDefs: allowedComputationDefs,
        owner:                  msg.sender,
        active:                 true,
        createdAt:              uint64(block.timestamp),
        fallbackClusterId:      fallbackClusterId
    });

    emit MXECreated(mxeId, clusterId, protocol);
}
```

---

### 4.6 `ComputationRegistry.sol`

When a developer compiles an Arcis circuit, the CLI uploads the arithmetic circuit representation here. For circuits under ~24KB the bytecode is stored directly in contract storage. For larger circuits, an IPFS CID is stored and nodes fetch the full bytecode from IPFS (validating against the on-chain hash).

```solidity
struct ComputationDefinition {
    bytes32  bytecodeHash;        // keccak256 of full circuit bytecode
    bytes    bytecode;            // stored inline if len <= MAX_INLINE_SIZE
    string   ipfsCid;             // non-empty if stored off-chain
    uint32   estimatedGates;      // approximate gate count for fee estimation
    uint32   inputCount;          // expected encrypted input count
    uint32   outputCount;
    address  deployer;
    uint64   deployedAt;
    bool     deprecated;
}

uint256 public constant MAX_INLINE_SIZE = 24_576; // 24KB

mapping(bytes32 compDefId => ComputationDefinition) public computationDefs;

event ComputationDefinitionDeployed(
    bytes32 indexed compDefId,
    address indexed deployer,
    uint32  estimatedGates
);

function deployComputationDefinition(
    bytes   calldata bytecode,
    string  calldata ipfsCid,
    uint32           estimatedGates,
    uint32           inputCount,
    uint32           outputCount
) external returns (bytes32 compDefId) {
    bytes32 bytecodeHash = keccak256(bytecode.length > 0 ? bytecode : bytes(ipfsCid));

    compDefId = keccak256(abi.encode(bytecodeHash, msg.sender, block.timestamp));

    computationDefs[compDefId] = ComputationDefinition({
        bytecodeHash:   bytecodeHash,
        bytecode:       bytecode.length <= MAX_INLINE_SIZE ? bytecode : bytes(""),
        ipfsCid:        ipfsCid,
        estimatedGates: estimatedGates,
        inputCount:     inputCount,
        outputCount:    outputCount,
        deployer:       msg.sender,
        deployedAt:     uint64(block.timestamp),
        deprecated:     false
    });

    emit ComputationDefinitionDeployed(compDefId, msg.sender, estimatedGates);
}
```

---

### 4.7 `ComputationCoordinator.sol`

The most critical contract. Handles commissioning, scheduling, result acceptance, callback dispatch, and fee settlement. Every computation request flows through here.

```solidity
enum ComputationStatus {
    Pending,      // commissioned, not yet picked up
    InProgress,   // nodes acknowledged, running MPC
    Completed,    // result submitted and callback fired
    Failed,       // timed out or nodes could not agree
    Slashed       // nodes slashed for misbehavior
}

struct Computation {
    bytes32           mxeId;
    bytes32           compDefId;
    bytes             encInputs;          // X25519-encrypted, Rescue-ciphered
    string            inputIpfsCid;       // for large inputs (EIP-4844 flow)
    address           callbackContract;
    bytes4            callbackSelector;
    uint256           callbackGasLimit;
    uint256           feeDeposit;         // in $CONFIDE
    uint256           priorityFee;        // tip for faster scheduling
    address           requester;
    uint64            commissionedAt;
    uint64            deadline;           // must complete before this timestamp
    ComputationStatus status;
    bytes             encResult;          // populated on completion
    bytes32           resultCommitment;   // keccak256(computationId || encResult)
    bool              callbackSucceeded;
}

mapping(bytes32 computationId => Computation) public computations;

// Pull model fallback: if push callback fails, result stored here
mapping(bytes32 computationId => bytes) public pendingPullResults;

event ComputationRequested(
    bytes32 indexed computationId,
    bytes32 indexed mxeId,
    bytes32 indexed compDefId,
    bytes           encInputs,
    string          inputIpfsCid,
    uint64          deadline
);

event ComputationCompleted(
    bytes32 indexed computationId,
    bytes32         resultCommitment,
    bool            callbackSucceeded
);

event ComputationFailed(
    bytes32 indexed computationId,
    string          reason
);

event ComputationSlashed(
    bytes32 indexed computationId,
    address[]       slashedNodes
);

// ─── Commission ─────────────────────────────────────────────────────────────

function commission(
    bytes32 mxeId,
    bytes32 compDefId,
    bytes   calldata encInputs,
    string  calldata inputIpfsCid,    // pass "" if inputs inline
    address callbackContract,
    bytes4  callbackSelector,
    uint256 callbackGasLimit,
    uint256 priorityFee
) external nonReentrant returns (bytes32 computationId) {
    MXE   memory mxe     = mxeFactory.mxes(mxeId);
    ComputationDefinition memory def = registry.computationDefs(compDefId);

    require(mxe.active, "MXE not active");
    require(!def.deprecated, "computation def deprecated");

    // Validate compDef is allowed by this MXE
    if (mxe.allowedComputationDefs.length > 0) {
        require(_isAllowed(mxe.allowedComputationDefs, compDefId), "compDef not allowed");
    }

    uint256 baseFee    = feeOracle.estimateFee(compDefId, callbackGasLimit);
    uint256 totalFee   = baseFee + priorityFee;

    // Fee payment via ERC-20 transfer (uses permit for gasless approve)
    confideToken.transferFrom(msg.sender, address(this), totalFee);

    uint64 deadline = uint64(block.timestamp) + feeOracle.deadlineForCircuit(compDefId);

    computationId = keccak256(
        abi.encode(mxeId, compDefId, encInputs, msg.sender, block.timestamp, block.prevrandao)
    );

    computations[computationId] = Computation({
        mxeId:              mxeId,
        compDefId:          compDefId,
        encInputs:          encInputs,
        inputIpfsCid:       inputIpfsCid,
        callbackContract:   callbackContract,
        callbackSelector:   callbackSelector,
        callbackGasLimit:   callbackGasLimit,
        feeDeposit:         totalFee,
        priorityFee:        priorityFee,
        requester:          msg.sender,
        commissionedAt:     uint64(block.timestamp),
        deadline:           deadline,
        status:             ComputationStatus.Pending,
        encResult:          bytes(""),
        resultCommitment:   bytes32(0),
        callbackSucceeded:  false
    });

    emit ComputationRequested(
        computationId, mxeId, compDefId,
        encInputs, inputIpfsCid, deadline
    );
}

// ─── Submit Result ──────────────────────────────────────────────────────────

function submitResult(
    bytes32   computationId,
    bytes     calldata encResult,
    bytes     calldata aggregatedBlsSig,
    address[] calldata signers
) external nonReentrant {
    Computation storage comp = computations[computationId];

    require(comp.status == ComputationStatus.Pending
         || comp.status == ComputationStatus.InProgress, "invalid status");
    require(block.timestamp <= comp.deadline, "past deadline");

    // Verify BLS aggregate signature from threshold-many cluster nodes
    Cluster memory cluster = _getCluster(comp.mxeId);
    require(signers.length >= cluster.minThreshold, "below threshold");

    bytes32 message = keccak256(abi.encode(computationId, encResult));
    _verifyBLSAggregate(message, aggregatedBlsSig, signers, cluster.nodes);

    comp.encResult       = encResult;
    comp.resultCommitment = message;
    comp.status          = ComputationStatus.Completed;

    // Attempt push callback
    bool callbackOk = _tryCallback(comp, computationId, encResult);
    comp.callbackSucceeded = callbackOk;

    if (!callbackOk) {
        // Store for pull model
        pendingPullResults[computationId] = encResult;
    }

    // Distribute fees to participating nodes
    _distributeFees(comp.feeDeposit, signers);

    emit ComputationCompleted(computationId, message, callbackOk);
}

// ─── Push Callback ──────────────────────────────────────────────────────────

function _tryCallback(
    Computation memory comp,
    bytes32            computationId,
    bytes memory       encResult
) internal returns (bool success) {
    bytes memory callData = abi.encodeWithSelector(
        comp.callbackSelector,
        computationId,
        encResult
    );

    (success,) = comp.callbackContract.call{gas: comp.callbackGasLimit}(callData);
}

// ─── Pull Model ─────────────────────────────────────────────────────────────

function pullResult(bytes32 computationId)
    external
    returns (bytes memory encResult)
{
    Computation storage comp = computations[computationId];
    require(comp.callbackContract == msg.sender, "only callback contract can pull");
    require(comp.status == ComputationStatus.Completed, "not completed");
    require(!comp.callbackSucceeded, "push already succeeded");

    encResult = pendingPullResults[computationId];
    delete pendingPullResults[computationId];

    comp.callbackSucceeded = true;
}

// ─── Slash Timed-Out Computation ────────────────────────────────────────────

function slashTimedOut(bytes32 computationId) external {
    Computation storage comp = computations[computationId];
    require(comp.status == ComputationStatus.Pending
         || comp.status == ComputationStatus.InProgress, "not active");
    require(block.timestamp > comp.deadline, "not past deadline");

    comp.status = ComputationStatus.Failed;

    Cluster memory cluster = _getCluster(comp.mxeId);
    address[] memory nodesToSlash = cluster.nodes;

    // Partial slash for all cluster nodes (they failed to deliver)
    stakingManager.slashNodes(nodesToSlash, SlashReason.MissedDeadline, comp.compDefId);

    // Refund requester
    confideToken.transfer(comp.requester, comp.feeDeposit);

    emit ComputationFailed(computationId, "deadline exceeded");
    emit ComputationSlashed(computationId, nodesToSlash);
}
```

---

### 4.8 `StakingManager.sol`

```solidity
enum SlashReason { MissedDeadline, IncorrectResult, OfflineDuringComputation }

struct NodeStakeInfo {
    uint256 selfStaked;
    uint256 delegatedStake;
    uint256 totalStake;           // selfStaked + delegatedStake
    uint256 reputationScore;      // 0–10_000 (basis points), affects selection weight
    uint256 computationsCompleted;
    uint256 computationsFailed;
    uint256 accumulatedRewards;
    uint256 pendingSlash;
    uint64  lastActivityAt;
    bool    jailed;               // jailed nodes excluded from cluster selection
}

mapping(address nodeId   => NodeStakeInfo)                          public nodeStakes;
mapping(address delegator => mapping(address nodeId => uint256))    public delegations;
mapping(address delegator => uint256)                               public totalDelegated;

uint256 public constant MIN_SELF_STAKE   = 10_000 ether; // 10K CONFIDE
uint256 public constant SLASH_MISSED     = 500;          // basis points (5%)
uint256 public constant SLASH_INCORRECT  = 3_000;        // 30%
uint256 public constant SLASH_OFFLINE    = 200;          // 2%

event NodeStaked(address indexed nodeId, uint256 amount);
event NodeUnstaked(address indexed nodeId, uint256 amount);
event NodeSlashed(address indexed nodeId, SlashReason reason, uint256 slashAmount);
event NodeJailed(address indexed nodeId);
event NodeUnjailed(address indexed nodeId);
event DelegationAdded(address indexed delegator, address indexed nodeId, uint256 amount);
event RewardsClaimed(address indexed nodeId, uint256 amount);

function stake(address nodeId, uint256 amount) external {
    require(registry.nodes(nodeId).ownerAddress == msg.sender, "not node owner");
    confideToken.transferFrom(msg.sender, address(this), amount);
    nodeStakes[nodeId].selfStaked   += amount;
    nodeStakes[nodeId].totalStake   += amount;
    emit NodeStaked(nodeId, amount);
}

function delegate(address nodeId, uint256 amount) external {
    require(nodeStakes[nodeId].selfStaked >= MIN_SELF_STAKE, "node undercapitalized");
    require(!nodeStakes[nodeId].jailed, "node jailed");
    confideToken.transferFrom(msg.sender, address(this), amount);
    delegations[msg.sender][nodeId]  += amount;
    totalDelegated[msg.sender]       += amount;
    nodeStakes[nodeId].delegatedStake += amount;
    nodeStakes[nodeId].totalStake    += amount;
    emit DelegationAdded(msg.sender, nodeId, amount);
}

// 7-day unbonding period for self-stake; 3-day for delegations
function initiateUnstake(address nodeId, uint256 amount) external {
    // Records an unbonding entry with unlock timestamp
    // Actual transfer happens after unbonding period via claimUnstake()
}

function slashNodes(
    address[] calldata nodesToSlash,
    SlashReason        reason,
    bytes32            compDefId
) external onlyCoordinator {
    uint256 basisPoints = reason == SlashReason.MissedDeadline    ? SLASH_MISSED
                        : reason == SlashReason.IncorrectResult   ? SLASH_INCORRECT
                        :                                           SLASH_OFFLINE;

    for (uint i; i < nodesToSlash.length; ++i) {
        address node = nodesToSlash[i];
        NodeStakeInfo storage s = nodeStakes[node];

        uint256 slashAmount = s.totalStake * basisPoints / 10_000;
        s.totalStake  -= slashAmount;
        s.selfStaked  -= _min(slashAmount, s.selfStaked);
        s.computationsFailed++;

        // Reputation decay
        s.reputationScore = s.reputationScore > 1_000
            ? s.reputationScore - 1_000
            : 0;

        // Jail node if reputation < 2000 (20%)
        if (s.reputationScore < 2_000) {
            s.jailed = true;
            emit NodeJailed(node);
        }

        // Slashed funds go to protocol treasury
        confideToken.transfer(treasury, slashAmount);
        emit NodeSlashed(node, reason, slashAmount);
    }
}

function distributeFees(address[] calldata nodes, uint256 totalFee)
    external
    onlyCoordinator
{
    // Fee split: 90% to nodes, 10% to protocol treasury
    uint256 nodeShare     = totalFee * 90 / 100;
    uint256 protocolShare = totalFee - nodeShare;
    uint256 perNode       = nodeShare / nodes.length;

    for (uint i; i < nodes.length; ++i) {
        nodeStakes[nodes[i]].accumulatedRewards += perNode;
    }
    confideToken.transfer(treasury, protocolShare);
}
```

---

### 4.9 `FeeOracle.sol`

Fees scale with circuit complexity (gate count), current Base gas price, and the callback gas limit. Priority fees allow requesters to jump the queue.

```solidity
contract FeeOracle {
    // Base fee per 1000 gates (in CONFIDE tokens, scaled by 18 decimals)
    uint256 public feePerKGates         = 0.1 ether;
    uint256 public callbackGasPremium   = 120;  // 120% of estimated callback gas cost
    uint256 public minFee               = 0.5 ether;
    uint256 public maxFee               = 10_000 ether;

    // Deadline: 30 seconds per 10K gates, min 60s, max 10min
    uint256 public secondsPer10KGates   = 30;
    uint256 public minDeadlineSeconds   = 60;
    uint256 public maxDeadlineSeconds   = 600;

    function estimateFee(
        bytes32 compDefId,
        uint256 callbackGasLimit
    ) external view returns (uint256 fee) {
        uint32  gates        = registry.computationDefs(compDefId).estimatedGates;
        uint256 circuitFee   = (gates / 1000) * feePerKGates;
        uint256 callbackFee  = callbackGasLimit
                               * block.basefee
                               * callbackGasPremium
                               / 100
                               / 1e9;  // convert gwei to CONFIDE at oracle rate

        fee = _clamp(circuitFee + callbackFee, minFee, maxFee);
    }

    function deadlineForCircuit(bytes32 compDefId) external view returns (uint64) {
        uint32  gates    = registry.computationDefs(compDefId).estimatedGates;
        uint256 deadline = (gates / 10_000) * secondsPer10KGates;
        return uint64(_clamp(deadline, minDeadlineSeconds, maxDeadlineSeconds));
    }
}
```

---

### 4.10 `Governance.sol` + `TimelockController`

Uses OpenZeppelin's `GovernorUpgradeable` with custom voting power (lockup-weighted).

```solidity
contract GlaselGovernor is
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorVotesUpgradeable,
    GovernorTimelockControlUpgradeable,
    UUPSUpgradeable
{
    // Voting power = staked CONFIDE × lockupMultiplier
    // Lockup 0 days  → 1x
    // Lockup 90 days → 1.5x
    // Lockup 365 days → 2x
    // Lockup 730 days → 3x (max)

    uint256 public constant PROPOSAL_FEE = 1_000 ether; // burned if vote fails

    // Quorum: 4% of circulating supply
    function quorum(uint256 blockNumber)
        public view override returns (uint256)
    {
        return confideToken.getPastTotalSupply(blockNumber) * 4 / 100;
    }

    // Proposal threshold: must hold 0.1% of supply to propose
    function proposalThreshold()
        public view override returns (uint256)
    {
        return confideToken.totalSupply() / 1000;
    }

    // Technical upgrade proposals burn fee if they fail
    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[]   memory calldatas,
        bytes32   descriptionHash
    ) internal override returns (uint256) {
        // Burn the proposer's fee deposit
        confideToken.burn(proposerOf[hashProposal(targets, values, calldatas, descriptionHash)], PROPOSAL_FEE);
        return super._cancel(targets, values, calldatas, descriptionHash);
    }
}
```

Timelock is `TimelockController` with:
- Minimum delay: **48 hours** for parameter changes
- Minimum delay: **7 days** for contract upgrades
- Proposers: Governor contract
- Executors: anyone (permissionless execution after delay)
- Admin: renounced after bootstrap

---

### 4.11 `ConfidentialBase.sol` (Abstract)

This is what application developers inherit. It abstracts all interaction with the Coordinator.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IComputationCoordinator.sol";
import "./interfaces/IFeeOracle.sol";

abstract contract ConfidentialBase {
    IComputationCoordinator private immutable _coordinator;
    IFeeOracle              private immutable _feeOracle;
    IERC20                  private immutable _confide;

    mapping(bytes32 computationId => bytes32) internal _pendingComputations;

    error NotCoordinator();
    error UnknownComputation(bytes32 computationId);

    modifier onlyCoordinator() {
        if (msg.sender != address(_coordinator)) revert NotCoordinator();
        _;
    }

    constructor(address coordinator, address feeOracle, address confideToken) {
        _coordinator = IComputationCoordinator(coordinator);
        _feeOracle   = IFeeOracle(feeOracle);
        _confide     = IERC20(confideToken);
        // Infinite approval to coordinator for fee payments
        _confide.approve(address(_coordinator), type(uint256).max);
    }

    // ─── Internal helpers ────────────────────────────────────────────────────

    function _invokeConfidential(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes   memory encInputs,
        uint256 callbackGasLimit
    ) internal returns (bytes32 computationId) {
        return _invokeConfidentialWithPriority(mxeId, compDefId, encInputs, callbackGasLimit, 0);
    }

    function _invokeConfidentialWithPriority(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes   memory encInputs,
        uint256 callbackGasLimit,
        uint256 priorityFee
    ) internal returns (bytes32 computationId) {
        uint256 totalFee = _feeOracle.estimateFee(compDefId, callbackGasLimit) + priorityFee;

        // Ensure contract has enough $CONFIDE (pull from msg.sender)
        if (_confide.balanceOf(address(this)) < totalFee) {
            _confide.transferFrom(msg.sender, address(this), totalFee);
        }

        computationId = _coordinator.commission(
            mxeId,
            compDefId,
            encInputs,
            "",
            address(this),
            this.onComputationComplete.selector,
            callbackGasLimit,
            priorityFee
        );

        _pendingComputations[computationId] = compDefId;
    }

    // For large inputs — uses IPFS CID stored on-chain, data in blob
    function _invokeConfidentialLarge(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes32 blobHash,          // from blobhash() opcode
        string  memory ipfsCid,
        uint256 callbackGasLimit
    ) internal returns (bytes32 computationId) {
        // encInputs = abi.encode(blobHash) as a sentinel
        bytes memory blobRef = abi.encode(blobHash);
        computationId = _coordinator.commission(
            mxeId, compDefId, blobRef, ipfsCid,
            address(this), this.onComputationComplete.selector,
            callbackGasLimit, 0
        );
    }

    // ─── Override in your contract ───────────────────────────────────────────

    function onComputationComplete(
        bytes32 computationId,
        bytes   calldata encResult
    ) external virtual onlyCoordinator {
        revert UnknownComputation(computationId);
    }
}
```

---

### 4.12 Upgradeability Strategy

| Contract             | Proxy Type          | Upgrade Authority                |
|----------------------|---------------------|----------------------------------|
| GlaselToken         | UUPS                | Timelock (7-day delay)           |
| NodeRegistry         | UUPS                | Timelock (48h delay)             |
| ClusterManager       | UUPS                | Timelock (48h delay)             |
| MXEFactory           | UUPS                | Timelock (48h delay)             |
| ComputationRegistry  | UUPS                | Timelock (48h delay)             |
| ComputationCoordinator | UUPS              | Timelock (7-day delay)           |
| StakingManager       | UUPS                | Timelock (7-day delay)           |
| FeeOracle            | UUPS                | Timelock (48h delay)             |
| Governance           | UUPS                | Self-governed via vote           |

All proxy deployments use `ERC1967Proxy`. Implementation contracts include `_authorizeUpgrade` gated by `onlyRole(UPGRADER_ROLE)` where `UPGRADER_ROLE` is held exclusively by the `TimelockController`.

Storage layout is managed via explicit slot declarations (OpenZeppelin's `StorageSlotUpgradeable` pattern) to prevent upgrade storage collisions. Every implementation contract version is audited before timelock submission.

---

## 5. Off-Chain Node Infrastructure

### 5.1 Node Daemon Architecture (`GlaselOS`)

The node daemon is a long-running Rust process. It has four major subsystems:

```
┌──────────────────────────────────────────────────────┐
│  GlaselOS Daemon                                        │
│                                                      │
│  ┌──────────────────┐   ┌──────────────────────────┐ │
│  │  Chain Listener  │   │  Key Management Service  │ │
│  │  (alloy-rs)      │   │  (HSM / secure enclave)  │ │
│  │                  │   │                          │ │
│  │  Subscribes to:  │   │  - Node BLS signing key  │ │
│  │  ComputationReq  │   │  - X25519 share key      │ │
│  │  ClusterEvents   │   │  - Keyshare material     │ │
│  └────────┬─────────┘   └──────────────────────────┘ │
│           │                                          │
│  ┌────────▼─────────────────────────────────────────┐│
│  │  Computation Scheduler                           ││
│  │                                                  ││
│  │  Priority queue ordered by: priorityFee / gates  ││
│  │  Max concurrent: cluster.maxComputations         ││
│  └────────┬─────────────────────────────────────────┘│
│           │                                          │
│  ┌────────▼──────────────┐  ┌───────────────────────┐│
│  │  Cerberus Engine      │  │  Manticore Engine     ││
│  │                       │  │                       ││
│  │  - OT/VOLE offline    │  │  - Trusted Dealer     ││
│  │  - Online MPC phase   │  │  - Fast preprocessing ││
│  │  - Identifiable abort │  │  - ML-friendly ops    ││
│  └────────┬──────────────┘  └──────────┬────────────┘│
│           │                            │             │
│  ┌────────▼────────────────────────────▼────────────┐│
│  │  Result Submitter                                ││
│  │                                                  ││
│  │  - Aggregate BLS signatures from peer nodes      ││
│  │  - Build submitResult() transaction              ││
│  │  - Gas estimation + EIP-1559 priority fee        ││
│  │  - Retry logic with exponential backoff          ││
│  └──────────────────────────────────────────────────┘│
└──────────────────────────────────────────────────────┘
```

**Core daemon loop (pseudo-Rust):**

```rust
#[tokio::main]
async fn main() -> Result<()> {
    let config    = Config::load("glaseld.toml")?;
    let keystore  = KeyManagementService::init(&config.hsm).await?;
    let chain     = ChainListener::new(&config.rpc_url, &config.contracts).await?;
    let scheduler = ComputationScheduler::new(&config);
    let p2p       = P2PLayer::new(&config.peers).await?;

    // Subscribe to on-chain events
    let mut events = chain.subscribe_computation_requests(config.cluster_id).await?;

    loop {
        tokio::select! {
            Some(event) = events.next() => {
                match event {
                    ChainEvent::ComputationRequested(req) => {
                        scheduler.enqueue(req).await?;
                    },
                    ChainEvent::ClusterMigration(migration) => {
                        // Participate in re-keying ceremony
                        keystore.initiate_rekey(migration).await?;
                    },
                    ChainEvent::NodeJailed(node_id) if node_id == config.node_id => {
                        warn!("This node has been jailed. Stopping new work.");
                        scheduler.drain().await?;
                    }
                }
            },
            Some(comp) = scheduler.next_ready() => {
                tokio::spawn(run_computation(comp, keystore.clone(), p2p.clone()));
            }
        }
    }
}

async fn run_computation(
    comp:     ComputationTask,
    keystore: KeyManagementService,
    p2p:      P2PLayer,
) -> Result<()> {
    // 1. Fetch circuit from ComputationRegistry (inline or IPFS)
    let circuit = fetch_circuit(&comp.comp_def_id).await?;

    // 2. Decrypt input shares from encrypted calldata
    let input_shares = keystore.decrypt_shares(&comp.enc_inputs)?;

    // 3. Run MPC protocol
    let enc_result = match comp.protocol {
        Protocol::Cerberus => {
            let mut cerberus = CerberusEngine::new(comp.party_id, comp.cluster_size);
            cerberus.run(circuit, input_shares, &p2p, comp.session_id).await?
        },
        Protocol::Manticore => {
            let mut manticore = ManticoreEngine::new(comp.party_id, comp.cluster_size);
            manticore.run(circuit, input_shares, &p2p, comp.session_id).await?
        }
    };

    // 4. Sign result with BLS key
    let sig = keystore.bls_sign(
        &keccak256_concat(comp.computation_id, &enc_result)
    )?;

    // 5. Broadcast signature to peers; leader aggregates and submits
    p2p.broadcast_result_signature(comp.computation_id, enc_result, sig).await?;

    Ok(())
}
```

---

### 5.2 Cerberus MPC Engine

Cerberus implements the BMRS24 protocol with identifiable abort under dishonest majority. The full specification is in the Arcium Cerberus whitepaper (June 2026). Implementation plan:

**Phase 1 — Primitives:**

```rust
// Oblivious Transfer (OT) — based on Simplest OT (CO15)
pub struct ObliviousTransfer {
    // Sender holds (m0, m1); Receiver holds choice bit b
    // Output: receiver learns m_b, sender learns nothing
}

// Vector OLE (VOLE) — extend OT to field elements
// Enables efficient additive secret sharing operations
pub struct VOLE {
    field: FieldElement,  // Fp where p = 2^255 - 19 (matches X25519 field)
    // Generates authenticated triples: (u, v, w) where u*delta = v + w
}

// Authenticated Secret Sharing (SPDZ-style)
pub struct AuthShare {
    value: FieldElement,
    mac:   FieldElement,  // MAC = value * delta + randomness
    // Prevents forgery; if MAC check fails, abort and identify cheater
}
```

**Phase 2 — Preprocessing (offline phase):**

```rust
// The most expensive part; done before computation starts
// Generates Beaver multiplication triples: (a, b, c) where a*b = c
// Each triple is secret-shared across all nodes
// Nodes can compute ~100K triples/second with modern hardware

pub async fn generate_triples(
    count:      usize,
    session_id: SessionId,
    peers:      &P2PLayer,
) -> Vec<BeaverTriple> {
    // Use VOLE extension to batch-generate triples efficiently
    // Communication: O(count * log(security_param)) bits
}
```

**Phase 3 — Online phase:**

```rust
pub struct CerberusEngine {
    party_id:     usize,
    n_parties:    usize,
    triples:      VecDeque<BeaverTriple>,
    session_id:   SessionId,
}

impl CerberusEngine {
    pub async fn run(
        &mut self,
        circuit: &ArithmeticCircuit,
        inputs:  &[AuthShare],
        peers:   &P2PLayer,
    ) -> Result<Vec<EncOutput>> {

        // Evaluate circuit gate by gate
        let mut wire_values: HashMap<WireId, AuthShare> = HashMap::new();

        for gate in circuit.gates() {
            let result = match gate {
                Gate::Add(a, b) => {
                    // Addition is free — local computation, no communication
                    wire_values[a].add(&wire_values[b])
                },
                Gate::MulConst(a, c) => {
                    // Scalar multiplication is free
                    wire_values[a].mul_const(c)
                },
                Gate::Mul(a, b) => {
                    // Multiplication requires communication (1 round)
                    let triple = self.triples.pop_front()
                        .ok_or(Error::InsufficientTriples)?;
                    self.beaver_multiply(&wire_values[a], &wire_values[b], triple, peers).await?
                },
            };

            // MAC check: verify no party deviated
            // If MAC is invalid, identify the cheater and abort
            result.verify_mac()?;
            wire_values[gate.output_wire()] = result;
        }

        // Output reconstruction: only authorized parties learn the result
        let outputs = circuit.output_wires()
            .iter()
            .map(|w| self.reconstruct(wire_values[w].clone(), peers))
            .collect::<FuturesOrdered<_>>()
            .collect::<Vec<_>>()
            .await;

        outputs.into_iter().collect()
    }
}
```

---

### 5.3 Manticore Engine

Manticore operates in the honest-but-curious model with a Trusted Dealer for preprocessing. Suitable for ML inference where computational complexity demands performance over maximum-security guarantees.

```rust
pub struct ManticoreEngine {
    party_id:      usize,
    trusted_dealer: TrustedDealerClient, // the preprocessing node; goes offline after
}

impl ManticoreEngine {
    pub async fn run(
        &mut self,
        circuit: &ArithmeticCircuit,
        inputs:  &[SecretShare],  // additive shares (no MACs needed)
        peers:   &P2PLayer,
    ) -> Result<Vec<EncOutput>> {
        // Similar to Cerberus but:
        // 1. No MAC generation/verification (trusted-not-malicious assumption)
        // 2. Preprocessing material from Trusted Dealer, not VOLE
        // 3. Supports fixed-point arithmetic natively (for ML ops)
        // 4. ~3-5x faster than Cerberus for same circuit

        // Additional ML primitives:
        // - Truncation (for fixed-point mul)
        // - Comparison (for ReLU activation)
        // - ArgMax (for classification output)
    }
}
```

---

### 5.4 Key Management & HSM

Production nodes must store BLS signing keys and X25519 share keys in hardware. Recommended path:

```
Key Hierarchy:
├── Root key (hardware-backed: AWS CloudHSM / Nitro Enclave / YubiHSM2)
│   ├── BLS12-381 signing key
│   │   └── Signs: (computationId || encResult) for result attestation
│   ├── X25519 share key
│   │   └── Used in: cluster DKG, input encryption by clients
│   └── P2P TLS identity key
│       └── Authenticates: node-to-node MPC communication channels

Key rotation policy:
  - BLS key:    every 90 days, requires cluster re-keying
  - X25519 key: every 30 days, triggers ClusterManager.rotateX25519Key() on-chain
  - P2P TLS:    every 7 days, automatic
```

**Keyshare backup:** each node's VOLE/preprocessing keyshares are encrypted with threshold encryption to the other nodes. If a node loses its state, it can reconstruct shares from `threshold-1` peers. Reconstruction requires an on-chain governance proposal for nodes above the threshold to release recovery material.

---

### 5.5 P2P Communication Layer

Nodes communicate directly via mutually authenticated TLS 1.3 channels. No central relay.

```rust
pub struct P2PLayer {
    peers: HashMap<NodeId, TlsStream>,  // authenticated by NodeRegistry BLS pub keys
}

impl P2PLayer {
    // Send MPC message to specific peer
    pub async fn send(&self, peer: NodeId, msg: MpcMessage) -> Result<()> {
        let stream = &self.peers[&peer];
        let encoded = bincode::serialize(&msg)?;
        stream.write_all(&encoded).await?;
        Ok(())
    }

    // Broadcast to all peers (for preprocessing material, signature collection)
    pub async fn broadcast(&self, msg: MpcMessage) -> Result<()> {
        let futs: Vec<_> = self.peers.keys()
            .map(|peer| self.send(*peer, msg.clone()))
            .collect();
        futures::future::try_join_all(futs).await?;
        Ok(())
    }
}
```

Connection establishment uses the node's registered BLS public key for peer authentication (pinned certificate / raw public key TLS mode). If a peer's identity doesn't match `NodeRegistry`, the connection is rejected.

---

### 5.6 BLS Signature Aggregation

Instead of requiring N individual `ecrecover` calls on-chain (expensive), nodes aggregate their BLS signatures off-chain using BLS12-381.

```rust
// Node side: sign and broadcast
let message    = keccak256_concat(computation_id, &enc_result);
let signature  = bls_sign(&keystore.bls_key, &message);
p2p.broadcast_result_signature(computation_id, enc_result.clone(), signature).await?;

// Leader node: collect and aggregate once threshold is reached
let signatures: Vec<BlsSignature> = collect_signatures_until_threshold(
    computation_id,
    cluster.min_threshold,
    timeout = Duration::from_secs(30),
).await?;

let aggregated = bls_aggregate(&signatures);

// Submit single transaction with aggregated sig
chain.submit_result(computation_id, enc_result, aggregated, signers).await?;
```

On-chain BLS verification uses the `BLS12_381_G1_MSM` and `BLS12_381_MAP_FP_TO_G1` precompiles proposed in EIP-2537. Until Base ships EIP-2537, a Solidity-based BLS verifier library (e.g., `herumi/bls-eth-go` compiled to EVM via Yul) is used as a fallback, with a known gas premium (~200K gas per verification vs. ~45K with precompile).

---

## 6. Encryption Stack

### 6.1 X25519 + Distributed Key Generation

Each cluster has a **combined X25519 public key** derived via a t-of-n DKG ceremony run off-chain when the cluster forms. The combined key is stored in `ClusterManager`. Clients use this key to encrypt inputs — no individual node can decrypt inputs alone.

```
DKG Protocol (simplified Pedersen DKG):
1. Each node i generates ephemeral keypair (xi, Xi = xi * G)
2. Each node i broadcasts Xi to all peers
3. Nodes verify Xi are valid Curve25519 points
4. Combined key = X1 + X2 + ... + Xn (EC point addition)
5. Combined key stored on-chain via ClusterManager.activateCluster()

Decryption during MPC:
- Input encrypted as ECDH(client_ephemeral, cluster_combined_key)
- MPC nodes cooperatively run the Rescue decryption circuit
- No single node ever holds the combined private key
```

### 6.2 Rescue Cipher

Arcium's encryption stack is used unchanged. The Rescue cipher is chosen for its **MPC-friendliness** — it is arithmetization-oriented, meaning it can be evaluated efficiently inside an arithmetic circuit.

```
Key parameters (matching Arcium spec):
  - Field:          Fp where p = 2^255 - 19 (Curve25519 prime)
  - Block size:     m = 5 field elements
  - Security level: 128-bit
  - Mode:           CTR (Counter mode)
  - Counter format: [nonce, i, 0, 0, 0] where nonce = 16 random bytes
  - Rounds:         10 (minimum for m=5 at 128-bit security)

Key derivation:
  1. X25519 ECDH → shared_secret (32 bytes in F_p)
  2. Rescue-Prime KDF (rate=7, capacity=5, m=12, s=256)
     over F_{2^255-19}, output truncated to 5 field elements
  3. Resulting 5 F_p elements = Rescue cipher key

Decryption inside MPC:
  - Rescue decryption circuit is ~4,000 gates per 5-element block
  - Amortizes well: most circuit gates are for the actual computation
```

### 6.3 Type System (`Enc<Owner, T>`)

In the Arcis DSL (and in the TypeScript SDK), encrypted values carry their ownership type:

```rust
// In Arcis (Rust DSL for MPC circuits)

// Enc<Mxe, T>: the MXE nodes collectively can reveal this
// Enc<Shared, T>: requires client cooperation to reveal (shared secret)
pub enum Owner { Mxe, Shared }
pub struct Enc<O: Owner, T> {
    ciphertext: Vec<FieldElement>,
    pub_key:    Option<[u8; 32]>,  // present only if O = Shared
    nonce:      [u8; 16],
    _marker:    PhantomData<(O, T)>,
}

// Convert ciphertext to secret shares (runs Rescue decode circuit in MPC)
pub fn to_arcis<T>(enc: Enc<Mxe, T>) -> T {
    // circuit: X25519 derive shared key → Rescue decrypt → output secret share
}

// Convert secret share back to ciphertext (Rescue encode circuit in MPC)
pub fn from_arcis<T>(value: T, owner: Owner) -> Enc<impl Owner, T> {
    // circuit: Rescue encrypt → output ciphertext
}
```

### 6.4 Sealing (Re-encoding)

Re-encoding allows outputting a value encrypted to a *different* key than it was input with — e.g., input is encrypted to the cluster, output is re-encrypted to a specific user.

```rust
// Arcis circuit: re-encrypt output to recipient's X25519 public key
pub fn seal_to_recipient<T>(
    value:          T,             // secret share inside MPC
    recipient_key:  [u8; 32],      // recipient's X25519 public key (public input)
) -> Enc<Shared, T> {
    // 1. Generate ephemeral key inside MPC (using Arcis random primitive)
    // 2. Run ECDH inside MPC circuit: shared = ECDH(ephemeral, recipient_key)
    // 3. Derive Rescue key from shared secret
    // 4. Encrypt value with Rescue inside MPC
    // 5. Output: ciphertext that only recipient can decrypt
}
```

---

## 7. Circuit Compiler (Arcis DSL)

### 7.1 Language Design

Arcis is a Rust-embedded DSL for writing MPC circuits. The developer experience mirrors writing normal Rust — types, pattern matching, conditionals, loops — with the constraint that all operations must be **data-oblivious** (no branching on secret values).

```rust
// Example: Dark pool order matching circuit
// Inputs: N orders (price, quantity, side) encrypted from N users
// Output: matched trades (without revealing unmatched orders)

use arcis::prelude::*;

#[arcis_circuit]
pub fn match_orders(
    orders: Vec<Enc<Mxe, Order>>,
) -> Vec<Enc<Shared, Trade>> {
    // Decrypt orders inside MPC
    let decrypted: Vec<Order> = orders.iter()
        .map(|o| o.to_arcis())
        .collect();

    // Sort by price (oblivious sort — no data leakage)
    let sorted = oblivious_sort(&decrypted, |a, b| a.price.cmp(&b.price));

    // Match bids with asks (oblivious matching)
    let trades = oblivious_match(&sorted);

    // Re-encrypt each trade to its participants
    trades.iter()
        .map(|t| seal_to_recipient(t, t.buyer_key))
        .collect()
}

#[arcis_type]
pub struct Order {
    price:    u64,
    quantity: u64,
    side:     OrderSide,  // Buy | Sell
    buyer_key: [u8; 32],
}

#[arcis_type]
pub struct Trade {
    price:    u64,
    quantity: u64,
    buyer_key: [u8; 32],
    seller_key: [u8; 32],
}
```

### 7.2 Compilation Pipeline

```
Arcis Source (.arcis file)
        │
        ▼
┌──────────────────────────────┐
│  Arcis Frontend (syn + quote)│  ← Rust proc-macro expansion
│  - Type checking             │
│  - Obliviousness validation  │  ← reject secret-dependent branches
│  - Variable liveness         │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│  Arithmetic Circuit IR       │  ← internal representation
│  - Gates: Add, Mul, MulConst │
│  - Wires: input / internal / output
│  - Gate count annotation     │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│  Circuit Optimizer           │
│  - CSE (common subexpression)│
│  - Constant propagation      │
│  - Dead gate elimination     │
└────────────┬─────────────────┘
             │
             ▼
┌──────────────────────────────┐
│  Serializer                  │
│  - Binary circuit format     │  → uploaded to ComputationRegistry
│  - JSON ABI (input/output    │  → used by TypeScript SDK
│    types + Enc<> annotations)│
│  - Solidity callback types   │  → generated stub for ConfidentialBase
└──────────────────────────────┘
```

### 7.3 Arithmetic Circuit Representation

```
Binary circuit format (flatbuffers schema):

Circuit {
  version:       u16,
  gate_count:    u32,
  input_count:   u16,
  output_count:  u16,
  field_modulus: [u8; 32],  // p = 2^255 - 19

  gates: [Gate],
  input_metadata:  [InputMeta],
  output_metadata: [OutputMeta],
}

Gate = AddGate  { out: u32, in_a: u32, in_b: u32 }
     | MulGate  { out: u32, in_a: u32, in_b: u32 }
     | ConstGate{ out: u32, in_a: u32, const: [u8; 32] }

InputMeta  { wire: u32, enc_type: EncType, data_type: DataType }
OutputMeta { wire: u32, enc_type: EncType, data_type: DataType, recipient_key_wire: Option<u32> }

EncType = MxeEncrypted | SharedEncrypted | Public
DataType = U64 | U128 | I64 | Bool | FieldElement | Bytes32
```

---

## 8. Developer Tooling

### 8.1 `glaselvm` CLI

```bash
# Install
curl -sSf https://install.glasel.network | sh
glaselvm --version  # 0.1.0

# Initialize project (Foundry-based)
glaselvm new my-dark-pool --template dark-pool
cd my-dark-pool

# Compile Arcis circuit
glaselvm compile circuits/dark_pool.arcis
# Output:
#   artifacts/dark_pool.circuit       (binary circuit)
#   artifacts/dark_pool_abi.json      (JSON ABI)
#   src/generated/DarkPoolCallback.sol (Solidity callback stub)

# Simulate circuit locally (no nodes needed)
glaselvm simulate circuits/dark_pool.arcis \
  --inputs '{"orders": [{"price": 100, "quantity": 10, "side": "Buy"}]}'

# Deploy circuit to ComputationRegistry on Base Sepolia
glaselvm deploy-circuit artifacts/dark_pool.circuit \
  --network base-sepolia \
  --rpc https://sepolia.base.org \
  --private-key $DEPLOYER_KEY
# Output: compDefId = 0xabc123...

# Create MXE
glaselvm create-mxe \
  --cluster 0xcluster_id... \
  --protocol cerberus \
  --comp-def 0xabc123... \
  --network base-sepolia
# Output: mxeId = 0xdef456...

# Estimate fee for a computation
glaselvm estimate-fee \
  --comp-def 0xabc123... \
  --callback-gas 200000 \
  --network base-sepolia
# Output: ~2.5 CONFIDE base fee, deadline: 45s

# Run a node (for node operators)
glaselvm node start --config glaseld.toml
```

### 8.2 `@glasel/client` TypeScript SDK

```typescript
import { GlaselClient, EncryptedInput, ComputationResult } from '@glasel/client';
import { createWalletClient, http } from 'viem';
import { base } from 'viem/chains';

// Initialize
const client = new GlaselClient({
  chain:       base,
  transport:   http('https://mainnet.base.org'),
  contracts: {
    coordinator:  '0x...',
    nodeRegistry: '0x...',
    confideToken: '0x...',
  }
});

// Fetch cluster's combined X25519 public key
const clusterKey = await client.getClusterPublicKey(mxeId);

// Encrypt an input value
const bid: EncryptedInput = await client.encrypt({
  value:      { price: 1000n, quantity: 5n, side: 'Buy' },
  abiType:    'Order',           // matches Arcis @arcis_type
  clusterKey,
  nonce:      crypto.getRandomValues(new Uint8Array(16)),
});

// Submit computation via your app contract
const txHash = await darkPoolContract.write.submitOrder([bid.ciphertext]);

// Watch for computation result (listens for ComputationCompleted event)
const result: ComputationResult = await client.watchComputation({
  txHash,
  timeout:   120_000, // 2 minutes
});

if (result.success) {
  // Decrypt result (if encrypted to this user)
  const trade = await client.decrypt({
    ciphertext: result.encResult,
    privateKey: userEphemeralKey,  // from the seal_to_recipient output
    abiType:    'Trade',
  });
  console.log('Matched trade:', trade);
}
```

**Permit-based fee approval (gasless):**

```typescript
// Instead of approve() tx, use EIP-2612 permit for gasless approval
const permit = await client.signPermit({
  token:    confideTokenAddress,
  spender:  coordinatorAddress,
  value:    parseEther('100'),
  deadline: BigInt(Math.floor(Date.now() / 1000) + 3600),
  wallet:   walletClient,
});

// Coordinator accepts permit in commission() and does transferWithPermit internally
await darkPoolContract.write.submitOrderWithPermit([bid.ciphertext, permit]);
```

---

### 8.3 Testing Infrastructure

**`MockCoordinator.sol`** — allows full contract testing without real MPC nodes:

```solidity
contract MockCoordinator is IComputationCoordinator {
    mapping(bytes32 => bytes) public queuedResults;

    function commission(/* ... */) external payable returns (bytes32 computationId) {
        computationId = keccak256(abi.encode(msg.sender, block.timestamp));
        // Don't do anything yet; test calls mockComplete() to simulate MPC result
    }

    // Called by test to simulate MPC completing with a specific result
    function mockComplete(bytes32 computationId, bytes calldata result) external {
        (bool success,) = computations[computationId].callbackContract.call(
            abi.encodeWithSelector(
                computations[computationId].callbackSelector,
                computationId,
                result
            )
        );
        require(success, "mock callback failed");
    }

    function mockFail(bytes32 computationId) external {
        emit ComputationFailed(computationId, "mock failure");
    }
}
```

**Foundry test pattern:**

```solidity
// test/DarkPool.t.sol
contract DarkPoolTest is Test {
    DarkPool       pool;
    MockCoordinator coordinator;
    GlaselToken   token;

    function setUp() public {
        token       = new GlaselToken();
        coordinator = new MockCoordinator(address(token));
        pool        = new DarkPool(address(coordinator), address(token));

        token.mint(address(this), 1_000_000 ether);
        token.approve(address(pool), type(uint256).max);
    }

    function test_order_matching() public {
        // Submit two orders (encrypted in tests as just ABI-encoded)
        bytes memory encBid  = abi.encode(Order(100, 10, Side.Buy,  address(this)));
        bytes memory encAsk  = abi.encode(Order(100, 10, Side.Sell, address(this)));

        bytes32 compId1 = pool.submitOrder(encBid);
        bytes32 compId2 = pool.submitOrder(encAsk);

        // Simulate MPC matching them
        bytes memory matchResult = abi.encode(
            Trade(100, 10, address(this), address(this))
        );
        coordinator.mockComplete(compId1, matchResult);

        assertEq(pool.trades(0).price, 100);
        assertEq(pool.trades(0).quantity, 10);
    }

    function test_callback_failure_fallback_to_pull() public {
        // Make callback deliberately fail
        pool.setCallbackAlwaysFail(true);

        bytes32 compId = pool.submitOrder(abi.encode(Order(100, 10, Side.Buy, address(this))));
        coordinator.mockComplete(compId, abi.encode(Trade(100, 10, address(this), address(this))));

        // Push failed; result should be pullable
        bytes memory pulled = coordinator.pullResult(compId);
        assertGt(pulled.length, 0);
    }
}
```

**Fuzz testing for circuit obliviousness:**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // Verify circuit produces identical output regardless of which party runs it
    proptest! {
        #[test]
        fn test_circuit_data_obliviousness(
            inputs in arb_orders(1..10),
        ) {
            // Run circuit with different party orderings; output must be identical
            let result_party0 = simulate_cerberus(&circuit, &inputs, 0, 3)?;
            let result_party1 = simulate_cerberus(&circuit, &inputs, 1, 3)?;
            let result_party2 = simulate_cerberus(&circuit, &inputs, 2, 3)?;

            prop_assert_eq!(result_party0, result_party1);
            prop_assert_eq!(result_party1, result_party2);
        }
    }
}
```

### 8.4 `glasel.toml`

```toml
[project]
name    = "my-dark-pool"
version = "0.1.0"

[network]
chain   = "base"
rpc     = "https://mainnet.base.org"
chain_id = 8453

[network.testnet]
chain   = "base-sepolia"
rpc     = "https://sepolia.base.org"
chain_id = 84532

[contracts]
coordinator       = "0x..."
mxe_factory       = "0x..."
computation_reg   = "0x..."
node_registry     = "0x..."
staking_manager   = "0x..."
confide_token     = "0x..."

[mxe]
id           = "0x..."        # deployed MXE id
protocol     = "cerberus"     # cerberus | manticore
fallback_mxe = ""             # optional fallback MXE

[circuits]
dark_pool = { path = "circuits/dark_pool.arcis", id = "0x..." }

[node]
# Only needed for node operators
node_id         = "0x..."
rpc             = "https://mainnet.base.org"
cluster_id      = "0x..."
hsm_type        = "nitro"     # nitro | cloudhsm | software (dev only)
p2p_listen_addr = "0.0.0.0:9090"

[node.peers]
# Auto-discovered from ClusterManager; override here if needed
```

---

## 9. Computation Lifecycle (End-to-End)

```
1. CIRCUIT DEPLOYMENT (one-time, by developer)
   ├── glaselvm compile circuits/dark_pool.arcis
   ├── glaselvm deploy-circuit → ComputationRegistry.deployComputationDefinition()
   │   compDefId = keccak256(bytecodeHash, deployer, timestamp)
   └── glaselvm create-mxe → MXEFactory.createMXE()
       mxeId = keccak256(clusterId, protocol, deployer, timestamp)

2. CLIENT ENCRYPTION (per request, by end user)
   ├── client.getClusterPublicKey(mxeId)
   │   → ClusterManager.clusters[mxeId.clusterId].clusterPubKey
   ├── Generate ephemeral X25519 keypair
   ├── ECDH(ephemeral_sk, cluster_combined_pk) → shared_secret
   ├── Rescue-Prime KDF(shared_secret) → rescue_key
   ├── Rescue-CTR-Encrypt(rescue_key, nonce, plaintext) → ciphertext
   └── encInputs = { ciphertext, ephemeral_pk, nonce }

3. COMMISSIONING (by user's app contract or directly)
   ├── User calls DarkPool.submitOrder(encInputs)
   ├── DarkPool calls ConfidentialBase._invokeConfidential(mxeId, compDefId, encInputs)
   ├── ConfidentialBase calls ComputationCoordinator.commission()
   │   ├── FeeOracle.estimateFee() → totalFee
   │   ├── $CONFIDE.transferFrom(requester, coordinator, totalFee)
   │   ├── Compute computationId = keccak256(..., block.prevrandao)
   │   ├── Store Computation struct
   │   └── Emit ComputationRequested(computationId, mxeId, compDefId, encInputs, deadline)
   └── User receives computationId

4. NODE EXECUTION (by all nodes in assigned cluster)
   ├── Chain listeners detect ComputationRequested event
   ├── All cluster nodes fetch event and enqueue computation
   ├── Nodes fetch circuit from ComputationRegistry
   │   └── If IPFS CID: fetch and verify keccak256(bytecode) == bytecodeHash
   ├── Nodes decrypt their input shares (cooperative Rescue decode circuit)
   ├── Nodes run Cerberus/Manticore online phase
   │   ├── Offline preprocessing: Beaver triple generation (VOLE-based)
   │   └── Online phase: gate-by-gate circuit evaluation with MAC checks
   ├── Each node computes output shares
   └── Each node signs: BLS.sign(bls_key, keccak256(computationId || encResult))

5. RESULT AGGREGATION & SUBMISSION
   ├── Nodes broadcast BLS signatures to cluster peers (P2P)
   ├── Leader node (round-robin per epoch) collects threshold-many signatures
   ├── Leader aggregates: BLS.aggregate(signatures) → single 48-byte signature
   └── Leader submits: ComputationCoordinator.submitResult(computationId, encResult, aggSig, signers)
       ├── Verify BLS aggregate signature (EIP-2537 precompile or Solidity fallback)
       ├── Verify signers.length >= cluster.minThreshold
       ├── Mark computation as Completed
       ├── Attempt push callback: callbackContract.onComputationComplete(compId, encResult)
       │   └── On failure: store in pendingPullResults for pull model
       ├── Distribute fees: StakingManager.distributeFees(signers, feeDeposit)
       └── Emit ComputationCompleted(computationId, resultCommitment, callbackSucceeded)

6. RESULT DECRYPTION (by authorized recipient)
   ├── Client detects ComputationCompleted event (via @glasel/client watchComputation)
   ├── If result sealed to specific user:
   │   ├── ECDH(user_sk, ephemeral_pk_from_result) → shared_secret
   │   └── Rescue-Decrypt(shared_secret, ciphertext) → plaintext
   └── Application processes decrypted result
```

---

## 10. Network Economics

### 10.1 Fee Model

Every computation consumes `$CONFIDE`. Fees have two components:

```
totalFee = baseFee + priorityFee

baseFee  = (estimatedGates / 1000) * feePerKGates
         + callbackGasLimit * block.basefee * gasPremium / confideEthRate

priorityFee = requester's tip for faster scheduling (optional, goes to nodes)
```

Fee distribution per computation:
- **90%** → distributed to participating nodes (proportional to stake weight)
- **10%** → protocol treasury (funds development, security audits)

### 10.2 Staking & Slashing

```
Minimum self-stake:         10,000 CONFIDE
Unbonding period (self):    7 days
Unbonding period (delegated): 3 days

Slash table:
┌─────────────────────────────┬────────────────┬───────────────────┐
│ Offense                     │ Slash (% stake)│ Additional penalty│
├─────────────────────────────┼────────────────┼───────────────────┤
│ Missed deadline             │ 5%             │ Reputation -1000  │
│ Offline during computation  │ 2%             │ Reputation -500   │
│ Incorrect result (minority) │ 30%            │ Jail + reputation │
│ Double-signing              │ 100%           │ Permanent ban     │
└─────────────────────────────┴────────────────┴───────────────────┘

Reputation score (0–10,000):
  - Start: 5,000
  - +100 per completed computation
  - -500 to -1000 per slash event
  - Below 2,000 → jailed (excluded from new clusters)
  - Unjail: governance vote + 30-day cool-down + re-stake to minimum
```

### 10.3 Delegation

Any $CONFIDE holder can delegate to a node operator. Rewards split between node operator and delegators are set by the operator (default 10% operator commission, 90% to delegators). The operator can change commission with 7-day notice.

### 10.4 Epoch Structure

- **Epoch length:** 24 hours (86,400 seconds)
- **Epoch start:** determined by block timestamp modulo epoch length
- **Per-epoch actions:**
  - Reward distribution for completed computations
  - Reputation recalculation
  - Cluster priority list update (stake-weighted)
  - Staking snapshot for governance voting power

---

## 11. Security Model

### 11.1 Threat Model

| Threat | Impact | Mitigation |
|--------|--------|-----------|
| Up to N-1 malicious nodes in cluster | Data theft or result manipulation | Cerberus dishonest-majority MPC; identifiable abort |
| Node collusion (multiple nodes, same operator) | Break threshold assumption | Sybil check in ClusterManager; one operator per cluster |
| Malicious leader node | Suppress result or submit wrong result | Any node can submit; threshold signature verifiable by all |
| Coordinator contract bug | Fee theft, wrong callbacks | UUPS upgradeable; 7-day timelock; formal verification |
| MEV / front-running | Observe computation contents | Encrypted inputs; commit-reveal for sensitive request patterns |
| Key compromise of single node | Partial key exposure | DKG: no single node holds full cluster key |
| Key loss of entire cluster | Data loss | Keyshare backup with threshold reconstruction |
| Governance attack (majority token capture) | Malicious upgrades | 7-day timelock; emergency multisig pause during bootstrap |
| Smart contract reentrancy | Fund theft | All state changes before external calls; `nonReentrant` on all entry points |

### 11.2 Sybil Resistance

Two layers:

**Intra-cluster:** `ClusterManager.proposeCluster()` enforces that no operator address appears more than once. Sybil detection extends N hops through the delegation graph: if operator A controls 70% of stake delegated to five different node addresses, those nodes cannot all be in the same cluster.

**Network-wide:** `StakingManager` tracks total stake per operator across all their nodes. Governance can cap the maximum stake-share any single entity controls across the network (proposed: 33% cap).

### 11.3 MEV & Front-Running Protection

**Commit-reveal for sensitive computations:**

```solidity
// Phase 1: Commit to inputs (tx reveals nothing)
function commitComputation(bytes32 inputCommitment) external returns (bytes32 commitId) {
    commitments[commitId] = Commitment({
        hash: inputCommitment,
        requester: msg.sender,
        blockNumber: block.number,
    });
}

// Phase 2: Reveal inputs (must happen within 10 blocks of commit)
function revealAndCommission(
    bytes32 commitId,
    bytes calldata encInputs,    // must match inputCommitment
    bytes32 mxeId,
    bytes32 compDefId
) external returns (bytes32 computationId) {
    Commitment memory c = commitments[commitId];
    require(c.requester == msg.sender);
    require(block.number <= c.blockNumber + 10, "reveal window passed");
    require(keccak256(encInputs) == c.hash, "commitment mismatch");
    delete commitments[commitId];
    return _commission(mxeId, compDefId, encInputs, ...);
}
```

**Input encryption as baseline MEV protection:**  
Even without commit-reveal, inputs are X25519-encrypted before they hit the chain. Observers on Base cannot read the inputs. Commit-reveal adds protection against *ordering* attacks where a searcher doesn't need to read the inputs but can delay or reorder them.

### 11.4 Emergency Mechanisms

```solidity
// Emergency pause: only multisig during bootstrap period
// After bootstrap: only governance (with timelock bypass for emergency)
contract EmergencyPause is AccessControl {
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    bool public paused;

    modifier whenNotPaused() {
        require(!paused, "system paused");
        _;
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        paused = true;
        // Emits event monitored by all node daemons; they stop accepting new work
    }

    function unpause() external {
        // Requires governance vote OR multisig (during bootstrap)
    }
}
```

Circuit breakers in `ComputationCoordinator`:
- Auto-pause if >10% of computations fail in a 1-hour window
- Auto-pause if BLS verification fails unexpectedly (indicates a node software bug)
- Rate limiting: max 1,000 computation commissions per block per requester

---

## 12. Infrastructure & DevOps

### 12.1 Node Hardware Requirements

**Minimum (permissioned Manticore cluster):**
```
CPU:     8-core x86_64, AVX2 support (for fast field arithmetic)
RAM:     32 GB
Storage: 500 GB NVMe SSD
Network: 1 Gbps symmetric, <50ms to other cluster nodes
OS:      Ubuntu 22.04 LTS
```

**Recommended (Cerberus permissionless cluster):**
```
CPU:     32-core x86_64, AVX-512 support
RAM:     128 GB
Storage: 2 TB NVMe SSD (RAID 1)
Network: 10 Gbps symmetric, <20ms to other cluster nodes
HSM:     AWS Nitro Enclave or YubiHSM2 (for key storage)
OS:      Ubuntu 22.04 LTS with security hardening (AppArmor, auditd)
```

**For Manticore ML workloads:**
```
GPU:     NVIDIA A100 or H100 (Manticore supports GPU-accelerated field arithmetic)
VRAM:    80 GB+
```

### 12.2 Deployment Architecture

**Smart contracts (Foundry):**
```bash
# Deployment sequence (order matters due to dependencies)
1. confideToken      ← no dependencies
2. nodeRegistry      ← depends on: confideToken
3. stakingManager    ← depends on: confideToken, nodeRegistry
4. clusterManager    ← depends on: nodeRegistry
5. mxeFactory        ← depends on: clusterManager
6. computationRegistry ← no dependencies
7. feeOracle         ← depends on: computationRegistry
8. computationCoordinator ← depends on: all above
9. governance        ← depends on: confideToken
10. timelockController ← depends on: governance

# Each contract deployed as:
# 1. Deploy implementation contract
# 2. Deploy ERC1967Proxy pointing to implementation
# 3. Call proxy.initialize(...)
# 4. Transfer ownership to TimelockController

# Verify all contracts on Basescan
forge script script/Deploy.s.sol --rpc-url base --broadcast --verify
```

**Node deployment (Kubernetes):**
```yaml
# glaseld-deployment.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: glaseld-node
spec:
  replicas: 1  # one pod per physical node (key isolation)
  template:
    spec:
      containers:
      - name: glaseld
        image: glasel/glaseld:v1.0.0
        resources:
          requests:
            cpu: "16"
            memory: "64Gi"
          limits:
            cpu: "32"
            memory: "128Gi"
        env:
        - name: NODE_CONFIG_PATH
          value: /config/glaseld.toml
        - name: HSM_TYPE
          value: "nitro"
        volumeMounts:
        - name: config
          mountPath: /config
        - name: keystore
          mountPath: /keystore
          readOnly: true
      volumes:
      - name: config
        configMap:
          name: glaseld-config
      - name: keystore
        secret:
          secretName: glaseld-keystore
```

### 12.3 Monitoring & Alerting

```yaml
# Key metrics to monitor (Prometheus + Grafana)

# Contract-level (via event indexer / The Graph subgraph)
- computations_requested_total        # counter
- computations_completed_total        # counter
- computations_failed_total           # counter
- computation_latency_seconds         # histogram
- fees_collected_confide_total        # counter
- nodes_slashed_total                 # counter
- nodes_jailed_current                # gauge

# Node-level (exported by GlaselOS daemon)
- mpc_rounds_completed_total          # counter
- mpc_round_latency_ms               # histogram (p50, p95, p99)
- preprocessing_triples_available    # gauge (alert if < 10K)
- p2p_connection_status{peer}        # gauge (0 or 1 per peer)
- bls_signature_aggregation_time_ms  # histogram
- chain_listener_lag_blocks          # gauge (alert if > 5)

# Alerts
- computation_failure_rate > 5%      → PagerDuty (P1)
- node_p2p_disconnect{peer}          → Slack (P2)
- preprocessing_triples < 1000       → Slack (P2, will block computations)
- chain_listener_lag > 10 blocks     → PagerDuty (P1)
- staking_balance < min_self_stake   → Slack (P2)
```

**The Graph subgraph** for indexing all Glasel events:
```typescript
// schema.graphql
type Computation @entity {
  id:            Bytes!
  mxeId:         Bytes!
  compDefId:     Bytes!
  requester:     Bytes!
  status:        String!
  commissionedAt: BigInt!
  completedAt:   BigInt
  feeDeposit:    BigInt!
  callbackSucceeded: Boolean
}

type Node @entity {
  id:                Bytes!
  reputationScore:   BigInt!
  computationsCompleted: BigInt!
  computationsFailed:    BigInt!
  jailed:            Boolean!
}
```

### 12.4 Key Rotation

```
Rotation schedule and procedure:

1. P2P TLS keys (every 7 days)
   - Automatic rotation by GlaselOS daemon
   - New key registered via authenticated channel to peers
   - Zero downtime; old key valid for 24h overlap

2. X25519 share key (every 30 days)
   - Node calls NodeRegistry.rotateX25519Key(newKey)
   - ClusterManager detects rotation, marks cluster as Migrating
   - Cluster runs a new DKG ceremony to generate new combined key
   - New combined key submitted via ClusterManager.activateCluster()
   - Downtime: ~5-10 minutes while DKG runs

3. BLS signing key (every 90 days)
   - Requires governance notification 14 days in advance
   - Old key valid for 30-day overlap period
   - Nodes must re-register via NodeRegistry.rotateBLSKey()
     (requires threshold signature from cluster peers to prove authorization)
```

---

## 13. Testing Strategy

### Layer 1: Unit Tests (Foundry)

```
Coverage targets:
  - GlaselToken:           100% line coverage
  - NodeRegistry:           100% line coverage
  - ClusterManager:         100% line coverage
  - MXEFactory:             100% line coverage
  - ComputationRegistry:    100% line coverage
  - ComputationCoordinator: 100% line coverage (most critical)
  - StakingManager:         100% line coverage
  - FeeOracle:              100% line coverage
  - Governance:             90%+ line coverage

Invariant tests (Foundry invariant testing):
  - Total $CONFIDE supply never exceeds MAX_SUPPLY
  - Sum of all staked + circulating balances == total supply
  - No computation can be completed twice
  - slashedAmount never exceeds nodeStake.totalStake
  - computationFee always satisfies fee >= FeeOracle.estimateFee(compDefId, gasLimit)
```

### Layer 2: Integration Tests

```bash
# Full end-to-end test with real MPC (using 3-node local cluster)
glaselvm test:integration \
  --nodes 3 \
  --protocol cerberus \
  --circuit circuits/dark_pool.arcis \
  --input fixtures/orders.json

# Test Manticore path
glaselvm test:integration --protocol manticore --circuit circuits/ml_inference.arcis

# Test fault tolerance: kill one node mid-computation
glaselvm test:fault-tolerance --kill-node 2 --at-phase online
```

### Layer 3: Adversarial Tests

```rust
// Test identifiable abort: malicious node sends wrong MAC
#[tokio::test]
async fn test_cerberus_identifies_malicious_node() {
    let mut cluster = TestCluster::new(3);

    // Node 1 will send an incorrect MAC on gate 42
    cluster.node(1).inject_fault(FaultType::WrongMac { gate: 42 });

    let result = cluster.run_circuit(&sample_circuit(), &sample_inputs()).await;

    assert!(matches!(result, Err(CerberusError::IdentifiedCheater(1))));
}

// Test dishonest majority: 2 of 3 nodes collude
#[tokio::test]
async fn test_cerberus_resists_dishonest_majority() {
    let mut cluster = TestCluster::new(3);
    cluster.node(1).make_malicious();
    cluster.node(2).make_malicious();  // 2/3 malicious

    // Result must still be correct (honest node 0 detects cheating)
    let result = cluster.run_circuit(&sample_circuit(), &sample_inputs()).await;

    // Should abort with cheaters identified, NOT produce wrong result
    assert!(matches!(result, Err(CerberusError::AbortWithCheaters(_))));
    // Critically: honest party's input must NOT be revealed to cheaters
}
```

### Layer 4: Load Testing

```bash
# Simulate 1,000 concurrent computations
glaselvm load-test \
  --rpc https://base-sepolia.rpc.url \
  --computations 1000 \
  --concurrency 50 \
  --circuit artifacts/simple_add.circuit \
  --duration 10m

# Expected SLA targets (production):
# - p50 computation latency: < 30s
# - p95 computation latency: < 90s
# - p99 computation latency: < 180s
# - Failure rate: < 0.1%
# - Throughput: > 100 computations / minute per cluster
```

---

## 14. Phased Roadmap

### Phase 1 — Foundation (Months 1–4)

**Goal:** Contracts and nodes working end-to-end on Base Sepolia.

| Deliverable | Owner | Month |
|-------------|-------|-------|
| All 8 core contracts + unit tests | Smart contract team | 1–2 |
| $CONFIDE token + staking | Smart contract team | 2 |
| Cerberus MPC library (Rust) — primitives + OT/VOLE | Cryptography team | 1–3 |
| Cerberus online phase + identifiable abort | Cryptography team | 3–4 |
| Node daemon (chain listener + result submitter) | Infrastructure team | 2–3 |
| BLS signature aggregation (off-chain + on-chain verify) | Infrastructure team | 3 |
| Base Sepolia testnet deployment | All teams | 4 |
| Internal end-to-end smoke test (3-node cluster, simple circuit) | All teams | 4 |

### Phase 2 — Developer Tooling (Months 3–6, overlapping)

**Goal:** External developers can build apps on Glasel.

| Deliverable | Owner | Month |
|-------------|-------|-------|
| Arcis DSL frontend (proc-macro) | Language team | 3–4 |
| Arithmetic circuit IR + optimizer | Language team | 4–5 |
| `glaselvm` CLI (compile, deploy, simulate) | Tooling team | 4–5 |
| `@glasel/client` TypeScript SDK | SDK team | 4–5 |
| `ConfidentialBase.sol` + `MockCoordinator.sol` | Smart contract team | 4 |
| `glasel.toml` config format | Tooling team | 5 |
| Developer docs site + Hello World tutorial | Developer relations | 5–6 |
| Foundry template repositories | Developer relations | 6 |

### Phase 3 — Reference Applications (Months 5–8)

**Goal:** Prove the system with real applications; provide developer blueprints.

| Deliverable | Month |
|-------------|-------|
| C-ERC20: confidential balances for any ERC-20 token | 5–6 |
| Dark pool reference implementation (sealed-bid order book) | 6–7 |
| Sealed-bid auction contract | 7 |
| Confidential on-chain voting | 7–8 |
| Public testnet launch with incentivized node operators | 8 |

### Phase 4 — Mainnet & Economics (Months 7–10)

**Goal:** Production launch on Base mainnet.

| Deliverable | Month |
|-------------|-------|
| Third-party security audit (smart contracts) | 7–8 |
| Third-party cryptographic audit (Cerberus implementation) | 8 |
| Bug bounty program launch | 8 |
| Governance deployment + token distribution | 9 |
| Base mainnet launch (permissioned genesis clusters) | 9 |
| Node operator onboarding + staking live | 9–10 |
| Permissionless cluster formation enabled | 10 |

### Phase 5 — Manticore & AI (Months 9–13)

**Goal:** Enable ML inference over confidential data.

| Deliverable | Month |
|-------------|-------|
| Manticore engine (honest-but-curious, Trusted Dealer) | 9–11 |
| Fixed-point arithmetic in Arcis (for ML activations) | 10–11 |
| EIP-4844 blob support for large ML inputs | 11 |
| GPU acceleration for Manticore field arithmetic | 11–12 |
| Confidential ML inference reference app | 12–13 |
| Arcium Blackthorn-inspired confidential AI framework | 13 |

### Phase 6 — Multi-Chain (Months 12+)

**Goal:** Expand beyond Base.

| Deliverable | Timeline |
|-------------|----------|
| Arbitrum support (same OP Stack adaptation) | Month 13 |
| Optimism support | Month 14 |
| Ethereum L1 support (Coordinator as L1 anchor) | Month 15 |
| EIP-2537 BLS precompile integration (once Base ships it) | When available |
| Base-native custom precompile proposal for VOLE | Month 16+ |

---

## Appendix A — Contract Addresses (Testnet)

> *To be populated after Phase 1 deployment.*

| Contract | Base Sepolia |
|----------|-------------|
| GlaselToken (proxy) | TBD |
| NodeRegistry (proxy) | TBD |
| ClusterManager (proxy) | TBD |
| MXEFactory (proxy) | TBD |
| ComputationRegistry (proxy) | TBD |
| ComputationCoordinator (proxy) | TBD |
| StakingManager (proxy) | TBD |
| FeeOracle (proxy) | TBD |
| Governance (proxy) | TBD |
| TimelockController | TBD |

---

## Appendix B — Key References

- Arcium Cerberus Whitepaper — Nicolas Le Bel et al., June 2026
- Arcium Purplepaper — Yannik Schrade et al., June 2026
- BMRS24 — The foundational MPC protocol Cerberus builds on
- EIP-2537 — BLS12-381 precompiles (BLS verification gas optimization)
- EIP-4844 — Blob transactions (large input data availability)
- OpenZeppelin Contracts v5 — Base for all Solidity contracts
- alloy-rs — Rust Ethereum client library for node daemon
- BLS12-381 — Elliptic curve for threshold signatures

---

*Glasel Network Architecture Specification — v1.0*  
*This document is the reference architecture. All implementation decisions that deviate from this spec require a formal architecture decision record (ADR).*
