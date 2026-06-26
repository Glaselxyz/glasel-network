# GlaselOS — Glasel node daemon (Phase 3)

Rust workspace for the off-chain MPC network (§5 of the
[architecture](../glasel-network-architecture.md)).

## Crates

| Crate | Responsibility |
|-------|----------------|
| `glasel-crypto` | The encryption stack (F_p, Rescue-Prime cipher/KDF, X25519, encrypt/seal) — **byte-for-byte compatible with the `@glasel/client` TS SDK** |
| `glasel-circuit` | Arcis arithmetic-circuit IR, builder, optimizer (const-fold/CSE/DCE), simulator, binary format (§7) |
| `glaselvm` | Developer CLI (§8.1): `list`, `compile`, `info`, `simulate`, `deploy-circuit`, `estimate-fee` |
| `glaseld` | The node daemon: config, chain listener (alloy), scheduler, MPC engine (evaluates compiled circuits), threshold signer, result submitter |

## glaselvm CLI

```bash
glaselvm list                                            # built-in circuits
glaselvm compile order_notional --out circuit.bin        # optimize + serialize (+ .abi.json)
glaselvm info circuit.bin                                # gate/mul counts
glaselvm simulate order_notional --inputs 1000,7,0,42,43 # evaluate in the clear
glaselvm deploy-circuit circuit.bin --rpc $RPC --private-key $KEY --registry $REG
glaselvm estimate-fee --comp-def $ID --rpc $RPC --fee-oracle $FEE
```

## glaseld daemon loop

1. **Chain listener** (`chain.rs`) polls `ComputationRequested` logs from the
   ComputationCoordinator via alloy.
2. **Scheduler** (`scheduler.rs`) dedups and queues tasks.
3. **Engine** (`engine.rs`) decrypts the inputs with the cluster key, evaluates
   the circuit, and re-seals the result to the recipient.
4. **Signer** (`signer.rs`) threshold-signs `keccak256(abi.encode(computationId,
   encResult))` with EIP-191 (matching the on-chain `ThresholdSig`).
5. **Submitter** (`chain.rs`) sends `submitResult` on-chain.

## Build & test

```bash
cargo build
cargo test          # glasel-crypto interop vectors (6) — must match the TS SDK
```

The interop tests (`crates/glasel-crypto/tests/vectors.rs`) load vectors emitted
by the SDK (`sdk/scripts/gen-vectors.ts`) and assert the Rust permutation, KDF,
CTR cipher, ECDH, and **decryption of a TS-sealed payload** all reproduce them
exactly. Regenerate with `bun run scripts/gen-vectors.ts` from `sdk/`.

## Full daemon e2e

From `sdk/`: `bun run scripts/e2e-node.ts` (needs `anvil`, `forge`, and a built
`glaseld`). It deploys the protocol, sets up a cluster, commissions a computation,
then runs **this binary**, which detects the event, computes, and submits the
result — verified by the SDK decrypting the node's output back to the original
order. 4/4 assertions green.

## Design notes (Phase 3)

- **Simulated MPC** — the engine models the cluster as one process holding the
  DKG-combined X25519 key, using the real encryption stack so the end-to-end flow
  is genuine. Replacing it with true Cerberus/Manticore MPC changes only
  `engine.rs`. The engine fetches the compiled circuit from ComputationRegistry
  and evaluates it (`glasel-circuit`); the `order_notional` example computes
  `price*quantity` in-circuit during the e2e.
- **Threshold ECDSA, not BLS** — same Phase-1 stand-in the contracts use; the
  concatenated 65-byte signatures map directly onto the on-chain verifier.
- **`run_once`** config flag processes a single computation then exits (used by
  the e2e); unset it for a continuously-running operator node.

## Sample `glaseld.toml`

```toml
rpc_url = "https://sepolia.base.org"
poll_interval_ms = 500
start_block = 0
run_once = false

[contracts]
coordinator = "0x…"
cluster_manager = "0x…"

[cluster]
x25519_private_key = "0x…"   # DKG share (here: the full combined key, simulated)

[engine]
recipient_public_key = "0x…"

[signers]
keys = ["0x…", "0x…"]        # node operator ECDSA keys
```
