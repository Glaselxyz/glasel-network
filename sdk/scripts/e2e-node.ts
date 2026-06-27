/**
 * Full daemon e2e (Phase 3d).
 *
 * Deploys + sets up the protocol and commissions a computation via viem, then
 * runs the REAL GlaselOS Rust binary — which detects the ComputationRequested
 * event, decrypts the inputs with the cluster key, runs the (echo) circuit,
 * re-seals the result to the recipient, threshold-signs it, and submits it
 * on-chain. The SDK then watches the computation to completion and decrypts the
 * node-produced result, proving the off-chain ↔ on-chain ↔ SDK loop end-to-end.
 *
 * Run: bun run scripts/e2e-node.ts   (requires anvil, forge, and a built glaseld)
 */
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters,
  parseEventLogs, bytesToHex, type Hex, type Address, type WalletClient, type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { generateKeyPair, publicKeyFromPrivate } from "../src/x25519.js";
import { encodeValues, serializePayload, ORDER_SCHEMA } from "../src/codec.js";
import { encrypt, pubkeyToFieldPair } from "../src/crypto.js";
import { GlaselClient } from "../src/client.js";
import { tokenAbi, registryAbi, stakingAbi, clusterAbi, mxeAbi, compRegAbi, coordWriteAbi } from "./e2e-abi.js";

const RPC = "http://127.0.0.1:8545";
const CONTRACTS_DIR = new URL("../../contracts", import.meta.url).pathname;
const NODE_DIR = new URL("../../node", import.meta.url).pathname;
const GLASELD_BIN = `${NODE_DIR}/target/debug/glaseld`;
const CONFIDEVM_BIN = `${NODE_DIR}/target/debug/glaselvm`;
const TOML = `${CONTRACTS_DIR}/glaseld.e2e.toml`;
const CIRCUIT_BIN = `${CONTRACTS_DIR}/order_notional.e2e.bin`;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const MIN_STAKE = 10_000n * 10n ** 18n;
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;

