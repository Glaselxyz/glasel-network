// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolFixture} from "../helpers/ProtocolFixture.sol";
import {Types} from "../../src/libraries/Types.sol";
import {ComputationCoordinator} from "../../src/core/ComputationCoordinator.sol";

/// @dev Minimal application callback target used by the lifecycle test.
contract Receiver {
    bytes public lastResult;
    bytes32 public lastId;
    bool public revertOnCallback;

    function setRevert(bool v) external {
        revertOnCallback = v;
    }

    function onComputationComplete(bytes32 id, bytes calldata encResult) external {
        require(!revertOnCallback, "callback reverted");
        lastId = id;
        lastResult = encResult;
    }
}

contract LifecycleTest is ProtocolFixture {
    Receiver receiver;
    address requester = makeAddr("requester");
    bytes32 mxeId;
    bytes32 compDefId;

    // Fixed group secret key (< r) used by the off-chain BLS signer for the test.
    string internal constant SK = "12345678901234567890123456789";

    function setUp() public {
        _deployProtocol();
        bytes32 clusterId = _activateCluster(Types.ClusterPermission.Permissionless);
        compDefId = _deployDef(50_000); // 5 GLASEL circuit fee, 150s deadline
        mxeId = _createMXE(clusterId, compDefId);

        // Register the cluster's BLS group key (the sole result path is BLS).
        (uint256[4] memory pk,) = _ffiSign(bytes32(uint256(1)));
        vm.prank(admin);
        clusterManager.setBlsGroupKey(clusterId, pk);

        receiver = new Receiver();

        // Fund the requester and approve the coordinator.
        vm.prank(admin);
        token.mint(requester, 1_000 ether);
        vm.prank(requester);
        token.approve(address(coordinator), type(uint256).max);

        vm.fee(0); // deterministic: no callback gas component
    }

    /// Produce a real BN254 group key + signature over `message` via the Rust
    /// `bls-sign` binary (the same signer the nodes run). Requires `ffi = true`.
    function _ffiSign(bytes32 message) internal returns (uint256[4] memory pk, uint256[2] memory sig) {
        string[] memory cmd = new string[](3);
        cmd[0] = "../node/target/debug/bls-sign";
        cmd[1] = SK;
        cmd[2] = vm.toString(message);
        bytes memory out = vm.ffi(cmd);
        (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e, uint256 f) =
            abi.decode(out, (uint256, uint256, uint256, uint256, uint256, uint256));
        pk = [a, b, c, d];
        sig = [e, f];
    }

    function _blsSig(bytes32 id, bytes memory encResult) internal returns (uint256[2] memory sig) {
        (, sig) = _ffiSign(keccak256(abi.encode(id, encResult)));
    }

    function _commission() internal returns (bytes32 computationId) {
        vm.prank(requester);
        computationId = coordinator.commission(
            mxeId, compDefId, hex"c1ab23ef", "", address(receiver), Receiver.onComputationComplete.selector, 200_000, 0
        );
    }

    function test_fullLifecycle_pushCallback() public {
        uint256 reqBefore = token.balanceOf(requester);
        bytes32 id = _commission();

        Types.Computation memory c = coordinator.getComputation(id);
        assertEq(uint8(c.status), uint8(Types.ComputationStatus.Pending));
        assertEq(c.requester, requester);
        assertEq(c.feeDeposit, 5 ether); // 50_000 gates -> 5 GLASEL
        assertEq(reqBefore - token.balanceOf(requester), 5 ether);

        // Nodes compute + threshold-BLS-sign the result; one aggregated sig.
        bytes memory encResult = hex"deadbeef";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));

        // Callback fired, result delivered.
        assertEq(receiver.lastId(), id);
        assertEq(receiver.lastResult(), encResult);

        Types.Computation memory done = coordinator.getComputation(id);
        assertEq(uint8(done.status), uint8(Types.ComputationStatus.Completed));
        assertTrue(done.callbackSucceeded);

        // Fees are escrowed during the challenge window; finalize once it closes.
        vm.warp(block.timestamp + coordinator.challengeWindow() + 1);
        coordinator.finalizeComputation(id);

        // Fees accrue to the snapshotted participant set (3 cluster nodes): 90%
        // split across participants, 10% to treasury. (The BLS path has no signer
        // list — a valid group signature already proves a threshold signed.)
        uint256 nodeShare = (5 ether * 90) / 100;
        uint256 perNode = nodeShare / 3;
        for (uint8 i; i < 3; ++i) {
            assertEq(staking.getStakeInfo(node[i]).accumulatedRewards, perNode);
            assertEq(staking.getStakeInfo(node[i]).computationsCompleted, 1);
        }
        assertEq(token.balanceOf(treasury), 5 ether - perNode * 3);
    }

    function test_pullFallback_whenCallbackReverts() public {
        receiver.setRevert(true);
        bytes32 id = _commission();

        bytes memory encResult = hex"1234";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));

        Types.Computation memory c = coordinator.getComputation(id);
        assertEq(uint8(c.status), uint8(Types.ComputationStatus.Completed));
        assertFalse(c.callbackSucceeded);
        assertEq(coordinator.pendingPullResults(id), encResult);

        // Receiver pulls the result.
        vm.prank(address(receiver));
        bytes memory pulled = coordinator.pullResult(id);
        assertEq(pulled, encResult);
        assertTrue(coordinator.getComputation(id).callbackSucceeded);
    }

    // BLS-signature rejection (tampered result / wrong key) is covered end-to-end
    // in BlsSubmit.t.sol's test_SubmitResultBLS_RejectsTamperedResult.

    function test_slashTimedOut() public {
        uint256 reqBefore = token.balanceOf(requester);
        bytes32 id = _commission();
        assertEq(reqBefore - token.balanceOf(requester), 5 ether);

        // Warp past the deadline (150s) and slash.
        vm.warp(block.timestamp + 151);
        coordinator.slashTimedOut(id);

        Types.Computation memory c = coordinator.getComputation(id);
        assertEq(uint8(c.status), uint8(Types.ComputationStatus.Failed));

        // Requester fully refunded.
        assertEq(token.balanceOf(requester), reqBefore);

        // All cluster nodes slashed 5% (MissedDeadline) and lost reputation.
        for (uint8 i; i < 3; ++i) {
            Types.NodeStakeInfo memory s = staking.getStakeInfo(node[i]);
            assertEq(s.totalStake, MIN_STAKE - (MIN_STAKE * 500) / 10_000);
            assertEq(s.computationsFailed, 1);
        }
    }

    /// A wrong-but-signed result is disputed within the challenge window: the
    /// participants are slashed 30% (IncorrectResult) and the requester refunded.
    function test_challengeResult_slashesAndRefunds() public {
        uint256 reqBefore = token.balanceOf(requester);
        bytes32 id = _commission();
        bytes memory encResult = hex"deadbeef";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));

        // A challenger (admin holds CHALLENGER_ROLE) disputes within the window.
        vm.prank(admin);
        coordinator.challengeResult(id);

        Types.Computation memory c = coordinator.getComputation(id);
        assertEq(uint8(c.status), uint8(Types.ComputationStatus.Failed));
        // Escrowed fee refunded to the requester (never distributed).
        assertEq(token.balanceOf(requester), reqBefore);
        // Participants slashed 30% for an incorrect result.
        for (uint8 i; i < 3; ++i) {
            assertEq(staking.getStakeInfo(node[i]).totalStake, MIN_STAKE - (MIN_STAKE * 3000) / 10_000);
        }
        // A challenged computation can no longer be finalized.
        vm.warp(block.timestamp + coordinator.challengeWindow() + 1);
        vm.expectRevert(ComputationCoordinator.InvalidStatus.selector);
        coordinator.finalizeComputation(id);
    }

    /// Finalizing before the window closes reverts; only a challenger can dispute.
    function test_finalize_blockedDuringWindow() public {
        bytes32 id = _commission();
        bytes memory encResult = hex"beef";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));
        vm.expectRevert(ComputationCoordinator.ChallengeWindowOpen.selector);
        coordinator.finalizeComputation(id);
    }

    /// Once the challenge window has elapsed, a dispute can no longer be raised —
    /// the result is final and challengeResult reverts NotChallengeable.
    function test_challengeResult_revertsAfterWindowCloses() public {
        bytes32 id = _commission();
        bytes memory encResult = hex"beef";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));
        vm.warp(block.timestamp + coordinator.challengeWindow() + 1);
        vm.prank(admin);
        vm.expectRevert(ComputationCoordinator.NotChallengeable.selector);
        coordinator.challengeResult(id);
    }

    /// finalize is idempotent-guarded: a second call after fees are released reverts
    /// AlreadyFinalized (no double payout).
    function test_finalize_revertsOnDoubleFinalize() public {
        bytes32 id = _commission();
        bytes memory encResult = hex"beef";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));
        vm.warp(block.timestamp + coordinator.challengeWindow() + 1);
        coordinator.finalizeComputation(id);
        vm.expectRevert(ComputationCoordinator.AlreadyFinalized.selector);
        coordinator.finalizeComputation(id);
    }

    /// Only an account holding CHALLENGER_ROLE may dispute a result.
    function test_challengeResult_revertsForNonChallenger() public {
        bytes32 id = _commission();
        bytes memory encResult = hex"beef";
        coordinator.submitResult(id, encResult, _blsSig(id, encResult));
        address stranger = address(0xBAD);
        vm.expectRevert(
            abi.encodeWithSignature(
                "AccessControlUnauthorizedAccount(address,bytes32)", stranger, coordinator.CHALLENGER_ROLE()
            )
        );
        vm.prank(stranger);
        coordinator.challengeResult(id);
    }

    function test_commission_revertsWhenPaused() public {
        vm.prank(admin);
        coordinator.pause();
        vm.prank(requester);
        vm.expectRevert();
        coordinator.commission(
            mxeId, compDefId, hex"00", "", address(receiver), Receiver.onComputationComplete.selector, 100_000, 0
        );
    }

    function test_commission_revertsDefNotAllowed() public {
        bytes32 otherDef = _deployDef(1000); // not in the MXE allow-list
        vm.prank(requester);
        vm.expectRevert(ComputationCoordinator.DefNotAllowed.selector);
        coordinator.commission(
            mxeId, otherDef, hex"00", "", address(receiver), Receiver.onComputationComplete.selector, 100_000, 0
        );
    }

    /// Per-requester per-block rate limit blocks the 3rd commission when max is 2.
    function test_rateLimit_perBlock() public {
        vm.prank(admin);
        coordinator.setRateLimit(2);
        _commission(); // 1
        _commission(); // 2
        vm.prank(requester);
        vm.expectRevert(ComputationCoordinator.RateLimited.selector);
        coordinator.commission(
            mxeId, compDefId, hex"c1ab23ef", "", address(receiver), Receiver.onComputationComplete.selector, 200_000, 0
        );
    }

    /// The circuit breaker auto-pauses after too many failures in the window.
    function test_circuitBreaker_autoPausesOnFailureSpike() public {
        vm.prank(admin);
        coordinator.setCircuitBreaker(10_000, 2); // trip after >2 failures
        bytes32 a = _commission();
        bytes32 b = _commission();
        bytes32 c = _commission();
        vm.warp(block.timestamp + 151); // past the 150s deadline

        coordinator.slashTimedOut(a); // failure 1
        coordinator.slashTimedOut(b); // failure 2
        assertFalse(coordinator.paused());
        coordinator.slashTimedOut(c); // failure 3 > 2 → trips the breaker
        assertTrue(coordinator.paused(), "circuit breaker tripped");

        // New commissions are blocked while paused.
        vm.prank(requester);
        vm.expectRevert();
        coordinator.commission(
            mxeId, compDefId, hex"00", "", address(receiver), Receiver.onComputationComplete.selector, 100_000, 0
        );
    }
}
