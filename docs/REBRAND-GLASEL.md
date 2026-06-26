# Rebrand Plan: Confide → Glasel

Rename the **"Confide" brand mark** to **"Glasel"** across contracts, SDK, Rust
workspace, node daemon, subgraph, CI, and docs — then redeploy to Base Sepolia.
**Frontend (`web/`) is out of scope** (already rebranded by another instance),
but see §7 for the address-propagation coordination it depends on.

## Decisions (locked)
1. **Brand only.** Rename `Confide` → `Glasel`. **Keep** the generic word
   `Confidential` and "confidential compute" — `ConfidentialBase`,
   `ConfidentialVote`, `ConfidentialWithPriority` stay as-is.
2. **arxOS rebrands too** → `GlaselOS` / daemon `glaseld`.
3. **Rename source + redeploy** to Base Sepolia (on-chain name/symbol changes →
   new addresses everywhere).
4. **api / mcp: skipped** — no such components exist in the repo.

## Name mapping (the canonical table)

| Old | New | Notes |
|---|---|---|
| `Confide` (brand, prose) | `Glasel` | NOT `Confidential` |
| `Confide Network` | `Glasel Network` | |
| **Token** name `"Confide"` / symbol `"CONFIDE"` / `$CONFIDE` | `"Glasel"` / `"GLASEL"` / `$GLASEL` | on-chain → needs redeploy |
| `ConfideToken` | `GlaselToken` | contract + file + tests |
| `IConfideToken` | `IGlaselToken` | interface |
| `ConfideGovernor` | `GlaselGovernor` | contract + file + tests |
| **Rust crate** `confide-bls` | `glasel-bls` | dir + `Cargo.toml` + `confide_bls`→`glasel_bls` |
| `confide-circuit` | `glasel-circuit` | "" (`confide_circuit`→`glasel_circuit`) |
| `confide-crypto` | `glasel-crypto` | "" |
| `confide-mpc` | `glasel-mpc` | "" |
| `confidevm` (CLI) | `glaselvm` | crate + binary |
| `confide.toml` (manifest) | `glasel.toml` | authored-project manifest filename |
| **Daemon** crate/bin `arxos` | `glaseld` | |
| `arxos-party` | `glaseld-party` | |
| `arxOS` (brand) | `GlaselOS` | prose |
| env `ARXOS_*` (CONFIG, TX_KEY, X25519_KEY) | `GLASEL_*` | |
| metrics prefix `arxos_*` | `glasel_*` | `glasel_computations_{seen,completed,failed}`, `glasel_submit_errors` |
| `arxos.service`, user/group `arxos` | `glaseld.service`, `glasel` | |
| `/etc/arxos`, `/var/lib/arxos` | `/etc/glasel`, `/var/lib/glasel` | |
| Docker image `arxos` | `glaseld` | |
| **SDK** pkg `@confide/client` | `@glasel/client` | |
| `ConfideClient` | `GlaselClient` | class + all call sites |
| **Unbranded — DO NOT rename** | | `bls-dkg`/`bls-sign`/`bls-vector` bins; `arxos`→ done above; `ConfidentialBase`/`ConfidentialVote`; `MXE`, `arx`?? (arx is part of arxOS → `glaseld`) |

> The `glaseld` / `GlaselOS` names for the daemon are the proposed default — trivially
> swappable (e.g. `glasel-node`) by find/replacing the new token before execution.

## Out of scope / auto-handled
- **`web/`** — frontend, already rebranded. (But needs new addresses, §7.)
- **`node/vendor/MP-SPDZ/**`** — generated, gitignored build artifacts
  (`.mpc`/`.bc`/`.sch`/logs/CMake `.o`). They regenerate from test program-name
  strings; no manual edit. (We do rename those label strings in test source for
  consistency, e.g. `program: "confide_e2e"` → `"glasel_e2e"`.)
- **`Cargo.lock`, `sdk/bun.lock`** — regenerate via `cargo build` / `bun install`;
  never hand-edit.
