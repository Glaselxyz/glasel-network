# Examples — building on Glasel

A minimal, copy-pasteable example of the Glasel developer flow with
`@glasel/client`.

## confidential-order

Computes `price * quantity` **confidentially**: the inputs are encrypted on the
client, the result is sealed back to you, and nothing reveals the plaintext.

```bash
cd sdk
bun run examples/confidential-order.ts   # prints: confidential notional = 7000
bun test examples/                        # runs the example's test
```

The example is self-contained (the cluster's decrypt → compute → re-seal step is
inlined) so you can learn the API with no infrastructure.

### Talking to the live network (Base Sepolia)

Swap the local cluster keypair for the real key read from chain, and commission
through the Coordinator:

```ts
import { GlaselClient, ORDER_SCHEMA } from "@glasel/client";
import { createPublicClient, http } from "viem";
import { baseSepolia } from "viem/chains";

const client = new GlaselClient({
  publicClient: createPublicClient({ chain: baseSepolia, transport: http() }),
  addresses: {
    coordinator: "0x8Da86E718964678f1Fd04467D3d7bc4B5A439A74",
    clusterManager: "0xeD336A97691Cdba986383eD1BAA942F49254CcBe",
    mxeFactory: "0x102fB9E05A5b61C0C654ff58B2d9F92f3a7bdE46",
  },
});

const clusterKey = await client.getClusterPublicKeyForMXE(mxeId);
const { encInputs } = client.encrypt({ schema: ORDER_SCHEMA, clusterKey, value: { /* … */ } });
// commission(encInputs) → watchComputation(computationId) → decryptResult(...)
```

See the full SDK reference at `/docs/sdk` and the deployed addresses at
`/docs/network`.
