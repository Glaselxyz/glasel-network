/**
 * Set the network fee policy on the live FeeOracle (admin / PARAM_ROLE).
 *
 *   bun run scripts/set-fees.ts free      # jobs cost 0 — devs need only Base ETH for gas
 *   bun run scripts/set-fees.ts default   # restore the default GLASEL fee schedule
 *
 * "free" zeroes feePerKGates, minFee, and glaselPerGasWei so estimateFee() == 0
 * for any circuit and any callback — no GLASEL is ever pulled from a requester.
 */
import { createPublicClient, createWalletClient, http, parseEther, type Hex, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolveChain, defaultRpc } from "./chain.js";

const chain = resolveChain();
const ROOT = new URL("../..", import.meta.url).pathname;
// Base Sepolia defaults; override with FEE_ORACLE / COMP_DEF on other chains.
const FEE_ORACLE = (process.env.FEE_ORACLE ?? "0x0d3cCA64CaAC0b9c1CBaE9420898A33d8b3615Fc") as Address;
const COMP_DEF = (process.env.COMP_DEF ?? "0x3f9bbaa3c6563b5fe2b5a39b70fd8fc7c98f855bc85650470bd5e65b54c65eb9") as Hex; // order_notional

const feeOracleAbi = [
  { type: "function", name: "setFeeParams", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "estimateFee", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const mode = process.argv[2] ?? "free";
// feePerKGates, callbackGasPremium, minFee, maxFee, glaselPerGasWei
const params: [bigint, bigint, bigint, bigint, bigint] =
  mode === "free"
    ? [0n, 120n, 0n, parseEther("10000"), 0n]
    : [parseEther("0.1"), 120n, parseEther("0.5"), parseEther("10000"), 1n];

function loadEnv() {
  const raw = readFileSync(`${ROOT}/contracts/.env`, "utf8");
  const rpc = process.env.RPC_URL || (raw.match(/RPC_URL=(.+)/)?.[1] ?? defaultRpc(chain)).trim();
  let pk = (raw.match(/PRIVATE_KEY=(.+)/)?.[1] ?? "").trim();
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  return { rpc, pk: pk as Hex };
}

async function main() {
  const { rpc, pk } = loadEnv();
  const publicClient = createPublicClient({ chain, transport: http(rpc) });
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({ account, chain, transport: http(rpc) });

  console.log(`Mode: ${mode} → setFeeParams(${params.join(", ")})`);
  let gas: bigint | undefined;
  try { gas = await publicClient.estimateContractGas({ address: FEE_ORACLE, abi: feeOracleAbi, functionName: "setFeeParams", args: params, account }); gas += gas / 2n; } catch {}
  const hash = await wallet.writeContract({ address: FEE_ORACLE, abi: feeOracleAbi, functionName: "setFeeParams", args: params, chain, account, ...(gas ? { gas } : {}) });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error("setFeeParams reverted");
  console.log(`setFeeParams tx: ${hash}`);

  const fee = await publicClient.readContract({ address: FEE_ORACLE, abi: feeOracleAbi, functionName: "estimateFee", args: [COMP_DEF, 0n] });
  console.log(`estimateFee(order_notional, 0) = ${fee}  ${fee === 0n ? "→ jobs are FREE (gas only)" : "→ GLASEL fee applies"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