let failures = 0;
const check = (ok: boolean, msg: string) => {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  // Cluster + recipient keys; encrypt an Order to the cluster.
  const cluster = generateKeyPair();
  const recipient = generateKeyPair();
  const order = {
    price: 4242n,
    quantity: 9n,
    side: false,
    buyerKey: bytesToHex(publicKeyFromPrivate(recipient.privateKey)),
  };
  // Per-job recipient sealing: the requester's pubkey rides as the first two
  // field elements; the node peels them off and seals the result back to it.
  const plaintext = [...pubkeyToFieldPair(recipient.publicKey), ...encodeValues(ORDER_SCHEMA, order)];
  const encInputs = serializePayload(encrypt(plaintext, cluster.publicKey));
  const clusterPub = bytesToHex(cluster.publicKey) as Hex;

  console.log("starting anvil…");
  const anvil = Bun.spawn(["anvil", "--silent", "--code-size-limit", "120000"], { stdout: "ignore", stderr: "ignore" });
  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;
  for (let i = 0; i < 60; i++) { try { await publicClient.getBlockNumber(); break; } catch { await sleep(250); } }

  try {
    console.log("deploying contracts…");
    const dep = Bun.spawn(["forge", "script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC, "--broadcast", "--private-key", KEYS[0]], {
      cwd: CONTRACTS_DIR, env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` }, stdout: "pipe", stderr: "pipe",
    });
    if ((await dep.exited) !== 0) { console.error(await new Response(dep.stderr).text()); throw new Error("deploy failed"); }
    const bc = JSON.parse(await Bun.file(`${CONTRACTS_DIR}/broadcast/Deploy.s.sol/31337/run-latest.json`).text());
    const proxies: Address[] = bc.transactions.filter((t: any) => t.contractName === "ERC1967Proxy" && t.transactionType === "CREATE").map((t: any) => t.contractAddress);
    const [token, registry, staking, clusterManager, mxeFactory, compRegistry, , coordinator] = proxies;

    const w = (i: number) => createWalletClient({ account: privateKeyToAccount(KEYS[i] as Hex), chain: foundry, transport: http(RPC) });
    const wallets = [w(0), w(1), w(2), w(3)];
    const addr = (i: number) => wallets[i]!.account!.address;
    const send = async (wc: WalletClient, p: any) => publicClient.waitForTransactionReceipt({ hash: await wc.writeContract({ ...p, chain: foundry, account: wc.account! }) });
    const ev = (r: any, abi: any, name: string, key: string) => (parseEventLogs({ abi, logs: r.logs, eventName: name })[0] as any).args[key] as Hex;

    // Seed + register + stake.
    const minter = (await publicClient.readContract({ address: token!, abi: tokenAbi, functionName: "MINTER_ROLE" })) as Hex;
    await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "grantRole", args: [minter, addr(0)] });
    for (let i = 1; i <= 3; i++) await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "mint", args: [addr(i), MIN_STAKE] });
    await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "mint", args: [addr(0), 1000n * 10n ** 18n] });
    for (let i = 1; i <= 3; i++) {
      const bls = new Uint8Array(48); bls[0] = i; bls[47] = i;
      await send(wallets[i]!, { address: registry, abi: registryAbi, functionName: "registerNode", args: [bytesToHex(bls), `0x${i.toString().padStart(64, "0")}`, ZERO32, "US"] });
      await send(wallets[i]!, { address: token, abi: tokenAbi, functionName: "approve", args: [staking, MIN_STAKE] });
      await send(wallets[i]!, { address: staking, abi: stakingAbi, functionName: "stake", args: [addr(i), MIN_STAKE] });
    }

    // Cluster (combined key = SDK cluster pubkey).
    const nodes = [addr(1), addr(2), addr(3)] as Address[];
    const prop = await send(wallets[1]!, { address: clusterManager, abi: clusterAbi, functionName: "proposeCluster", args: [nodes, 0, 2, addr(0)] });
    const clusterId = ev(prop, clusterAbi, "ClusterProposed", "clusterId");
    const actMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [clusterId, clusterPub]));
    const actSigs = (await wallets[1]!.signMessage({ account: wallets[1]!.account!, message: { raw: actMsg } })) + (await wallets[2]!.signMessage({ account: wallets[2]!.account!, message: { raw: actMsg } })).slice(2);
    await send(wallets[0]!, { address: clusterManager, abi: clusterAbi, functionName: "activateCluster", args: [clusterId, clusterPub, actSigs as Hex, [addr(1), addr(2)]] });

    // Compile + deploy the order_notional circuit via the glaselvm CLI.
    const cli = async (args: string[]) => {
      const p = Bun.spawn([CONFIDEVM_BIN, ...args], { stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
      if (code !== 0) throw new Error(`glaselvm ${args[0]} failed: ${err}`);
      return out;
    };
    await cli(["compile", "order_notional", "--out", CIRCUIT_BIN]);
    const deployOut = await cli(["deploy-circuit", CIRCUIT_BIN, "--rpc", RPC, "--private-key", KEYS[0], "--registry", compRegistry!]);
    const compDefId = (deployOut.match(/compDefId = (0x[0-9a-fA-F]{64})/) ?? [])[1] as Hex;
    check(!!compDefId, `glaselvm compiled + deployed order_notional circuit (${compDefId?.slice(0, 14)}…)`);
    const mxeR = await send(wallets[0]!, { address: mxeFactory, abi: mxeAbi, functionName: "createMXE", args: [clusterId, 0, [compDefId], ZERO32] });
    const mxeId = ev(mxeR, mxeAbi, "MXECreated", "mxeId");
    await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "approve", args: [coordinator, 2n ** 255n] });
    const comR = await send(wallets[0]!, { address: coordinator, abi: coordWriteAbi, functionName: "commission", args: [mxeId, compDefId, encInputs, "", ZERO, "0x00000000", 0n, 0n] });
    const computationId = ev(comR, coordWriteAbi, "ComputationRequested", "computationId");
    check(true, `computation commissioned (${computationId.slice(0, 14)}…) — not yet submitted`);

    // Write glaseld.toml and run the real daemon.
    const toml = `rpc_url = "${RPC}"
poll_interval_ms = 200
start_block = 0
run_once = true

[contracts]
coordinator = "${coordinator}"
cluster_manager = "${clusterManager}"
computation_registry = "${compRegistry}"

[cluster]
x25519_private_key = "${bytesToHex(cluster.privateKey)}"

[engine]
recipient_public_key = "${bytesToHex(recipient.publicKey)}"

[signers]
keys = ["${KEYS[1]}", "${KEYS[2]}"]
`;
    await Bun.write(TOML, toml);

    if (!(await Bun.file(GLASELD_BIN).exists())) throw new Error(`glaseld binary missing at ${GLASELD_BIN} — run: cargo build -p glaseld`);
    console.log("running GlaselOS daemon…");
    const node = Bun.spawn([GLASELD_BIN, TOML], { stdout: "pipe", stderr: "pipe" });
    const nodeCode = await Promise.race([node.exited, sleep(20000).then(() => "timeout")]);
    if (nodeCode === "timeout") { node.kill(); throw new Error("glaseld did not finish in 20s"); }
    const nodeLog =
      (await new Response(node.stdout).text()) + (await new Response(node.stderr).text());
    console.log("─── GlaselOS logs ───\n" + nodeLog + "──────────────────");
    check(nodeCode === 0, `GlaselOS exited cleanly`);

    // Verify via SDK: the NODE produced + submitted the result.
    const client = new GlaselClient({ publicClient, addresses: { coordinator: coordinator!, clusterManager: clusterManager!, mxeFactory: mxeFactory! } });
    const result = await client.watchComputation({ computationId, timeoutMs: 8000, pollMs: 250 });
    check(result.success, "computation Completed — submitted by the GlaselOS node");

    const decoded = client.decryptResult({ encResult: result.encResult, privateKey: recipient.privateKey, schema: ORDER_SCHEMA });
    // order_notional outputs [price*quantity, quantity, side, buyerKey] — so the
    // decoded "price" field carries the notional the NODE computed in-circuit.
    const expectedNotional = order.price * order.quantity; // 4242 * 9 = 38178
    check(decoded.price === expectedNotional, `node computed notional in-circuit: price*qty = ${expectedNotional}`);
    check(decoded.quantity === 9n && decoded.side === false, "quantity + side preserved by the circuit");
    check((decoded.buyerKey as string).toLowerCase() === order.buyerKey.toLowerCase(), "buyer key round-trips through the node");

    console.log(failures ? `\nNODE E2E FAILED (${failures})` : "\nNODE E2E PASSED");
  } finally {
    anvil.kill();
    try { await Bun.file(TOML).unlink?.(); } catch {}
  }
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
