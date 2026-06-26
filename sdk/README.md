# @glasel/client — Glasel Network SDK (Phase 2)

TypeScript client + encryption stack for the Glasel Network (§6, §8.2 of the
[architecture](../glasel-network-architecture.md)). Runs on Bun.

## What's here

| Module | Responsibility |
|--------|----------------|
| `src/field.ts` | F_p arithmetic over p = 2²⁵⁵−19 + element/byte serialization |
| `src/rescue.ts` | Rescue-Prime permutation, sponge KDF, CTR-mode stream cipher |
| `src/x25519.ts` | X25519 keygen + ECDH (→ field element for the KDF) |
| `src/crypto.ts` | `encrypt` / `decrypt` / `seal` — ECDH + KDF + CTR |
| `src/codec.ts` | Typed value ↔ field-element codec; `encInputs` wire format |
| `src/client.ts` | `GlaselClient` — cluster key reads, encrypt, watch, decrypt (viem) |
| `src/abi.ts` | Minimal read ABIs + `ComputationStatus` |

## Quick start

```ts
import { GlaselClient, ORDER_SCHEMA } from "@glasel/client";

const client = new GlaselClient({ publicClient, addresses: { coordinator, clusterManager, mxeFactory } });

const clusterKey = await client.getClusterPublicKeyForMXE(mxeId);
const { encInputs } = client.encrypt({
  schema: ORDER_SCHEMA,
  value: { price: 1000n, quantity: 5n, side: false, buyerKey },
  clusterKey,
});
// submit encInputs via your app contract, then:
const result = await client.watchComputation({ computationId });
if (result.success) {
  const trade = client.decryptResult({ encResult: result.encResult, privateKey, schema: ORDER_SCHEMA });
}
```

## Tests

```bash
bun install
bun test            # 24 unit tests: field, rescue/CTR, ECDH, seal, codec, wire format
bun run typecheck
bun run scripts/e2e.ts   # cross-stack: deploys to anvil, runs full lifecycle, SDK reads+decrypts (needs forge+anvil)
```

The e2e (`scripts/e2e.ts`) deploys the contracts with `forge script Deploy`, then
drives propose→activate→commission→submit from viem (reading each id from its
event, signing with EIP-191 to match the contract's `toEthSignedMessageHash`),
and finally uses `GlaselClient` to read the cluster key, watch the computation,
and decrypt the on-chain result — 9 assertions, all green.

## Design note — Rescue cipher

This is a **self-consistent** Rescue-Prime instantiation: the MDS matrix (Cauchy)
and round constants are generated deterministically from a domain-separated seed,
so the SDK and the (future) node implementation agree exactly. Arcium's published
constant set is not fully public; swapping it in is a drop-in change since the
algorithmic structure (α-S-box, inverse-S-box, MDS, sponge, CTR) is unchanged.
See the header of `src/rescue.ts`.
