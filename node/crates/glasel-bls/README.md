# glasel-bls

**Real threshold BLS signatures on BN254 (alt_bn128), verifiable on-chain** —
replacing the Phase-1 ECDSA threshold stand-in.

Base doesn't ship the EIP-2537 (BLS12-381) precompiles the spec originally
assumed, so Glasel uses **BN254**, whose pairing (`ecPairing`, 0x08) and
`modexp` (0x05) precompiles *are* available on Base.

## Scheme

- A group secret key `sk ∈ F_r` is Shamir-shared across the cluster (degree `t`).
- The group public key `PK = sk·G2` is published on-chain.
- Each signer `i` produces a partial `σ_i = sk_i · H(m)` over G1.
- Any `t + 1` partials Lagrange-combine to `σ = sk · H(m)`.
- Verification is one pairing equation: **`e(σ, G2) == e(H(m), PK)`**.

`H(m)` (hash-to-G1) is keccak256 + try-and-increment, implemented identically in
Rust (`src/bls.rs`) and Solidity (`contracts/src/libraries/BLS.sol`). BN254's G1
has cofactor 1, so any on-curve point is in the group.

## Verify it

```bash
# Rust crypto: threshold sign + verify, hash-to-G1 determinism
cd node && cargo test -p glasel-bls

# Cross-language: generate a vector and verify it ON-CHAIN via ecPairing
cargo run -p glasel-bls --bin bls-vector ../contracts/test/fixtures/bls_vector.json
cd ../contracts && forge test --match-contract BLSTest
```

The Foundry test consumes the Rust-produced `(message, σ, PK)` and verifies it
through the `ecPairing` precompile (~138k gas). That it passes proves the signer
and the on-chain verifier agree — same generator, same hash-to-curve.

## Security note

This is real threshold BLS, but the simple group-key model assumes an honest
DKG. Production needs a real distributed key generation (no trusted dealer) and
proof-of-possession on member keys. The dealer here stands in for the DKG.

## Integration (next)

Wire into the protocol: store each cluster's BN254 group key at
`activateCluster`, and swap `ThresholdSig.verify` (ECDSA set) for `BLS.verify`
in `ComputationCoordinator.submitResult`. Same calldata shape, far less gas at
scale (one pairing vs N signature recoveries).
