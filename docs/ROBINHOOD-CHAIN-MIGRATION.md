# Migration Plan: Base → Robinhood Chain

## What Robinhood Chain is (research summary, July 2026)

- A **permissionless, fully EVM-compatible Layer 2** built on **Arbitrum** (Nitro),
  using Ethereum blobs for data availability. Mainnet launched **July 1, 2026**.
- **ETH is the native gas token** (same as Base) — ~100ms blocks.
- **Any developer can deploy standard Solidity contracts** with Foundry/Hardhat.
- Focused on **tokenized real-world assets** (stock tokens, 24/7 trading), with a
  DeFi ecosystem (Uniswap, 1inch, Lighter, Arcus) live from day one.

### Network parameters
| | Testnet | Mainnet |
|---|---|---|
| Chain ID | `46630` | `4663` |
| Public RPC | `https://rpc.testnet.chain.robinhood.com` | `https://rpc.mainnet.chain.robinhood.com` |
| Alchemy RPC | `https://robinhood-testnet.g.alchemy.com/v2/<key>` | `https://robinhood-mainnet.g.alchemy.com/v2/<key>` |
| Explorer | `explorer.testnet.chain.robinhood.com` | `robinhoodchain.blockscout.com` (Blockscout) |
| Faucet | `faucet.testnet.chain.robinhood.com` | — |
| Gas | ETH | ETH |
| Docs | https://docs.robinhood.com/chain/ | |

## Why this is a *config migration*, not a rewrite

Our whole stack is EVM + ETH-gas already, so almost nothing structural changes:

| Layer | Change needed |
|---|---|
| Contracts (Solidity, UUPS) | **Redeploy** the same code via Foundry to chain 46630, then 4663. New addresses (unless CREATE2 — see below). |
| SDK (`@glasel/client`, viem) | Define a **custom viem chain** for Robinhood; repoint addresses. Republish (0.3.0). |
| Node (`glaseld`, alloy) | **Config only** — set `rpc_url` + `[contracts]` to the new chain/addresses; fund the submitter with Robinhood ETH. |
| Web (`web/`, viem) | Swap the chain + addresses in `site.ts`; redeploy. |
| Off-chain infra (droplets) | Unchanged — just repoint `rpc_url`. |

Gas token is ETH on both chains, so **no fee-logic change** is required.

## The one real technical risk — verify it FIRST

Our result verification (`BLS.sol`) uses the **`ecPairing` (0x08)**, `ecAdd` (0x06),
`ecMul` (0x07) and **`modexp` (0x05)** precompiles. Arbitrum Nitro is EVM-equivalent
and supports these, so it *should* work — but this is the one thing that would break
the whole protocol if it didn't. **De-risk on day one** by deploying to Robinhood
testnet and running a real BLS `submitResult` (our existing `testnet.ts` / a live
`golive-demo` job does exactly this). If a job completes + verifies on-chain, the
precompiles are good and the rest is mechanical.

Secondary (minor) items to sanity-check on testnet:
- `block.basefee` semantics differ on Arbitrum (affects `FeeOracle.callbackFee`) —
  irrelevant while fees are 0/GLASEL, but confirm `estimateFee` behaves.
- Gas metering differs (L1 data + L2 exec) — our +60% estimate buffer already covers it.
- Contract size — Arbitrum's limit is higher than L1's 24 KB, so the coordinator
  (which needed `via_ir` on Base) is fine.

## Strategic fit (worth noting)

A confidential-compute layer is a **strong fit** for a tokenized-finance chain:
private trades, dark pools, sealed-bid auctions, and confidential order matching on
tokenized equities are exactly our reference apps (`DarkPool`, `SealedBidAuction`,
`ConfidentialVote`). "Private computation for 24/7 tokenized markets" is a sharper
pitch on Robinhood Chain than on a general-purpose L2.

## What's already wired (done in-repo)

The code is now chain-agnostic and switches by a single env var — no source edits
needed to target Robinhood:

- **Chain definitions** — `sdk/scripts/chain.ts` and `web/src/lib/chain.ts` define
  `robinhoodTestnet` (46630) and `robinhoodMainnet` (4663) viem chains alongside Base.
- **SDK scripts** — `golive-wire`, `golive-demo`, `set-fees`, `grant-minter`,
  `loadtest`, `testnet` read `CHAIN=base-sepolia|robinhood-testnet|robinhood-mainnet`
  (default `base-sepolia`). The Foundry broadcast path and the persisted state/toml
  files are now keyed by chain id, so a Robinhood deploy never clobbers the live Base
  state (`golive-state.46630.json`, `glaseld.golive.46630.toml`).
- **Web app** — `site.ts` derives chain name / id / explorer / RPC / marketing copy /
  gas-faucet hint from the active chain (`NEXT_PUBLIC_CHAIN`). Robinhood addresses are
  read from `NEXT_PUBLIC_*` env (set them on Vercel after the deploy).
