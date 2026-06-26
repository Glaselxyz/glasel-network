# Glasel Network — Smart Contract Security Audit

**Scope:** `contracts/src/` — core orchestration (ComputationCoordinator), StakingManager,
ClusterManager, MXEFactory, ComputationRegistry, FeeOracle, NodeRegistry, GlaselToken,
ConfidentialBase, ThresholdSig, and the reference apps.
**Method:** independent review pass + maintainer review. All findings below were
**fixed and covered by regression tests** unless marked *Acknowledged*.
**Status after remediation:** 86/86 contract tests pass (incl. dedicated regression
tests in `test/unit/AuditRegression.t.sol`), plus the SDK↔chain and SDK↔chain↔daemon
end-to-end flows.

## Findings

| ID | Severity | Title | Status |
|----|----------|-------|--------|
| C-1 | Critical | Same-block `commission` computationId collision strands fees / overwrites jobs | ✅ Fixed |
| H-1 | High | No cluster-liveness check; jobs accepted against dissolved/forming/migrating clusters | ✅ Fixed |
| H-2 | High | Slashing/verification used the *mutable current* cluster, not commission-time participants | ✅ Fixed |
| H-3 | High | Slashing evadable via `initiateUnstake` front-run; pool could under-account | ✅ Fixed |
| M-1 | Medium | `pullResult` missing `nonReentrant` (guard inconsistency) | ✅ Fixed |
| M-2 | Medium | Unbounded cluster size → gas-DoS could brick a computation | ✅ Fixed |
| M-3 | Medium | `FeeOracle` deadline floor could be set to 0, bricking paid jobs | ✅ Fixed |
| L-1 | Low | ThresholdSig sound; add `signer != address(0)` belt-and-suspenders | ✅ Fixed |
| L-2 | Info | `ConfidentialBase` consumer footguns (default-revert callback, infinite approve) | Acknowledged |
| L-3 | Info | No `__gap` / namespaced storage reserves on upgradeable contracts | Acknowledged |
| L-4 | Info | Access control otherwise sound; `initiateNodeMigration` lever neutralised by H-2 fix | Resolved via H-2 |

---

### C-1 — computationId collision (Critical) ✅
`commission` derived the id from `(mxeId, compDefId, encInputs, msg.sender, block.timestamp,
block.prevrandao)` — all constant within a block. The same requester commissioning the same
inputs twice in one block produced an identical id, overwriting the first `Computation`
(including its `feeDeposit`, assigned not accumulated) while fees were charged twice → one
paid computation silently vanished.

**Fix:** added a monotonic `_commissionNonce` to the preimage (mirrors the existing
`ComputationRegistry` nonce). `ComputationCoordinator.sol`.
**Test:** `test_C1_noComputationIdCollision`.

### H-1 — missing cluster-liveness check (High) ✅
`commission` validated the MXE/definition but never the cluster status. `dissolveCluster`
doesn't touch the MXE, so an active MXE could point at a `Dissolved`/`Migrating` cluster.
Requesters paid for unserviceable jobs that could only time out (then slash a dead cluster).

**Fix:** `commission` now resolves the cluster and requires `status == Active`.
**Test:** `test_H1_commissionRevertsIfClusterDissolved`.

### H-2 — slashing followed the mutable cluster (High) ✅
`submitResult` and `slashTimedOut` read `cluster.nodes` live. `initiateNodeMigration`
swaps a node in place, so a timed-out job slashed whatever node *currently* sat in the
cluster — letting the real offender escape and slashing an uninvolved replacement (a
griefing lever for any cluster member).

**Fix:** the participant set + threshold are **snapshotted into the `Computation` struct at
commission** and used for both verification and slashing. `Types.Computation` gained
`participants` + `threshold`; the coordinator populates and reads them.
**Test:** `test_H2_slashHitsCommitTimeParticipants` (migrates the cluster, asserts the
original participant is slashed and the replacement is not).

### H-3 — slashing evadable via unbonding (High) ✅
`initiateUnstake` decremented `totalStake` immediately while the tokens stayed in the
contract pending `claimUnstake`. Slashing was computed on the reduced `totalStake`, so a
node could front-run a slash by unbonding nearly all self-stake and escape the penalty;
the unbonding principal remained fully reclaimable.

**Fix:** self-unbonding is tracked in `pendingSelfUnbond[node]` and included in the slash
base; `slashNodes` absorbs in order self-stake → self-unbonding → delegated, haircutting the
node owner's pending unbonding entries (`_slashUnbonding`). Conservation is preserved (the
staking-solvency invariant still holds).
**Test:** `test_H3_unbondingStakeIsSlashable` (30% slash hits the full 10k base, not the
1k left staked; the unbonding entry is haircut and `claimUnstake` pays only the reduced
amount).

### M-1 — `pullResult` reentrancy guard (Medium) ✅
`pullResult` (the documented push-callback fallback) lacked `nonReentrant` while the other
state-mutating entry points had it. CEI ordering made it safe today, but the inconsistency
was fragile across upgrades. **Fix:** added `nonReentrant`.

### M-2 — unbounded cluster size (Medium) ✅
`proposeCluster` enforced only `n >= 3`. A very large node set propagates into O(n) staking
loops and ThresholdSig's O(n²) scan, riskng a gas-DoS that could permanently brick a
computation. **Fix:** `MAX_CLUSTER_NODES = 64` cap, checked before the registration loop.
**Test:** `test_M2_clusterSizeCapped`.

### M-3 — zero deadline floor (Medium) ✅
`setDeadlineParams` allowed `minDeadlineSeconds = 0`, which would let `commission` set
`deadline == block.timestamp`, making the job instantly un-submittable. **Fix:** require a
nonzero floor. **Test:** `test_M3_deadlineFloorNonZero`.

### L-1 — zero-address signer (Low) ✅
`ThresholdSig` was sound (binds `computationId` / `(clusterId, key)`, enforces uniqueness +
membership + threshold; OZ ECDSA rejects malleable/zero recoveries). Added a defensive
`signer != address(0)` reject as belt-and-suspenders.

### Acknowledged (Informational)
- **L-2** `ConfidentialBase.onComputationComplete` reverts by default (forces pull if a
  subclass forgets to override) and grants the coordinator infinite `$CONFIDE` approval —
  documented integrator footguns, not vulnerabilities.
- **L-3** Upgradeable contracts don't reserve `__gap` storage / ERC-7201 namespaces. Hygiene
  is otherwise good (`_disableInitializers`, role-gated `_authorizeUpgrade`, correct OZ v5
  `_update`/`nonces`). Recommended before mainnet; tracked as future work.

## Out of scope / by design (documented elsewhere)
- **Threshold ECDSA instead of BLS12-381 aggregation** — Phase-1 stand-in (no EIP-2537 on
  Base yet); see `libraries/ThresholdSig.sol` and the contracts README.
- **Simulated MPC engine** — the node models the cluster as one process holding the combined
  key; see the node README. The on-chain contracts make no trust assumption beyond the
  threshold signature.
