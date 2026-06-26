// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ProtocolFixture} from "../helpers/ProtocolFixture.sol";
import {Types} from "../../src/libraries/Types.sol";
import {ComputationCoordinator} from "../../src/core/ComputationCoordinator.sol";
import {ClusterManager} from "../../src/core/ClusterManager.sol";
import {FeeOracle} from "../../src/core/FeeOracle.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {StakingManager} from "../../src/core/StakingManager.sol";

/// @notice Regression tests for the security-audit findings.
contract AuditCoordinatorTest is ProtocolFixture {
    address requester = makeAddr("requester");
    bytes32 mxeId;
    bytes32 compDefId;
    bytes32 clusterId;

    function setUp() public {
        _deployProtocol();
        clusterId = _activateCluster(Types.ClusterPermission.Permissionless);
        compDefId = _deployDef(50_000); // 150s deadline
        mxeId = _createMXE(clusterId, compDefId);
        vm.prank(admin);
        token.mint(requester, 1_000 ether);
        vm.prank(requester);
        token.approve(address(coordinator), type(uint256).max);
        vm.fee(0);
    }

    function _commission() internal returns (bytes32) {
        vm.prank(requester);
        return coordinator.commission(mxeId, compDefId, hex"1122", "", address(0), bytes4(0), 0, 0);
    }

    /// C-1: two identical commissions in the same block must NOT collide.
    function test_C1_noComputationIdCollision() public {
        bytes32 a = _commission();
        bytes32 b = _commission(); // same block, same args
        assertTrue(a != b, "computationId collision");
        // Both deposits are independently recorded.
        assertEq(coordinator.getComputation(a).feeDeposit, 5 ether);
        assertEq(coordinator.getComputation(b).feeDeposit, 5 ether);
    }

    /// H-1: commissioning against a dissolved cluster must revert.
    function test_H1_commissionRevertsIfClusterDissolved() public {
        vm.prank(admin);
        clusterManager.dissolveCluster(clusterId);
        vm.prank(requester);
        vm.expectRevert(ComputationCoordinator.ClusterNotActive.selector);
        coordinator.commission(mxeId, compDefId, hex"1122", "", address(0), bytes4(0), 0, 0);
    }

    /// H-2: migrating the cluster after commission must NOT redirect slashing
    ///      onto the replacement node; the snapshotted participants are slashed.
    function test_H2_slashHitsCommitTimeParticipants() public {
        bytes32 cid = _commission();

        // Register + stake a replacement node, then migrate node[2] -> replacement.
        uint256 rpk = 0xD44;
        address replacement = vm.addr(rpk);
        bytes memory bls = new bytes(48);
        bls[0] = 0x09;
        bls[47] = 0x09;
        vm.prank(replacement);
        registry.registerNode(bls, bytes32(uint256(9)), bytes32(0), "US");
        vm.prank(admin);
        token.mint(replacement, MIN_STAKE);
        vm.startPrank(replacement);
        token.approve(address(staking), MIN_STAKE);
        staking.stake(replacement, MIN_STAKE);
        vm.stopPrank();

        vm.prank(admin);
        clusterManager.initiateNodeMigration(clusterId, node[2], replacement);

        // Time out and slash.
        vm.warp(block.timestamp + 200);
        coordinator.slashTimedOut(cid);

        // Original participant node[2] is slashed; the replacement is untouched.
        assertEq(staking.getStakeInfo(node[2]).computationsFailed, 1);
        assertEq(staking.getStakeInfo(replacement).computationsFailed, 0);
        assertEq(staking.getStakeInfo(node[0]).computationsFailed, 1);
    }
}

contract AuditStakingTest is Test {
    GlaselToken token;
    NodeRegistry registry;
    StakingManager staking;
    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address coordinator = makeAddr("coordinator");
    address node = makeAddr("node");
    uint256 constant MIN = 10_000 ether;

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
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.mint(node, MIN);
        staking.setCoordinator(coordinator);
        vm.stopPrank();
        bytes memory bls = new bytes(48);
        bls[0] = 0x01;
        vm.prank(node);
        registry.registerNode(bls, bytes32(0), bytes32(0), "US");
        vm.startPrank(node);
        token.approve(address(staking), MIN);
        staking.stake(node, MIN);
        vm.stopPrank();
    }

    /// H-3: a node cannot dodge slashing by front-running initiateUnstake; the
    ///      unbonding stake is included in the slash base and haircut.
    function test_H3_unbondingStakeIsSlashable() public {
        // Move 9000 of 10000 self-stake into unbonding.
        vm.prank(node);
        staking.initiateUnstake(node, 9_000 ether);
        assertEq(staking.getStakeInfo(node).selfStaked, 1_000 ether);
        assertEq(staking.pendingSelfUnbond(node), 9_000 ether);

        address[] memory nodes = new address[](1);
        nodes[0] = node;
        uint256 treasuryBefore = token.balanceOf(treasury);

        // IncorrectResult = 30% of base (10_000) = 3_000, not 30% of 1_000.
        vm.prank(coordinator);
        staking.slashNodes(nodes, Types.SlashReason.IncorrectResult, bytes32(0));

        assertEq(token.balanceOf(treasury) - treasuryBefore, 3_000 ether, "slash escaped via unbonding");
        assertEq(staking.getStakeInfo(node).selfStaked, 0);
        assertEq(staking.pendingSelfUnbond(node), 7_000 ether); // 9000 - 2000 haircut

        // The unbonding entry was haircut to 7000; claim pays only that.
        vm.warp(block.timestamp + 7 days + 1);
        vm.prank(node);
        staking.claimUnstake();
        assertEq(token.balanceOf(node), 7_000 ether);
    }
}

contract AuditMiscTest is Test {
    address admin = makeAddr("admin");

    /// M-2: proposeCluster must reject oversized node sets.
    function test_M2_clusterSizeCapped() public {
        NodeRegistry registry = NodeRegistry(
            address(new ERC1967Proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin))))
        );
        ClusterManager cm = ClusterManager(
            address(
                new ERC1967Proxy(
                    address(new ClusterManager()),
                    abi.encodeCall(ClusterManager.initialize, (admin, address(registry), address(0)))
                )
            )
        );
        // 65 > MAX_CLUSTER_NODES (64); cap is checked before registration.
        address[] memory many = new address[](65);
        for (uint256 i; i < 65; ++i) {
            many[i] = address(uint160(i + 1));
        }
        vm.expectRevert(ClusterManager.TooManyNodes.selector);
        cm.proposeCluster(many, Types.ClusterPermission.Permissionless, 33, admin);
    }

    /// M-3: deadline floor cannot be set to zero.
    function test_M3_deadlineFloorNonZero() public {
        NodeRegistry registry = NodeRegistry(
            address(new ERC1967Proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin))))
        );
        FeeOracle fee = FeeOracle(
            address(
                new ERC1967Proxy(
                    address(new FeeOracle()), abi.encodeCall(FeeOracle.initialize, (admin, address(registry)))
                )
            )
        );
        vm.prank(admin);
        vm.expectRevert("deadline floor=0");
        fee.setDeadlineParams(0, 0, 600);
    }
}