- **`confide-network-architecture.md`** (root spec) — optional; historical design
  doc. Recommend renaming file + `ConfideClient`/brand refs for consistency, but
  it does not affect builds.

---

## Sequenced execution (each phase ends green before the next)

### Phase 1 — Contracts (`contracts/`)
Rename **Confide-brand only**; leave `Confidential*` untouched.
- Files: `src/token/ConfideToken.sol`→`GlaselToken.sol`,
  `src/governance/ConfideGovernor.sol`→`GlaselGovernor.sol`,
  `src/interfaces/IConfideToken.sol`→`IGlaselToken.sol`,
  `test/unit/ConfideToken.t.sol`→`GlaselToken.t.sol`.
- Identifiers: `ConfideToken`→`GlaselToken`, `ConfideGovernor`→`GlaselGovernor`,
  `IConfideToken`→`IGlaselToken` in those files **plus** `script/Deploy.s.sol`,
  `test/**` call sites, and any imports.
- On-chain strings: `__ERC20_init("Confide", "CONFIDE")` → `("Glasel", "GLASEL")`;
  NatSpec `$CONFIDE`/"Confide" → `$GLASEL`/"Glasel".
- Leave `ConfidentialBase`, `ConfidentialVote`, `ConfidentialWithPriority`,
  `ConfidentialBaseMock`, `ConfidentialApps.t.sol` as-is.
- **Gate:** `forge test` → 100/100.

