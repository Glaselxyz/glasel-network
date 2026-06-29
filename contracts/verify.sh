#!/usr/bin/env bash
# Verify the live Glasel contracts on Basescan (Base Sepolia, chainId 84532).
#
#   BASESCAN_API_KEY=your_key ./verify.sh
#
# Verifies each implementation contract from the deploy broadcast. UUPS proxies
# are verified by source via their implementation: once an impl is verified,
# open the PROXY address on Basescan → "More Options → Is this a Proxy?" →
# Verify, and Basescan links the two. Run from the contracts/ directory.
set -euo pipefail

: "${BASESCAN_API_KEY:?set BASESCAN_API_KEY (get one free at basescan.org)}"
BROADCAST="broadcast/Deploy.s.sol/84532/run-latest.json"
CHAIN=84532
VERIFIER_URL="https://api-sepolia.basescan.org/api"

[ -f "$BROADCAST" ] || { echo "missing $BROADCAST (run from contracts/)"; exit 1; }
command -v forge >/dev/null || { echo "forge not on PATH (try: PATH=\$HOME/.foundry/bin:\$PATH)"; exit 1; }

# Implementation contracts = CREATE txs that aren't the ERC1967Proxy wrappers.
node -e '
const bc = require("./'"$BROADCAST"'");
const impls = bc.transactions.filter(
  (t) => t.transactionType === "CREATE" && t.contractName && t.contractName !== "ERC1967Proxy",
);
for (const t of impls) console.log(`${t.contractAddress} ${t.contractName}`);
' | while read -r addr name; do
  echo ">> verifying $name @ $addr"
  forge verify-contract "$addr" "$name" \
    --chain "$CHAIN" \
    --verifier etherscan \
    --verifier-url "$VERIFIER_URL" \
    --etherscan-api-key "$BASESCAN_API_KEY" \
    --watch || echo "   (failed for $name — if it says 'multiple contracts', pass src/.../$name.sol:$name)"
done

echo
echo "Done. Now mark each proxy on Basescan: open the proxy address →"
echo "More Options → Is this a Proxy? → Verify. Proxy addresses are in docs/COMPATIBILITY.md."
