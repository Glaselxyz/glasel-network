// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {ReentrancyGuardUpgradeable} from "@openzeppelin/contracts-upgradeable/utils/ReentrancyGuardUpgradeable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Types} from "../libraries/Types.sol";
import {IStakingManager} from "../interfaces/IStakingManager.sol";
import {INodeRegistry} from "../interfaces/INodeRegistry.sol";

/// @title StakingManager
/// @notice Custodies staked + delegated $GLASEL, distributes computation fees,
///         and applies slashing / reputation updates on behalf of the
///         ComputationCoordinator.
contract StakingManager is IStakingManager, AccessControlUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    using SafeERC20 for IERC20;

    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant COORDINATOR_ROLE = keccak256("COORDINATOR_ROLE");

    uint256 public constant MIN_SELF_STAKE = 10_000 ether;
    uint256 public constant SLASH_MISSED = 500; // 5%
    uint256 public constant SLASH_INCORRECT = 3_000; // 30%
    uint256 public constant SLASH_OFFLINE = 200; // 2%

    uint256 public constant SELF_UNBONDING = 7 days;
    uint256 public constant DELEGATED_UNBONDING = 3 days;

    uint256 public constant INITIAL_REPUTATION = 5_000;
    uint256 public constant MAX_REPUTATION = 10_000;
    uint256 public constant JAIL_THRESHOLD = 2_000;
    uint256 public constant REPUTATION_GAIN = 100;

    IERC20 public glaselToken;
    INodeRegistry public registry;
    address public treasury;

    struct Unbonding {
        uint256 amount;
        uint64 unlockAt;
        bool isDelegation;
        address node; // for delegation accounting on claim
        bool claimed;
    }

    mapping(address nodeId => Types.NodeStakeInfo) private _nodeStakes;
    mapping(address delegator => mapping(address nodeId => uint256)) public delegations;
    mapping(address delegator => uint256) public totalDelegated;
    mapping(address account => Unbonding[]) private _unbondings;
    /// @dev Self-stake currently unbonding per node — still slashable so a node
    ///      cannot dodge a pending slash by front-running initiateUnstake (H-3).
    mapping(address node => uint256) public pendingSelfUnbond;

    uint256 public totalSlashed;

    event NodeStaked(address indexed nodeId, uint256 amount);
    event UnstakeInitiated(address indexed account, uint256 amount, uint64 unlockAt);
    event UnstakeClaimed(address indexed account, uint256 amount);
    event NodeSlashed(address indexed nodeId, Types.SlashReason reason, uint256 slashAmount);
    event NodeJailed(address indexed nodeId);
    event NodeUnjailed(address indexed nodeId);
    event DelegationAdded(address indexed delegator, address indexed nodeId, uint256 amount);
    event RewardsClaimed(address indexed nodeId, uint256 amount);
    event FeesDistributed(uint256 nodeShare, uint256 protocolShare, uint256 perNode);

    error NotNodeOwner();
    error NodeUndercapitalized();
    error NodeJailedErr();
    error AmountZero();
    error InsufficientStake();
    error NothingToClaim();
    error StillBonding();
    error NotRegistered();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address token, address registry_, address treasury_) external initializer {
        __AccessControl_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();
        glaselToken = IERC20(token);
        registry = INodeRegistry(registry_);
        treasury = treasury_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
    }

    /// @notice Wire the coordinator address (granted COORDINATOR_ROLE). Admin-only.
    function setCoordinator(address coordinator) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _grantRole(COORDINATOR_ROLE, coordinator);
    }

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = treasury_;
    }

    // ─── Staking ────────────────────────────────────────────────────────────

    function stake(address nodeId, uint256 amount) external nonReentrant {
        if (registry.getNode(nodeId).ownerAddress != msg.sender) revert NotNodeOwner();
        if (amount == 0) revert AmountZero();

        glaselToken.safeTransferFrom(msg.sender, address(this), amount);

        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        if (s.reputationScore == 0 && s.lastActivityAt == 0) {
            s.reputationScore = INITIAL_REPUTATION;
        }
        s.selfStaked += amount;
        s.totalStake += amount;
        s.lastActivityAt = uint64(block.timestamp);
        emit NodeStaked(nodeId, amount);
    }

    function delegate(address nodeId, uint256 amount) external nonReentrant {
        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        if (s.selfStaked < MIN_SELF_STAKE) revert NodeUndercapitalized();
        if (s.jailed) revert NodeJailedErr();
        if (amount == 0) revert AmountZero();

        glaselToken.safeTransferFrom(msg.sender, address(this), amount);

        delegations[msg.sender][nodeId] += amount;
        totalDelegated[msg.sender] += amount;
        s.delegatedStake += amount;
        s.totalStake += amount;
        emit DelegationAdded(msg.sender, nodeId, amount);
    }

    /// @notice Begin unbonding self-stake. Funds transfer after SELF_UNBONDING via claimUnstake.
    function initiateUnstake(address nodeId, uint256 amount) external {
        if (registry.getNode(nodeId).ownerAddress != msg.sender) revert NotNodeOwner();
        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        if (amount == 0) revert AmountZero();
        if (amount > s.selfStaked) revert InsufficientStake();

        s.selfStaked -= amount;
        s.totalStake -= amount;
        pendingSelfUnbond[nodeId] += amount; // remains slashable until claimed (H-3)

        uint64 unlockAt = uint64(block.timestamp + SELF_UNBONDING);
        _unbondings[msg.sender].push(
            Unbonding({amount: amount, unlockAt: unlockAt, isDelegation: false, node: nodeId, claimed: false})
        );
        emit UnstakeInitiated(msg.sender, amount, unlockAt);
    }

    /// @notice Begin unbonding a delegation. Funds transfer after DELEGATED_UNBONDING.
    function initiateUndelegate(address nodeId, uint256 amount) external {
        if (amount == 0) revert AmountZero();
        if (amount > delegations[msg.sender][nodeId]) revert InsufficientStake();

        delegations[msg.sender][nodeId] -= amount;
        totalDelegated[msg.sender] -= amount;

        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        s.delegatedStake -= amount;
        s.totalStake -= amount;

        uint64 unlockAt = uint64(block.timestamp + DELEGATED_UNBONDING);
        _unbondings[msg.sender].push(
            Unbonding({amount: amount, unlockAt: unlockAt, isDelegation: true, node: nodeId, claimed: false})
        );
        emit UnstakeInitiated(msg.sender, amount, unlockAt);
    }

    /// @notice Claim all matured unbonding entries.
    function claimUnstake() external nonReentrant {
        Unbonding[] storage entries = _unbondings[msg.sender];
        uint256 payout;
        for (uint256 i; i < entries.length; ++i) {
            if (!entries[i].claimed && block.timestamp >= entries[i].unlockAt) {
                entries[i].claimed = true;
                payout += entries[i].amount;
                // The entry's amount may have been reduced by an intervening
                // slash; release exactly that (possibly haircut) amount (H-3).
                if (!entries[i].isDelegation) {
                    pendingSelfUnbond[entries[i].node] -= entries[i].amount;
                }
            }
        }
        if (payout == 0) revert NothingToClaim();
        glaselToken.safeTransfer(msg.sender, payout);
        emit UnstakeClaimed(msg.sender, payout);
    }

    // ─── Rewards ──────────────────────────────────────────────────────────────

    function claimRewards(address nodeId) external nonReentrant {
        if (registry.getNode(nodeId).operatorAddress != msg.sender) revert NotNodeOwner();
        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        uint256 amount = s.accumulatedRewards;
        if (amount == 0) revert NothingToClaim();
        s.accumulatedRewards = 0;
        glaselToken.safeTransfer(msg.sender, amount);
        emit RewardsClaimed(nodeId, amount);
    }

    // ─── Coordinator-only hooks ───────────────────────────────────────────────

    /// @notice Accounts a distributed fee. The coordinator MUST have transferred
    ///         `totalFee` $GLASEL to this contract before calling.
    /// @dev 90% credited to participating nodes, 10% forwarded to the treasury.
    function distributeFees(address[] calldata nodes, uint256 totalFee) external onlyRole(COORDINATOR_ROLE) {
        if (nodes.length == 0 || totalFee == 0) return;
        uint256 nodeShare = (totalFee * 90) / 100;
        uint256 protocolShare = totalFee - nodeShare;
        uint256 perNode = nodeShare / nodes.length;
        // Dust from integer division is folded into the protocol share.
        uint256 distributed = perNode * nodes.length;
        protocolShare += (nodeShare - distributed);

        for (uint256 i; i < nodes.length; ++i) {
            _nodeStakes[nodes[i]].accumulatedRewards += perNode;
        }
        if (protocolShare > 0) glaselToken.safeTransfer(treasury, protocolShare);
        emit FeesDistributed(distributed, protocolShare, perNode);
    }

    function recordCompletion(address[] calldata nodes) external onlyRole(COORDINATOR_ROLE) {
        for (uint256 i; i < nodes.length; ++i) {
            Types.NodeStakeInfo storage s = _nodeStakes[nodes[i]];
            s.computationsCompleted++;
            s.lastActivityAt = uint64(block.timestamp);
            uint256 rep = s.reputationScore + REPUTATION_GAIN;
            s.reputationScore = rep > MAX_REPUTATION ? MAX_REPUTATION : rep;
        }
    }

    function slashNodes(
        address[] calldata nodesToSlash,
        Types.SlashReason reason,
        bytes32 /* compDefId */
    )
        external
        onlyRole(COORDINATOR_ROLE)
    {
        uint256 basisPoints = reason == Types.SlashReason.MissedDeadline
            ? SLASH_MISSED
            : reason == Types.SlashReason.IncorrectResult ? SLASH_INCORRECT : SLASH_OFFLINE;

        uint256 repPenalty = reason == Types.SlashReason.IncorrectResult ? 1_000 : 500;

        uint256 batchSlashed;
        for (uint256 i; i < nodesToSlash.length; ++i) {
            address node = nodesToSlash[i];
            Types.NodeStakeInfo storage s = _nodeStakes[node];

            // Slash base includes self-stake currently unbonding, so unbonding
            // cannot be used to escape a pending slash (H-3).
            uint256 base = s.totalStake + pendingSelfUnbond[node];
            uint256 slashAmount = (base * basisPoints) / 10_000;
            if (slashAmount > base) slashAmount = base;

            // Absorb in order: self-stake, then self-unbonding, then delegated.
            uint256 remaining = slashAmount;
            uint256 fromSelf = remaining < s.selfStaked ? remaining : s.selfStaked;
            s.selfStaked -= fromSelf;
            s.totalStake -= fromSelf;
            remaining -= fromSelf;

            if (remaining > 0 && pendingSelfUnbond[node] > 0) {
                uint256 fromUnbond = remaining < pendingSelfUnbond[node] ? remaining : pendingSelfUnbond[node];
                _slashUnbonding(node, fromUnbond);
                pendingSelfUnbond[node] -= fromUnbond;
                remaining -= fromUnbond;
            }

            if (remaining > 0) {
                uint256 fromDeleg = remaining < s.delegatedStake ? remaining : s.delegatedStake;
                s.delegatedStake -= fromDeleg;
                s.totalStake -= fromDeleg;
                remaining -= fromDeleg;
            }

            uint256 slashed = slashAmount - remaining;
            s.computationsFailed++;

            s.reputationScore = s.reputationScore > repPenalty ? s.reputationScore - repPenalty : 0;
            if (s.reputationScore < JAIL_THRESHOLD && !s.jailed) {
                s.jailed = true;
                emit NodeJailed(node);
            }

            batchSlashed += slashed;
            emit NodeSlashed(node, reason, slashed);
        }
        if (batchSlashed > 0) {
            totalSlashed += batchSlashed;
            glaselToken.safeTransfer(treasury, batchSlashed);
        }
    }

    /// @dev Haircut a node's unclaimed self-unbonding entries by `amount`, so a
    ///      slash reaches stake that is mid-unbonding (H-3). Bounded by the node
    ///      owner's unbonding-entry count.
    function _slashUnbonding(address node, uint256 amount) private {
        address owner = registry.getNode(node).ownerAddress;
        Unbonding[] storage es = _unbondings[owner];
        uint256 toCut = amount;
        for (uint256 i; i < es.length && toCut > 0; ++i) {
            if (!es[i].claimed && !es[i].isDelegation && es[i].node == node) {
                uint256 cut = toCut < es[i].amount ? toCut : es[i].amount;
                es[i].amount -= cut;
                toCut -= cut;
            }
        }
    }

    /// @notice Governance / admin unjail after cool-down (enforced off-chain by governance).
    function unjail(address nodeId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        if (s.selfStaked < MIN_SELF_STAKE) revert NodeUndercapitalized();
        s.jailed = false;
        s.reputationScore = INITIAL_REPUTATION;
        emit NodeUnjailed(nodeId);
    }

    // ─── Views ────────────────────────────────────────────────────────────────

    function getStakeInfo(address nodeId) external view returns (Types.NodeStakeInfo memory) {
        return _nodeStakes[nodeId];
    }

    /// @notice A node is eligible for cluster selection if adequately capitalised
    ///         and not jailed.
    function isEligible(address nodeId) external view returns (bool) {
        Types.NodeStakeInfo storage s = _nodeStakes[nodeId];
        return s.selfStaked >= MIN_SELF_STAKE && !s.jailed;
    }

    function unbondingCount(address account) external view returns (uint256) {
        return _unbondings[account].length;
    }

    function unbondingAt(address account, uint256 index) external view returns (Unbonding memory) {
        return _unbondings[account][index];
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
