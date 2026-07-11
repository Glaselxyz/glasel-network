# Security Policy

Glasel is a **research preview**. It is deployed to **Robinhood Chain mainnet**
(chainId 4663), but with deliberately **testnet-grade keys and a single operator
node** (see below) — it has **not** been audited. The GLASEL token here has **no
value**; do not use real funds or trust these contracts with anything of value.

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue.

- Preferred: open a **private vulnerability report** via this repository's
  **Security → Report a vulnerability** (GitHub private advisories).
- Or email **security@glasel.xyz**.

Include a description, affected component (contracts / SDK / node daemon / web),
and reproduction steps. We aim to acknowledge within a few business days. Please
give us a reasonable window to remediate before public disclosure.

## Scope

In scope: the Solidity contracts (`contracts/`), the TypeScript SDK (`sdk/`),
the Rust node daemon (`node/`), and the web app (`web/`).

Out of scope: the deliberately-weak **demo keys** described below, denial
of service against the single operator node, and anything requiring
compromise of a developer's own machine or wallet.

## Testnet-grade key model (important context for auditors)

This deployment uses deliberate simplifications that **must not** carry to a
value-bearing production deployment:

- **Cluster BLS group secret** — the live cluster signs results with a *random*
  per-cluster BN254 secret that is generated at wiring time and stored **only** in
  the gitignored `contracts/golive-state*.json` (and the operator's daemon config).
  It is never committed. The daemon config supports `env:` / `file:` secret
  references (`resolve_secret`) so production deployments inject it out-of-band.
- **Submitter account** — the daemon posts results from a *random, funded* EOA.
  `submitResult` verifies the aggregated BLS group signature, not the sender, so
  the submitter only needs gas.
- **Node registration identities** — for reproducible testnet bring-up, the three
  demo cluster nodes register under deterministic keys derived from public strings
  (`keccak256("glasel-testnet-node-N")`). These stake **valueless testnet GLASEL**
  and do **not** authorize results (the BLS group key does). **Production requires
  independent, randomly-generated operator keys** — never derived, never committed.
- **Anvil keys** in the local e2e scripts (`sdk/scripts/e2e*.ts`) are the standard,
  publicly-known local development keys and are used only against a local chain.

## Mainnet hardening checklist (before any value is at stake)

- Random, out-of-band-injected cluster and operator keys (no derived/committed keys).
- External smart-contract audit.
- Multiple independent operators (the real BGW/threshold-trust model), not one node.
- Storage `__gap`s on upgradeable contracts.
