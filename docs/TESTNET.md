# Base Sepolia Testnet Deployment & Live Test Report

The full Glasel core protocol is deployed to **Base Sepolia** (chainId `84532`)
and exercised end-to-end by an on-chain test harness that drives normal and
edge-case flows from a single funded EOA. Results are accepted on-chain solely
via the **threshold-BLS path** (`submitResult(bytes32,bytes,uint256[2])` — one
aggregated BN254 signature verified by the `ecPairing` precompile); the legacy
per-signer ECDSA path has been removed. Live suite: **20/20 passing**.

## Deployed addresses (chainId 84532)

| Contract | Address |
|----------|---------|
| GlaselToken | [`0xa9E29104Fa0287db5bb5BB048a729C93f746b09C`](https://sepolia.basescan.org/address/0xa9E29104Fa0287db5bb5BB048a729C93f746b09C) |
| NodeRegistry | [`0xBA585F1f16b57e1443B1EA01143aa56D3fe432e0`](https://sepolia.basescan.org/address/0xBA585F1f16b57e1443B1EA01143aa56D3fe432e0) |
| StakingManager | [`0x957100d7a9B2E85958D8e1Be503977b2b1D8a01A`](https://sepolia.basescan.org/address/0x957100d7a9B2E85958D8e1Be503977b2b1D8a01A) |
| ClusterManager | [`0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523`](https://sepolia.basescan.org/address/0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523) |
| MXEFactory | [`0x7CE839Eea76EA1F2F808E4c831a0910A23425f30`](https://sepolia.basescan.org/address/0x7CE839Eea76EA1F2F808E4c831a0910A23425f30) |
| ComputationRegistry | [`0x359e6fd81BD1EAE7F4ae7a7Fdc29b1986f679F72`](https://sepolia.basescan.org/address/0x359e6fd81BD1EAE7F4ae7a7Fdc29b1986f679F72) |
| FeeOracle | [`0x0d3cCA64CaAC0b9c1CBaE9420898A33d8b3615Fc`](https://sepolia.basescan.org/address/0x0d3cCA64CaAC0b9c1CBaE9420898A33d8b3615Fc) |
| ComputationCoordinator | [`0x1FbB367715D26F752357dc7ee60b957CB40d8452`](https://sepolia.basescan.org/address/0x1FbB367715D26F752357dc7ee60b957CB40d8452) |

All 8 are ERC1967 (UUPS) proxies. Deployed + wired via
`forge script script/Deploy.s.sol:Deploy --rpc-url https://sepolia.base.org --broadcast`.
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
- **Public RPC consistency:** `sepolia.base.org` is load-balanced across
  replicas without read-your-writes guarantees. The harness polls verifying
  reads/simulations until consistent (`readUntil`, and `expectRevert` retries),
  rather than asserting immediately after a write.
- **Gas estimation:** OP-stack `eth_estimateGas` can be tight for rapid
  same-block txs; the harness adds a 60% buffer to every contract write.
- The deployer is a throwaway testnet key (`contracts/.env`, gitignored). Do not
  reuse it for anything holding value.
