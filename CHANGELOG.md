# Changelog

All notable changes to the published Glasel artifacts. This project follows
[Keep a Changelog](https://keepachangelog.com/) and
[Semantic Versioning](https://semver.org/). The SDK, CLI, and node version
independently; entries are grouped by artifact.

## [Unreleased]

### Added
- `glaseld` Docker image published to GHCR on `v*` tags (`ghcr.io/glaselxyz/glaseld`).
- `curl | sh` installer for the `glaselvm` CLI (`scripts/install.sh`).
- npm publish automation for `@glasel/client` on `sdk-v*` tags.
- typedoc API reference (`cd sdk && npm run docs`).
- Ops docs: compatibility matrix, testnet disclaimer, incident runbook, RPC guidance.

---

## SDK — `@glasel/client`

### [0.2.0]
#### Added
- `GlaselClient.encrypt` accepts `recipientPublicKey`: the requester's X25519 key
  is prepended to the sealed inputs so the node seals the result back to the
  requester. This is required to use the live network — any developer can now
  decrypt their own result.
- `pubkeyToFieldPair` exported from `crypto`.

#### Changed
- Live-network jobs must pass `recipientPublicKey`. (Omitting it is only valid for
  tests that model the node themselves.)

### [0.1.0]
- Initial publish: field arithmetic, Rescue cipher/KDF, X25519 ECDH,
  encrypt/decrypt/seal, typed codec, EIP-2612 permit, `GlaselClient`
  (read cluster key, encrypt, watch, decrypt), ABI registry.

---

## CLI — `glaselvm`

### [0.1.0]
- Initial publish to crates.io + prebuilt GitHub Release binaries
  (linux-x64, macos-arm64, macos-x64).
- Commands: `list`, `new`, `compile`, `info`, `simulate`, `deploy-circuit`,
  `estimate-fee`.

---

## Node — `glaseld`

### [Unreleased]
- Single-process engine now seals each result to the **per-job** requester key
  carried in the sealed inputs; `[engine] recipient_public_key` is optional
  (BGW/MASCOT fallback only).

---

## Contracts (Robinhood Chain testnet)

See [docs/COMPATIBILITY.md](docs/COMPATIBILITY.md) for the address ↔ version map.
Contract upgrades are tracked there, not here, because they are deployments rather
than published packages.
