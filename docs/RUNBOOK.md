# Incident Runbook

Boring but essential. The difference between a 5-minute outage and a 5-hour one.
Keep this short and current. Operator hosts run `glaseld` as a systemd service
(`glaseld.service`), logging to `/var/log/glaseld.log`, metrics on `:9090`.

## Quick diagnosis

```sh
# Is the daemon up?
systemctl status glaseld
# Recent activity (look for "computing"/"submitted result"/errors)
tail -n 50 /var/log/glaseld.log
# Metrics (seen/completed/failed/submit_errors)
curl -s localhost:9090/metrics | grep glaseld_
```

On-chain: confirm the cluster is still active and the submitter has gas.

## A node is down

1. `systemctl restart glaseld` (it is `Restart=always`, so this is rarely needed).
2. If it won't start, check the log for the cause:
   - `Odd number of digits` → `bls_group_secret` must be **hex**, not decimal
     (see the BLS-secret gotcha in the bring-up notes).
   - RPC errors → the configured `rpc_url` is rate-limited or down; switch RPC
     (see [RPC.md](RPC.md)).
   - `expected 32 bytes` → a malformed key in `glaseld.toml`.
3. Verify cluster membership on-chain is intact (the node is still staked + in the
   active cluster). If it was slashed out, re-stake and re-form the cluster.

## Jobs are committed but never complete

1. Confirm at least one daemon is running and polling (log shows block numbers
   advancing).
2. Check the submitter account has Base Sepolia ETH — `submitResult` (BLS pairing
   verify) is gas-heavy. Top it up from the admin/deployer.
3. Confirm the daemon's BLS group key matches the on-chain `setBlsGroupKey` value
   (a mismatch makes every `submitResult` revert). The daemon logs its group key
   at startup; compare with the registered key.
4. Check the contract circuit breaker hasn't auto-paused the coordinator after
   repeated failures; unpause via the admin once the root cause is fixed.

## The faucet drained / is failing

1. Check the faucet wallet's GLASEL balance and that it still holds `MINTER_ROLE`.
2. Re-mint to the faucet wallet (admin) or grant `MINTER_ROLE` again.
3. The faucet is rate-limited per address; abuse from one address won't drain it,
   but many addresses can — lower the per-claim amount if needed.

## The cluster is falling behind (queue backing up)

The malicious-secure (MASCOT) path runs **one job at a time per machine**. If load
is sustained:
1. Add more `glaseld` nodes (horizontal scale) and register/stake them.
2. Until then, expect higher latency — jobs queue, they do not fail.
3. Re-run the load test to re-size the cluster against real throughput.

## Key safety

- Operator keys are referenced via `env:` / `file:` in `glaseld.toml`, never
  committed. Keep an **encrypted backup** of each node's keys so a dead server is a
  restore, not a lost identity.
- Rotate any key that was ever exposed (e.g. pasted into chat or a ticket).

## Escalation

Post outages on the status page and the support channel so developers know it is
the network, not their code.
