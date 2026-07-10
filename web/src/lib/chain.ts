/**
 * The chain the web app targets. Env-driven so the site works on Base Sepolia
 * today and Robinhood Chain after the migration — set `NEXT_PUBLIC_CHAIN`:
 *
 *   NEXT_PUBLIC_CHAIN=base-sepolia       (default — current live)
 *   NEXT_PUBLIC_CHAIN=robinhood-testnet  (chain 46630)
 *   NEXT_PUBLIC_CHAIN=robinhood-mainnet  (chain 4663)
 *
 * Robinhood Chain is a permissionless, EVM-equivalent Arbitrum L2 with ETH gas,
 * so only the chain id / RPC / explorer change. See docs/ROBINHOOD-CHAIN-MIGRATION.md.
 */
import { defineChain, type Chain } from "viem";
import { baseSepolia } from "viem/chains";

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

export const robinhoodMainnet: Chain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

export const CHAINS: Record<string, Chain> = {
  "base-sepolia": baseSepolia,
  "robinhood-testnet": robinhoodTestnet,
  "robinhood-mainnet": robinhoodMainnet,
};

/** The chain key this build targets (defaults to Base Sepolia). */
export const chainKey = (process.env.NEXT_PUBLIC_CHAIN ?? "base-sepolia").toLowerCase();

/** The resolved viem chain — the single source of truth for the whole app. */
export const activeChain: Chain = CHAINS[chainKey] ?? baseSepolia;
