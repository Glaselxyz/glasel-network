/**
 * Grant MINTER_ROLE on GlaselToken to an address (admin / DEFAULT_ADMIN_ROLE).
 * Used to authorize the faucet wallet to dispense test GLASEL.
 *
 *   bun run scripts/grant-minter.ts 0x<address>
 */
import { createPublicClient, createWalletClient, http, getAddress, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";

const TOKEN = "0xa9E29104Fa0287db5bb5BB048a729C93f746b09C" as Address; // GlaselToken
const tokenAbi = [
  { type: "function", name: "MINTER_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  { type: "function", name: "hasRole", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [{ type: "bool" }] },
] as const;

const target = getAddress(process.argv[2] ?? "");
const ROOT = new URL("../..", import.meta.url).pathname;
const env = readFileSync(`${ROOT}/contracts/.env`, "utf8");
const rpc = process.env.RPC_URL || (env.match(/RPC_URL=(.+)/)?.[1] ?? "https://sepolia.base.org").trim();
let pk = (env.match(/PRIVATE_KEY=(.+)/)?.[1] ?? "").trim();
if (!pk.startsWith("0x")) pk = `0x${pk}`;

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(rpc) });
const account = privateKeyToAccount(pk as Hex);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(rpc) });

const MINTER = (await publicClient.readContract({ address: TOKEN, abi: tokenAbi, functionName: "MINTER_ROLE" })) as Hex;
const already = await publicClient.readContract({ address: TOKEN, abi: tokenAbi, functionName: "hasRole", args: [MINTER, target] });
if (already) {
  console.log(`${target} already has MINTER_ROLE — nothing to do.`);
} else {
  const hash = await wallet.writeContract({ address: TOKEN, abi: tokenAbi, functionName: "grantRole", args: [MINTER, target], chain: baseSepolia, account });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("grantRole reverted");
  console.log(`Granted MINTER_ROLE to ${target}\n  tx: ${hash}`);
}
