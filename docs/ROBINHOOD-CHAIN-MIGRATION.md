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

## The plan

### Phase 0 — De-risk (½ day)
1. Add Base-style RPC + chain config for Robinhood testnet (chain 46630).
2. Deploy the contracts to Robinhood testnet: `forge script Deploy --rpc-url <rh-testnet> --broadcast` (fund the deployer from the RH faucet).
3. Run one real confidential job (`golive-wire` + `golive-demo`) → **confirm BLS `submitResult` verifies on-chain.** This proves the precompiles + the whole path.

### Phase 1 — Full testnet migration (1–2 days)
4. Repoint the **SDK**: add a `robinhoodTestnet` viem chain, swap addresses; republish `@glasel/client@0.3.0`.
5. Repoint the **node**: `glaseld.toml` `rpc_url` + `[contracts]`; fund the submitter with RH testnet ETH; restart the daemon.
6. Repoint the **web app**: chain + addresses in `site.ts`; redeploy to Vercel; `/api/status` should show the RH cluster active.
7. Verify the **quickstart** end-to-end on Robinhood testnet from a fresh wallet.
8. Update all docs (COMPATIBILITY, DEPLOY, RPC) + `verify.sh` for the **Blockscout** verifier.

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
