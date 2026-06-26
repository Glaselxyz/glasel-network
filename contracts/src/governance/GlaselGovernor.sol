// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GovernorUpgradeable} from "@openzeppelin/contracts-upgradeable/governance/GovernorUpgradeable.sol";
import {
    GovernorSettingsUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorSettingsUpgradeable.sol";
import {
    GovernorCountingSimpleUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorCountingSimpleUpgradeable.sol";
import {
    GovernorVotesUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesUpgradeable.sol";
import {
    GovernorVotesQuorumFractionUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorVotesQuorumFractionUpgradeable.sol";
import {
    GovernorTimelockControlUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/extensions/GovernorTimelockControlUpgradeable.sol";
import {
    TimelockControllerUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title GlaselGovernor
/// @notice $GLASEL token governance (§4.10). Standard OpenZeppelin v5 Governor:
///         simple for/against/abstain counting, ERC20Votes voting power, a 4%
///         quorum fraction, and a TimelockController so passed proposals execute
///         only after the governance delay. The Governor upgrades itself
///         (UUPS, `onlyGovernance`); the timelock owns the upgrade authority of
///         every other protocol contract.
contract GlaselGovernor is
    GovernorUpgradeable,
    GovernorSettingsUpgradeable,
    GovernorCountingSimpleUpgradeable,
    GovernorVotesUpgradeable,
    GovernorVotesQuorumFractionUpgradeable,
    GovernorTimelockControlUpgradeable,
    UUPSUpgradeable
{
    using SafeERC20 for IERC20;

    /// @notice Anti-spam deposit a proposer must post; refunded if the proposal
    ///         succeeds, forfeited to the treasury (the timelock) if it fails.
    uint256 public proposalFee;
    IERC20 public feeToken;
    mapping(uint256 proposalId => uint256) public depositAmount;
    mapping(uint256 proposalId => address) public depositProposer;

    error NoDeposit();
    error ProposalNotFinal();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// @param token         the ERC20Votes $GLASEL token
    /// @param timelock      the TimelockController that executes proposals
    /// @param votingDelay   delay (in token clock units) before voting opens
    /// @param votingPeriod  voting window length
    /// @param proposalThreshold minimum votes to create a proposal
    /// @param quorumPercent quorum as a percent of total supply (e.g. 4)
    function initialize(
        IVotes token,
        TimelockControllerUpgradeable timelock,
        uint48 votingDelay,
        uint32 votingPeriod,
        uint256 proposalThreshold,
        uint256 quorumPercent,
        uint256 proposalFee_
    ) external initializer {
        __Governor_init("GlaselGovernor");
        __GovernorSettings_init(votingDelay, votingPeriod, proposalThreshold);
        __GovernorCountingSimple_init();
        __GovernorVotes_init(token);
        __GovernorVotesQuorumFraction_init(quorumPercent);
        __GovernorTimelockControl_init(timelock);
        __UUPSUpgradeable_init();
        proposalFee = proposalFee_;
        feeToken = IERC20(address(token));
    }

    /// @dev Adjust the anti-spam proposal fee (governance-only).
    function setProposalFee(uint256 fee) external onlyGovernance {
        proposalFee = fee;
    }

    /// @notice Create a proposal, posting the anti-spam deposit (if any).
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        string memory description
    ) public override returns (uint256) {
        uint256 proposalId = super.propose(targets, values, calldatas, description);
        if (proposalFee > 0) {
            feeToken.safeTransferFrom(_msgSender(), address(this), proposalFee);
            depositAmount[proposalId] = proposalFee;
            depositProposer[proposalId] = _msgSender();
        }
        return proposalId;
    }

    /// @notice Settle a proposal's deposit once it reaches a terminal state:
    ///         refunded to the proposer if it passed, forfeited to the treasury
    ///         (the timelock executor) if it failed.
    function reclaimProposalDeposit(uint256 proposalId) external {
        uint256 amount = depositAmount[proposalId];
        if (amount == 0) revert NoDeposit();
        ProposalState s = state(proposalId);
        address recipient;
        if (s == ProposalState.Succeeded || s == ProposalState.Queued || s == ProposalState.Executed) {
            recipient = depositProposer[proposalId];
        } else if (s == ProposalState.Defeated || s == ProposalState.Canceled || s == ProposalState.Expired) {
            recipient = _executor();
        } else {
            revert ProposalNotFinal();
        }
        delete depositAmount[proposalId];
        delete depositProposer[proposalId];
        feeToken.safeTransfer(recipient, amount);
    }

    // ─── Required overrides (OZ v5 multiple inheritance) ──────────────────────

    function votingDelay() public view override(GovernorUpgradeable, GovernorSettingsUpgradeable) returns (uint256) {
        return super.votingDelay();
    }

    function votingPeriod() public view override(GovernorUpgradeable, GovernorSettingsUpgradeable) returns (uint256) {
        return super.votingPeriod();
    }

    function proposalThreshold()
        public
        view
        override(GovernorUpgradeable, GovernorSettingsUpgradeable)
        returns (uint256)
    {
        return super.proposalThreshold();
    }

    function quorum(uint256 timepoint)
        public
        view
        override(GovernorUpgradeable, GovernorVotesQuorumFractionUpgradeable)
        returns (uint256)
    {
        return super.quorum(timepoint);
    }

    function state(uint256 proposalId)
        public
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (ProposalState)
    {
        return super.state(proposalId);
    }

    function proposalNeedsQueuing(uint256 proposalId)
        public
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (bool)
    {
        return super.proposalNeedsQueuing(proposalId);
    }

    function _queueOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (uint48) {
        return super._queueOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _executeOperations(
        uint256 proposalId,
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) {
        super._executeOperations(proposalId, targets, values, calldatas, descriptionHash);
    }

    function _cancel(
        address[] memory targets,
        uint256[] memory values,
        bytes[] memory calldatas,
        bytes32 descriptionHash
    ) internal override(GovernorUpgradeable, GovernorTimelockControlUpgradeable) returns (uint256) {
        return super._cancel(targets, values, calldatas, descriptionHash);
    }

    function _executor()
        internal
        view
        override(GovernorUpgradeable, GovernorTimelockControlUpgradeable)
        returns (address)
    {
        return super._executor();
    }

    /// @dev Governor upgrades are themselves governed (must pass a proposal).
    function _authorizeUpgrade(address) internal override onlyGovernance {}
}
