// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BLS
/// @notice On-chain verification of threshold BLS signatures on BN254
///         (alt_bn128), using the `ecPairing` (0x08) and `modexp` (0x05)
///         precompiles that Base ships. Replaces the Phase-1 ECDSA threshold
///         stand-in: the cluster holds one group key `PK = sk·G2` (sk Shamir-
///         shared), `t + 1` nodes partial-sign, and the aggregated signature
///         `σ = sk·H(m)` is verified here with a single pairing equation
///         `e(σ, G2) == e(H(m), PK)`.
/// @dev    `hashToG1` must match the off-chain signer (glasel-bls) byte-for-byte:
///         keccak256(message) mod q, then try-and-increment, taking the smaller
///         square root. BN254's G1 has cofactor 1, so any on-curve point is in
///         the group.
library BLS {
    /// BN254 base field modulus q.
    uint256 internal constant Q =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    // G2 generator in ecPairing coordinate order [x.c1, x.c0, y.c1, y.c0].
    uint256 internal constant G2_X1 =
        11559732032986387107991004021392285783925812861821192530917403151452391805634;
    uint256 internal constant G2_X0 =
        10857046999023057135944570762232829481370756359578518086990519993285655852781;
    uint256 internal constant G2_Y1 =
        4082367875863433681332203403145435568316851327593401208105741076214120093531;
    uint256 internal constant G2_Y0 =
        8495653923123431417604973247489272438418190587263600148770280649306958101930;

    error PairingFailed();
    error ModExpFailed();

    /// @notice Verify `e(sig, G2) == e(H(message), pk)`.
    /// @param message the raw bytes that were signed
    /// @param sig     the aggregated signature σ in G1, as [x, y]
    /// @param pk      the group public key in G2, [x.c1, x.c0, y.c1, y.c0]
    function verify(bytes memory message, uint256[2] memory sig, uint256[4] memory pk)
        internal
        view
        returns (bool)
    {
        (uint256 hx, uint256 hy) = hashToG1(message);

        // Negate σ in G1 so the pairing product e(−σ, G2)·e(H, PK) == 1
        // is equivalent to e(σ, G2) == e(H, PK).
        uint256 negSy = sig[1] == 0 ? 0 : Q - (sig[1] % Q);

        uint256[12] memory input;
        // pair 1: (−σ, G2 generator)
        input[0] = sig[0];
        input[1] = negSy;
        input[2] = G2_X1;
        input[3] = G2_X0;
        input[4] = G2_Y1;
        input[5] = G2_Y0;
        // pair 2: (H(m), PK)
        input[6] = hx;
        input[7] = hy;
        input[8] = pk[0];
        input[9] = pk[1];
        input[10] = pk[2];
        input[11] = pk[3];

        uint256[1] memory out;
        bool ok;
        assembly {
            ok := staticcall(gas(), 0x08, input, 0x180, out, 0x20)
        }
        if (!ok) revert PairingFailed();
        return out[0] == 1;
    }

    /// @notice Validate that `pk` is a genuine G2 point (on-curve AND in the
    ///         correct subgroup). The ecPairing precompile validates every input
    ///         point and reverts on an invalid one, so we exploit the identity
    ///         `e(G1, PK)·e(-G1, PK) == 1` — which holds for any valid PK but
    ///         reverts for an off-curve / wrong-subgroup point. (Callers must
    ///         separately reject the all-zero identity key, which is "valid" but
    ///         useless.)
    function isValidGroupKey(uint256[4] memory pk) internal view returns (bool) {
        uint256[12] memory input;
        // pair 1: (G1 generator (1,2), PK)
        input[0] = 1;
        input[1] = 2;
        input[2] = pk[0];
        input[3] = pk[1];
        input[4] = pk[2];
        input[5] = pk[3];
        // pair 2: (-G1 generator (1, Q-2), PK)
        input[6] = 1;
        input[7] = Q - 2;
        input[8] = pk[0];
        input[9] = pk[1];
        input[10] = pk[2];
        input[11] = pk[3];

        uint256[1] memory out;
        bool ok;
        assembly {
            ok := staticcall(gas(), 0x08, input, 0x180, out, 0x20)
        }
        return ok && out[0] == 1;
    }

    /// @notice Deterministic hash-to-G1: keccak256 + try-and-increment.
    function hashToG1(bytes memory message) internal view returns (uint256 x, uint256 y) {
        x = uint256(keccak256(message)) % Q;
        while (true) {
            // rhs = x^3 + 3 (mod q)
            uint256 rhs = addmod(mulmod(mulmod(x, x, Q), x, Q), 3, Q);
            // Euler's criterion: rhs is a QR iff rhs^((q-1)/2) == 1.
            if (expmod(rhs, (Q - 1) / 2, Q) == 1) {
                // q ≡ 3 (mod 4)  ⇒  sqrt = rhs^((q+1)/4)
                y = expmod(rhs, (Q + 1) / 4, Q);
                uint256 qy = Q - y;
                if (y > qy) y = qy; // canonical: the smaller root
                return (x, y);
            }
            x = addmod(x, 1, Q);
        }
    }

    /// @dev base^exp mod m via the modexp precompile (0x05).
    function expmod(uint256 base, uint256 e, uint256 m) internal view returns (uint256 result) {
        assembly {
            let p := mload(0x40)
            mstore(p, 0x20) // length of base
            mstore(add(p, 0x20), 0x20) // length of exp
            mstore(add(p, 0x40), 0x20) // length of mod
            mstore(add(p, 0x60), base)
            mstore(add(p, 0x80), e)
            mstore(add(p, 0xa0), m)
            if iszero(staticcall(gas(), 0x05, p, 0xc0, p, 0x20)) { revert(0, 0) }
            result := mload(p)
            mstore(0x40, add(p, 0xc0))
        }
    }
}
