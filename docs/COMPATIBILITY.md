# Compatibility Matrix

Which SDK / CLI / node version works with which deployed contracts. Check this
before upgrading — a mismatch can silently break your app (e.g. an ABI tuple that
gained a field, or a renamed function).

## Current testnet (Base Sepolia, chainId 84532)

| Artifact | Version | Notes |
|---|---|---|
| Contracts | rebrand redeploy (2026-06) | coordinator `0x1FbB367715D26F752357dc7ee60b957CB40d8452` |
| SDK `@glasel/client` | `>=0.2.0` | 0.2.0 adds per-job result sealing (`recipientPublicKey`) |
| CLI `glaselvm` | `0.1.0` | circuit authoring + `deploy-circuit` |
| Node `glaseld` | current `main` | single-process engine, per-job sealing |

### Live contract addresses (Base Sepolia)

| Contract | Address |
|---|---|
| GlaselToken | `0xa9E29104Fa0287db5bb5BB048a729C93f746b09C` |
| NodeRegistry | `0xBA585F1f16b57e1443B1EA01143aa56D3fe432e0` |
| StakingManager | `0x957100d7a9B2E85958D8e1Be503977b2b1D8a01A` |
| ClusterManager | `0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523` |
| MXEFactory | `0x7CE839Eea76EA1F2F808E4c831a0910A23425f30` |
| ComputationRegistry | `0x359e6fd81BD1EAE7F4ae7a7Fdc29b1986f679F72` |
| FeeOracle | `0x0d3cCA64CaAC0b9c1CBaE9420898A33d8b3615Fc` |
| ComputationCoordinator | `0x1FbB367715D26F752357dc7ee60b957CB40d8452` |

### Live cluster + ready-to-use MXE

A cluster and an `order_notional` MXE (computes `price * quantity` confidentially)
are already deployed, so you can run a job without deploying anything — see
`sdk/examples/quickstart.mjs`.

| Id | Value |
|---|---|
| clusterId | `0xdcc20d23e53232465d569e2498bb798a6f7e3b54b5f9d16ad2b0b0d2ba1eefe2` |
| mxeId | `0xd225ab0f770065fa35a9d279cc02d5397646a09d3801c803133ddec7fdfc2690` |
| compDefId | `0x3f9bbaa3c6563b5fe2b5a39b70fd8fc7c98f855bc85650470bd5e65b54c65eb9` |

The cluster is **Permissionless**, so you can also deploy your own circuit
(`glaselvm compile … && glaselvm deploy-circuit …`), create your own MXE
(`MXEFactory.createMXE`), and commission against it — no allowlist.

### 30-second quickstart

```sh
npm install @glasel/client viem
export PRIVATE_KEY=0x...   # Base Sepolia key with GLASEL (faucet) + ETH (gas)
node quickstart.mjs        # from sdk/examples/quickstart.mjs
```

Encrypts an order, commissions it on the live network, and decrypts the
node-computed result (`price*quantity`) that only your key can read. You need
**GLASEL** (from the faucet) to pay the computation fee and **Base Sepolia ETH**
(from a public ETH faucet) for gas — see [RPC.md](RPC.md).

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