- **Node (`glaseld`)** — already chain-agnostic (reads the chain id from `rpc_url`);
  `golive-wire` writes a ready-to-use `glaseld.golive.46630.toml`.
- **One-command runbook** — `scripts/deploy-robinhood.sh testnet` runs the whole
  Phase 0/1 deploy with preflight safety checks (see below).

What still needs **you** (funds/keys, not code): a Robinhood-funded deployer, and —
after the deploy — setting the new `NEXT_PUBLIC_*` addresses on Vercel and funding the
node submitter with Robinhood ETH.

## ✅ Phase 0 — DONE (proven on Robinhood testnet, chain 46630)

Deployed the full core protocol to Robinhood testnet and ran the self-contained
`testnet.ts` harness: **20/20 checks passed, 0 failed.** The decisive ones:

- **`submitResult` with on-chain BLS pairing verification succeeded** — this exercises
  the `ecPairing` (0x08) + `modexp` (0x05) precompiles. **They work on Robinhood.**
- The **tampered-result** case was correctly rejected (`BadBLSSignature`) — the pairing
  check is not just present but sound.
- Full lifecycle also passed: node register + stake, cluster propose/activate,
  `setBlsGroupKey`, MXE + computation definition, commission, SDK decrypt of the sealed
  result, plus slashing, pause/unpause and every access-control guard.

**The one real migration risk is cleared.** Everything downstream is mechanical.

Deployed addresses (Robinhood testnet 46630), from
`contracts/broadcast/Deploy.s.sol/46630/run-latest.json`:

| Contract | Address |
|---|---|
| GlaselToken | `0x045DFA9915322E4D007B0bd1958e214f3159767d` |
| NodeRegistry | `0x4AB5A0B3b6fa16132e14964c236C0e798CD5adea` |
| StakingManager | `0xCAb5286f5Ce94136c2aE7327abFa821DD56622D7` |
| ClusterManager | `0xFd874609e9913292b3A701C162c29D0595affDAe` |
| MXEFactory | `0x1187f7D55Ea30E5738e84a14E07b288dA9A07DF2` |
| ComputationRegistry | `0x7aFdCBd7917B6b0290eD97CaA1dEC045494662A1` |
| FeeOracle | `0xA17B0De7C45b4B3B139ff18FBDEA18E0d12bA2a3` |
| ComputationCoordinator | `0x9BC3E13B967f8152F618bbe7e0c624e8111ec4dc` |

Notes from the run:
- Deploy cost ~0.0005 ETH at 0.02 gwei — L2 gas is negligible; 0.01 ETH funded the whole run.
- `forge` prints an **EIP-3855 (PUSH0) "unsupported chain" warning** for 46630. It's a
  false positive from forge's RPC capability probe — the contracts are compiled for
  `cancun` (which uses PUSH0) and **all 20 checks executed successfully**, so PUSH0 works
  in practice on testnet. Worth explicitly re-confirming before mainnet (chain 4663).

## ✅ Phase 1 — real network verified end-to-end (Robinhood testnet 46630)

- `golive-wire` wired a **live operator cluster**: 3 nodes registered + staked, cluster
  `0xc7c048a51ef57b2daded02e5c692b6f0c63903a715013f69d670ac06b489934f` **active**,
  BLS group key set, `order_notional` circuit compiled + deployed
  (compDef `0x282ab976…`), MXE `0xdb7de481…` created. Emitted
  `contracts/glaseld.golive.46630.toml` (rpc + contracts + submitter key).
- **`glaseld` ran against that config and processed a real job**: commissioned
  `0xe29a4ced…`, the daemon computed on the ciphertext and submitted a BLS-signed
  result in **~7 s** (tx `0xc17b1415…`); the developer decrypted **38178 = 4242 × 9**.
  Full confidential path proven on Robinhood: encrypt → node computes blind →
  BLS-verified result on-chain → only the developer reads it.
- **Web verified locally** against RH (`NEXT_PUBLIC_CHAIN=robinhood-testnet` + the 46630
  addresses): `/api/status` → `rpcReachable: true`, `coordinatorAcceptingJobs: true`,
  `clusterActive: true` (reading the RH cluster). Not yet flipped on the public Vercel
  site — that's the cutover decision below.

### ✅ Public cutover — DONE (2026-07-11)
1. **Daemon on the droplet** — node-1 (`159.203.160.51`) repointed to
   `glaseld.golive.46630.toml` (Base config backed up to `/root/glaseld.base-sepolia.toml`);
   `RUST_LOG=info` drop-in added. It processed a fresh job on RH in ~7 s while the local
   daemon was stopped (tx confirmed via `glaseld_computations_seen`). The Base node is
   thereby retired.
