# Operator Deploy Guide

The maintainer-side runbook: how to cut a release, deploy the web app (docs +
faucet + status), and stand up or repair the operator cluster. For a third party
running a single node, see [NODE-OPERATOR.md](NODE-OPERATOR.md); for incident
response see [RUNBOOK.md](RUNBOOK.md).

## The moving parts

| Piece | Where it lives | How it ships |
|---|---|---|
| SDK `@glasel/client` | `sdk/` | npm, on a `sdk-v*` tag (`publish-sdk.yml`) |
| CLI `glaselvm` | `node/crates/glaselvm` | crates.io + GitHub Release binaries, on a `v*` tag (`release.yml`) |
| Node `glaseld` | `node/crates/glaseld` | Docker image on GHCR, on a `v*` tag (`release.yml`) |
| Web (docs + faucet + status) | `web/` | Vercel (or any Next.js host) |
| Contracts | `contracts/` | live on Base Sepolia (see [COMPATIBILITY.md](COMPATIBILITY.md)) |
| Cluster wiring | `sdk/scripts/golive-wire.ts` | run once to form/repair the cluster |

## 1. Cut a release

Two independent tag streams, because the SDK versions separately from the
Rust workspace:

```sh
# CLI binaries (linux-x64, macos-arm64, macos-x64) + glaseld Docker image → GHCR
git tag v0.2.0 && git push origin v0.2.0

# SDK → npm  (tag version MUST equal sdk/package.json "version")
git tag sdk-v0.2.0 && git push origin sdk-v0.2.0
```

`release.yml` (`v*`) attaches the CLI tarballs to the GitHub Release and pushes
`ghcr.io/glaselxyz/glaseld:<version>` + `:latest`. `publish-sdk.yml` (`sdk-v*`)
guards the version match, builds `dist/`, and `npm publish`es.

**Required repo secret:** `NPM_TOKEN` — a npm Granular Access Token with "bypass
2FA" + write on the `@glasel` scope. (GHCR uses the built-in `GITHUB_TOKEN`; no
secret needed. crates.io publishes were done manually — see the build-state notes.)

## 2. Deploy the web app (docs + faucet + status)

The `web/` Next.js app hosts the docs, the `/faucet`, and the `/status` page.
Deploy on Vercel (free tier) pointed at the repo with **root directory `web`**.

### Environment variables (set in the host's project settings)

| Var | Used by | Required? | Notes |
|---|---|---|---|
| `FAUCET_PRIVATE_KEY` | `/api/faucet` | to enable faucet | key holding `MINTER_ROLE` on GlaselToken. **Server-only.** Without it the faucet returns 503 (page still deploys). |
| `RPC_URL` | faucet + status | recommended | dedicated Base Sepolia RPC (see [RPC.md](RPC.md)); falls back to the public node. |
| `FAUCET_AMOUNT` | `/api/faucet` | optional | GLASEL per claim, whole tokens (default 1000, capped 100k). |
| `FAUCET_MAX_CLAIMS_PER_DAY` | `/api/faucet` | optional | global daily ceiling (default 500) — bounds faucet-wallet gas spend. |
| `NEXT_PUBLIC_RPC_URL` | client reads | optional | only if you want client-side reads on a dedicated RPC. |

The faucet's per-address / per-IP rate limit is **in-process**, so on a
multi-instance serverless host it is best-effort per instance; the global daily
cap and the on-chain effect are the reliable bounds. For strict limits, back it
with a shared store (Vercel KV / Upstash) — see the note in
`web/src/app/api/faucet/route.ts`.

### Faucet wallet

The `FAUCET_PRIVATE_KEY` account must (a) hold `MINTER_ROLE` on GlaselToken and
(b) keep enough Base Sepolia ETH for gas. Grant the role from the admin/deployer:

```solidity
GlaselToken.grantRole(MINTER_ROLE, faucetAddress)
```

Top it up with ETH periodically; the status of "faucet drained" is in
[RUNBOOK.md](RUNBOOK.md).

## 3. Stand up (or repair) the operator cluster

### a. Wire the cluster on-chain (idempotent)

`golive-wire.ts` registers + stakes the node operators, forms a cluster bound to
the daemon's X25519 key, registers the BLS group key, deploys the demo circuit,
and writes the daemon config:

