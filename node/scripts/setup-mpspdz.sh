#!/usr/bin/env bash
# setup-mpspdz.sh — build MP-SPDZ's maliciously-secure MASCOT VM for Glasel.
#
# MASCOT (Keller-Orsini-Scholl, CCS'16) gives malicious security against a
# dishonest majority over a prime field — the production-grade replacement for
# Glasel's semi-honest BGW multiplication. This script builds it natively
# (no Docker) and was validated on macOS arm64 (Apple clang 21) + Linux.
#
# Verified end-to-end: compiles `Programs/Source/glasel_mul.mpc` (price*quantity)
# and runs a 2-party malicious-secure session → `notional = 7000`, secure
# SoftSpoken OT (NOT the -DINSECURE KOS path).
#
# Gotchas this script encodes (all real, hit during bring-up):
#   1. Apple clang 21 flags Homebrew gmpxx.h's deprecated literal operators, and
#      MP-SPDZ builds with -Werror → drop -Werror (warnings in a 3rd-party dep
#      shouldn't fail the build).
#   2. Boost 1.90's Asio broke libOTe's bundled cryptoTools (no matching
#      `boost_asio_require_fn`) → pin Boost 1.85 for the SoftSpoken OT build.
#      (Do NOT work around this with USE_KOS=1 — MP-SPDZ gates KOS behind
#       -DINSECURE because KOS15's proof has a known gap, eprint 2022/192.)
#   3. A shallow clone skips submodules; simde's nested `munit` test submodule
#      fails to fetch but isn't needed → init top-level deps only.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # node/
MPSPDZ_DIR="${MPSPDZ_DIR:-$ROOT/vendor/MP-SPDZ}"
MPSPDZ_REF="${MPSPDZ_REF:-master}"
PARTIES="${PARTIES:-2}"

echo "==> MP-SPDZ → $MPSPDZ_DIR"

if [[ "$(uname -s)" == "Darwin" ]]; then
  echo "==> macOS deps via Homebrew"
  brew install gmp libsodium ntl openssl boost@1.85 >/dev/null
  # Boost 1.85 must be the active boost (1.90's Asio breaks libOTe/cryptoTools).
  if ! grep -q "108500" /opt/homebrew/include/boost/version.hpp 2>/dev/null; then
    brew unlink boost >/dev/null 2>&1 || true
    brew link --force --overwrite boost@1.85 >/dev/null
  fi
  CXX_BIN="/usr/bin/g++"   # system clang; non-system compilers break per MP-SPDZ README
else
  echo "==> Linux deps via apt (Debian/Ubuntu)"
  sudo apt-get update -y && sudo apt-get install -y \
    automake build-essential clang cmake git libboost-dev libboost-thread-dev \
    libgmp-dev libntl-dev libsodium-dev libssl-dev libtool python3
  CXX_BIN="clang++"
fi

if [[ ! -d "$MPSPDZ_DIR/.git" ]]; then
  git clone --depth 1 --branch "$MPSPDZ_REF" https://github.com/data61/MP-SPDZ.git "$MPSPDZ_DIR"
fi
cd "$MPSPDZ_DIR"

echo "==> fetching deps (top-level submodules; skip simde's munit test submodule)"
git submodule update --init --depth 1 \
  deps/SimpleOT deps/SimplestOT_C deps/libOTe deps/simde deps/sse2neon Programs/Circuits

echo "==> CONFIG.mine (system compiler; SoftSpoken OT by leaving USE_KOS unset)"
printf 'CXX = %s\n' "$CXX_BIN" > CONFIG.mine
# Drop -Werror so a too-new compiler's warnings in 3rd-party headers don't fail us.
sed -i.bak 's/ -Werror//g' CONFIG && rm -f CONFIG.bak

echo "==> building mascot-party.x (malicious, dishonest-majority, prime field)"
make clean >/dev/null 2>&1 || true
make -j"$(getconf _NPROCESSORS_ONLN)" mascot-party.x

echo "==> TLS certs for $PARTIES parties"
Scripts/setup-ssl.sh "$PARTIES"

echo "==> install the Glasel smoke-test program + inputs"
mkdir -p Programs/Source Player-Data
cat > Programs/Source/glasel_mul.mpc <<'MPC'
# Malicious-secure 2-party multiplication: party 0's price * party 1's quantity.
# MASCOT authenticates every secret share with a MAC; the reveal is MAC-checked,
# so a cheating party is caught (security with abort) — the property our
# semi-honest BGW lacks. This is the order-notional circuit from the Glasel demo.
price = sint.get_input_from(0)
quantity = sint.get_input_from(1)
notional = price * quantity
print_ln('notional = %s', notional.reveal())
MPC
echo "1000" > Player-Data/Input-P0-0   # party 0's private price
echo "7"    > Player-Data/Input-P1-0   # party 1's private quantity

echo
echo "✅ MASCOT built: $MPSPDZ_DIR/mascot-party.x"
echo "   Smoke test:  cd $MPSPDZ_DIR && python3 ./compile.py glasel_mul && Scripts/mascot.sh glasel_mul"
echo "   (expects 'notional = 7000' from price=1000 * quantity=7)"
