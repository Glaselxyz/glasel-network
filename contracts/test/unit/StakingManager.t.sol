// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {StakingManager} from "../../src/core/StakingManager.sol";
import {Types} from "../../src/libraries/Types.sol";

contract StakingManagerTest is Test {
    GlaselToken token;
    NodeRegistry registry;
    StakingManager staking;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address coordinator = makeAddr("coordinator");
    address node1 = makeAddr("node1"); // operator+owner of node
    address delegator = makeAddr("delegator");

    uint256 constant MIN = 10_000 ether;

    function setUp() public {
        // token
        token = GlaselToken(
            address(new ERC1967Proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))))
        );
        // registry
        registry = NodeRegistry(
            address(new ERC1967Proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin))))
        );
        // staking
        staking = StakingManager(
            address(
                new ERC1967Proxy(
                    address(new StakingManager()),
                    abi.encodeCall(StakingManager.initialize, (admin, address(token), address(registry), treasury))
                )
            )
        );

        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.mint(node1, 100_000 ether);
        token.mint(delegator, 100_000 ether);
        staking.setCoordinator(coordinator);
        vm.stopPrank();

        // register node
        bytes memory bls = new bytes(48);
        bls[0] = 0x01;
        vm.prank(node1);
        registry.registerNode(bls, bytes32(0), bytes32(0), "US");
    }

    function _stakeMin() internal {
        vm.startPrank(node1);
        token.approve(address(staking), MIN);
        staking.stake(node1, MIN);
        vm.stopPrank();
    }

    function test_stake() public {
        _stakeMin();
        Types.NodeStakeInfo memory s = staking.getStakeInfo(node1);
        assertEq(s.selfStaked, MIN);
        assertEq(s.totalStake, MIN);
        assertEq(s.reputationScore, 5_000);
        assertTrue(staking.isEligible(node1));
    }

    function test_stake_revertsNonOwner() public {
        vm.prank(delegator);
        vm.expectRevert(StakingManager.NotNodeOwner.selector);
        staking.stake(node1, 1 ether);
    }

    function test_delegate() public {
        _stakeMin();
        vm.startPrank(delegator);
        token.approve(address(staking), 5_000 ether);
        staking.delegate(node1, 5_000 ether);
        vm.stopPrank();
        Types.NodeStakeInfo memory s = staking.getStakeInfo(node1);
        assertEq(s.delegatedStake, 5_000 ether);
        assertEq(s.totalStake, MIN + 5_000 ether);
        assertEq(staking.delegations(delegator, node1), 5_000 ether);
    }

    function test_delegate_revertsUndercapitalized() public {
        // node1 staked only 1 ether (below MIN)
        vm.startPrank(node1);
        token.approve(address(staking), 1 ether);
        staking.stake(node1, 1 ether);
        vm.stopPrank();

        vm.startPrank(delegator);
        token.approve(address(staking), 100 ether);
        vm.expectRevert(StakingManager.NodeUndercapitalized.selector);
        staking.delegate(node1, 100 ether);
        vm.stopPrank();
    }

    function test_unstake_unbondingFlow() public {
        _stakeMin();
        vm.prank(node1);
        staking.initiateUnstake(node1, 4_000 ether);

        // cannot claim before unlock
        vm.prank(node1);
        vm.expectRevert(StakingManager.NothingToClaim.selector);
        staking.claimUnstake();

        vm.warp(block.timestamp + 7 days);
        uint256 before = token.balanceOf(node1);
        vm.prank(node1);
        staking.claimUnstake();
        assertEq(token.balanceOf(node1) - before, 4_000 ether);
        assertEq(staking.getStakeInfo(node1).selfStaked, MIN - 4_000 ether);
    }

    function test_slash_missedDeadline() public {
        _stakeMin();
        address[] memory nodes = new address[](1);
        nodes[0] = node1;

        uint256 treasuryBefore = token.balanceOf(treasury);
        vm.prank(coordinator);
        staking.slashNodes(nodes, Types.SlashReason.MissedDeadline, bytes32(0));

        Types.NodeStakeInfo memory s = staking.getStakeInfo(node1);
        assertEq(s.totalStake, MIN - (MIN * 500) / 10_000); // 5% slashed
        assertEq(s.reputationScore, 5_000 - 500);
        assertEq(token.balanceOf(treasury) - treasuryBefore, (MIN * 500) / 10_000);
        assertEq(staking.totalSlashed(), (MIN * 500) / 10_000);
    }

    function test_slash_jailsOnLowReputation() public {
        _stakeMin();
        address[] memory nodes = new address[](1);
        nodes[0] = node1;
        // IncorrectResult: -1000 rep each. 5000 -> need <2000 => 4 slashes (1000).
        for (uint256 i; i < 4; ++i) {
            vm.prank(coordinator);
            staking.slashNodes(nodes, Types.SlashReason.IncorrectResult, bytes32(0));
        }
        Types.NodeStakeInfo memory s = staking.getStakeInfo(node1);
        assertTrue(s.jailed);
        assertFalse(staking.isEligible(node1));
    }

    function test_slash_revertsNonCoordinator() public {
        _stakeMin();
        address[] memory nodes = new address[](1);
        nodes[0] = node1;
        vm.expectRevert();
        staking.slashNodes(nodes, Types.SlashReason.MissedDeadline, bytes32(0));
    }

    function test_distributeFees_andClaim() public {
        _stakeMin();
        address[] memory nodes = new address[](2);
        nodes[0] = node1;
        address node2 = makeAddr("node2");
        nodes[1] = node2;

        uint256 totalFee = 1000 ether;
        // Coordinator transfers fee to staking, then accounts it.
        vm.prank(admin);
        token.mint(coordinator, totalFee);
        vm.prank(coordinator);
        token.transfer(address(staking), totalFee);
        vm.prank(coordinator);
        staking.distributeFees(nodes, totalFee);

        uint256 nodeShare = (totalFee * 90) / 100; // 900
        uint256 perNode = nodeShare / 2; // 450
        assertEq(staking.getStakeInfo(node1).accumulatedRewards, perNode);
        assertEq(token.balanceOf(treasury), totalFee - perNode * 2); // 100

        // node1 operator claims
        uint256 before = token.balanceOf(node1);
        vm.prank(node1);
        staking.claimRewards(node1);
        assertEq(token.balanceOf(node1) - before, perNode);
    }

    function test_recordCompletion_increasesReputation() public {
        _stakeMin();
        address[] memory nodes = new address[](1);
        nodes[0] = node1;
        vm.prank(coordinator);
        staking.recordCompletion(nodes);
        Types.NodeStakeInfo memory s = staking.getStakeInfo(node1);
        assertEq(s.computationsCompleted, 1);
        assertEq(s.reputationScore, 5_100);
    }
}
