// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {PausableUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/PausableUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import {Types} from "../libraries/Types.sol";
import {BLS} from "../libraries/BLS.sol";
import {IComputationCoordinator} from "../interfaces/IComputationCoordinator.sol";
import {IMXEFactory} from "../interfaces/IMXEFactory.sol";
import {IClusterManager} from "../interfaces/IClusterManager.sol";
import {IComputationRegistry} from "../interfaces/IComputationRegistry.sol";
import {IFeeOracle} from "../interfaces/IFeeOracle.sol";
import {IStakingManager} from "../interfaces/IStakingManager.sol";

/// @title ComputationCoordinator
/// @notice The protocol's orchestration core: commissions computations, accepts
///         threshold-signed results, dispatches the application callback (with a
///         pull fallback), settles fees, and slashes timed-out clusters.
contract ComputationCoordinator is
    IComputationCoordinator,
    AccessControlUpgradeable,
    ReentrancyGuardUpgradeable,
    PausableUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    /// @dev May dispute a submitted result within its challenge window (a
    ///      watchtower / governance address that re-executes off-chain).
    bytes32 public constant CHALLENGER_ROLE = keccak256("CHALLENGER_ROLE");

    IMXEFactory public mxeFactory;
    IComputationRegistry public registry;
    IClusterManager public clusterManager;
    IFeeOracle public feeOracle;
    IStakingManager public stakingManager;
    IERC20 public glaselToken;

    mapping(bytes32 computationId => Types.Computation) private _computations;
    mapping(bytes32 computationId => bytes) public pendingPullResults;
    /// @dev Monotonic nonce mixed into computationId so two otherwise-identical
    ///      commissions in the same block cannot collide (audit C-1).
    uint256 private _commissionNonce;

    // ─── Optimistic challenge model (append-only storage) ───────────────────
    /// @notice Window after a result is submitted during which a CHALLENGER may
    ///         dispute it (fees are escrowed until it closes). 0 disables it.
    uint64 public challengeWindow;
    mapping(bytes32 computationId => uint64) public challengeDeadlineOf;
    mapping(bytes32 computationId => bool) public finalized;

    // ─── Rate limiting + circuit breaker (append-only storage) ──────────────
    /// @notice Max commissions one requester may submit per block (0 disables).
    uint256 public maxCommissionsPerBlock;
    mapping(address requester => mapping(uint256 blockNumber => uint256)) private _commissionsInBlock;
    /// @notice Rolling-window failure budget; exceeding it auto-pauses the system.
    uint64 public failureWindowBlocks;
    uint256 public maxFailuresPerWindow;
    uint256 private _windowStartBlock;
    uint256 private _failuresInWindow;

    event ComputationRequested(
        bytes32 indexed computationId,
        bytes32 indexed mxeId,
        bytes32 indexed compDefId,
        bytes encInputs,
        string inputIpfsCid,
        uint64 deadline
    );
    event ComputationCompleted(bytes32 indexed computationId, bytes32 resultCommitment, bool callbackSucceeded);
    event ComputationFailed(bytes32 indexed computationId, string reason);
    event ComputationSlashed(bytes32 indexed computationId, address[] slashedNodes);
    event ResultPulled(bytes32 indexed computationId);
    event ComputationFinalized(bytes32 indexed computationId);
    event ComputationChallenged(bytes32 indexed computationId, address[] slashedNodes);
    event CircuitBreakerTripped(uint256 failures, uint64 windowBlocks);

    error MXENotActive();
    error DefinitionDeprecated();
    error UnknownDefinition();
    error DefNotAllowed();
    error InvalidStatus();
    error PastDeadline();
    error NotPastDeadline();
    error OnlyCallbackContract();
    error PushAlreadySucceeded();
    error NotCompleted();
    error ClusterNotActive();
    error InvalidGroupKey();
    error BadBLSSignature();
    error ChallengeWindowOpen();
    error AlreadyFinalized();
    error NotChallengeable();
    error RateLimited();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    struct Wiring {
        address admin;
        address mxeFactory;
        address registry;
        address clusterManager;
        address feeOracle;
        address stakingManager;
        address glaselToken;
    }

    function initialize(Wiring calldata w) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __Pausable_init();
        __UUPSUpgradeable_init();

        mxeFactory = IMXEFactory(w.mxeFactory);
        registry = IComputationRegistry(w.registry);
        clusterManager = IClusterManager(w.clusterManager);
        feeOracle = IFeeOracle(w.feeOracle);
        stakingManager = IStakingManager(w.stakingManager);
        glaselToken = IERC20(w.glaselToken);

        _grantRole(DEFAULT_ADMIN_ROLE, w.admin);
        _grantRole(UPGRADER_ROLE, w.admin);
        _grantRole(PAUSER_ROLE, w.admin);
        _grantRole(CHALLENGER_ROLE, w.admin);
        challengeWindow = 1 hours;
        maxCommissionsPerBlock = 50;
        failureWindowBlocks = 1800; // ~1h on Base (2s blocks)
        maxFailuresPerWindow = 100;
    }

    function setChallengeWindow(uint64 window) external onlyRole(DEFAULT_ADMIN_ROLE) {
        challengeWindow = window;
    }

    function setRateLimit(uint256 maxPerBlock) external onlyRole(DEFAULT_ADMIN_ROLE) {
        maxCommissionsPerBlock = maxPerBlock;
    }

    function setCircuitBreaker(uint64 windowBlocks, uint256 maxFailures) external onlyRole(DEFAULT_ADMIN_ROLE) {
        failureWindowBlocks = windowBlocks;
        maxFailuresPerWindow = maxFailures;
    }

    /// @dev Count a failure in the rolling window; auto-pause if the budget is
    ///      exceeded (a watchdog can then investigate before unpausing).
    function _recordFailure() internal {
        if (maxFailuresPerWindow == 0) return;
        if (block.number >= _windowStartBlock + failureWindowBlocks) {
            _windowStartBlock = block.number;
            _failuresInWindow = 0;
        }
        if (++_failuresInWindow > maxFailuresPerWindow && !paused()) {
            _pause();
            emit CircuitBreakerTripped(_failuresInWindow, failureWindowBlocks);
        }
    }

    // ─── Commission ─────────────────────────────────────────────────────────

    function commission(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes calldata encInputs,
        string calldata inputIpfsCid,
        address callbackContract,
        bytes4 callbackSelector,
        uint256 callbackGasLimit,
        uint256 priorityFee
    ) external nonReentrant whenNotPaused returns (bytes32 computationId) {
        // Per-requester per-block rate limit (anti-spam / fairness at scale).
        if (maxCommissionsPerBlock != 0 && ++_commissionsInBlock[msg.sender][block.number] > maxCommissionsPerBlock) {
            revert RateLimited();
        }
        if (!mxeFactory.isActive(mxeId)) revert MXENotActive();
        if (!registry.exists(compDefId)) revert UnknownDefinition();
        if (registry.getDefinition(compDefId).deprecated) revert DefinitionDeprecated();
        if (!mxeFactory.isAllowed(mxeId, compDefId)) revert DefNotAllowed();

        // Resolve and require a live cluster, then snapshot its membership +
        // threshold so verification/slashing bind to the assigned nodes (H-1, H-2).
        Types.Cluster memory cluster = _getCluster(mxeId);
        if (cluster.status != Types.ClusterStatus.Active) revert ClusterNotActive();

        uint256 baseFee = feeOracle.estimateFee(compDefId, callbackGasLimit);
        uint256 totalFee = baseFee + priorityFee;

        glaselToken.safeTransferFrom(msg.sender, address(this), totalFee);

        uint64 deadline = uint64(block.timestamp) + feeOracle.deadlineForCircuit(compDefId);

        computationId =
            keccak256(abi.encode(mxeId, compDefId, encInputs, msg.sender, block.timestamp, _commissionNonce++));

        Types.Computation storage c = _computations[computationId];
        c.mxeId = mxeId;
        c.compDefId = compDefId;
        c.encInputs = encInputs;
        c.inputIpfsCid = inputIpfsCid;
        c.callbackContract = callbackContract;
        c.callbackSelector = callbackSelector;
        c.callbackGasLimit = callbackGasLimit;
        c.feeDeposit = totalFee;
        c.priorityFee = priorityFee;
        c.requester = msg.sender;
        c.commissionedAt = uint64(block.timestamp);
        c.deadline = deadline;
        c.status = Types.ComputationStatus.Pending;
        c.participants = cluster.nodes;
        c.threshold = cluster.minThreshold;
        c.blsGroupKey = cluster.blsGroupKey; // snapshot for the threshold-BLS path

        emit ComputationRequested(computationId, mxeId, compDefId, encInputs, inputIpfsCid, deadline);
    }

    // ─── Submit result ──────────────────────────────────────────────────────

    /// @notice Threshold-BLS result submission — the protocol's sole result path.
    ///         Verifies ONE aggregated BN254 signature against the cluster's group
    ///         key snapshotted at commission. With a threshold-shared key a valid
    ///         signature already proves ≥ t+1 honest nodes signed, so no signer
    ///         list is needed; fees + completion credit accrue to the snapshotted
    ///         participant set. (The legacy per-signer ECDSA path was removed: a
    ///         single pairing check is cheaper and binds to the DKG group key.)
    function submitResult(bytes32 computationId, bytes calldata encResult, uint256[2] calldata sig)
        external
        nonReentrant
    {
        Types.Computation storage comp = _computations[computationId];
        if (comp.status != Types.ComputationStatus.Pending && comp.status != Types.ComputationStatus.InProgress) {
            revert InvalidStatus();
        }
        if (block.timestamp > comp.deadline) revert PastDeadline();

        uint256[4] memory pk = comp.blsGroupKey;
        if (pk[0] == 0 && pk[1] == 0 && pk[2] == 0 && pk[3] == 0) revert InvalidGroupKey();

        bytes32 message = keccak256(abi.encode(computationId, encResult));
        if (!BLS.verify(abi.encodePacked(message), sig, pk)) revert BadBLSSignature();

        comp.encResult = encResult;
        comp.resultCommitment = message;
        comp.status = Types.ComputationStatus.Completed;
        // Open the challenge window; fees are escrowed until finalization so a
        // disputed result can be slashed + refunded (audit: IncorrectResult path).
        challengeDeadlineOf[computationId] = uint64(block.timestamp) + challengeWindow;

        bool callbackOk = _tryCallback(comp, computationId, encResult);
        comp.callbackSucceeded = callbackOk;
        if (!callbackOk) {
            pendingPullResults[computationId] = encResult;
        }

        emit ComputationCompleted(computationId, message, callbackOk);
    }

    /// @notice Settle a completed computation once its challenge window has
    ///         elapsed: pay the snapshotted participants + credit completion.
    ///         Permissionless (anyone can poke it after the window).
    function finalizeComputation(bytes32 computationId) external nonReentrant {
        Types.Computation storage comp = _computations[computationId];
        if (comp.status != Types.ComputationStatus.Completed) revert InvalidStatus();
        if (finalized[computationId]) revert AlreadyFinalized();
        if (block.timestamp <= challengeDeadlineOf[computationId]) revert ChallengeWindowOpen();
        finalized[computationId] = true;

        address[] memory parts = comp.participants;
        uint256 fee = comp.feeDeposit;
        if (fee > 0) {
            comp.feeDeposit = 0;
            glaselToken.safeTransfer(address(stakingManager), fee);
            stakingManager.distributeFees(parts, fee);
        }
        stakingManager.recordCompletion(parts);
        emit ComputationFinalized(computationId);
    }

    /// @notice Dispute a submitted result within its challenge window (a watchtower
    ///         re-executed the circuit and found it wrong). Slashes the participant
    ///         set for IncorrectResult and refunds the requester's escrowed fee.
    function challengeResult(bytes32 computationId) external nonReentrant onlyRole(CHALLENGER_ROLE) {
        Types.Computation storage comp = _computations[computationId];
        if (comp.status != Types.ComputationStatus.Completed) revert NotChallengeable();
        if (finalized[computationId]) revert AlreadyFinalized();
        if (block.timestamp > challengeDeadlineOf[computationId]) revert NotChallengeable();
        finalized[computationId] = true;
        comp.status = Types.ComputationStatus.Failed;

        address[] memory parts = comp.participants;
        stakingManager.slashNodes(parts, Types.SlashReason.IncorrectResult, comp.compDefId);
        _recordFailure();

        uint256 refund = comp.feeDeposit;
        if (refund > 0) {
            comp.feeDeposit = 0;
            glaselToken.safeTransfer(comp.requester, refund);
        }
        emit ComputationChallenged(computationId, parts);
    }

    function _tryCallback(Types.Computation storage comp, bytes32 computationId, bytes calldata encResult)
        internal
        returns (bool success)
    {
        if (comp.callbackContract == address(0)) return false;
        bytes memory callData = abi.encodeWithSelector(comp.callbackSelector, computationId, encResult);
        (success,) = comp.callbackContract.call{gas: comp.callbackGasLimit}(callData);
    }

    // ─── Pull model ───────────────────────────────────────────────────────────

    function pullResult(bytes32 computationId) external nonReentrant returns (bytes memory encResult) {
        Types.Computation storage comp = _computations[computationId];
        if (msg.sender != comp.callbackContract) revert OnlyCallbackContract();
        if (comp.status != Types.ComputationStatus.Completed) revert NotCompleted();
        if (comp.callbackSucceeded) revert PushAlreadySucceeded();

        encResult = pendingPullResults[computationId];
        delete pendingPullResults[computationId];
        comp.callbackSucceeded = true;
        emit ResultPulled(computationId);
    }

    // ─── Slash timed-out ────────────────────────────────────────────────────────

    function slashTimedOut(bytes32 computationId) external nonReentrant {
        Types.Computation storage comp = _computations[computationId];
        if (comp.status != Types.ComputationStatus.Pending && comp.status != Types.ComputationStatus.InProgress) {
            revert InvalidStatus();
        }
        if (block.timestamp <= comp.deadline) revert NotPastDeadline();

        comp.status = Types.ComputationStatus.Failed;

        // Slash exactly the nodes that were assigned at commission (H-2).
        address[] memory nodesToSlash = comp.participants;
        stakingManager.slashNodes(nodesToSlash, Types.SlashReason.MissedDeadline, comp.compDefId);
        _recordFailure();

        uint256 refund = comp.feeDeposit;
        if (refund > 0) {
            comp.feeDeposit = 0;
            glaselToken.safeTransfer(comp.requester, refund);
        }

        emit ComputationFailed(computationId, "deadline exceeded");
        emit ComputationSlashed(computationId, nodesToSlash);
    }

    // ─── Admin / pause ────────────────────────────────────────────────────────

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getComputation(bytes32 computationId) external view returns (Types.Computation memory) {
        return _computations[computationId];
    }

    function statusOf(bytes32 computationId) external view returns (Types.ComputationStatus) {
        return _computations[computationId].status;
    }

    function _getCluster(bytes32 mxeId) internal view returns (Types.Cluster memory) {
        bytes32 clusterId = mxeFactory.getMXE(mxeId).clusterId;
        return clusterManager.getCluster(clusterId);
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
