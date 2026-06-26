// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {BLS} from "../../src/libraries/BLS.sol";

/// @notice Verifies a threshold BLS signature produced off-chain by the Rust
///         `glasel-bls` crate (node/crates/glasel-bls), proving the on-chain
///         `ecPairing` verifier and the signer agree. The fixture is generated
///         by `cargo run -p glasel-bls --bin bls-vector`.
contract BLSTest is Test {
    bytes message;
    uint256[2] sig;
    uint256[4] pk;

    function setUp() public {
        string memory json = vm.readFile("test/fixtures/bls_vector.json");
        message = vm.parseJsonBytes(json, ".message");
        sig[0] = vm.parseJsonUint(json, ".sig.x");
        sig[1] = vm.parseJsonUint(json, ".sig.y");
        uint256[] memory pkArr = vm.parseJsonUintArray(json, ".pk");
        for (uint256 i = 0; i < 4; i++) {
            pk[i] = pkArr[i];
        }
    }

    function test_VerifiesValidThresholdSignature() public view {
        assertTrue(BLS.verify(message, sig, pk), "valid threshold BLS signature must verify on-chain");
    }

    function test_RejectsWrongMessage() public view {
        // A different message hashes to a different G1 point, so the pairing
        // equation no longer holds — but all points stay valid, so the
        // precompile returns 0 (not a revert).
        assertFalse(BLS.verify(bytes("a different message"), sig, pk), "wrong message must not verify");
    }

    function test_HashToG1IsOnCurve() public view {
        (uint256 x, uint256 y) = BLS.hashToG1(message);
        // y^2 == x^3 + 3 (mod q)
        uint256 q = BLS.Q;
        uint256 lhs = mulmod(y, y, q);
        uint256 rhs = addmod(mulmod(mulmod(x, x, q), x, q), 3, q);
        assertEq(lhs, rhs, "hashToG1 must land on the curve");
    }
}
