# RPC Guidance (Robinhood Chain testnet)

The default public endpoint `https://rpc.testnet.chain.robinhood.com` works for getting started,
but it is **rate-limited and load-balanced across replicas** — fine for a demo,
flaky under real use. Two specific gotchas the SDK already works around:

- **No read-your-writes.** A read immediately after a write may hit a replica that
  hasn't caught up. The SDK polls/retries (`watchComputation`, `readUntil`); if you
  write your own reads, poll until consistent rather than asserting once.
- **Tight gas estimation.** OP-stack `eth_estimateGas` underestimates rapid
  same-block txs. The SDK adds a ~60% gas buffer on writes; do the same in custom
  tooling or txs hit out-of-gas.

## Recommended for real use

Use a dedicated provider's free tier and pass it as your RPC URL. Any of these work
(pick one, create a free Robinhood Chain testnet app, copy the HTTPS URL):

- Alchemy — Robinhood Chain testnet
- Infura — Robinhood Chain testnet
- QuickNode — Robinhood Chain testnet
- Ankr / BlastAPI public or keyed endpoints

Set it via the SDK transport, or `RPC_URL` for the scripts:

```sh
export RPC_URL="https://base-sepolia.g.alchemy.com/v2/<your-key>"
```

```ts
import { http, createPublicClient } from "viem";
import { baseSepolia } from "viem/chains";

const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(process.env.RPC_URL), // your dedicated endpoint
});
```

A dedicated endpoint gives you higher rate limits and (usually) read-your-writes,
which removes most of the polling friction above.

## Faucet (gas)

You also need Robinhood Chain testnet ETH for gas. Use a public Robinhood Chain testnet ETH faucet
(Coinbase Developer Platform, Alchemy, etc.). Glasel's own faucet dispenses test
**GLASEL** for computation fees — it does not dispense ETH.
