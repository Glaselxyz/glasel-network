/**
 * Post-GLS-cutover e2e: commission the live demo job through the NEW
 * ComputationCoordinator (GLS-denominated) and confirm the droplet daemon
 * serves it against the unchanged cluster/MXE/circuit. Fees are free, so no GLS
 * is needed — only ETH gas for the commission tx.
 *
 * Run: node scripts/gls-e2e.mjs   (needs MAINNET_PRIVATE_KEY in contracts/.env)
 */
import { readFileSync } from "node:fs";
import {
  createPublicClient, createWalletClient, http, defineChain,
  bytesToHex, parseEventLogs,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { GlaselClient, ORDER_SCHEMA, generateKeyPair, publicKeyFromPrivate } from "../dist/index.js";

const chain = defineChain({
  id: 4663, name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});

// NEW GLS-denominated deployment.
const COORDINATOR = "0xf90C73ad8D700115afd8175eB2C1953C80d45157";
const CLUSTER_MANAGER = "0xcfC7f9dc4C311207B0Aa6DaF7DaDc63f6DbFA79b";
const MXE_FACTORY = "0x0Ee8170F29D0590B08D879Baa5e4AEc27Ae7d0eD";
// Existing live demo MXE + circuit (unchanged).
const MXE_ID = "0x50efc3d07c4b042b06260c7b5de822c9961e9576ce1a8054fe9f50ba42bb1a66";
const COMP_DEF_ID = "0x2cef4b58d6963e92e8fd548d87c02ffd37472b3201c8d2bdb6a4377fed01ae64";
const ZERO = "0x0000000000000000000000000000000000000000";

const coordinatorAbi = [
  { type: "function", name: "commission", stateMutability: "nonpayable",
    inputs: [
      { name: "mxeId", type: "bytes32" }, { name: "compDefId", type: "bytes32" },
      { name: "encInputs", type: "bytes" }, { name: "inputIpfsCid", type: "string" },
      { name: "callbackTarget", type: "address" }, { name: "callbackSelector", type: "bytes4" },
      { name: "callbackGasLimit", type: "uint256" }, { name: "maxFee", type: "uint256" },
    ], outputs: [{ type: "bytes32" }] },
  { type: "event", name: "ComputationRequested",
    inputs: [
      { name: "computationId", type: "bytes32", indexed: true },
      { name: "mxeId", type: "bytes32", indexed: true },
      { name: "compDefId", type: "bytes32", indexed: true },
      { name: "encInputs", type: "bytes", indexed: false },
      { name: "inputIpfsCid", type: "string", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
    ] },
];

const pkLine = readFileSync(new URL("../../contracts/.env", import.meta.url), "utf8")
  .split("\n").find((l) => l.startsWith("MAINNET_PRIVATE_KEY="));
let pk = (pkLine?.split("=")[1] ?? "").trim().replace(/^["']|["']$/g, "");
if (!pk.startsWith("0x")) pk = "0x" + pk;

const account = privateKeyToAccount(pk);
const publicClient = createPublicClient({ chain, transport: http() });
const wallet = createWalletClient({ account, chain, transport: http() });
const glasel = new GlaselClient({
  publicClient,
  addresses: { coordinator: COORDINATOR, clusterManager: CLUSTER_MANAGER, mxeFactory: MXE_FACTORY },
});

async function send(params) {
  let gas;
  try { gas = await publicClient.estimateContractGas({ ...params, account }); gas += (gas * 6n) / 10n; } catch {}
  const hash = await wallet.writeContract({ ...params, account, chain, ...(gas ? { gas } : {}) });
  const rc = await publicClient.waitForTransactionReceipt({ hash });
  if (rc.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return rc;
}

const me = generateKeyPair();
const clusterKey = await glasel.getClusterPublicKeyForMXE(MXE_ID);
const order = { price: 1000n, quantity: 7n, side: false, buyerKey: bytesToHex(publicKeyFromPrivate(me.privateKey)) };
const { encInputs } = glasel.encrypt({ schema: ORDER_SCHEMA, clusterKey, value: order, recipientPublicKey: me.publicKey });

console.error(`Requester : ${account.address}`);
console.error(`Coordinator (new, GLS): ${COORDINATOR}`);
const rc = await send({
  address: COORDINATOR, abi: coordinatorAbi, functionName: "commission",
  args: [MXE_ID, COMP_DEF_ID, encInputs, "", ZERO, "0x00000000", 0n, 0n],
});
const computationId = parseEventLogs({ abi: coordinatorAbi, logs: rc.logs, eventName: "ComputationRequested" })[0].args.computationId;
console.error(`🛰  Commissioned ${computationId} (tx ${rc.transactionHash})`);
console.error(`   waiting for the droplet daemon to serve it…`);

const t0 = Date.now();
const res = await glasel.watchComputation({ computationId, timeoutMs: 180_000, pollMs: 3000 });
if (!res.success) throw new Error(`computation did not complete (status ${res.status})`);
const decoded = glasel.decryptResult({ encResult: res.encResult, privateKey: me.privateKey, schema: ORDER_SCHEMA });
const expected = order.price * order.quantity;
console.error(`✅ served in ${((Date.now() - t0) / 1000).toFixed(0)}s — notional = ${decoded.price} (expected ${expected})`);
if (decoded.price !== expected) throw new Error("result mismatch");
console.error(`🎉 New GLS-denominated Coordinator is live and serving.`);
