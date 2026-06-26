# Malicious-secure MPC via MP-SPDZ (MASCOT)

Glasel's in-house `glasel-mpc` engine is **semi-honest** BGW: correct and
genuinely multi-party, but it assumes parties follow the protocol. Production
needs **malicious security** (a cheating party is caught, not trusted). We do
**not** hand-roll that — the right primitive is [MP-SPDZ](https://github.com/data61/MP-SPDZ)'s
**MASCOT** protocol (Keller–Orsini–Scholl, CCS'16): authenticated Beaver triples
+ MAC-checked openings give malicious security against a **dishonest majority**
over a prime field — exactly Glasel's threat model.

## What is built + verified ✅

- **MASCOT compiled natively** (macOS arm64 / Apple clang 21; Linux apt path too) —
  reproducibly via [`node/scripts/setup-mpspdz.sh`](../node/scripts/setup-mpspdz.sh).
- **Secure OT**: uses **SoftSpoken** OT (libOTe), *not* the `-DINSECURE` KOS path
  (MP-SPDZ gates KOS behind `-DINSECURE` because KOS15's proof has a known gap,
  [eprint 2022/192](https://eprint.iacr.org/2022/192)).
- **Verified run**: the Glasel order-notional circuit (`price * quantity`) compiles
  to MASCOT bytecode (1 authenticated triple, 1 MAC-checked open) and a 2-party
  malicious-secure session outputs `notional = 7000` from party-0 price `1000` and
  party-1 quantity `7`. Statistical security parameter 40.

### Bring-up gotchas (encoded in the setup script)
1. Apple clang 21 errors on Homebrew `gmpxx.h`'s deprecated literal operators under
   MP-SPDZ's `-Werror` → drop `-Werror` (3rd-party-header warnings shouldn't fail us).
2. Boost 1.90's Asio broke libOTe's bundled `cryptoTools` → pin **Boost 1.85** for
   the SoftSpoken OT build.
3. Shallow clone skips submodules; `simde`'s nested `munit` *test* submodule fails to
   fetch but isn't needed → init top-level deps only.

## Integration — built + verified ✅

1. **IR → `.mpc` compiler** — `confide_circuit::mpspdz::compile_to_mpspdz` emits an
   MP-SPDZ program from our `Circuit` IR (inputs → `get_input_from`, gates → `sint`
   ops, outputs → MAC-checked `reveal`). Unit-tested; and `run_mascot` compiles it
   with `-P` our field prime (2²⁵⁵−19) and runs MASCOT. The gated e2e test
   (`tests/mascot_e2e.rs`) confirms the malicious-secure output **matches the
   in-process `evaluate`** on multiple circuits (`7000`, `44`).
2. **`MaliciousBackend` adapter** — `glaseld/src/malicious.rs`: decrypt inputs →
   evaluate under MASCOT → re-seal, returning the same `encResult` shape as the
   other backends. Wired into the daemon handler (precedence: malicious → BGW →
   engine), selected by the `[malicious]` config block (`mpspdz_dir`, `parties`).
   Gated test runs the full decrypt→MASCOT→seal path → `7000`.

3. **Distributed execution** — each party now runs as its **own independent
   process** connected over the network, not co-launched on one host:
   `confide_circuit::mpspdz::run_mascot_party` (the per-node primitive,
   `mascot-party.x <id> <prog> -N <n> -h <party0> -pn <port>`) and
   `run_mascot_distributed` (launches the N independent processes). The GlaselOS
   `MaliciousBackend` uses the distributed path, with `host`/`port` in `[malicious]`
   config. Verified by `distributed_mascot_independent_party_processes` (2 separate
   processes over the network → `7000`).

4. **Multi-host deploy harness** — `node/scripts/mascot-multihost.sh`: `prepare`
   (compile over the field prime + generate certs + pack a bundle) and `run`
   (launch this node's single party at `mascot-party.x <id> <prog> -N <n> -h
   <party0> -pn <port>`). Locally verified by `test-mascot-multihost.sh` (two
   independent parties on 127.0.0.1 → `out 7000`); the only step not exercisable
   here is the cross-machine `scp` of the bundle.

5. **Real cross-machine run ✅** — verified on **3 separate DigitalOcean droplets**
   (nyc3): MP-SPDZ built on each, bytecode + TLS certs distributed, one
   `mascot-party.x` per host connected peer-to-peer over **public IPs** (via an
   `-ip` hosts file), computing `price × quantity = out 7000` — `Global data sent
   = 0.63 MB in ~89 rounds (all parties)`, i.e. genuine cross-machine traffic, not
   localhost. (Linux build gotchas vs. macOS: needs `libboost-all-dev` for
   `-lboost_iostreams`, and `git submodule update --init --recursive deps/libOTe`
   for cryptoTools.)

## What remains (honest)

6. **Secure offline phase + decentralized input provision**: MASCOT's preprocessing
   currently runs online; production wants a dedicated offline phase. And the
   dealer-decrypts-then-assigns-inputs step is the same MP-SPDZ-decryption boundary
   noted for `MpcSession`.
7. **External audit** of the integration (the MASCOT protocol itself is already a
   well-studied, audited construction).
