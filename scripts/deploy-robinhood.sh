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
#   • forge script Deploy --broadcast   → 8 UUPS proxies on Robinhood
#   • CHAIN=robinhood-* testnet.ts      → self-contained harness (NO daemon): the
#                                         deployer funds 3 node sub-accounts, they
#                                         register + stake, form + activate a cluster,
#                                         set the BLS group key, commission a job, then
#                                         BLS-sign + submitResult ON-CHAIN — plus a
#                                         tampered-result rejection test. If submitResult
#                                         verifies, the BLS precompiles (ecPairing 0x08 /
#                                         modexp 0x05) work → the one real migration risk
#                                         is cleared. Only the deployer wallet needs funds.
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
# Capture any caller-provided Robinhood RPC before .env (whose RPC_URL is Base).
RH_RPC="${RH_RPC:-}"
# shellcheck disable=SC1091
set -a; . ./.env; set +a
# Use the Robinhood RPC (explicit override or the network default) — NOT .env's
# RPC_URL, which points at Base. Only PRIVATE_KEY/DEPLOYER_ADDRESS come from .env.
RPC="${RH_RPC:-$DEF_RPC}"

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
PK="$PRIVATE_KEY"; [ "${PK#0x}" = "$PK" ] && PK="0x$PK"   # normalise 0x prefix
forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --private-key "$PK"

# ---- 2. Self-contained de-risk: full flow incl. on-chain BLS submitResult ---
echo "▸ Running the self-contained testnet harness (registers, stakes, forms a"
echo "  cluster, commissions a job, BLS-signs + submitResult on-chain)…"
( cd "$ROOT/sdk" && CHAIN="$CHAIN_KEY" RPC_URL="$RPC" bun run scripts/testnet.ts )

echo
echo "✅ Robinhood $NET deploy + on-chain BLS-verified job complete."
echo "   The BLS precompiles (ecPairing 0x08 / modexp 0x05) work on Robinhood."
echo "   New addresses: contracts/broadcast/Deploy.s.sol/$WANT_ID/run-latest.json"
echo
echo "   Next (Phase 1 — real network, needs the daemon), from sdk/:"
echo "     CHAIN=$CHAIN_KEY RPC_URL=$RPC bun run scripts/golive-wire.ts"
echo "   then run glaseld with the emitted glaseld.golive.$WANT_ID.toml and set the"
echo "   NEXT_PUBLIC_* addresses on Vercel (docs/ROBINHOOD-CHAIN-MIGRATION.md)."
