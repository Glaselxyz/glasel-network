#!/usr/bin/env bash
# Verify the live Glasel contracts on Blockscout (Robinhood Chain testnet, chainId 46630).
#
#   ./verify.sh
#
# Blockscout (unlike Basescan) needs no API key. Verifies each implementation
# contract from the deploy broadcast. UUPS proxies are verified by source via
# their implementation: once an impl is verified, open the PROXY address on
# Blockscout and use its proxy-detection to link the two. Run from contracts/.
set -euo pipefail

BROADCAST="broadcast/Deploy.s.sol/46630/run-latest.json"
CHAIN=46630
VERIFIER_URL="https://explorer.testnet.chain.robinhood.com/api"

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
    --verifier blockscout \
    --verifier-url "$VERIFIER_URL" \
    --watch || echo "   (failed for $name — if it says 'multiple contracts', pass src/.../$name.sol:$name)"
done

echo
echo "Done. Now link each proxy on Blockscout: open the proxy address and use"
echo "its proxy detection. Proxy addresses are in docs/COMPATIBILITY.md."
