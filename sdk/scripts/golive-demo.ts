/**
 * Glasel live demo — commission a real confidential job (developer's view).
 *
 * Assumes scripts/golive-wire.ts has stood up the cluster + MXE and the live
 * GlaselOS daemon is running on the node-1 droplet. This script plays the role
 * of a *developer* using the network:
 *
 *   1. generates its own X25519 recipient keypair (only it can read the result),
 *   2. encrypts an order to the CLUSTER key with `recipientPublicKey` prepended
 *      (so the live node seals the result back to this developer),
 *   3. commissions the computation on-chain,
 *   4. waits for the LIVE node to detect, compute (price*qty in-circuit), BLS-sign
 *      and submit the result, then
 *   5. decrypts the node-produced result and checks it.
 *
 * Run:  cd sdk && bun run scripts/golive-demo.ts
 */
import {
  createPublicClient, createWalletClient, http, parseEventLogs, bytesToHex,
  type Hex, type Address, type WalletClient, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { readFileSync } from "node:fs";
import { generateKeyPair, publicKeyFromPrivate } from "../src/x25519.js";
import { ORDER_SCHEMA } from "../src/codec.js";
import { GlaselClient } from "../src/client.js";
import { tokenAbi, coordWriteAbi } from "./e2e-abi.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const CONTRACTS_DIR = `${ROOT}/contracts`;
const STATE_PATH = `${CONTRACTS_DIR}/golive-state.json`;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;

function loadEnv(): { rpc: string; pk: Hex } {
  const raw = readFileSync(`${CONTRACTS_DIR}/.env`, "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) { const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/); if (m) env[m[1]!] = m[2]!; }
  const rpc = process.env.RPC_URL || env.RPC_URL || "https://sepolia.base.org";
  let pk = (process.env.PRIVATE_KEY || env.PRIVATE_KEY || "") as string;
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  return { rpc, pk: pk as Hex };
}
function loadAddresses(): Record<string, Address> {
  const bc = JSON.parse(readFileSync(`${CONTRACTS_DIR}/broadcast/Deploy.s.sol/84532/run-latest.json`, "utf8"));
  const px: Address[] = bc.transactions.filter((t: any) => t.contractName === "ERC1967Proxy" && t.transactionType === "CREATE").map((t: any) => t.contractAddress);
  const [token, registry, staking, clusterManager, mxeFactory, compRegistry, feeOracle, coordinator] = px;
  return { token, registry, staking, clusterManager, mxeFactory, compRegistry, feeOracle, coordinator } as Record<string, Address>;
}

async function main() {
  const { rpc, pk } = loadEnv();
  const A = loadAddresses();
  const state = JSON.parse(readFileSync(STATE_PATH, "utf8"));
  if (!state.mxeId || !state.compDefId || !state.clusterId) throw new Error("run golive-wire.ts first");

  const chain = baseSepolia;
  const publicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;
  const dev = privateKeyToAccount(pk); // the requester pays the fee + gas
  const devWallet = createWalletClient({ account: dev, chain, transport: http(rpc) });
  const send = async (wc: WalletClient, p: any) => {
    let gas: bigint | undefined;
    try { gas = await publicClient.estimateContractGas({ ...p, account: wc.account! } as any); gas = gas + gas * 6n / 10n; } catch {}
    const rc = await publicClient.waitForTransactionReceipt({ hash: await wc.writeContract({ ...p, chain, account: wc.account!, ...(gas ? { gas } : {}) }) });
    if (rc.status !== "success") throw new Error("tx reverted");
    return rc;
  };
  const ev = (rc: any, abi: any, name: string, key: string) => (parseEventLogs({ abi, logs: rc.logs, eventName: name })[0] as any).args[key] as Hex;

  const client = new GlaselClient({ publicClient, addresses: { coordinator: A.coordinator, clusterManager: A.clusterManager, mxeFactory: A.mxeFactory } });

  // 1. Developer's own recipient key — only this key can decrypt the result.
  const recipient = generateKeyPair();

  // 2. Encrypt to the live cluster key, sealing the result back to ourselves.
  const clusterKey = await client.getClusterPublicKey(state.clusterId);
  console.log(`Cluster key    : ${bytesToHex(clusterKey)}`);
  const order = { price: 4242n, quantity: 9n, side: false, buyerKey: bytesToHex(publicKeyFromPrivate(recipient.privateKey)) };
  const { encInputs } = client.encrypt({ schema: ORDER_SCHEMA, value: order, clusterKey, recipientPublicKey: recipient.publicKey });

  // 3. Commission on-chain.
  await send(devWallet, { address: A.token, abi: tokenAbi, functionName: "approve", args: [A.coordinator, 2n ** 255n] });
  const comRc = await send(devWallet, { address: A.coordinator, abi: coordWriteAbi, functionName: "commission", args: [state.mxeId, state.compDefId, encInputs, "", ZERO, "0x00000000", 0n, 0n] });
  const computationId = ev(comRc, coordWriteAbi, "ComputationRequested", "computationId");
  console.log(`\n🛰  Commissioned ${computationId}`);
  console.log(`   order: price=${order.price} quantity=${order.quantity} side=${order.side}`);
  console.log(`   waiting for the live node to compute + submit…`);

  // 4. Wait for the LIVE daemon to serve it.
  const t0 = Date.now();
  const res = await client.watchComputation({ computationId, timeoutMs: 180_000, pollMs: 3000 });
  if (!res.success) { console.error(`\n❌ computation did not complete (status ${res.status})`); process.exit(1); }
  console.log(`\n✅ Completed by the live node in ${((Date.now() - t0) / 1000).toFixed(0)}s`);

  // 5. Decrypt — only our recipient key can read it.
  const decoded = client.decryptResult({ encResult: res.encResult, privateKey: recipient.privateKey, schema: ORDER_SCHEMA });
  const expected = order.price * order.quantity; // order_notional: price field carries price*qty
  const ok = decoded.price === expected && decoded.quantity === 9n && decoded.side === false
    && (decoded.buyerKey as string).toLowerCase() === order.buyerKey.toLowerCase();
  console.log(`   decrypted notional (price*qty) = ${decoded.price}  (expected ${expected})`);
  console.log(`   quantity=${decoded.quantity} side=${decoded.side}`);
  console.log(ok ? `\n🎉 LIVE NETWORK VERIFIED — node computed on encrypted data, only the developer could read the result.`
                 : `\n❌ result mismatch`);
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
