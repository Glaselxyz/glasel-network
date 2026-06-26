# Production Readiness Plan: Open Glasel Testnet to 100 Developers

## The goal (definition of done)

A developer who has never met the team can, in under 30 minutes and without asking
anyone for help:

1. Find Glasel (docs site, search, GitHub).
2. Install the SDK and CLI from public registries.
3. Get test tokens from a faucet.
4. Write, deploy, and run a private app against a live network that actually
   completes the job.
5. See the result and know where to get help if stuck.

And the network stays up while 100 of them do this concurrently.

## The core gap

Everything is **built and tested**, but almost nothing is **published or hosted**.
Right now it only runs on the builder's machine. The work below is mostly
distribution, hosting, and keeping a live network online, not new features.

| Piece | Built today | Missing for 100 devs |
|---|---|---|
| Contracts | Live on Base Sepolia | Not verified on Basescan; no public address page |
| SDK (`@glasel/client`) | Works as a local package | Not published to npm |
| CLI (`glaselvm`) | Builds from source | No installable binary |
| Node (`glaseld`) | Has Docker + systemd files | No published image; no live cluster |
| Subgraph | Code written | Not deployed to a hosted endpoint |
| Docs site (`web/`) | Builds locally | Not hosted at a real domain |
| Tokens | Mintable by admin | No faucet for developers |
| Support | None | No channel, no status page |

---

## Workstream 1 — Publish the tools (so developers can install)

This is the "host/list it somewhere" work.

**SDK → npm.** Claim the `@glasel` organization on npm. Publish `@glasel/client`
as a public package. Ship both module formats and the type definitions so it works
in Node, browsers, and Bun. Add a README, a LICENSE, and a keywords list so it is
searchable. Result: `npm install @glasel/client`.

**CLI → installable binary.** Publish `glaselvm` three ways so any developer can
get it: prebuilt binaries on GitHub Releases (macOS Apple Silicon and Intel, Linux
x64), `cargo install glaselvm` on crates.io, and a one line `curl | sh` installer
script. Optional later: a Homebrew formula.

**Node → public image.** Publish the `glaseld` Docker image to a public registry
(GitHub Container Registry), tagged by version, plus binaries on GitHub Releases.
Result: an operator runs one `docker run` command instead of compiling Rust.

**Release automation.** One GitHub Action that, on a version tag, builds and
publishes all of the above at once. This keeps versions in sync and removes manual
publishing mistakes.

Cost: free. Mostly account setup plus a release pipeline.

---

## Workstream 2 — Stand up the live network (so the testnet actually works)

This is the single most important workstream. Without live operator machines, every
job a developer commissions just sits there and never completes.

**Run a real operator cluster.** Deploy 3 to 5 `glaseld` nodes on cloud servers,
running 24/7, in different locations. Register and stake them on-chain so the
contracts will assign jobs to them. Start with the practical compute path and move
to the malicious-secure (MASCOT) path as it hardens. This is the "always on" core
of the testnet.

**Token faucet.** Build a simple faucet (a small web form or a chat bot) that sends
test GLASEL to any developer address, with a daily limit per address to prevent
abuse. Link it to the public Base Sepolia ETH faucet so developers can also cover
gas. Without this, nobody can pay the job fee.

**Hosted subgraph.** Deploy the subgraph to The Graph's testnet endpoint so
developers can query the status and history of their computations from a public URL.

**RPC access.** Recommend a reliable Base Sepolia RPC provider (a free tier from a
major provider) in the docs, or run a light proxy, so developers are not blocked by
the rate limits of the default public node.

**Verify contracts on Basescan.** Get a Basescan API key and verify all eight
contracts. This lets developers read the code, trust it, and interact through the
block explorer. It is a strong, free trust signal.

Cost: roughly 50 to 150 dollars a month for the cloud cluster. Everything else is
free tiers.

---

## Workstream 3 — Developer experience (so they can self-serve)

**Host the docs site.** Deploy the existing `web/` site to a host (Vercel free
tier) at a real domain such as docs.glasel.xyz. Put the live contract addresses,
the faucet link, and the quickstart front and center.

**A quickstart that truly works.** One page that takes a developer from nothing to a
deployed, running private app in under 30 minutes. Test it end to end on a clean
machine, because the first 30 minutes decide whether a developer stays.

**Templates and an examples repo.** A public repository with ready to clone
examples (sealed auction, private vote, confidential matching) so developers start
from working code, not a blank page. The CLI already scaffolds these; mirror them in
a browsable repo.

**API reference.** Auto-generate the SDK reference from the code so every function
is documented and always current.

