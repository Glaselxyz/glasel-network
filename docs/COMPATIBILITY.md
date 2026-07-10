# Compatibility Matrix

Which SDK / CLI / node version works with which deployed contracts. Check this
before upgrading — a mismatch can silently break your app (e.g. an ABI tuple that
gained a field, or a renamed function).

## Current testnet (Robinhood Chain testnet, chainId 46630)

| Artifact | Version | Notes |
|---|---|---|
| Contracts | rebrand redeploy (2026-06) | coordinator `0x9BC3E13B967f8152F618bbe7e0c624e8111ec4dc` |
| SDK `@glasel/client` | `>=0.2.0` | 0.2.0 adds per-job result sealing (`recipientPublicKey`) |
| CLI `glaselvm` | `0.1.0` | circuit authoring + `deploy-circuit` |
| Node `glaseld` | current `main` | single-process engine, per-job sealing |

### Live contract addresses (Robinhood Chain testnet)

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

### Live cluster + ready-to-use MXE

A cluster and an `order_notional` MXE (computes `price * quantity` confidentially)
are already deployed, so you can run a job without deploying anything — see
`sdk/examples/quickstart.mjs`.

| Id | Value |
|---|---|
| clusterId | `0xc7c048a51ef57b2daded02e5c692b6f0c63903a715013f69d670ac06b489934f` |
| mxeId | `0xd225ab0f770065fa35a9d279cc02d5397646a09d3801c803133ddec7fdfc2690` |
| compDefId | `0x282ab9766b2e70d1464453af4e86f5c0194c0c07c2aa2c8e7ef0f0dc46365d7e` |

The cluster is **Permissionless**, so you can also deploy your own circuit
(`glaselvm compile … && glaselvm deploy-circuit …`), create your own MXE
(`MXEFactory.createMXE`), and commission against it — no allowlist.

### 30-second quickstart

```sh
npm install @glasel/client viem
export PRIVATE_KEY=0x...   # Robinhood Chain testnet key with ETH for gas
node quickstart.mjs        # from sdk/examples/quickstart.mjs
```

Encrypts an order, commissions it on the live network, and decrypts the
node-computed result (`price*quantity`) that only your key can read. **Right now
testnet jobs are free — you only need Robinhood Chain testnet ETH for gas** (from a public
ETH faucet). GLASEL is the network's token: developers pay job fees in GLASEL and
operators stake it. The per-job fee is currently set to 0 for launch and will be
enabled as the testnet matures (you'll get GLASEL from the faucet then). See
[RPC.md](RPC.md).

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
