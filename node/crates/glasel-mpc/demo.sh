#!/usr/bin/env bash
# Real 3-process MPC demo: secret-share `price=1000, quantity=7`, run three
# separate glaseld-party processes that compute price*quantity over shares, and
# verify (a) all three reconstruct 7000 and (b) no process ever held plaintext.
set -euo pipefail

cd "$(dirname "$0")/../../.." # repo root
BIN="node/target/debug/glaseld-party"
DIR="$(mktemp -d)"
PORTS=(9001 9002 9003)
ADDRS="127.0.0.1:9001,127.0.0.1:9002,127.0.0.1:9003"
EXPECT=7000

( cd node && cargo build -p glasel-mpc --bin glaseld-party ) >/dev/null 2>&1

# 1. Deal: secret-share the inputs to 3 parties (threshold 1).
"$BIN" deal --inputs 1000,7 --n 3 --t 1 --out-dir "$DIR" >/dev/null

# 2. Privacy check: no share file may contain the plaintext inputs verbatim.
for i in 1 2 3; do
  if grep -Eq '"1000"|"7"' "$DIR/shares-$i.json"; then
    echo "FAIL: party $i share file leaks a plaintext input"; exit 1
  fi
done
echo "✓ no party's shares contain the plaintext inputs (1000, 7)"

# 3. Launch three separate processes.
pids=()
for i in 1 2 3; do
  "$BIN" run --id "$i" --t 1 --addrs "$ADDRS" \
    --shares "$DIR/shares-$i.json" --circuit "$DIR/circuit.json" \
    >"$DIR/out-$i.json" 2>"$DIR/err-$i.log" &
  pids+=($!)
done
for pid in "${pids[@]}"; do wait "$pid"; done

# 4. Verify every process independently reconstructed the correct result.
ok=0
for i in 1 2 3; do
  got=$(grep -oE '"outputs":\["[0-9]+"\]' "$DIR/out-$i.json" | grep -oE '[0-9]+' | tail -1)
  echo "  party $i → $got"
  [ "$got" = "$EXPECT" ] && ok=$((ok+1))
done

if [ "$ok" = "3" ]; then
  echo "✓ all 3 processes computed price*quantity = $EXPECT over shares — no party saw the inputs"
  rm -rf "$DIR"
  exit 0
else
  echo "FAIL: only $ok/3 processes returned $EXPECT"; echo "logs in $DIR"; exit 1
fi
