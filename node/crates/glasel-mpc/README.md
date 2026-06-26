# glasel-mpc

A **real** (semi-honest, honest-majority) multi-party computation engine for
Glasel — replacing the single-process simulated engine with genuine distributed
MPC.

## What it is

- **Shamir secret sharing** over the Glasel field F_p (`shamir.rs`).
- **BGW protocol** (`bgw.rs`): linear gates (add / add-const / mul-const /
  const) are local; each multiplication runs one communication round
  (local product → fresh degree-`t` re-share → Lagrange degree reduction).
- **Transports** (`net.rs`): `InMemoryNet` (threads, for tests) and `TcpNet`
  (separate OS processes over TCP).
- Evaluates the same compiled `glasel-circuit` IR the rest of the stack uses.

Inputs are secret-shared across `n` parties; the parties compute over shares and
open only the output. **No single party ever sees a plaintext input or the
result.**

## Security model

Passive (semi-honest) security against up to `t` colluding parties, with
`n ≥ 2t + 1`. This is real distributed MPC, **not** a simulation — but it is not
yet *maliciously* secure (no cheater detection / authenticated shares). That
hardening (e.g. SPDZ-style MACs) is the next milestone.

## Try it

```bash
# in-process: 3 parties / 3 threads, several circuits
cd node && cargo test -p glasel-mpc

# real processes: 3 separate OS processes over TCP compute price*quantity
bash node/crates/glasel-mpc/demo.sh
```

The demo secret-shares `price=1000, quantity=7`, launches three `glaseld-party`
processes, verifies all three reconstruct `7000`, and checks that no party's
share file contains the plaintext inputs.

## Integration

This engine replaces `glaseld`'s simulated `engine.rs`: instead of one process
holding the DKG-combined key and decrypting, the cluster nodes hold shares and
compute over them. Client inputs become secret-shared to the cluster (rather than
encrypted to a single combined key).