```sh
cd sdk && bun run scripts/golive-wire.ts
# writes:
#   contracts/golive-state.json     (cluster keypair + ids — gitignored, SECRET)
#   contracts/glaseld.golive.toml   (daemon config — gitignored, SECRET)
```

Re-running it is safe: it reuses an active cluster and only fills gaps.

### b. Run the node(s)

Per-node detail (hardware, register/stake, config, monitor) is in
[NODE-OPERATOR.md](NODE-OPERATOR.md). The fastest path with the published image:

```sh
docker run -d --name glaseld --restart unless-stopped \
  -v /etc/glaseld/glaseld.toml:/etc/glaseld/glaseld.toml:ro \
  -p 9090:9090 \
  ghcr.io/glaselxyz/glaseld:latest /etc/glaseld/glaseld.toml
```

Or native via systemd (`node/deploy/glaseld.service`), which is how the current
testnet node runs.

**Architecture note.** The live default is the single-process engine: ONE daemon
(node-1) holds the combined cluster X25519 + BLS group key and submits results;
the other registered+staked operators provide on-chain decentralisation but stay
idle (`systemctl stop && disable`) so they don't duplicate-submit. The real
3-party BGW mesh (`[mpc]`) is built, tested, and one command away — see below.

### c. Compute mode: single daemon (default) vs. BGW mesh

The daemon runs the local engine unless `glaseld.toml` has an `[mpc]` block, in
which case it joins a BGW secret-sharing session over the authenticated Noise mesh.

**Why single daemon is the live default.** With `n=3, t=1`, BGW needs all three
nodes present to compute (t is the *privacy* threshold, not fault tolerance), and
a failed session is not retried — so the mesh's availability is the *product* of
three machines and a single node outage silently drops jobs (→ on-chain timeout →
self-slashing). Since all three nodes are operated by one party today, the mesh's
privacy-vs-a-curious-peer benefit is also unrealized. So: single daemon for
reliability now; flip to the mesh once nodes are independently operated and the
daemon has re-enqueue + graceful peer-down fallback.

**Flip to the BGW mesh:**
```sh
# 1. roster + Noise keys live in gitignored contracts/mpc-mesh.json
#    (generate keys: cargo run -p glasel-mpc --example noise_keygen -- 3)
cd sdk && bun run scripts/gen-mpc-configs.ts $(cast block-number --rpc-url https://sepolia.base.org)
# 2. ship each /tmp/glaseld-node{1,2,3}.toml to its node as /root/glaseld.toml,
#    enable+start glaseld on all three (mesh port 9100 must be reachable peer-to-peer)
```
**Flip back to single daemon:** ship `contracts/glaseld.golive.toml` (no `[mpc]`)
to node-1 and `systemctl stop && disable glaseld` on node-2/node-3.

### d. Key safety

Daemon secrets in `glaseld.toml` should use `env:`/`file:` references in
production, not inline values (the daemon warns at startup if inlined). Keep an
**encrypted backup** of each node's keys. The `bls_group_secret` is the **hex**
encoding of the group secret (not decimal) — mismatches make every `submitResult`
revert; see [RUNBOOK.md](RUNBOOK.md).

## 4. Verify the deploy

1. **Status page** — open `/status`; RPC, coordinator (accepting jobs), and
   operator cluster should all be green.
2. **End-to-end** — commission a real job and confirm the live node serves it:
   ```sh
   cd sdk && bun run scripts/golive-demo.ts
   # expect: "LIVE NETWORK VERIFIED" — node computed on encrypted data
   ```
3. **Faucet** — request GLASEL to a fresh address; confirm the balance and the
   basescan tx link.
4. **Packages** — `npm install @glasel/client` and `cargo install glaselvm`
   (or the `curl | sh` installer) resolve the published versions.

## 5. Pre-mainnet gates (not required for testnet)

Verify contracts on Basescan, host the subgraph on The Graph, line up an external
audit, and open a bug bounty. See [PRODUCTION-READINESS.md](PRODUCTION-READINESS.md)
for the full rollout and [DISCLAIMER.md](DISCLAIMER.md) for the testnet caveats.
