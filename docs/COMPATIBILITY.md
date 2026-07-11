# Compatibility Matrix

Which SDK / CLI / node version works with which deployed contracts. Check this
before upgrading — a mismatch can silently break your app (e.g. an ABI tuple that
gained a field, or a renamed function).

## Current deployment (Robinhood Chain mainnet, chainId 4663)

| Artifact | Version | Notes |
|---|---|---|
| Contracts | rebrand redeploy (2026-06) | coordinator `0x8fA215115eAf03Cfe86595c351E4AB095cCab001` |
| SDK `@glasel/client` | `>=0.2.0` | 0.2.0 adds per-job result sealing (`recipientPublicKey`) |
| CLI `glaselvm` | `0.1.0` | circuit authoring + `deploy-circuit` |
| Node `glaseld` | current `main` | single-process engine, per-job sealing |

### Live contract addresses (Robinhood Chain mainnet)

| Contract | Address |
|---|---|
| GlaselToken | `0xb71Cb43cC0809E17F520da97967F04307779133E` |
| NodeRegistry | `0x8727F63BFB99C50616bEC0142670991341F2684e` |
| StakingManager | `0x6a297BB3B54303Ae62457C70b4d3818d22Bfef51` |
| ClusterManager | `0xcfC7f9dc4C311207B0Aa6DaF7DaDc63f6DbFA79b` |
| MXEFactory | `0x0Ee8170F29D0590B08D879Baa5e4AEc27Ae7d0eD` |
| ComputationRegistry | `0x7E1eef5089C06AbEBB7Ee6d8ab76FfAb3619a44c` |
| FeeOracle | `0x30747dDcBe086Aa3194F25f7dd0060698CF1C1d9` |
| ComputationCoordinator | `0x8fA215115eAf03Cfe86595c351E4AB095cCab001` |

### Live cluster + ready-to-use MXE

A cluster and an `order_notional` MXE (computes `price * quantity` confidentially)
are already deployed, so you can run a job without deploying anything — see
`sdk/examples/quickstart.mjs`.

| Id | Value |
|---|---|
| clusterId | `0xb24c314b548c6c54785d4ad1caa710d591c1c2dfe6c42e3153b87b8936babd63` |
| mxeId | `0xd225ab0f770065fa35a9d279cc02d5397646a09d3801c803133ddec7fdfc2690` |
| compDefId | `0x2cef4b58d6963e92e8fd548d87c02ffd37472b3201c8d2bdb6a4377fed01ae64` |

The cluster is **Permissionless**, so you can also deploy your own circuit
(`glaselvm compile … && glaselvm deploy-circuit …`), create your own MXE
(`MXEFactory.createMXE`), and commission against it — no allowlist.

### 30-second quickstart

```sh
npm install @glasel/client viem
export PRIVATE_KEY=0x...   # Robinhood Chain mainnet key with ETH for gas
node quickstart.mjs        # from sdk/examples/quickstart.mjs
```

Encrypts an order, commissions it on the live network, and decrypts the
node-computed result (`price*quantity`) that only your key can read. **Right now
jobs are free — you only need Robinhood Chain ETH for gas** (bridge real ETH to
Robinhood Chain). GLASEL is the network's token: developers pay job fees in GLASEL and
operators stake it. The per-job fee is currently set to 0 for launch and will be
enabled as the network matures. See [RPC.md](RPC.md).

## Rules of thumb

- **SDK ↔ contracts**: the SDK reads contract ABIs from `sdk/src/abi.ts`. If a
  contract redeploy changes a struct returned to the SDK (e.g. `Computation`),
  bump the SDK minor version and note it here. Always use an SDK whose row matches
  the live coordinator address.
- **Per-job sealing**: the live network requires SDK `>=0.2.0`. With `0.1.0` the
  node would treat your circuit inputs as the recipient key and produce garbage.
- **CLI ↔ registry**: `glaselvm deploy-circuit` only needs the
  `ComputationRegistry` address; any 0.1.x CLI works as long as the registry ABI
  is unchanged.

## Deprecation policy

Breaking changes to a public surface (SDK exported functions, contract external
functions, CLI flags) ship in a **major** version bump and are announced in
`CHANGELOG.md` at least one minor release ahead where feasible. Testnet
deployments may reset; mainnet will not.
