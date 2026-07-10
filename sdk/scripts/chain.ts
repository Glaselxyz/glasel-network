/**
 * Single source of truth for the chain the admin/dev scripts target.
 *
 * Chain selection is env-driven so the same scripts work on Base Sepolia today
 * and Robinhood Chain after the migration — no code edits, just `CHAIN=...`:
 *
 *   CHAIN=base-sepolia       bun run scripts/golive-wire.ts   # default (current live)
 *   CHAIN=robinhood-testnet  bun run scripts/golive-wire.ts   # Robinhood testnet (46630)
 *   CHAIN=robinhood-mainnet  bun run scripts/golive-wire.ts   # Robinhood mainnet (4663)
 *
 * Robinhood Chain is a permissionless, EVM-equivalent Arbitrum L2 with ETH gas,
 * so nothing about the protocol changes — only the chain id / RPC / explorer.
 * See docs/ROBINHOOD-CHAIN-MIGRATION.md.
 */
import { defineChain, type Chain } from "viem";
import { baseSepolia } from "viem/chains";

/** Robinhood Chain testnet — chain id 46630. */
export const robinhoodTestnet: Chain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://explorer.testnet.chain.robinhood.com" },
  },
  testnet: true,
});

/** Robinhood Chain mainnet — chain id 4663. */
export const robinhoodMainnet: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

const CHAINS: Record<string, Chain> = {
  "base-sepolia": baseSepolia,
  "robinhood-testnet": robinhoodTestnet,
  "robinhood-mainnet": robinhoodMainnet,
};

/** The chain the scripts target. Defaults to Base Sepolia; override with `CHAIN`. */
export function resolveChain(name?: string): Chain {
  const key = (name ?? process.env.CHAIN ?? "base-sepolia").toLowerCase();
  const chain = CHAINS[key];
  if (!chain) {
    throw new Error(`unknown CHAIN '${key}' — use one of: ${Object.keys(CHAINS).join(", ")}`);
  }
  return chain;
}

/** The chain's default public RPC (fallback when RPC_URL is unset). */
export function defaultRpc(chain: Chain): string {
  return chain.rpcUrls.default.http[0]!;
}

/** Foundry writes broadcasts under `broadcast/Deploy.s.sol/<chainId>/`. */
export function broadcastDir(contractsDir: string, chain: Chain): string {
  return `${contractsDir}/broadcast/Deploy.s.sol/${chain.id}/run-latest.json`;
}

/**
 * Per-chain file path so multiple deployments coexist without clobbering.
 * Base Sepolia keeps the historical unsuffixed name (e.g. `golive-state.json`);
 * every other chain gets a `.<chainId>` suffix (e.g. `golive-state.46630.json`).
 */
export function chainFile(dir: string, base: string, ext: string, chain: Chain): string {
  const suffix = chain.id === baseSepolia.id ? "" : `.${chain.id}`;
  return `${dir}/${base}${suffix}.${ext}`;
}
