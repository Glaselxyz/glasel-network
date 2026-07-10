# Robinhood Chain Testnet Deployment & Live Test Report

The full Glasel core protocol is deployed to **Robinhood Chain testnet** (chainId `46630`)
and exercised end-to-end by an on-chain test harness that drives normal and
edge-case flows from a single funded EOA. Results are accepted on-chain solely
via the **threshold-BLS path** (`submitResult(bytes32,bytes,uint256[2])` — one
aggregated BN254 signature verified by the `ecPairing` precompile); the legacy
per-signer ECDSA path has been removed. Live suite: **20/20 passing**.

## Deployed addresses (chainId 46630)

| Contract | Address |
|----------|---------|
| GlaselToken | [`0x045DFA9915322E4D007B0bd1958e214f3159767d`](https://explorer.testnet.chain.robinhood.com/address/0x045DFA9915322E4D007B0bd1958e214f3159767d) |
| NodeRegistry | [`0x4AB5A0B3b6fa16132e14964c236C0e798CD5adea`](https://explorer.testnet.chain.robinhood.com/address/0x4AB5A0B3b6fa16132e14964c236C0e798CD5adea) |
| StakingManager | [`0xCAb5286f5Ce94136c2aE7327abFa821DD56622D7`](https://explorer.testnet.chain.robinhood.com/address/0xCAb5286f5Ce94136c2aE7327abFa821DD56622D7) |
| ClusterManager | [`0xFd874609e9913292b3A701C162c29D0595affDAe`](https://explorer.testnet.chain.robinhood.com/address/0xFd874609e9913292b3A701C162c29D0595affDAe) |
| MXEFactory | [`0x1187f7D55Ea30E5738e84a14E07b288dA9A07DF2`](https://explorer.testnet.chain.robinhood.com/address/0x1187f7D55Ea30E5738e84a14E07b288dA9A07DF2) |
| ComputationRegistry | [`0x7aFdCBd7917B6b0290eD97CaA1dEC045494662A1`](https://explorer.testnet.chain.robinhood.com/address/0x7aFdCBd7917B6b0290eD97CaA1dEC045494662A1) |
| FeeOracle | [`0xA17B0De7C45b4B3B139ff18FBDEA18E0d12bA2a3`](https://explorer.testnet.chain.robinhood.com/address/0xA17B0De7C45b4B3B139ff18FBDEA18E0d12bA2a3) |
| ComputationCoordinator | [`0x9BC3E13B967f8152F618bbe7e0c624e8111ec4dc`](https://explorer.testnet.chain.robinhood.com/address/0x9BC3E13B967f8152F618bbe7e0c624e8111ec4dc) |

All 8 are ERC1967 (UUPS) proxies. Deployed + wired via
`forge script script/Deploy.s.sol:Deploy --rpc-url https://rpc.testnet.chain.robinhood.com --broadcast`.
Total gas for deploy + full test suite: **~0.0017 ETH** at ~0.006 gwei.

## How to reproduce

```bash
# 1. Deploy (deployer key in contracts/.env: PRIVATE_KEY / RPC_URL)
cd contracts && forge script script/Deploy.s.sol:Deploy \
  --rpc-url "$RPC_URL" --broadcast --private-key "$PRIVATE_KEY" --slow

# 2. Run the live test suite (reads addresses from broadcast artifact)
cd ../sdk && bun run scripts/testnet.ts
```

The harness ([sdk/scripts/testnet.ts](../sdk/scripts/testnet.ts)) bootstraps off
ONE funded EOA: it derives three deterministic node sub-accounts, tops them up
with gas, mints stake tokens, and drives the whole protocol. It is idempotent —
re-runs skip already-registered/staked nodes and create a fresh cluster.

> Latest deploy carries the C-phase hardening: optimistic **challenge window**
> (disputable/slashable wrong results), **rate limiting**, **circuit breaker**,
> on-chain **BLS group-key validation**, and a governance **proposal fee**.

## Results — 20/20 passed

### Normal lifecycle
- ✓ 3 nodes registered + staked (≥ min stake)
- ✓ cluster proposed + activated (threshold-signed activation)
- ✓ computation definition + MXE created
- ✓ computation commissioned + **threshold-BLS** result submitted (one aggregated BN254 sig verified on-chain via `ecPairing`)
- ✓ SDK reads the cluster X25519 public key back, matches
- ✓ SDK `watchComputation` → Completed
- ✓ on-chain `encResult` == client-sealed bytes
- ✓ SDK decrypts the result == original trade (`price=1000, quantity=7, side=buy`)

### Edge cases — invariants & guards (revert-name verified)
- ✓ **C-1** identical commissions get distinct `computationId`s (collision fix)
- ✓ tampered result (valid BLS sig over a *different* result) → `BadBLSSignature`
- ✓ unknown computation definition → `UnknownDefinition`
- ✓ unauthorized mint (no `MINTER_ROLE`) → `AccessControlUnauthorizedAccount`
- ✓ **M-3** zero deadline floor → `deadline floor=0`
- ✓ paused coordinator rejects commission → `EnforcedPause`

### Edge cases — slashing & dissolved cluster (state-mutating)
- ✓ **H-2** `slashTimedOut` on an expired computation → status `Failed`
- ✓ assigned node penalized by the slash (stake `19500 → 18525`, a 5% haircut)
- ✓ **H-1** commission against a dissolved cluster → `ClusterNotActive`

## Notes
- **Public RPC consistency:** `rpc.testnet.chain.robinhood.com` is load-balanced across
  replicas without read-your-writes guarantees. The harness polls verifying
  reads/simulations until consistent (`readUntil`, and `expectRevert` retries),
  rather than asserting immediately after a write.
- **Gas estimation:** OP-stack `eth_estimateGas` can be tight for rapid
  same-block txs; the harness adds a 60% buffer to every contract write.
- The deployer is a throwaway testnet key (`contracts/.env`, gitignored). Do not
  reuse it for anything holding value.
