#!/usr/bin/env bash
#
# Deploy the Glasel core protocol to Robinhood Chain and prove it works end to end.
# This is Phase 0 (de-risk) + Phase 1 (wire) of docs/ROBINHOOD-CHAIN-MIGRATION.md.
#
#   scripts/deploy-robinhood.sh testnet     # chain 46630 (default)
#   scripts/deploy-robinhood.sh mainnet     # chain 4663
#
# Prereqs (YOU must do these first — they need funds/keys, not code):
#   1. Fund a throwaway deployer with Robinhood ETH:
#        testnet → https://faucet.testnet.chain.robinhood.com
#   2. In contracts/.env set PRIVATE_KEY / DEPLOYER_ADDRESS to that deployer and
#      point RPC_URL at the Robinhood RPC (this script also accepts RPC_URL inline).
#
# What it does (all reversible / read-heavy until the deploy tx):
#   • preflight: confirms the RPC's chain id matches the target + deployer is funded
#   • forge script Deploy --broadcast        → 8 UUPS proxies on Robinhood
#   • CHAIN=robinhood-* golive-wire.ts        → register+stake node, activate cluster,
#                                               compile+deploy the demo circuit, createMXE
#   • CHAIN=robinhood-* golive-demo.ts        → ONE real confidential job. If its result
#                                               verifies on-chain, the BLS precompiles
#                                               (ecPairing 0x08 / modexp 0x05) work — the
#                                               single real risk of the migration is cleared.
set -euo pipefail

NET="${1:-testnet}"
case "$NET" in
  testnet) CHAIN_KEY="robinhood-testnet"; WANT_ID=46630; DEF_RPC="https://rpc.testnet.chain.robinhood.com" ;;
  mainnet) CHAIN_KEY="robinhood-mainnet"; WANT_ID=4663;  DEF_RPC="https://rpc.mainnet.chain.robinhood.com" ;;
  *) echo "usage: $0 [testnet|mainnet]" >&2; exit 2 ;;
esac

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT/contracts"
[ -f .env ] || { echo "✗ contracts/.env not found — copy .env.example and fill it in." >&2; exit 1; }
# shellcheck disable=SC1091
set -a; . ./.env; set +a
RPC="${RPC_URL:-$DEF_RPC}"

echo "▸ Target: Robinhood $NET ($CHAIN_KEY, chain id $WANT_ID)"
echo "▸ RPC:    $RPC"

# ---- Preflight: never deploy to the wrong chain ----------------------------
GOT_ID="$(cast chain-id --rpc-url "$RPC")"
[ "$GOT_ID" = "$WANT_ID" ] || { echo "✗ RPC chain id is $GOT_ID, expected $WANT_ID. Fix RPC_URL." >&2; exit 1; }
BAL="$(cast balance "$DEPLOYER_ADDRESS" --rpc-url "$RPC")"
echo "▸ Deployer $DEPLOYER_ADDRESS balance: $(cast from-wei "$BAL") ETH"
[ "$BAL" != "0" ] || { echo "✗ Deployer has 0 ETH — fund it from the Robinhood faucet first." >&2; exit 1; }

# ---- 1. Deploy the 8 proxies ----------------------------------------------
echo "▸ Deploying core protocol (forge script Deploy --broadcast)…"
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast

# ---- 2. Wire the cluster + circuit + MXE ----------------------------------
echo "▸ Wiring the operator cluster (golive-wire)…"
( cd "$ROOT/sdk" && CHAIN="$CHAIN_KEY" RPC_URL="$RPC" bun run scripts/golive-wire.ts )

# ---- 3. The de-risk job: one real confidential computation ----------------
echo "▸ Running one real confidential job (golive-demo) — this exercises BLS verify…"
( cd "$ROOT/sdk" && CHAIN="$CHAIN_KEY" RPC_URL="$RPC" bun run scripts/golive-demo.ts )

echo
echo "✅ Robinhood $NET deploy + wire + verified job complete."
echo "   New addresses: contracts/broadcast/Deploy.s.sol/$WANT_ID/run-latest.json"
echo "   Daemon config: contracts/glaseld.golive.$WANT_ID.toml"
echo "   Next: point the node + web at these (Phase 1 in docs/ROBINHOOD-CHAIN-MIGRATION.md)."
