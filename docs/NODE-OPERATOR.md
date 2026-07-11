# Running a Glasel GlaselOS Node (Robinhood Chain mainnet)

A node operator runs the **GlaselOS daemon**, which watches the
`ComputationCoordinator` for `ComputationRequested` events, computes results
(MPC), threshold-signs them, and submits on-chain.

## 1. Hardware
- 2–4 vCPU, 4–8 GB RAM, 40 GB SSD, Ubuntu 22.04/24.04.
- Stable public IP + the MPC ports open between cluster peers (see the cluster's
  port base in `[mpc]`/`[malicious]`).
- For the malicious-secure (MASCOT) backend, build MP-SPDZ once:
  `node/scripts/setup-mpspdz.sh`.

## 2. Get the binary
```bash
# Docker
docker build -f node/deploy/Dockerfile -t glaseld .
# or native
cd node && cargo build --release -p glaseld   # → target/release/glaseld
```

## 3. On-chain: register + stake (one time)
Each node needs an identity in `NodeRegistry` and ≥ `MIN_SELF_STAKE` (10,000
CONFIDE) in `StakingManager`. Use the SDK or `cast`:
```
registerNode(blsPubKey, x25519PubKey, ...)   # NodeRegistry
approve(staking, amount); stake(self, amount)  # StakingManager
```
Then a cluster owner adds you to a cluster (`proposeCluster` → `activateCluster`)
and registers the cluster's DKG group key (`setBlsGroupKey`).

## 4. Configure `glaseld.toml`
Live Robinhood Chain mainnet addresses are in [contracts/deployments/robinhood-mainnet.json](../contracts/deployments/robinhood-mainnet.json). **Never inline
secrets** — use `env:`/`file:` references:
```toml
rpc_url = "https://rpc.mainnet.chain.robinhood.com"
metrics_addr = "0.0.0.0:9090"          # Prometheus /metrics

[contracts]
coordinator = "0x8fA215115eAf03Cfe86595c351E4AB095cCab001"
computation_registry = "0x7E1eef5089C06AbEBB7Ee6d8ab76FfAb3619a44c"

[cluster]
x25519_private_key = "env:GLASELD_X25519_KEY"
bls_group_secret   = "file:/etc/glaseld/bls.key"

[signers]
keys = ["env:GLASELD_TX_KEY"]            # gas payer for submitResult

# [mpc] for the BGW mesh, or [malicious] for MP-SPDZ MASCOT — see config.rs.
```
Put secrets in `/etc/glaseld/secrets.env` (chmod 600), e.g. `GLASELD_TX_KEY=0x…`.

## 5. Run
```bash
# systemd
cp node/deploy/glaseld.service /etc/systemd/system/ && systemctl enable --now glaseld
journalctl -u glaseld -f
# or docker
docker run -v /etc/glaseld:/etc/glaseld --env-file /etc/glaseld/secrets.env -p 9090:9090 glaseld
```

## 6. Monitor
- **Metrics**: `curl http://<node>:9090/metrics` → `glaseld_computations_{seen,completed,failed}`,
  `glaseld_submit_errors`. Scrape with Prometheus, dashboard in Grafana.
- **Protocol-wide**: the subgraph in [`subgraph/`](../subgraph) indexes the
  computation lifecycle (requested/completed/failed/challenged/finalized).

## 7. Economics + safety
- Fees (90% of each computation, split across the cluster) accrue to your stake
  after the **challenge window** elapses (`finalizeComputation`).
- Slashing: missed deadline (5%), incorrect result (30%, via `challengeResult`).
  Keep your node online and correct.
