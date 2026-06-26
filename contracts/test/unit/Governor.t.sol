// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {
    TimelockControllerUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {GlaselGovernor} from "../../src/governance/GlaselGovernor.sol";

/// @dev A governance-owned target.
contract Box {
    uint256 public value;
    address public immutable gov;

    constructor(address gov_) {
        gov = gov_;
    }

    function setValue(uint256 v) external {
        require(msg.sender == gov, "only governance");
        value = v;
    }
}

contract GovernorTest is Test {
    GlaselToken token;
    TimelockControllerUpgradeable timelock;
    GlaselGovernor governor;
    Box box;

    address admin = makeAddr("admin");
    address voter = makeAddr("voter");

    uint48 constant VOTING_DELAY = 1;
    uint32 constant VOTING_PERIOD = 10;
    uint256 constant MIN_DELAY = 1;

    function setUp() public {
        token = GlaselToken(
            address(new ERC1967Proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))))
        );

        // Timelock: this test contract is temporary admin for wiring.
        address[] memory empty = new address[](0);
        timelock = TimelockControllerUpgradeable(
            payable(address(
                    new ERC1967Proxy(
                        address(new TimelockControllerUpgradeable()),
                        abi.encodeCall(
                            TimelockControllerUpgradeable.initialize, (MIN_DELAY, empty, empty, address(this))
                        )
                    )
                ))
        );

        governor = GlaselGovernor(
            payable(address(
                    new ERC1967Proxy(
                        address(new GlaselGovernor()),
                        abi.encodeCall(
                            GlaselGovernor.initialize,
                            (IVotes(address(token)), timelock, VOTING_DELAY, VOTING_PERIOD, 0, 4, 0)
                        )
                    )
                ))
        );

        // Wire timelock roles: governor proposes/cancels; anyone executes.
        timelock.grantRole(timelock.PROPOSER_ROLE(), address(governor));
        timelock.grantRole(timelock.CANCELLER_ROLE(), address(governor));
        timelock.grantRole(timelock.EXECUTOR_ROLE(), address(0));
        timelock.renounceRole(timelock.DEFAULT_ADMIN_ROLE(), address(this));

        box = new Box(address(timelock));

        // Give the voter voting power.
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.mint(voter, 100_000 ether);
        vm.stopPrank();
        vm.prank(voter);
        token.delegate(voter);
        vm.roll(block.number + 1); // checkpoint the delegation
    }

    function _proposal()
        internal
        view
        returns (address[] memory targets, uint256[] memory values, bytes[] memory calldatas, string memory description)
    {
        targets = new address[](1);
        targets[0] = address(box);
        values = new uint256[](1);
        calldatas = new bytes[](1);
        calldatas[0] = abi.encodeCall(Box.setValue, (42));
        description = "set box value to 42";
    }

    function test_fullGovernanceCycle() public {
        (address[] memory t, uint256[] memory v, bytes[] memory c, string memory d) = _proposal();

        vm.prank(voter);
        uint256 proposalId = governor.propose(t, v, c, d);
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Pending));

        vm.roll(block.number + VOTING_DELAY + 1);
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Active));

        vm.prank(voter);
        governor.castVote(proposalId, 1); // For

        vm.roll(block.number + VOTING_PERIOD + 1);
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Succeeded));

        governor.queue(t, v, c, keccak256(bytes(d)));
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Queued));

        vm.warp(block.timestamp + MIN_DELAY + 1);
        governor.execute(t, v, c, keccak256(bytes(d)));
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Executed));

        assertEq(box.value(), 42);
    }

    function test_box_onlyGovernanceCanSet() public {
        vm.expectRevert("only governance");
        box.setValue(99);
    }

    function test_proposalDefeated_belowQuorum() public {
        // A voter with < 4% quorum cannot pass.
        address whale = makeAddr("smallholder");
        vm.startPrank(admin);
        token.mint(whale, 1000 ether); // total supply now 101_000; quorum = 4040
        vm.stopPrank();
        vm.prank(whale);
        token.delegate(whale);
        vm.roll(block.number + 1);

        (address[] memory t, uint256[] memory v, bytes[] memory c, string memory d) = _proposal();
        vm.prank(whale);
        uint256 proposalId = governor.propose(t, v, c, d);
        vm.roll(block.number + VOTING_DELAY + 1);
        vm.prank(whale);
        governor.castVote(proposalId, 1);
        vm.roll(block.number + VOTING_PERIOD + 1);
        // 1000 votes < 4040 quorum -> Defeated
        assertEq(uint8(governor.state(proposalId)), uint8(IGovernor.ProposalState.Defeated));
    }

    function test_cannotExecuteBeforeTimelockDelay() public {
        (address[] memory t, uint256[] memory v, bytes[] memory c, string memory d) = _proposal();
        vm.prank(voter);
        uint256 proposalId = governor.propose(t, v, c, d);
        vm.roll(block.number + VOTING_DELAY + 1);
        vm.prank(voter);
        governor.castVote(proposalId, 1);
        vm.roll(block.number + VOTING_PERIOD + 1);
        governor.queue(t, v, c, keccak256(bytes(d)));
        // Execute immediately (before MIN_DELAY elapses) must revert.
        vm.expectRevert();
        governor.execute(t, v, c, keccak256(bytes(d)));
    }

    /// A proposal fee is collected on propose, forfeited to the treasury on defeat.
    function test_proposalFee_collectedAndForfeitedOnDefeat() public {
        uint256 fee = 1_000 ether;
        GlaselGovernor feeGov = GlaselGovernor(
            payable(address(
                    new ERC1967Proxy(
                        address(new GlaselGovernor()),
                        abi.encodeCall(
                            GlaselGovernor.initialize,
                            (IVotes(address(token)), timelock, VOTING_DELAY, VOTING_PERIOD, 0, 4, fee)
                        )
                    )
                ))
        );

        (address[] memory t, uint256[] memory v, bytes[] memory c, string memory d) = _proposal();
        uint256 before = token.balanceOf(voter);
        vm.startPrank(voter);
        token.approve(address(feeGov), fee);
        uint256 proposalId = feeGov.propose(t, v, c, d);
        vm.stopPrank();

        assertEq(token.balanceOf(voter), before - fee, "fee collected from proposer");
        assertEq(token.balanceOf(address(feeGov)), fee);

        // No votes cast → after the voting period the proposal is Defeated.
        vm.roll(block.number + VOTING_DELAY + VOTING_PERIOD + 2);
        assertEq(uint8(feeGov.state(proposalId)), uint8(IGovernor.ProposalState.Defeated));

        // Reclaim forfeits the deposit to the treasury (the timelock executor).
        uint256 tlBefore = token.balanceOf(address(timelock));
        feeGov.reclaimProposalDeposit(proposalId);
        assertEq(token.balanceOf(address(timelock)), tlBefore + fee, "forfeited to treasury");
    }
}
