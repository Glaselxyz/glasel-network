# Confide Network — Smart Contracts (Phase 1)

The on-chain orchestration layer for the Confide confidential-computing network on
Base, implementing §4 of [`glasel-network-architecture.md`](../glasel-network-architecture.md).

All core contracts are deployed behind **UUPS (ERC1967) proxies** and gated by
`AccessControl`, with `UPGRADER_ROLE` held by the admin (a multisig during the
bootstrap period; a `TimelockController` thereafter).

## Contracts

| Contract | Responsibility |
|----------|----------------|
| `token/ConfideToken.sol` | `$CONFIDE` — ERC20 + EIP-2612 permit + ERC20Votes (OZ v5 `_update`) |
| `core/NodeRegistry.sol` | Node identity: BLS key, X25519 DKG key, hardware hash, jurisdiction |
| `core/StakingManager.sol` | Staking, delegation, unbonding, slashing, reputation/jail, fee accounting |
| `core/ClusterManager.sol` | Cluster proposal/activation/migration; Sybil checks; threshold-signed DKG key |
| `core/MXEFactory.sol` | MXE creation; Manticore-requires-permissioned policy; allow-lists |
| `core/ComputationRegistry.sol` | Circuit definitions (inline ≤24KB or IPFS CID) |
| `core/FeeOracle.sol` | Fee = f(gates, basefee, callback gas); per-circuit deadline |
| `core/ComputationCoordinator.sol` | Commission → submitResult → callback (+pull) → fees → slash |
| `ConfidentialBase.sol` | Abstract base apps inherit; hides all coordinator interaction |
| `apps/DarkPool.sol` | Reference app — sealed-bid order book (results sealed to participants) |
| `apps/ConfidentialVote.sol` | Reference app — private ballots, public tally |
| `apps/SealedBidAuction.sol` | Reference app — sealed bids, public winner/clearing price |
| `mocks/MockCoordinator.sol` | Test double for apps (no live MPC) |
| `mocks/StubFeeOracle.sol` | Fixed-fee oracle for standalone app tests |
| `libraries/ThresholdSig.sol` | Threshold signature verification (see note below) |
| `libraries/Types.sol` | Shared enums/structs |

## Deliberate Phase-1 design choices (vs. the spec)

These are intentional, documented deviations so the system **builds, runs and is
testable today** — each maps to a spec feature that lands in a later phase.

1. **Threshold signatures use ECDSA, not BLS aggregation.** The spec targets a
   single aggregated BLS12-381 signature verified via the EIP-2537 precompiles,
   which Base has not yet shipped. `ThresholdSig` instead verifies a *set* of
   ECDSA signatures, each recovering to a signer's registered node address. This
   is equally secure (still proves threshold-many honest attesters) but costs
   more gas. The calldata shape (`message`, `aggregatedSig`, `signers`) is
   identical to the BLS path, so a real BLS verifier drops in with no interface
   change. See the `NOTE` in `ThresholdSig.sol`.

2. **BLS G1 validation is length + non-zero only** (`NodeRegistry`). Full
   subgroup checks need EIP-2537; flagged inline.

3. **OZ v5 modernisation.** `ConfideToken` overrides `_update`/`nonces` (the spec
   showed the v4 `_afterTokenTransfer`).

4. **`ComputationRegistry` ids include a nonce** to make same-block deployments
   collision-proof (avoids silent overwrites).

5. **Governance + Timelock** are scheduled for a later hardening pass; Phase 1
   keeps the admin/multisig model the spec uses during bootstrap.

## Build & test

```bash
export PATH="$HOME/.foundry/bin:$PATH"
forge build
forge test            # 76 tests: unit + integration lifecycle + invariants + reference apps
forge fmt
```

### Deploy (Base Sepolia)

```bash
ADMIN=0x... TREASURY=0x... \
forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify
```

`run()` deploys all eight core contracts in dependency order (§12.2) behind
proxies and, when `admin == msg.sender`, wires the coordinator's role on staking.
With a multisig admin, call `StakingManager.setCoordinator` from the multisig.

## Test coverage

- **Unit** — every contract: token (mint/burn/votes/permit), registry, staking
  (stake/delegate/unbond/slash/jail/fees), cluster (propose/activate/dissolve +
  signature verification), MXE, registry/fee, `ConfidentialBase` via mock.
- **Integration** — full commission→compute→submit→callback lifecycle, pull
  fallback, below-threshold + forged-signature rejection, timed-out slashing,
  pause, allow-list enforcement; deploy-script wiring.
- **Invariant** — supply cap, staking solvency (balance always backs
  stakes + rewards), stake composition (2,048 fuzzed calls, 0 reverts).
