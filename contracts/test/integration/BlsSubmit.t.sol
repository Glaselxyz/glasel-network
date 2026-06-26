// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ProtocolFixture} from "../helpers/ProtocolFixture.sol";
import {Types} from "../../src/libraries/Types.sol";

/// @notice End-to-end test of the threshold-BLS result path: a cluster's BN254
///         group key is registered on-chain, a computation is commissioned, and
///         a real BLS signature (produced by the Rust `bls-sign` binary over the
///         exact on-chain message) is verified by `submitResultBLS` via the
///         ecPairing precompile. Proves the off-chain signer and on-chain
///         verifier agree on live protocol state. Requires `ffi = true`.
contract BlsSubmitTest is ProtocolFixture {
    // Fixed group secret key (< r) used by the off-chain signer for the test.
    string internal constant SK = "12345678901234567890123456789";

    function setUp() public {
        _deployProtocol();
    }

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

    function _commission() internal returns (bytes32 clusterId, bytes32 computationId) {
        clusterId = _activateCluster(Types.ClusterPermission.Permissionless);
        bytes32 compDefId = _deployDef(50_000);
        bytes32 mxeId = _createMXE(clusterId, compDefId);

        // Register the cluster's BLS group key (FFI returns pk for SK).
        (uint256[4] memory pk,) = _ffiSign(bytes32(uint256(1)));
        vm.prank(admin);
        clusterManager.setBlsGroupKey(clusterId, pk);

        vm.prank(admin);
        token.mint(admin, 1_000 ether);
        vm.startPrank(admin);
        token.approve(address(coordinator), type(uint256).max);
        computationId = coordinator.commission(mxeId, compDefId, hex"00", "", address(0), bytes4(0), 0, 0);
        vm.stopPrank();
    }

    function test_SubmitResultBLS_VerifiesOnChain() public {
        (, bytes32 computationId) = _commission();

        bytes memory encResult = hex"cafe";
        bytes32 message = keccak256(abi.encode(computationId, encResult));
        (, uint256[2] memory sig) = _ffiSign(message);

        coordinator.submitResult(computationId, encResult, sig);

        assertEq(
            uint8(coordinator.statusOf(computationId)),
            uint8(Types.ComputationStatus.Completed),
            "BLS-verified result must complete the computation"
        );
    }

    /// Trustless DKG (Feldman VSS, no dealer) → group key registered on-chain →
    /// a threshold-combined signature from the DKG shares verifies via ecPairing.
    function _ffiDkg(uint256 seed, bytes32 message) internal returns (uint256[4] memory pk, uint256[2] memory sig) {
        string[] memory cmd = new string[](5);
        cmd[0] = "../node/target/debug/bls-dkg";
        cmd[1] = vm.toString(seed);
        cmd[2] = "3";
        cmd[3] = "1";
        cmd[4] = vm.toString(message);
        bytes memory out = vm.ffi(cmd);
        (uint256 a, uint256 b, uint256 c, uint256 d, uint256 e, uint256 f) =
            abi.decode(out, (uint256, uint256, uint256, uint256, uint256, uint256));
        pk = [a, b, c, d];
        sig = [e, f];
    }

    function test_SubmitResultBLS_WithTrustlessDkgKey() public {
        bytes32 clusterId = _activateCluster(Types.ClusterPermission.Permissionless);
        bytes32 compDefId = _deployDef(50_000);
        bytes32 mxeId = _createMXE(clusterId, compDefId);

        uint256 seed = 4242;
        (uint256[4] memory pk,) = _ffiDkg(seed, bytes32(uint256(1)));
        vm.prank(admin);
        clusterManager.setBlsGroupKey(clusterId, pk);

        vm.prank(admin);
        token.mint(admin, 1_000 ether);
        vm.startPrank(admin);
        token.approve(address(coordinator), type(uint256).max);
        bytes32 computationId = coordinator.commission(mxeId, compDefId, hex"00", "", address(0), bytes4(0), 0, 0);
        vm.stopPrank();

        bytes memory encResult = hex"d00d";
        bytes32 message = keccak256(abi.encode(computationId, encResult));
        (, uint256[2] memory sig) = _ffiDkg(seed, message); // same seed → same group key

        coordinator.submitResult(computationId, encResult, sig);
        assertEq(
            uint8(coordinator.statusOf(computationId)),
            uint8(Types.ComputationStatus.Completed),
            "DKG-derived threshold signature must verify on-chain"
        );
    }

    function test_SubmitResultBLS_RejectsTamperedResult() public {
        (, bytes32 computationId) = _commission();

        bytes memory encResult = hex"cafe";
        bytes32 message = keccak256(abi.encode(computationId, encResult));
        (, uint256[2] memory sig) = _ffiSign(message);

        // Submit a different result with a signature over the original message.
        vm.expectRevert();
        coordinator.submitResult(computationId, hex"beef", sig);
    }

    function test_setBlsGroupKey_validatesG2Point() public {
        bytes32 clusterId = _activateCluster(Types.ClusterPermission.Permissionless);

        // Off-curve garbage is rejected by the pairing-based validity check.
        uint256[4] memory garbage = [uint256(1), uint256(2), uint256(3), uint256(4)];
        vm.prank(admin);
        vm.expectRevert();
        clusterManager.setBlsGroupKey(clusterId, garbage);

        // The all-zero identity is rejected too (valid point, useless key).
        uint256[4] memory zero;
        vm.prank(admin);
        vm.expectRevert();
        clusterManager.setBlsGroupKey(clusterId, zero);

        // A real group key (on-curve, correct subgroup) is accepted.
        (uint256[4] memory pk,) = _ffiSign(bytes32(uint256(1)));
        vm.prank(admin);
        clusterManager.setBlsGroupKey(clusterId, pk);
    }
}
