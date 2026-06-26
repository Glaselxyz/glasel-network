/**
 * Cross-stack end-to-end check (Phase 2d).
 *
 * Deploys the protocol with `forge script Deploy` (addresses are read from the
 * broadcast artifact), then drives the full lifecycle from viem — reading each
 * id (clusterId, mxeId, compDefId, computationId) from its emitted event before
 * use, and signing activation/result messages with EIP-191 (which matches the
 * contract's `toEthSignedMessageHash`). Finally the @glasel/client SDK reads
 * the cluster key back, watches the computation to completion, and decrypts the
 * on-chain result — proving the SDK works against real chain state.
 *
 * Run: bun run scripts/e2e.ts   (requires `anvil` and `forge` on PATH)
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseEventLogs,
  bytesToHex,
  type Hex,
  type Address,
  type WalletClient,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { generateKeyPair, publicKeyFromPrivate } from "../src/x25519.js";
import { encodeValues, serializePayload, ORDER_SCHEMA } from "../src/codec.js";
import { seal } from "../src/crypto.js";
import { GlaselClient } from "../src/client.js";
import {
  tokenAbi,
  registryAbi,
  stakingAbi,
  clusterAbi,
  mxeAbi,
  compRegAbi,
  coordWriteAbi,
} from "./e2e-abi.js";
import { blsSign, blsGroupKey } from "./bls.js";

const RPC = "http://127.0.0.1:8545";
const CONTRACTS_DIR = new URL("../../contracts", import.meta.url).pathname;
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const MIN_STAKE = 10_000n * 10n ** 18n;

// anvil default funded keys
const KEYS = [
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
] as const;

let failures = 0;
function check(ok: boolean, msg: string) {
  console.log(`${ok ? "✓" : "✗"} ${msg}`);
  if (!ok) failures++;
}

async function waitUp(pc: PublicClient, ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      await pc.getBlockNumber();
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  return false;
}

async function main() {
  // ── SDK-side keys + sealed trade ──────────────────────────────────────────
  const cluster = generateKeyPair();
  const recipient = generateKeyPair();
  const trade = {
    price: 1000n,
    quantity: 7n,
    side: true,
    buyerKey: bytesToHex(publicKeyFromPrivate(recipient.privateKey)),
  };
  const encResult = serializePayload(seal(encodeValues(ORDER_SCHEMA, trade), recipient.publicKey));
  const clusterPub = bytesToHex(cluster.publicKey) as Hex; // 32 bytes -> bytes32

  // ── anvil ───────────────────────────────────────────────────────────────────
  console.log("starting anvil…");
  const anvil = Bun.spawn(["anvil", "--silent", "--code-size-limit", "120000"], {
    stdout: "ignore",
    stderr: "ignore",
  });

  const publicClient = createPublicClient({ chain: foundry, transport: http(RPC) }) as PublicClient;
  if (!(await waitUp(publicClient))) {
    anvil.kill();
    throw new Error("anvil did not start");
  }

  try {
    // ── Deploy via forge ──────────────────────────────────────────────────────
    console.log("deploying contracts (forge script Deploy)…");
    const deploy = Bun.spawn(
      ["forge", "script", "script/Deploy.s.sol:Deploy", "--rpc-url", RPC, "--broadcast", "--private-key", KEYS[0]],
      {
        cwd: CONTRACTS_DIR,
        env: { ...process.env, PATH: `${process.env.HOME}/.foundry/bin:${process.env.PATH}` },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    if ((await deploy.exited) !== 0) {
      console.error(await new Response(deploy.stderr).text());
      throw new Error("forge deploy failed");
    }

    const broadcast = JSON.parse(
      await Bun.file(`${CONTRACTS_DIR}/broadcast/Deploy.s.sol/31337/run-latest.json`).text(),
    );
    const proxies: Address[] = broadcast.transactions
      .filter((t: any) => t.contractName === "ERC1967Proxy" && t.transactionType === "CREATE")
      .map((t: any) => t.contractAddress as Address);
    const [token, registry, staking, clusterManager, mxeFactory, compRegistry, , coordinator] = proxies;
    check(proxies.length === 8, `forge deployed 8 proxies`);

    // ── viem wallets ────────────────────────────────────────────────────────────
    const w = (i: number) =>
      createWalletClient({ account: privateKeyToAccount(KEYS[i] as Hex), chain: foundry, transport: http(RPC) });
    const wallets = [w(0), w(1), w(2), w(3)];
    const addr = (i: number) => wallets[i]!.account!.address;

    const send = async (wc: WalletClient, p: any) => {
      const hash = await wc.writeContract({ ...p, chain: foundry, account: wc.account! });
      return publicClient.waitForTransactionReceipt({ hash });
    };
    const eventArg = (receipt: any, abi: any, eventName: string, key: string) =>
      (parseEventLogs({ abi, logs: receipt.logs, eventName })[0] as any).args[key] as Hex;

    // ── Seed: minter + balances ──────────────────────────────────────────────────
    const minterRole = (await publicClient.readContract({ address: token!, abi: tokenAbi, functionName: "MINTER_ROLE" })) as Hex;
    await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "grantRole", args: [minterRole, addr(0)] });
    for (let i = 1; i <= 3; i++)
      await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "mint", args: [addr(i), MIN_STAKE] });
    await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "mint", args: [addr(0), 1000n * 10n ** 18n] });

    // ── Register + stake nodes ────────────────────────────────────────────────────
    for (let i = 1; i <= 3; i++) {
      const bls = new Uint8Array(48);
      bls[0] = i;
      bls[47] = i;
      await send(wallets[i]!, { address: registry, abi: registryAbi, functionName: "registerNode", args: [bytesToHex(bls), `0x${i.toString().padStart(64, "0")}`, ZERO32, "US"] });
      await send(wallets[i]!, { address: token, abi: tokenAbi, functionName: "approve", args: [staking, MIN_STAKE] });
      await send(wallets[i]!, { address: staking, abi: stakingAbi, functionName: "stake", args: [addr(i), MIN_STAKE] });
    }

    // ── Propose + activate cluster ──────────────────────────────────────────────────
    const nodes = [addr(1), addr(2), addr(3)] as Address[];
    const propRcpt = await send(wallets[1]!, { address: clusterManager, abi: clusterAbi, functionName: "proposeCluster", args: [nodes, 0, 2, addr(0)] });
    const clusterId = eventArg(propRcpt, clusterAbi, "ClusterProposed", "clusterId");

    const actMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [clusterId, clusterPub]));
    const actSigs = await sign2(wallets, actMsg);
    await send(wallets[0]!, { address: clusterManager, abi: clusterAbi, functionName: "activateCluster", args: [clusterId, clusterPub, actSigs, [addr(1), addr(2)]] });
    // Register the cluster's BLS group key (the sole result path is BLS).
    await send(wallets[0]!, { address: clusterManager, abi: clusterAbi, functionName: "setBlsGroupKey", args: [clusterId, blsGroupKey()] });
    check(true, `cluster proposed + activated + BLS group key set (${clusterId.slice(0, 14)}…)`);

    // ── Deploy circuit + MXE ──────────────────────────────────────────────────────────
    const defRcpt = await send(wallets[0]!, { address: compRegistry, abi: compRegAbi, functionName: "deployComputationDefinition", args: ["0xabcdef", "", 50_000, 2, 1] });
    const compDefId = eventArg(defRcpt, compRegAbi, "ComputationDefinitionDeployed", "compDefId");
    const mxeRcpt = await send(wallets[0]!, { address: mxeFactory, abi: mxeAbi, functionName: "createMXE", args: [clusterId, 0, [compDefId], ZERO32] });
    const mxeId = eventArg(mxeRcpt, mxeAbi, "MXECreated", "mxeId");

    // ── Commission + submit result ────────────────────────────────────────────────────
    await send(wallets[0]!, { address: token, abi: tokenAbi, functionName: "approve", args: [coordinator, 2n ** 255n] });
    const comRcpt = await send(wallets[0]!, { address: coordinator, abi: coordWriteAbi, functionName: "commission", args: [mxeId, compDefId, "0x00", "", ZERO, "0x00000000", 0n, 0n] });
    const computationId = eventArg(comRcpt, coordWriteAbi, "ComputationRequested", "computationId");

    const resMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes" }], [computationId, encResult]));
    const { sig } = blsSign(resMsg); // one aggregated BN254 signature
    await send(wallets[0]!, { address: coordinator, abi: coordWriteAbi, functionName: "submitResult", args: [computationId, encResult, sig] });
    check(true, `computation commissioned + result submitted (${computationId.slice(0, 14)}…)`);

    // ── SDK assertions against live chain ───────────────────────────────────────────────
    const client = new GlaselClient({ publicClient, addresses: { coordinator: coordinator!, clusterManager: clusterManager!, mxeFactory: mxeFactory! } });

    const onChainKey = await client.getClusterPublicKey(clusterId);
    check(bytesToHex(onChainKey) === clusterPub, "SDK reads cluster public key back, matches");

    const keyViaMxe = await client.getClusterPublicKeyForMXE(mxeId);
    check(bytesToHex(keyViaMxe) === clusterPub, "SDK resolves cluster key via MXE id");

    const result = await client.watchComputation({ computationId, timeoutMs: 8000, pollMs: 250 });
    check(result.success, "SDK watchComputation reports Completed");
    check(result.encResult.toLowerCase() === encResult.toLowerCase(), "on-chain encResult matches sealed bytes");

    const decoded = client.decryptResult({ encResult: result.encResult, privateKey: recipient.privateKey, schema: ORDER_SCHEMA });
    check(decoded.price === 1000n && decoded.quantity === 7n && decoded.side === true, "SDK decrypts result == original trade");
    check((decoded.buyerKey as string).toLowerCase() === trade.buyerKey.toLowerCase(), "sealed recipient key round-trips");

    console.log(failures ? `\nE2E FAILED (${failures})` : "\nE2E PASSED");
  } finally {
    anvil.kill();
  }
  process.exit(failures ? 1 : 0);
}

/** Sign `message` (raw bytes32, EIP-191) with node keys 1 and 2; concat to 130 bytes. */
async function sign2(wallets: WalletClient[], message: Hex): Promise<Hex> {
  const s1 = await wallets[1]!.signMessage({ account: wallets[1]!.account!, message: { raw: message } });
  const s2 = await wallets[2]!.signMessage({ account: wallets[2]!.account!, message: { raw: message } });
  return (s1 + s2.slice(2)) as Hex;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
