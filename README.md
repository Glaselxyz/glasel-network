# Glasel Network

A confidential-computing network on Base (Arcium-inspired), built from the
[architecture specification](glasel-network-architecture.md). Smart contracts
orchestrate; an off-chain MPC node network computes over encrypted inputs and
returns threshold-signed results; a TypeScript SDK handles client encryption.

## Status

| Phase | Component | Status | Verification |
|-------|-----------|--------|--------------|
| 1 | **Smart contracts** (`contracts/`) | ✅ | 90 Foundry tests: unit + lifecycle + invariants + apps |
| 2 | **SDK + encryption** (`sdk/`) | ✅ | cross-stack anvil e2e + live Base Sepolia suite (20/20) |
| 3 | **Node daemon `GlaselOS`** (`node/`) | ✅ | crypto interop vectors + full daemon e2e |
| 4 | **Arcis circuit IR + `glaselvm` CLI** (`node/`) | ✅ | 9 circuit tests + circuit-driven daemon e2e |
| 5 | **Reference apps** (DarkPool, vote, auction) | ✅ | tested via MockCoordinator |
| 6 | **Governance + Timelock + security audit** | ✅ | governance cycle + audit regressions; see [docs/AUDIT.md](docs/AUDIT.md) |
| 7 | **Real MPC + threshold BLS + DKG + malicious security** | ✅ | see below + [docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md) |

### Phase 7 — cryptographic maturity (all verified)

- **Threshold BLS is the sole on-chain result path** — one aggregated BN254
  signature verified by the `ecPairing` precompile. **Live on Base Sepolia**
  ([docs/TESTNET.md](docs/TESTNET.md), 20/20).
- **Real multi-party MPC** — Shamir + BGW over an **authenticated, encrypted Noise
  mesh** (`SecureTcpNet`), robust opening with cheating detection, run across
  independent processes.
- **Trustless DKG** — Feldman + bias-resistant Pedersen, run **live over the mesh**;
  distributed threshold signing combines partials without any node holding the key.
- **Malicious security** — MP-SPDZ **MASCOT** (authenticated triples + MAC-checked
  opens) built natively, our circuit IR compiles to it, and it runs as a
  daemon-selectable backend across independent party processes. See
  [docs/MPC-MALICIOUS.md](docs/MPC-MALICIOUS.md).

## What works today, end-to-end

A client encrypts a typed value to a cluster's X25519 key (SDK) → commissions a
computation on-chain (contracts) → the **real Rust GlaselOS daemon** detects the
event, decrypts the inputs, runs a circuit, re-seals the result, threshold-signs
it, and submits it on-chain → the SDK watches for completion and decrypts the
node-produced result. This is exercised by `sdk/scripts/e2e-node.ts` against a
live anvil.

The encryption stack (X25519 + Rescue-Prime cipher/KDF) is implemented twice —
TypeScript (`sdk/`) and Rust (`node/crates/glasel-crypto/`) — and proven
**byte-for-byte identical** via cross-language test vectors.

## Layout

```
contracts/   Foundry: 8 UUPS contracts + ConfidentialBase + reference apps + mocks + deploy
sdk/         @glasel/client (Bun/TS): encryption stack + viem client
node/        Rust workspace: glasel-crypto + glasel-circuit + glaselvm CLI + GlaselOS daemon
```

## Run everything

```bash
# Contracts
cd contracts && forge test

# SDK
cd sdk && bun install && bun test && bun run typecheck

# Node
cd node && cargo test

# Cross-stack e2e (needs anvil + forge + built glaseld)
cd node && cargo build -p glaseld
cd sdk  && bun run scripts/e2e.ts        # SDK ↔ chain
cd sdk  && bun run scripts/e2e-node.ts   # SDK ↔ chain ↔ GlaselOS daemon
```

## Engineering notes

The two original Phase-1 simplifications have since been **resolved**:

- ~~Threshold ECDSA stand-in for BLS~~ → **threshold BLS on BN254 is now the sole
  on-chain path**, live on Base Sepolia.
- ~~Simulated single-process MPC~~ → **real multi-party MPC** (semi-honest BGW and
  malicious-secure MASCOT) over an authenticated encrypted mesh.

The remaining boundaries are honest and documented (see
[docs/SECURITY-MODEL.md](docs/SECURITY-MODEL.md), [docs/AUDIT-PREP.md](docs/AUDIT-PREP.md)):

- **Input decryption** is still a dealer step (one node decrypts the on-chain
  `encInputs`, then shares/assigns inputs); in production that decryption is itself
  an MPC step. Transport, key generation, share-based compute, opening, signing and
  on-chain verification are all real.
- **Deployment is single-host** for the malicious-secure path: parties are
  independent processes on one machine. A true multi-machine run is operational
  (`node/scripts/mascot-multihost.sh`), not cryptographic.
- **External audit** is pending (third-party); see [docs/AUDIT-PREP.md](docs/AUDIT-PREP.md).

> Note: the contracts' forge FFI tests need the Rust BLS binaries first —
> `cd node && cargo build -p glasel-bls --bins` before `forge test`.
