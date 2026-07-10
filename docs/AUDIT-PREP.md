# Glasel — External Audit Preparation

This package scopes an external security audit. An audit is a third-party
engagement — this document does not replace it; it gives auditors the system
boundaries, trust assumptions, invariants, and known limitations so they can
start efficiently.

## 1. Scope

**On-chain (Solidity, `contracts/src`)**
- `core/ComputationCoordinator` — commission → BLS-verified result submission →
  callback (push + pull) → fee settlement → timeout slashing.
- `core/ClusterManager`, `core/StakingManager`, `core/NodeRegistry`,
  `core/MXEFactory`, `core/ComputationRegistry`, `core/FeeOracle`.
- `libraries/BLS` (BN254 pairing verify), `libraries/ThresholdSig` (ECDSA, cluster
  governance only), `governance/GlaselGovernor` + timelock.
- All eight core contracts are UUPS (ERC1967) proxies.

**Off-chain crypto (Rust, `node/crates`)**
- `glasel-crypto` — X25519 ECDH, AEAD seal/open, field, cross-language vectors.
- `glasel-bls` — threshold BLS on BN254, Feldman + Pedersen DKG.
- `glasel-mpc` — Shamir + BGW (semi-honest), Noise secure transport, networked
  DKG + distributed threshold signing.
- `glasel-circuit` — arithmetic IR, evaluator, MP-SPDZ codegen.
- `glaseld` — the node daemon (chain listener, scheduler, compute backends, signer).

## 2. Trust model & assumptions

- **Honest majority for liveness; dishonest-minority threat for safety.** Cluster
  of `n` nodes, threshold `t`, `n ≥ 2t + 1`.
- **Result authenticity**: a result is accepted on-chain only under a valid
  threshold-BLS signature over `keccak256(abi.encode(computationId, encResult))`
  against the cluster's DKG group key (one `ecPairing` check). The legacy ECDSA
  path was removed.
- **Key generation**: the group key comes from a no-trusted-dealer DKG (Feldman,
  with a bias-resistant Pedersen variant available); no node holds the whole key.
- **Transport**: party-to-party MPC links are mutually authenticated + AEAD-encrypted
  (Noise XX, `SecureTcpNet`), peers verified against the registered roster.
- **Economic security**: stake-backed; missed-deadline clusters are slashed.

## 3. Key invariants (enforced by tests)

1. A computation completes **only** with a verifying threshold-BLS signature;
   a tampered result is rejected (`BadBLSSignature`). [`BlsSubmit.t.sol`, `Lifecycle.t.sol`]
2. `computationId` is unique even for identical commissions in one block (audit C-1
   nonce). [`testnet.ts`]
3. Verification/slashing bind to the **participant set snapshotted at commission**
   (audit H-1/H-2), not the live set. [`ComputationCoordinator`]
4. Fees + completion credit accrue to the snapshotted participants; 90/10 split.
   [`Lifecycle.t.sol`]
5. Robust MPC opening detects a lying party and aborts (security with abort).
   [`bgw` `checked_open_detects_a_lying_party`]
6. No single MPC process holds a plaintext input. [`no_party_holds_plaintext`, 3-proc test]
7. DKG: a malicious dealing (inconsistent share) is detected. [`glasel-bls dkg`]
8. Secure transport rejects an unregistered/spoofed peer key. [`secure` `rejects_impersonation`]
9. Cross-language crypto vectors match (TS SDK ↔ Rust). [`glasel-crypto vectors`]

## 4. Prior internal audit

A self-audit (project Phase 6b) found + fixed C-1 (id collision), H-1/H-2 (stale
participant binding), and several M-level issues, each with a regression test
(`AuditRegression.t.sol`). That report is the starting point for external review.

## 5. Known boundaries / deliberately out of audit-as-production

These are simulation boundaries in the current build, documented so they are not
mistaken for production guarantees:
- **Input decryption**: a dealer node decrypts the on-chain `encInputs` with the
  cluster key, then secret-shares / assigns inputs. In production this decryption
  is itself an MPC step (MP-SPDZ), so no node sees plaintext. (`engine.rs`,
  `MpcSession`, `MaliciousBackend` all note this.)
- **Malicious-secure compute (MASCOT)** is built + verified locally (independent
  party processes); a real multi-host deployment is operational work (see
  `docs/MPC-MALICIOUS.md`).
- **Single-host daemon simulation**: one process can model the cluster; true
  multi-node deployment runs one party/DKG-share per machine.

## 6. Live deployment

Robinhood Chain testnet (chainId 46630), BLS-only contracts — addresses in `docs/TESTNET.md`,
live suite 20/20. Deployer is a throwaway testnet key (`contracts/.env`, gitignored).

## 7. Build + test for auditors

```
# Rust (note: build the BLS FFI binaries first so forge FFI tests pass)
cd node && cargo build -p glasel-bls --bins && cargo test --workspace -- --test-threads=1
# Contracts
cd contracts && forge test
# SDK typecheck + anvil e2e
cd sdk && bun run typecheck && bun run scripts/e2e.ts
# Malicious-secure backend (optional, needs MP-SPDZ)
node/scripts/setup-mpspdz.sh
```
