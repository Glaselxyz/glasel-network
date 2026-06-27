#!/bin/sh
# Glasel CLI installer — fetches a prebuilt `glaselvm` binary from GitHub Releases.
#
#   curl -fsSL https://raw.githubusercontent.com/Glaselxyz/glasel-network/main/scripts/install.sh | sh
#
# Env overrides:
#   GLASELVM_VERSION   release tag to install (default: latest)   e.g. v0.1.0
#   GLASELVM_INSTALL   install dir (default: $HOME/.local/bin)
#
# No Rust toolchain required. Verifies the published sha256 before installing.
set -eu

REPO="Glaselxyz/glasel-network"
BIN="glaselvm"
INSTALL_DIR="${GLASELVM_INSTALL:-$HOME/.local/bin}"

err() { printf 'error: %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

# ── pick a downloader ────────────────────────────────────────────────────────
if have curl; then
  dl() { curl -fsSL "$1" -o "$2"; }
  dl_stdout() { curl -fsSL "$1"; }
elif have wget; then
  dl() { wget -qO "$2" "$1"; }
  dl_stdout() { wget -qO- "$1"; }
else
  err "need curl or wget"
fi

# ── detect platform → release target triple ──────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"
case "$os" in
  Linux)
    case "$arch" in
      x86_64|amd64) target="x86_64-unknown-linux-gnu" ;;
      *) err "unsupported Linux arch: $arch (prebuilt binaries: x86_64 only — use 'cargo install glaselvm')" ;;
    esac ;;
  Darwin)
    case "$arch" in
      arm64|aarch64) target="aarch64-apple-darwin" ;;
      x86_64) target="x86_64-apple-darwin" ;;
      *) err "unsupported macOS arch: $arch" ;;
    esac ;;
  *) err "unsupported OS: $os (try 'cargo install glaselvm')" ;;
esac

# ── resolve version (latest if unset) ────────────────────────────────────────
version="${GLASELVM_VERSION:-}"
if [ -z "$version" ]; then
  # Follow the /releases/latest redirect to read the tag, no jq needed.
  version="$(dl_stdout "https://api.github.com/repos/$REPO/releases/latest" \
    | grep -m1 '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')"
  [ -n "$version" ] || err "could not determine latest version — set GLASELVM_VERSION (e.g. v0.1.0)"
fi

asset="${BIN}-${version}-${target}.tar.gz"
base="https://github.com/$REPO/releases/download/$version"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

printf 'Installing %s %s (%s)\n' "$BIN" "$version" "$target"

dl "$base/$asset" "$tmp/$asset" || err "download failed: $base/$asset"
dl "$base/$asset.sha256" "$tmp/$asset.sha256" || err "checksum download failed"

# ── verify sha256 ────────────────────────────────────────────────────────────
expected="$(awk '{print $1}' "$tmp/$asset.sha256")"
if have sha256sum; then
  actual="$(sha256sum "$tmp/$asset" | awk '{print $1}')"
elif have shasum; then
  actual="$(shasum -a 256 "$tmp/$asset" | awk '{print $1}')"
else
  err "need sha256sum or shasum to verify the download"
fi
[ "$expected" = "$actual" ] || err "checksum mismatch (expected $expected, got $actual)"

# ── extract + install ────────────────────────────────────────────────────────
tar -xzf "$tmp/$asset" -C "$tmp"
mkdir -p "$INSTALL_DIR"
install -m 0755 "$tmp/${BIN}-${version}-${target}/${BIN}" "$INSTALL_DIR/$BIN" \
  || cp "$tmp/${BIN}-${version}-${target}/${BIN}" "$INSTALL_DIR/$BIN"
chmod 0755 "$INSTALL_DIR/$BIN"

printf '\n✅ Installed %s to %s\n' "$BIN" "$INSTALL_DIR/$BIN"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) printf '\n⚠  %s is not on your PATH. Add it:\n    export PATH="%s:$PATH"\n' "$INSTALL_DIR" "$INSTALL_DIR" ;;
esac
printf '\nRun: %s --help\n' "$BIN"
