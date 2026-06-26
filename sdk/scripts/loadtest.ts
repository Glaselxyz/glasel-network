/**
 * Load test — fire N concurrent computations and report latency percentiles +
 * throughput, the SLA metrics from architecture §13.
 *
 *   MXE_ID=0x… COMP_DEF_ID=0x… CONCURRENCY=50 bun run scripts/loadtest.ts
 *
 * Requires a deployed protocol with an active cluster + MXE + computation
 * definition (run scripts/testnet.ts once to create them, then pass their ids).
 * Reads the deployer key + RPC from contracts/.env and addresses from the
 * broadcast artifact.
 */
import { createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters, parseEventLogs, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { coordWriteAbi } from "./e2e-abi.js";
import { blsSign } from "./bls.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const env = Object.fromEntries(
  readFileSync(`${ROOT}/contracts/.env`, "utf8").split("\n").filter((l) => l.includes("=")).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, "")];
  }),
);
const RPC = env.RPC_URL || "https://sepolia.base.org";
const account = privateKeyToAccount(env.PRIVATE_KEY as Hex);

const bc = JSON.parse(readFileSync(`${ROOT}/contracts/broadcast/Deploy.s.sol/84532/run-latest.json`, "utf8"));
const proxies = bc.transactions.filter((t: any) => t.contractName === "ERC1967Proxy").map((t: any) => t.contractAddress);
const coordinator = proxies[7] as Hex; // deploy order: token..coordinator

const MXE_ID = process.env.MXE_ID as Hex;
const COMP_DEF_ID = process.env.COMP_DEF_ID as Hex;
const N = Number(process.env.CONCURRENCY || "20");
if (!MXE_ID || !COMP_DEF_ID) throw new Error("set MXE_ID and COMP_DEF_ID (from a testnet.ts run)");

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) });
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC) });
const ZERO = "0x0000000000000000000000000000000000000000" as Hex;

async function oneComputation(i: number): Promise<number> {
  const t0 = Date.now();
  const encInputs = ("0x" + (i % 256).toString(16).padStart(2, "0")) as Hex;
  // commission
  const hash = await wallet.writeContract({
    address: coordinator, abi: coordWriteAbi, functionName: "commission",
    args: [MXE_ID, COMP_DEF_ID, encInputs, "", ZERO, "0x00000000", 0n, 0n],
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  const reqLog = parseEventLogs({ abi: coordWriteAbi, logs: rcpt.logs, eventName: "ComputationRequested" })[0] as any;
  const computationId = reqLog.args.computationId as Hex;
  // submit a BLS result
  const encResult = "0xcafe" as Hex;
  const msg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes" }], [computationId, encResult]));
  const { sig } = blsSign(msg);
  const sh = await wallet.writeContract({
    address: coordinator, abi: coordWriteAbi, functionName: "submitResult", args: [computationId, encResult, sig],
  });
  await publicClient.waitForTransactionReceipt({ hash: sh });
  return Date.now() - t0;
}

function pct(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function main() {
  console.log(`load test: ${N} concurrent computations against ${coordinator}`);
  const start = Date.now();
  const settled = await Promise.allSettled(Array.from({ length: N }, (_, i) => oneComputation(i)));
  const wall = (Date.now() - start) / 1000;

  const ok = settled.filter((s) => s.status === "fulfilled").map((s) => (s as PromiseFulfilledResult<number>).value);
  const failed = settled.length - ok.length;
  ok.sort((a, b) => a - b);

  console.log(`\n── results ──`);
  console.log(`  completed   ${ok.length}/${N}  (${failed} failed)`);
  console.log(`  throughput  ${(ok.length / wall).toFixed(2)} computations/s  (${wall.toFixed(1)}s wall)`);
  if (ok.length) {
    console.log(`  latency p50 ${pct(ok, 50)}ms  p95 ${pct(ok, 95)}ms  p99 ${pct(ok, 99)}ms  max ${ok[ok.length - 1]}ms`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