### Phase 2 — Rust core crates (`node/crates/confide-*`, `confidevm`)
Do as one atomic change (workspace won't build mid-rename):
- Rename crate dirs: `confide-bls|circuit|crypto|mpc` → `glasel-*`, `confidevm`→`glaselvm`.
- Each `Cargo.toml`: `name = "..."`, and **path deps** referencing siblings.
- `node/Cargo.toml`: `members`/`default-members` paths.
- Import identifiers (underscore form) across **31 files**: `confide_bls`→`glasel_bls`,
  `confide_circuit`→`glasel_circuit`, `confide_crypto`→`glasel_crypto`,
  `confide_mpc`→`glasel_mpc` (use/extern/test paths, the `dsl_auction` example,
  `mascot_e2e.rs`, etc.).
- `confidevm` → `glaselvm`: binary name, `--help`/usage strings, and the manifest
  filename `confide.toml`→`glasel.toml` in `manifest.rs`, `authoring.rs`, `main.rs`
  (incl. the scaffold templates + generated README).
- **Gate:** `cargo build` (regenerates `Cargo.lock`) then `cargo test --workspace`.

### Phase 3 — Daemon arxOS → glaseld (`node/crates/arxos*`, `node/deploy/`)
- Rename crates `arxos`→`glaseld`, `arxos-party`→`glaseld-party` (dirs + `Cargo.toml`
  + workspace members + the `arxos_party` import).
- `metrics.rs`: counter prefix `arxos_*`→`glasel_*` (+ its test assertions).
- `config.rs` / `main.rs`: env vars `ARXOS_CONFIG|TX_KEY|X25519_KEY`→`GLASEL_*`
  (+ the `resolve_secret`/`has_inline_secret` tests using `ARXOS_TEST_SECRET`,
  `ARXOS_NONEXISTENT_XYZ`).
- `node/deploy/Dockerfile`: image/bin `arxos`→`glaseld`, `ENV ARXOS_CONFIG`→`GLASEL_CONFIG`,
  paths `/etc/arxos`→`/etc/glasel`.
- `node/deploy/arxos.service`→`glaseld.service`: `User/Group`, `Environment=…CONFIG`,
  `EnvironmentFile`, `ExecStart=/usr/local/bin/glaseld`, `ReadWritePaths=/var/lib/glasel`.
- `docs/NODE-OPERATOR.md`: all `arxOS`/`arxos`/env/paths/metrics references.
- **Gate:** `cargo test --workspace` (incl. `glasel_*` metrics + secret tests).

### Phase 4 — SDK (`sdk/`)
- `package.json`: `"name": "@confide/client"`→`"@glasel/client"`, description.
- `ConfideClient`→`GlaselClient` in `src/client.ts`, `src/index.ts` exports, and all
  consumers: `scripts/{e2e,e2e-node,testnet}.ts`, `examples/*`, `README.md`.
- `@confide/client` import specifiers in `examples/confidential-order.ts`,
  `scripts/e2e.ts`, `examples/README.md`.
- (Optional) rename `examples/confidential-order.ts` — "confidential-order" is the
  generic adjective; recommend **keep** under decision #1.
- `bun install` to regenerate `bun.lock`.
- **Gate:** `bun run typecheck` + `bun test` → 26/26.

### Phase 5 — Subgraph, CI, docs
- `subgraph/subgraph.yaml`: description "Confide Network"→"Glasel Network"; scan
  `schema.graphql`/`src/mapping.ts` for brand strings.
- `.github/workflows/ci.yml`: any `-p confide-*` / `-p arxos` / `-p confidevm`
  build/test flags → new crate names; SDK package refs.
- `docs/`: `TESTNET.md`, `AUDIT.md`, `AUDIT-PREP.md`, `SECURITY-MODEL.md`,
  `MPC-MALICIOUS.md`, `README.md` — brand prose (`Confide`→`Glasel`, `arxOS`→`GlaselOS`),
  leaving "confidential" the adjective.
- **Gate:** subgraph `codegen`/`build` if toolchain present; CI yaml lint.

### Phase 6 — Redeploy to Base Sepolia
- `forge script Deploy.s.sol --broadcast` with the renamed contracts → **new
  addresses + on-chain name/symbol = Glasel/GLASEL**.
- Propagate the new addresses to the hardcoded spots:
  - `docs/TESTNET.md` (address table)
  - `node/crates/glaselvm/src/authoring.rs` (the `glasel_toml` live-address block)
  - `sdk/examples/README.md` (if any literal addresses)
  - SDK **scripts** auto-read the broadcast artifact — no edit needed.
- **Gate:** `bun run scripts/testnet.ts` (live 20/20) + `loadtest.ts` sanity.

### Phase 7 — Verify + record
- Full sweep: `forge test` (100), `cargo test --workspace`, `bun test` (26),
  `cargo fmt --all --check`, clippy.
- Grep guard: `grep -rIE "Confide|CONFIDE|confide_|@confide|arxos|ARXOS_"` over
  tracked files (excl. `web/`, `vendor/`, `Confidential*`) returns **only** the
  intentionally-kept generic `Confidential*` — anything else is a miss.
- Update memory (`project-build-state.md`, addresses), `MEMORY.md`.

---

## §7 Cross-cutting risks & coordination
- **Frontend addresses (coordination):** the redeploy in Phase 6 changes contract
  addresses. `web/` is already rebranded *textually*, but its hardcoded addresses
  (`web/src/lib/site.ts`) and any `@confide/client` dep (if the web app imports the
  SDK) must be updated with the new addresses + `@glasel/client`. Hand the Phase 6
  address table to whoever owns `web/`.
- **Atomicity:** Phases 2–3 break the build mid-edit — rename dirs, manifests,
  members, and imports together, then build once.
- **Lockfiles:** regenerate `Cargo.lock`/`bun.lock`; don't hand-edit (avoids
  spurious diffs / CI drift).
- **`vendor/MP-SPDZ`:** don't touch generated files; only test-source program-name
  label strings. Confirm `vendor/` is gitignored before committing.
- **Etherscan verify:** optional (no API key today) — re-verify new addresses later.
- **Repo/dir name** `Confide-Network` → `Glasel-Network` and git remote: optional,
  separate step (affects local paths + the memory dir path); do last, deliberately.
- **No commits yet:** the repo has zero git history — recommend committing the
  pre-rename state first (a clean baseline) so the rename is one reviewable diff.

## Effort estimate
~140 files touched (contracts 46, node 61, sdk 15, docs 6, subgraph/CI 2) plus
~14 file renames and 6 crate-dir renames. Mostly mechanical find/replace gated by
the existing test suites; the only non-mechanical work is the redeploy + address
propagation (Phase 6) and the frontend handoff (§7).
