/**
 * Glasel quickstart — run a confidential computation on the live testnet.
 *
 * A complete, copy-pasteable example: it encrypts an order, commissions it on the
 * live Glasel network (Base Sepolia), waits for a node to compute price*quantity
 * WITHOUT ever seeing your data, and decrypts the result — which only your key can
 * read. Runs against the deployed `order_notional` MXE, so you don't deploy any
 * contracts to try it.
 *
 *   npm install @glasel/client viem
 *   export PRIVATE_KEY=0x...        # a Base Sepolia key with ETH for gas
 *   export RPC_URL=https://...      # optional; defaults to the public node
 *   node quickstart.mjs
 *
 * Jobs are FREE on the testnet — you only need Base Sepolia ETH for gas (from a
 * public ETH faucet). No GLASEL token required.
 */
import { createPublicClient, createWalletClient, http, parseEventLogs, bytesToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { GlaselClient, ORDER_SCHEMA, generateKeyPair, publicKeyFromPrivate } from "@glasel/client";

// ── Live deployment (Base Sepolia) — see docs/COMPATIBILITY.md ────────────────
const addresses = {
  coordinator: "0x1FbB367715D26F752357dc7ee60b957CB40d8452",
  clusterManager: "0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523",
  mxeFactory: "0x7CE839Eea76EA1F2F808E4c831a0910A23425f30",
  token: "0xa9E29104Fa0287db5bb5BB048a729C93f746b09C",
};
const clusterId = "0xdcc20d23e53232465d569e2498bb798a6f7e3b54b5f9d16ad2b0b0d2ba1eefe2";
const mxeId = "0xd225ab0f770065fa35a9d279cc02d5397646a09d3801c803133ddec7fdfc2690";
const compDefId = "0x3f9bbaa3c6563b5fe2b5a39b70fd8fc7c98f855bc85650470bd5e65b54c65eb9";
const ZERO = "0x0000000000000000000000000000000000000000";

// Minimal ABI fragment for the commission write (the SDK doesn't wrap it yet).
const coordinatorWriteAbi = [
  { type: "function", name: "commission", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }, { type: "string" }, { type: "address" }, { type: "bytes4" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "event", name: "ComputationRequested", inputs: [{ name: "computationId", type: "bytes32", indexed: true }, { name: "mxeId", type: "bytes32", indexed: true }, { name: "compDefId", type: "bytes32", indexed: true }, { name: "encInputs", type: "bytes", indexed: false }, { name: "inputIpfsCid", type: "string", indexed: false }, { name: "deadline", type: "uint64", indexed: false }] },
];

const RPC_URL = process.env.RPC_URL || "https://sepolia.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) throw new Error("set PRIVATE_KEY (a Base Sepolia key with GLASEL + ETH)");

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) });
const account = privateKeyToAccount(PRIVATE_KEY);
const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) });
const glasel = new GlaselClient({ publicClient, addresses });

// OP-stack gas estimation runs tight for fresh txs; add a 60% buffer.
async function send(p) {
  let gas;
  try { gas = await publicClient.estimateContractGas({ ...p, account }); gas += (gas * 6n) / 10n; } catch {}
  const hash = await wallet.writeContract({ ...p, account, chain: baseSepolia, ...(gas ? { gas } : {}) });
  return publicClient.waitForTransactionReceipt({ hash });
}

async function main() {
  console.log("Requester:", account.address);

  // 1. Your own result key — only this private key can read the result.
  const recipient = generateKeyPair();

  // 2. Encrypt your inputs to the cluster, sealed back to you.
  const clusterKey = await glasel.getClusterPublicKey(clusterId);
  const order = {
    price: 1500n,
    quantity: 4n,
    side: false,
    buyerKey: bytesToHex(publicKeyFromPrivate(recipient.privateKey)),
  };
  const { encInputs } = glasel.encrypt({
    schema: ORDER_SCHEMA,
    value: order,
    clusterKey,
    recipientPublicKey: recipient.publicKey, // seal the result to me
  });
  console.log(`Order: price=${order.price} quantity=${order.quantity} (encrypted)`);

  // 3. Commission the computation on-chain. Jobs are free on the testnet, so
  //    there's no fee token to approve — you just pay gas.
  const rc = await send({
    address: addresses.coordinator, abi: coordinatorWriteAbi, functionName: "commission",
    args: [mxeId, compDefId, encInputs, "", ZERO, "0x00000000", 0n, 0n],
  });
  const { computationId } = parseEventLogs({ abi: coordinatorWriteAbi, logs: rc.logs, eventName: "ComputationRequested" })[0].args;
  console.log("Commissioned:", computationId);

  // 4. Wait for a node to compute it, then decrypt.
  const result = await glasel.watchComputation({ computationId, timeoutMs: 120_000, pollMs: 3000 });
  if (!result.success) throw new Error(`computation did not complete (status ${result.status})`);
  const decoded = glasel.decryptResult({ encResult: result.encResult, privateKey: recipient.privateKey, schema: ORDER_SCHEMA });

  console.log(`\n✅ notional (price*quantity) = ${decoded.price}  (expected ${order.price * order.quantity})`);
  console.log("The node computed on your encrypted data; only your key decrypted the result.");
}

main().catch((e) => { console.error(e); process.exit(1); });
