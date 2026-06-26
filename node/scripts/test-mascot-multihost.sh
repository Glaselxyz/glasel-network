#!/usr/bin/env bash
# Local verifier for mascot-multihost.sh: runs `prepare` then two independent
# `run` parties on 127.0.0.1 (the only thing not exercised vs. a real cluster is
# the cross-machine scp of the bundle). Expects `out 7000`.
set -euo pipefail
export PATH="/opt/homebrew/bin:$PATH"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MPSPDZ="$HERE/../vendor/MP-SPDZ"
[[ -x "$MPSPDZ/mascot-party.x" ]] || { echo "SKIP: MP-SPDZ not built"; exit 0; }

cat > "$MPSPDZ/Programs/Source/glasel_mh.mpc" <<'EOF'
price = sint.get_input_from(0)
quantity = sint.get_input_from(1)
print_ln('out %s', (price * quantity).reveal())
EOF

bash "$HERE/mascot-multihost.sh" prepare glasel_mh 2 /tmp/glasel-mh-bundle.tar.gz
echo 1000 > "$MPSPDZ/Player-Data/Input-P0-0"
echo 7    > "$MPSPDZ/Player-Data/Input-P1-0"

# Party 1 in the background (it retries until party 0 — the rendezvous — is up).
bash "$HERE/mascot-multihost.sh" run 1 glasel_mh 2 localhost 16800 >/dev/null 2>&1 &
out="$(bash "$HERE/mascot-multihost.sh" run 0 glasel_mh 2 localhost 16800 2>/dev/null)"
wait || true

if echo "$out" | grep -q "out 7000"; then
  echo "✅ multi-host harness PASS (out 7000 from two independent party processes)"
else
  echo "❌ FAIL:"; echo "$out"; exit 1
fi
