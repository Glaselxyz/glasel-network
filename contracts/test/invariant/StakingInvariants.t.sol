// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {StakingManager} from "../../src/core/StakingManager.sol";
import {Types} from "../../src/libraries/Types.sol";

/// @dev Drives random sequences of staking operations. All token movement flows
///      through this handler, which also acts as the coordinator (fees/slashing).
contract StakingHandler is Test {
    GlaselToken public token;
    StakingManager public staking;
    address[3] public nodes;
    address[2] public delegators;

    constructor(GlaselToken token_, StakingManager staking_, address[3] memory nodes_, address[2] memory delegators_) {
        token = token_;
        staking = staking_;
        nodes = nodes_;
        delegators = delegators_;
    }

    function stake(uint256 nodeSeed, uint256 amt) external {
        address n = nodes[nodeSeed % 3];
        amt = bound(amt, 0, token.balanceOf(n));
        vm.startPrank(n);
        token.approve(address(staking), amt);
        try staking.stake(n, amt) {} catch {}
        vm.stopPrank();
    }

    function delegate(uint256 dSeed, uint256 nodeSeed, uint256 amt) external {
        address d = delegators[dSeed % 2];
        address n = nodes[nodeSeed % 3];
        amt = bound(amt, 0, token.balanceOf(d));
        vm.startPrank(d);
        token.approve(address(staking), amt);
        try staking.delegate(n, amt) {} catch {}
        vm.stopPrank();
    }

    function initiateUnstake(uint256 nodeSeed, uint256 amt) external {
        address n = nodes[nodeSeed % 3];
        amt = bound(amt, 0, staking.getStakeInfo(n).selfStaked);
        vm.prank(n);
        try staking.initiateUnstake(n, amt) {} catch {}
    }

    function initiateUndelegate(uint256 dSeed, uint256 nodeSeed, uint256 amt) external {
        address d = delegators[dSeed % 2];
        address n = nodes[nodeSeed % 3];
        amt = bound(amt, 0, staking.delegations(d, n));
        vm.prank(d);
        try staking.initiateUndelegate(n, amt) {} catch {}
    }

    function claimUnstake(uint256 who, uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 0, 10 days));
        address a = who % 2 == 0 ? nodes[who % 3] : delegators[who % 2];
        vm.prank(a);
        try staking.claimUnstake() {} catch {}
    }

    function distributeFees(uint256 amt) external {
        amt = bound(amt, 0, token.balanceOf(address(this)));
        if (amt == 0) return;
        token.transfer(address(staking), amt);
        address[] memory ns = new address[](3);
        ns[0] = nodes[0];
        ns[1] = nodes[1];
        ns[2] = nodes[2];
        staking.distributeFees(ns, amt);
    }

    function slash(uint256 nodeSeed, uint256 reasonSeed) external {
        address[] memory ns = new address[](1);
        ns[0] = nodes[nodeSeed % 3];
        Types.SlashReason r = Types.SlashReason(reasonSeed % 3);
        staking.slashNodes(ns, r, bytes32(0));
    }

    function claimRewards(uint256 nodeSeed) external {
        address n = nodes[nodeSeed % 3];
        vm.prank(n);
        try staking.claimRewards(n) {} catch {}
    }
}

contract StakingInvariantsTest is Test {
    GlaselToken token;
    NodeRegistry registry;
    StakingManager staking;
    StakingHandler handler;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address[3] nodes;
    address[2] delegators;

    function setUp() public {
        token = GlaselToken(
            address(new ERC1967Proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))))
        );
        registry = NodeRegistry(
            address(new ERC1967Proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin))))
        );
        staking = StakingManager(
            address(
                new ERC1967Proxy(
                    address(new StakingManager()),
                    abi.encodeCall(StakingManager.initialize, (admin, address(token), address(registry), treasury))
                )
            )
        );

        nodes[0] = makeAddr("nodeA");
        nodes[1] = makeAddr("nodeB");
        nodes[2] = makeAddr("nodeC");
        delegators[0] = makeAddr("delA");
        delegators[1] = makeAddr("delB");

        // register nodes
        for (uint8 i; i < 3; ++i) {
            bytes memory bls = new bytes(48);
            bls[0] = bytes1(uint8(i + 1));
            bls[47] = bytes1(uint8(i + 1));
            vm.prank(nodes[i]);
            registry.registerNode(bls, bytes32(0), bytes32(0), "US");
        }

        handler = new StakingHandler(token, staking, nodes, delegators);

        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        // Fund actors and the handler (fee pool).
        for (uint8 i; i < 3; ++i) {
            token.mint(nodes[i], 1_000_000 ether);
        }
        token.mint(delegators[0], 1_000_000 ether);
        token.mint(delegators[1], 1_000_000 ether);
        token.mint(address(handler), 5_000_000 ether);
        staking.setCoordinator(address(handler));
        vm.stopPrank();

        targetContract(address(handler));
    }

    /// @notice Supply never exceeds the hard cap.
    function invariant_supplyCap() public view {
        assertLe(token.totalSupply(), token.MAX_SUPPLY());
    }

    /// @notice The staking contract is always solvent: its $GLASEL balance
    ///         covers every node's staked principal plus unclaimed rewards.
    ///         (Pending unbonding amounts are held too, so this is conservative.)
    function invariant_stakingSolvency() public view {
        uint256 backing;
        for (uint8 i; i < 3; ++i) {
            Types.NodeStakeInfo memory s = staking.getStakeInfo(nodes[i]);
            backing += s.selfStaked + s.delegatedStake + s.accumulatedRewards;
        }
        assertGe(token.balanceOf(address(staking)), backing);
    }

    /// @notice totalStake equals selfStaked + delegatedStake for every node.
    function invariant_stakeComposition() public view {
        for (uint8 i; i < 3; ++i) {
            Types.NodeStakeInfo memory s = staking.getStakeInfo(nodes[i]);
            assertEq(s.totalStake, s.selfStaked + s.delegatedStake);
        }
    }
}
