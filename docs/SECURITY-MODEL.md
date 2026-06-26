# Glasel — Security Model & Maturity

This document grades every layer honestly: what is production-grade, what is
testnet-grade, and what is explicitly not done yet. We maintain it because
"knowing exactly where you are" is the bar — for users and for diligence.

Legend: 🟢 production-credible · 🟡 testnet-grade (works, not yet audited/hardened) · 🔴 not yet built.

| Layer | Grade | What's real | What's required for production |
|-------|-------|-------------|--------------------------------|
| Smart contracts | 🟡 | 8 UUPS contracts, 91 tests, internal audit (1C/3H/3M fixed + regressions), governance + timelock module, live on Base Sepolia | External audit; storage `__gap`s; make BLS the sole verification path + redeploy |
| Threshold BLS (BN254) | 🟢 | Real aggregate signatures verified on-chain via the `ecPairing` precompile; any t+1 subset reconstructs the same group signature | Standard; pairs with the DKG below |
| Result-path auth | 🟢 | **BLS is the SOLE on-chain result path.** `submitResult` now takes one aggregated BN254 signature verified against the cluster's DKG group key (snapshotted at commission); the legacy per-signer ECDSA `submitResult` was removed — one pairing check, no signer list, fees/credit to the participant set. GlaselOS submits via this path (`BlsSigner`). Verified: forge 90/90 (incl. trustless-DKG-key submit + tamper rejection) **and the anvil e2e green end-to-end through the BLS path** (TS harness signs via the Rust `bls-sign` binary → on-chain `ecPairing` → SDK decrypt) | Live redeploy to Base Sepolia (needs funded key); the live-testnet harness shares the verified BLS code path |
| Distributed Key Gen (DKG) | 🟢 | **Feldman VSS** (verifiable shares, malicious-dealer detection) **and bias-resistant Pedersen DKG** (hiding G1 commitments → no Gennaro last-bit bias). **Now runs LIVE over the mesh** (`confide_mpc::dkg::run_dkg`): nodes broadcast commitments + privately deal shares over the authenticated, encrypted `SecureTcpNet`, verify each share, and each derives its own `sk_i` + the shared group key — no node holds the whole key. Verified over both InMemoryNet and the real secure mesh. **Distributed signing too** (`dkg_threshold_sign`): each node partial-signs with its share, exchanges partials over the mesh, and Lagrange-combines — every node outputs the same group signature, verified under the DKG key, with no node holding the whole secret (test: `dkg_then_threshold_sign_over_the_mesh`) | On-chain group-key registration in the multi-node daemon flow (each node runs `run_dkg`+`dkg_threshold_sign`; single-host sim still uses a config key); complaint/QUAL disqualification round |
| MPC — addition / opening | 🟢 | BGW over Shamir shares; **robust opening with cheating detection (security-with-abort)** — honest majority (n≥2t+1) over-determines the result, so a lying share at open is detected and the protocol aborts | — |
| MPC — multiplication | 🟡→🟢 | Real BGW interactive multiplication across 3 processes (**semi-honest**) **and** a built, verified **malicious-secure** path: MP-SPDZ **MASCOT** (authenticated Beaver triples + MAC-checked opens, dishonest-majority) compiled natively (`node/scripts/setup-mpspdz.sh`) and run on the order-notional circuit → `notional = 7000` over the secure SoftSpoken OT (no `-DINSECURE`). We do NOT hand-roll this — MASCOT is the audited primitive | Wire MASCOT as GlaselOS's compute backend (IR→`.mpc` compiler + adapter) + distributed multi-node deployment |
| Input confidentiality | 🟢 | Inputs are secret-shared to the parties; no single process ever holds a plaintext input (proven by `no_party_holds_plaintext` + the 3-process test) | — |
| Encryption stack (X25519 + Rescue-Prime) | 🟡 | Standard X25519 ECDH; Rescue-Prime cipher/KDF; implemented twice (TS + Rust), proven byte-identical | Rescue constants are self-generated (not a standardized parameter set) → review / swap for a vetted AEAD |
| Node transport | 🟢 | **Encrypted mesh by default**: `SecureTcpNet` runs the entire MPC over Noise (`Noise_XX_25519_ChaChaPoly_BLAKE2s`) — every party authenticates each peer's static key against the registered roster (rejecting spoofed/unknown peers) and every wire message is AEAD-encrypted. `glaseld-party` is secure by default (plaintext only via `--insecure`). Verified by an in-process secure-mesh test **and** a real 3-OS-process run over the encrypted mesh | Add replay/DoS limits and identity-key rotation |
| Daemon orchestration | 🟢 | **Chain-driven auto-launch**: GlaselOS's `ComputationRequested` handler runs a real BGW session over the authenticated, encrypted mesh (`MpcSession` + `SecureTcpNet`). The dealer recovers + secret-shares the inputs to peers over the mesh (peers never decrypt); every node evaluates over shares, opens, and re-seals; the designated node submits. Verified by a 3-party `chain_task_runs_over_secure_mesh_and_seals` test (peers handed a zero cluster key to prove they never decrypt). Selected via the `[mpc]` config block. **Fault tolerance:** mesh setup is deadline-bounded (`SecureTcpNet::connect_timeout`) — a missing/dead peer fails the session cleanly (`TimedOut`) instead of hanging the daemon (test: `connect_times_out_when_peer_absent`) | Live DKG of the cluster key per-session (today the dealer decrypts — see below); mid-session reconnection / task re-enqueue |

## What is genuinely trust-minimized today

- **Result authenticity** — a result is accepted on-chain only if a threshold of
  the cluster signed it (BLS aggregate verified by the pairing precompile),
  bound to the participant set snapshotted at commission.
- **Trustless key generation** — the cluster key comes from a Feldman-VSS DKG
  with verifiable shares; no party (or dealer) knows the group secret.
- **Input privacy under a semi-honest minority** — inputs are secret-shared;
  no single node sees plaintext, and a lying share at *opening* is caught.
- **Economic accountability** — staking + slashing bound to commission-time
  participants.

## What is NOT yet trust-minimized (say so)

- **Malicious behaviour during multiplication** — the BGW multiplication is
  semi-honest. A malicious party could deviate mid-multiplication without
  detection. This is the single most important gap and the reason for the
  MP-SPDZ plan below. Do not rely on Glasel against actively malicious nodes
  until that lands.
- **Transport** is unauthenticated/plaintext TCP.
- **No external audit** of contracts or crypto yet.

## MP-SPDZ integration {#mp-spdz-integration}

Malicious-secure MPC is the wrong thing to hand-roll. The production path is to
back the multiplication/protocol layer with **[MP-SPDZ](https://github.com/data61/MP-SPDZ)**
(Oxford/Data61, the most complete audited open-source MPC framework) and keep
Glasel's contracts, DKG, threshold-BLS, codec and orchestration around it:

- **Boundary:** the node's compute step (`run_party*`) is the seam. MP-SPDZ runs
  as a co-process exchanging shares over the existing party transport; Glasel
  feeds it the compiled circuit and reads back authenticated output shares.
- **What we keep:** the on-chain lifecycle, threshold-BLS verification, the DKG,
  the typed codec, fee/slashing economics, and the SDK — all unchanged.
- **What changes:** authenticated triples + MAC checks replace the semi-honest
  multiplication, upgrading the model from semi-honest to malicious-with-abort.

This is the credible plan: real working protocol now, audited library for the
hardest cryptographic core, no overclaiming.