**Support loop.** A public chat channel (Discord or Telegram), GitHub Discussions
for questions, and issue templates for bug reports. One hundred developers will have
questions; give them one obvious place to ask.

Cost: free.

---

## Workstream 4 — Reliability and operations (so it stays up)

**Monitoring and alerts.** The nodes already expose health metrics. Point a
monitoring dashboard (Prometheus plus Grafana) at the cluster, and wire alerts (to a
chat channel or pager) for a node going down, jobs failing, or the queue backing up.

**Status page.** A public page showing whether the network is healthy, so developers
can tell "is it me or is it down" without filing a ticket.

**Load test at scale.** Use the existing load test harness to simulate 100
developers and find the real throughput ceiling, then size the cluster to it. Note
that the malicious-secure compute path is heavy and processes one job at a time per
machine, so scaling means adding nodes or queueing, not assuming infinite capacity.

**Incident runbook.** A short document: what to do when a node dies, when the faucet
drains, when the cluster falls behind. Boring, but it is the difference between a
five minute outage and a five hour one.

**Key safety.** Operator keys are loaded from protected files, never hardcoded.
Keep encrypted backups of node keys so a dead server is a quick restore, not a lost
identity.

Cost: free to low (monitoring on the same servers).

---

## Workstream 5 — Trust and safety (so they feel safe building)

**Verify and document the security model.** Publish a clear, plain page on what is
protected, what the trust assumptions are, and what is still experimental. Honesty
here builds more trust than marketing.

**Bug bounty.** A small testnet bug bounty invites the 100 developers to find issues
before mainnet, and turns security researchers into allies.

**External audit (pre-mainnet gate).** The contracts are tested but not yet reviewed
by an outside firm. This is not required to open a testnet, but it is the gate before
real money. The audit preparation package already exists; line up a firm in parallel.

**Compatibility matrix.** A simple table of which SDK version works with which
deployed contract version, so an upgrade never silently breaks the 100 developers.

**Testnet disclaimer.** A clear note that this is a testnet, tokens have no value,
and things may reset. Sets expectations and reduces support load.

Cost: bug bounty and audit are the only real spend, and the audit is deferred to the
mainnet gate.

---

## Workstream 6 — Versioning and release discipline

**Semantic versioning everywhere.** SDK, CLI, and node share a clear version scheme
so developers know when something is a safe update versus a breaking change.

**Changelog and deprecation policy.** Announce changes ahead of time. The fastest
way to lose 100 developers is to break their apps without warning.

**Frozen public interfaces.** The SDK functions and contract calls developers depend
on become a stable promise. Internal refactors are fine; the outside surface stays
steady.

Cost: free. This is process, not infrastructure.

---

## Recommended rollout order

The critical path to "a developer can build something real" is short. Do these in
order; each one unblocks the next.

**Phase A — Make it reachable.**
1. Stand up the live operator cluster (Workstream 2). Nothing works without it.
2. Build the faucet (Workstream 2). No fee, no jobs.
3. Publish the SDK and CLI (Workstream 1). No install, no developers.

**Phase B — Make it learnable.**
4. Host the docs site and a tested quickstart (Workstream 3).
5. Verify contracts on Basescan and deploy the hosted subgraph (Workstream 2).
6. Publish templates and an examples repo (Workstream 3).

**Phase C — Make it dependable.**
7. Monitoring, alerts, and a status page (Workstream 4).
8. Support channels and a bug bounty (Workstreams 3 and 5).
9. Load test to 100 developers and size the cluster (Workstream 4).

**Phase D — Make it trustworthy for what comes next.**
10. Security model docs and compatibility matrix (Workstreams 5 and 6).
11. Line up the external audit for the mainnet gate (Workstream 5).

A small team can reach the end of Phase B quickly, because the software is already
built. Phases C and D are about staying up and earning trust as real developers
arrive.

## What this costs, roughly

Almost everything uses free tiers: npm, crates.io, GitHub Releases, GitHub Container
Registry, Vercel, The Graph testnet, Basescan verification, Discord. The only real
recurring cost is the cloud cluster, on the order of 50 to 150 dollars a month, plus
a domain name. The external audit and any bug bounty rewards are the larger,
deferred spends tied to the mainnet milestone, not the testnet launch.

## The one honest scaling caveat

One hundred developers casually building and testing is well within reach. The
contracts already rate limit and have a circuit breaker, and the cluster can be sized
to demand. The thing to watch is the malicious-secure compute path, which is
deliberately heavy and runs one job at a time per machine. Sustained heavy load means
adding more nodes or clusters and queueing jobs, not assuming the current handful of
machines scales forever. Plan the cluster size against the load test, not against
hope.
