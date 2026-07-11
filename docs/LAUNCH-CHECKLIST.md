# Launch Checklist — Soft Launch (≈10 developers)

The bar for a small, invited soft launch. Most of this is already done; the
"Must-do" list is short. For the full 100-dev path see
[PRODUCTION-READINESS.md](PRODUCTION-READINESS.md); for deploy mechanics see
[DEPLOY.md](DEPLOY.md); for incidents see [RUNBOOK.md](RUNBOOK.md).

## Already live ✅
- [x] Contracts deployed on Robinhood Chain mainnet (permissionless; 100/100 tests)
- [x] SDK published — `npm install @glasel/client`
- [x] CLI published — crates.io + GitHub Release binaries + `curl | sh`
- [x] Website + docs + status page live at **https://glasel.xyz**
- [x] Operator cluster running (node-1) with engine-fallback + retry hardening
- [x] Jobs work and are **free** (devs need only Robinhood Chain mainnet ETH for gas) — proven
      end-to-end from a fresh zero-token wallet
- [x] Quickstart tested against the live network (`sdk/examples/quickstart.mjs`)
- [x] Faucet live (optional while jobs are free)

## Must-do before inviting devs 🔴
- [ ] **Top up node-1's submitter gas.** It signs + posts every result; running dry
      stops all jobs. Send Robinhood Chain mainnet ETH to the submitter:
      `0x4E866EC90D6ECd1162D65C7e265e9B388B9f2BFf` (aim for ~0.05 ETH from a public
      faucet → ~1000+ submissions). Each `submitResult` (BLS pairing verify) costs
      ~0.00004 ETH.
- [ ] **Use a dedicated RPC.** With ~10 devs + the node all on the public
      `rpc.mainnet.chain.robinhood.com`, rate limits cause dropped reads/jobs. Get a free
      Alchemy/Infura Robinhood Chain mainnet key and set it as `rpc_url` in node-1's
      `glaseld.toml` (and `RPC_URL` on Vercel). See [RPC.md](RPC.md).

## Should-do (light for 10, but worth it) 🟡
- [ ] **Support channel** — point devs at GitHub Discussions/Issues (already set up)
      or a Telegram/email so they can report problems.
- [ ] **Watch node-1** — it's a single point of failure. For 10 devs you can eyeball
      the status page; a simple uptime ping on `:9090/metrics` (or a "did a job
      complete recently" check) is better.
- [ ] **Testnet disclaimer** visible to devs — [DISCLAIMER.md](DISCLAIMER.md).

## Skip for now (needed for 100 devs / mainnet, not a soft launch) ⚪
- [ ] Verify contracts on Blockscout (`contracts/verify.sh`) — nice trust signal
- [ ] Hosted subgraph (queryable history)
- [ ] Load test at scale + size the cluster
- [ ] More nodes / the BGW mesh (needs independent operators)
- [ ] GLASEL fees on (deferred: test ETH is scarce, so free is better on testnet;
      fees are a mainnet thing — `set-fees.ts default` when ready)
- [ ] CREATE2 deterministic addresses (so testnet == mainnet addresses)
- [ ] External audit (the real mainnet gate)

## The bottom line
For ~10 developers you need exactly two things: **fund node-1's gas** and **put a
dedicated RPC on node-1**. Everything else is already live. Then invite, watch the
status page, and top up gas as needed.
