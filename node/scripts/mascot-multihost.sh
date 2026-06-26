#!/usr/bin/env bash
# mascot-multihost.sh — deploy a Glasel MASCOT computation across real hosts.
#
# Each arxOS node runs exactly ONE MASCOT party. Party 0 is the rendezvous every
# party dials (`-h <party0_host>`); all parties share one base port. The program
# bytecode and the TLS certs must be identical on every node, so the coordinator
# compiles + generates them once and distributes a bundle; each node supplies only
# its OWN private input.
#
# Flow:
#   # 1. Coordinator: compile the program over the Glasel field prime + make certs,
#   #    then pack a bundle to ship to every node.
#   mascot-multihost.sh prepare <program> <n> <bundle.tar.gz> [field_prime]
#
#   # 2. Ship the bundle to each node and unpack it into that node's MP-SPDZ dir
#   #    (scp/rsync — out of band), then drop the node's private input:
#   #    echo "<value> ..." > Player-Data/Input-P<id>-0
#
#   # 3. On each node i (0..n-1), pointing at party 0's address:
#   mascot-multihost.sh run <party_id> <program> <n> <party0_host> <port>
#
# Verified locally: `prepare` + N concurrent `run` on 127.0.0.1 reproduces the
# 2-party order-notional result (see node/scripts/test-mascot-multihost.sh).
set -euo pipefail

MPSPDZ_DIR="${MPSPDZ_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/vendor/MP-SPDZ}"
cmd="${1:-}"; shift || true

case "$cmd" in
  prepare)
    program="${1:?program name}"; n="${2:?party count}"; bundle="${3:?output bundle path}"
    prime="${4:-57896044618658097711785492504343953926634992332820282019728792003956564819949}" # 2^255-19
    cd "$MPSPDZ_DIR"
    [[ -f "Programs/Source/$program.mpc" ]] || { echo "missing Programs/Source/$program.mpc" >&2; exit 1; }
    echo "==> compiling $program over prime $prime"
    python3 ./compile.py -P "$prime" "$program" >/dev/null
    echo "==> generating TLS certs for $n parties"
    Scripts/setup-ssl.sh "$n" >/dev/null
    echo "==> packing bundle → $bundle"
    tar czf "$bundle" \
      "Programs/Bytecode/$program"*.bc \
      Programs/Schedules/"$program".sch \
      Player-Data/*.pem Player-Data/*.0 2>/dev/null || \
      tar czf "$bundle" "Programs/Bytecode/$program"*.bc Programs/Schedules/"$program".sch Player-Data/*.pem
    echo "✅ bundle ready. Distribute to every node + unpack into its MP-SPDZ dir,"
    echo "   then set each node's Player-Data/Input-P<id>-0 before 'run'."
    ;;

  run)
    party_id="${1:?party id}"; program="${2:?program}"; n="${3:?party count}"
    host="${4:?party0 host}"; port="${5:?base port}"
    cd "$MPSPDZ_DIR"
    [[ -x ./mascot-party.x ]] || { echo "mascot-party.x not built (setup-mpspdz.sh)" >&2; exit 1; }
    echo "==> party $party_id of $n → rendezvous $host:$port"
    exec ./mascot-party.x "$party_id" "$program" -N "$n" -h "$host" -pn "$port"
    ;;

  *)
    echo "usage: mascot-multihost.sh {prepare <program> <n> <bundle> [prime] | run <id> <program> <n> <party0_host> <port>}" >&2
    exit 2
    ;;
esac