2. **Public site flipped** — `NEXT_PUBLIC_CHAIN=robinhood-testnet` + all `NEXT_PUBLIC_*`
   addresses set on Vercel; production redeployed to **glasel.xyz**. Live checks:
   homepage 49 "Robinhood" / 0 "Base", `/docs/network` shows chainId 46630, `/api/status`
   reads the live RH cluster (`clusterActive: true`). All Base→Robinhood copy updated.
3. **Testnet jobs set FREE on RH** (`set-fees.ts free`, estimateFee → 0) so devs need only
   Robinhood ETH for gas — matching Base's posture. GLASEL fees remain a mainnet thing.

**Robinhood testnet is now the live public network.** Follow-ups (not blockers):
- **Dedicated RPC** — status page block number can look stale on the public RH RPC; add an
  Alchemy RH key as `RPC_URL`/`NEXT_PUBLIC_RPC_URL` (same as the Base launch checklist).
- **Faucet on RH** — only needed if fees are later turned on; the faucet wallet would then
  need `MINTER_ROLE` on the RH token + RH gas. Optional while jobs are free.
- **Pre-existing doc staleness** (unrelated to the chain): architecture/security still
  describe threshold-ECDSA though the protocol now uses BN254 BLS; `@confide/*` package
  names in docs vs the published `@glasel/client`.

## The plan

### Phase 0 — De-risk (½ day) — ✅ complete (see result above)
1. Fund a throwaway deployer from the Robinhood testnet faucet
   (https://faucet.testnet.chain.robinhood.com); put its key in `contracts/.env` and
   set `RPC_URL=https://rpc.testnet.chain.robinhood.com`.
2. Run the one-command deploy:
   ```
   scripts/deploy-robinhood.sh testnet
   ```
   It preflights the chain id + deployer balance, deploys the 8 proxies, wires the
   cluster + demo circuit + MXE (`CHAIN=robinhood-testnet golive-wire`), then runs one
   real confidential job (`golive-demo`).
3. If that job's result **verifies on-chain**, the BLS precompiles (ecPairing 0x08 /
   modexp 0x05) work and the single real risk is cleared. New addresses land in
   `contracts/broadcast/Deploy.s.sol/46630/run-latest.json`.

### Phase 1 — Full testnet migration (1–2 days)
4. **SDK** — republish `@glasel/client@0.3.0` if the addresses are baked into examples;
   the chain is already defined. (Scripts already switch via `CHAIN=`.)
5. **Node** — copy `glaseld.golive.46630.toml` to node-1, fund the submitter with RH
   testnet ETH, restart the daemon. (`rpc_url` is already correct in that file.)
6. **Web** — on Vercel set `NEXT_PUBLIC_CHAIN=robinhood-testnet` and the
   `NEXT_PUBLIC_COORDINATOR/TOKEN/STAKING/CLUSTER_MANAGER/REGISTRY/MXE_FACTORY/`
   `COMP_REGISTRY/FEE_ORACLE/CLUSTER_ID` addresses from the deploy; redeploy. `/api/status`
   should then show the RH cluster active.
7. Verify the **quickstart** end-to-end on Robinhood testnet from a fresh wallet.
8. Update the doc code-samples (`web/src/app/page.tsx` hero, `docs/quickstart`) + docs
   (COMPATIBILITY, DEPLOY, RPC) + `verify.sh` for the **Blockscout** verifier.

### Phase 2 — Operational parity (½ day)
9. Faucet, submitter gas, status page, monitoring — same as today, pointed at RH testnet.
10. Soft-launch to the ~10 devs on Robinhood testnet (per `LAUNCH-CHECKLIST.md`).

### Phase 3 — Mainnet (chain 4663) — when ready
11. **CREATE2 deterministic deployment** so testnet == mainnet addresses (needed for listings; see the addresses discussion). Convert `Deploy.s.sol` to CREATE2 with fixed salts.
12. Deploy to Robinhood mainnet (chain 4663); verify on Blockscout.
13. Turn on real GLASEL fees; complete the mainnet gates (external audit, trustless-confidentiality work, node redundancy).

## Base: keep or drop?

The contracts are chain-agnostic — you could run **both** Base and Robinhood
(multi-chain) or fully move. For a single focused launch, migrate to Robinhood
testnet and retire the Base deployment once the RH one is verified.

## Sources
- https://docs.robinhood.com/chain/
- https://docs.robinhood.com/chain/connecting/
- https://docs.robinhood.com/chain/deploy-smart-contracts/
- https://cryptobriefing.com/robinhood-chain-launches-real-world-assets-layer-2/
- https://blog.thirdweb.com/robinhood-chain-inside-the-ethereum-l2-bringing-tokenized-stocks-to-120-countries/
