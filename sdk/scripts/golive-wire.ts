/**
 * Glasel live cluster bring-up — on-chain wiring (run once / idempotent).
 *
 * Stands up a REAL, persistent cluster on Base Sepolia that the live GlaselOS
 * daemon (running on a DigitalOcean droplet) serves. Unlike scripts/testnet.ts
 * (which models the node itself and dissolves the cluster at the end), this:
 *
 *   1. registers + stakes the 3 node operator accounts (idempotent),
 *   2. proposes + activates a cluster whose combined X25519 public key is the
 *      key the *daemon* holds the private half of (persisted in golive-state.json
 *      so the daemon config and chain agree across reruns),
 *   3. registers the cluster's BN254 BLS group key (setBlsGroupKey),
 *   4. compiles + deploys the real `order_notional` circuit (glaselvm),
 *   5. creates an MXE binding the cluster + circuit,
 *   6. funds the node submitter account with gas, and
 *   7. writes glaseld.toml (daemon config) + golive-state.json,
 *
 * then LEAVES THE CLUSTER ACTIVE so the live daemon can serve jobs commissioned
 * by any developer (see scripts/golive-demo.ts).
 *
 * Run:  cd sdk && bun run scripts/golive-wire.ts
 */
import {
  createPublicClient, createWalletClient, http, keccak256, encodeAbiParameters,
  parseEventLogs, bytesToHex, toHex, parseEther, formatEther,
  type Hex, type Address, type WalletClient, type PublicClient,
} from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolveChain, defaultRpc, broadcastDir, chainFile } from "./chain.js";
import { generateKeyPair } from "../src/x25519.js";

const chain = resolveChain();
import {
  tokenAbi, registryAbi, stakingAbi, clusterAbi, mxeAbi, coordWriteAbi,
} from "./e2e-abi.js";
import { randomGroupSecret, groupKeyForSecret } from "./bls.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const CONTRACTS_DIR = `${ROOT}/contracts`;
const NODE_DIR = `${ROOT}/node`;
const CONFIDEVM_BIN = `${NODE_DIR}/target/debug/glaselvm`;
const STATE_PATH = chainFile(CONTRACTS_DIR, "golive-state", "json", chain);
const TOML_PATH = chainFile(CONTRACTS_DIR, "glaseld.golive", "toml", chain);
const CIRCUIT_BIN = `${CONTRACTS_DIR}/order_notional.golive.bin`;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const MIN_STAKE = 10_000n * 10n ** 18n;

// ── extra ABIs (isActive / setBlsGroupKey) ───────────────────────────────────
const clusterExtraAbi = [
  ...clusterAbi,
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;
const stakingViewAbi = [
  { type: "function", name: "getStakeInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "selfStaked", type: "uint256" }, { name: "delegatedStake", type: "uint256" }, { name: "totalStake", type: "uint256" },
    { name: "reputationScore", type: "uint256" }, { name: "computationsCompleted", type: "uint256" }, { name: "computationsFailed", type: "uint256" },
    { name: "accumulatedRewards", type: "uint256" }, { name: "pendingSlash", type: "uint256" },
  ] }] },
] as const;
const registerSimAbi = [
  { type: "function", name: "registerNode", stateMutability: "nonpayable", inputs: [{ type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }, { type: "string" }], outputs: [] },
  { type: "error", name: "AlreadyRegistered", inputs: [] },
  { type: "error", name: "BlsKeyAlreadyRegistered", inputs: [] },
] as const;

function loadEnv(): { rpc: string; pk: Hex } {
  const raw = readFileSync(`${CONTRACTS_DIR}/.env`, "utf8");
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
    if (m) env[m[1]!] = m[2]!;
  }
  const rpc = process.env.RPC_URL || env.RPC_URL || defaultRpc(chain);
  let pk = (process.env.PRIVATE_KEY || env.PRIVATE_KEY || "") as string;
  if (!pk.startsWith("0x")) pk = `0x${pk}`;
  if (pk.length !== 66) throw new Error("PRIVATE_KEY missing/invalid in contracts/.env");
  return { rpc, pk: pk as Hex };
}

function loadAddresses(): Record<string, Address> {
  const path = broadcastDir(CONTRACTS_DIR, chain);
  const bc = JSON.parse(readFileSync(path, "utf8"));
  const proxies: Address[] = bc.transactions
    .filter((t: any) => t.contractName === "ERC1967Proxy" && t.transactionType === "CREATE")
    .map((t: any) => t.contractAddress as Address);
  if (proxies.length !== 8) throw new Error(`expected 8 proxies, found ${proxies.length}`);
  const [token, registry, staking, clusterManager, mxeFactory, compRegistry, feeOracle, coordinator] = proxies;
  return { token, registry, staking, clusterManager, mxeFactory, compRegistry, feeOracle, coordinator } as Record<string, Address>;
}

/** Persisted across reruns so the daemon config and the chain never diverge. */
interface State {
  clusterPriv: Hex;     // daemon's cluster X25519 private key (32 bytes hex)
  clusterPub: Hex;      // registered on-chain via activateCluster
  blsSecret: string;    // random BN254 group secret (hex) — NEVER commit; gitignored here
  submitterKey?: Hex;   // random funded submitter EOA priv — NEVER commit; gitignored here
  clusterId?: Hex;
  compDefId?: Hex;
  mxeId?: Hex;
}
function loadState(): State {
  if (existsSync(STATE_PATH)) {
    const s = JSON.parse(readFileSync(STATE_PATH, "utf8")) as State;
    // Back-fill a random BLS secret for older state files (never the public constant).
    if (!s.blsSecret) { s.blsSecret = randomGroupSecret(); writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }
    return s;
  }
  const kp = generateKeyPair();
  const s: State = { clusterPriv: bytesToHex(kp.privateKey), clusterPub: bytesToHex(kp.publicKey), blsSecret: randomGroupSecret() };
  writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
  return s;
}
function saveState(s: State) { writeFileSync(STATE_PATH, JSON.stringify(s, null, 2)); }

async function main() {
  const { rpc, pk } = loadEnv();
  const A = loadAddresses();
  const state = loadState();
  const publicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;

  const admin = privateKeyToAccount(pk);
  const adminWallet = createWalletClient({ account: admin, chain, transport: http(rpc) });

  // Node operator accounts (same deterministic identities as the testnet harness).
  const nodeKeys: Hex[] = [1, 2, 3].map((i) => keccak256(toHex(`glasel-testnet-node-${i}`)) as Hex);
  const nodeAccts = nodeKeys.map((k) => privateKeyToAccount(k));
  const nodeWallets = nodeAccts.map((acct) => createWalletClient({ account: acct, chain, transport: http(rpc) }));
  const nodeAddr = (i: number) => nodeAccts[i]!.address as Address;
  // The daemon's submitter is a RANDOM, funded EOA (persisted, gitignored) — not
  // a derived node key. submitResult verifies the BLS group signature, not the
  // sender, so the submitter only needs gas; keeping it random avoids shipping a
  // computable live key. Back-fill older state files.
  if (!state.submitterKey) {
    state.submitterKey = generatePrivateKey();
    writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
  }
  const submitterKey = state.submitterKey as Hex;
  const submitterAddr = privateKeyToAccount(submitterKey).address as Address;

  console.log(`Network        : ${chain.name} (chainId ${await publicClient.getChainId()})`);
  console.log(`Admin/deployer : ${admin.address}  (${formatEther(await publicClient.getBalance({ address: admin.address }))} ETH)`);
  console.log(`Submitter      : ${submitterAddr}  (${formatEther(await publicClient.getBalance({ address: submitterAddr }))} ETH)`);
  console.log(`Coordinator    : ${A.coordinator}`);
  console.log(`Cluster pubkey : ${state.clusterPub}`);

  const send = async (wc: WalletClient, p: any, label = "") => {
    let gas: bigint | undefined;
    try { gas = await publicClient.estimateContractGas({ ...p, account: wc.account! } as any); gas = gas + gas * 6n / 10n; } catch {}
    const hash = await wc.writeContract({ ...p, chain, account: wc.account!, ...(gas ? { gas } : {}) });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`tx reverted: ${label} (${hash})`);
    return rc;
  };
  const eventArg = (rc: any, abi: any, ev: string, key: string) =>
    (parseEventLogs({ abi, logs: rc.logs, eventName: ev })[0] as any).args[key] as Hex;
  const revertInfo = (e: any): string => {
    const parts: string[] = []; let cur: any = e;
    for (let d = 0; cur && d < 10; d++) {
      if (typeof cur.errorName === "string") parts.push(cur.errorName);
      if (cur.data && typeof cur.data.errorName === "string") parts.push(cur.data.errorName);
      if (typeof cur.reason === "string") parts.push(cur.reason);
      cur = cur.cause;
    }
    if (!parts.length && e?.shortMessage) parts.push(String(e.shortMessage));
    return [...new Set(parts)].join(" | ");
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const readUntil = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, tries = 12, delayMs = 2000): Promise<T> => {
    let v = await read();
    for (let i = 0; i < tries && !ok(v); i++) { await sleep(delayMs); v = await read(); }
    return v;
  };
  const multiSign = async (accts: any[], message: Hex): Promise<Hex> => {
    let out = "0x";
    for (const a of accts) out += (await a.signMessage({ message: { raw: message } })).slice(2);
    return out as Hex;
  };
  const balanceOfAbi = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
  const balOf = async (a: Address) =>
    (await publicClient.readContract({ address: A.token, abi: balanceOfAbi, functionName: "balanceOf", args: [a] })) as bigint;

  // ── 1. Fund node gas + mint stake (idempotent) ────────────────────────────
  console.log(`\n── Node operators: gas + stake ───────────────────────────`);
  for (let i = 0; i < 3; i++) {
    if ((await publicClient.getBalance({ address: nodeAddr(i) })) < parseEther("0.0002")) {
      const hash = await adminWallet.sendTransaction({ account: admin, chain, to: nodeAddr(i), value: parseEther("0.0004") });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }
  const MINTER = (await publicClient.readContract({ address: A.token, abi: tokenAbi, functionName: "MINTER_ROLE" })) as Hex;
  try { await send(adminWallet, { address: A.token, abi: tokenAbi, functionName: "grantRole", args: [MINTER, admin.address] }, "grant minter"); } catch {}
  for (let i = 0; i < 3; i++) {
    if ((await balOf(nodeAddr(i))) < MIN_STAKE)
      await send(adminWallet, { address: A.token, abi: tokenAbi, functionName: "mint", args: [nodeAddr(i), MIN_STAKE] }, "mint node");
  }
  for (let i = 0; i < 3; i++) {
    const bls = new Uint8Array(48); bls[0] = i + 1; bls[47] = i + 1;
    const x25519 = `0x${(i + 1).toString().padStart(64, "0")}` as Hex;
    let needsRegister = true;
    try {
      await publicClient.simulateContract({ address: A.registry, abi: registerSimAbi, functionName: "registerNode", args: [bytesToHex(bls), x25519, ZERO32, "US"], account: nodeAccts[i] });
    } catch (e: any) {
      const info = revertInfo(e);
      if (info.includes("AlreadyRegistered") || info.includes("BlsKeyAlreadyRegistered")) needsRegister = false; else throw e;
    }
    if (needsRegister)
      await send(nodeWallets[i]!, { address: A.registry, abi: registryAbi, functionName: "registerNode", args: [bytesToHex(bls), x25519, ZERO32, "US"] }, "registerNode");
    const info: any = await publicClient.readContract({ address: A.staking, abi: stakingViewAbi, functionName: "getStakeInfo", args: [nodeAddr(i)] });
    if (info.selfStaked < MIN_STAKE) {
      await send(nodeWallets[i]!, { address: A.token, abi: tokenAbi, functionName: "approve", args: [A.staking, MIN_STAKE] }, "approve stake");
      await send(nodeWallets[i]!, { address: A.staking, abi: stakingAbi, functionName: "stake", args: [nodeAddr(i), MIN_STAKE] }, "stake");
    }
    console.log(`   node-${i + 1}  ${nodeAddr(i)}  registered + staked`);
  }

  // ── 2. Propose + activate cluster (reuse if still active) ──────────────────
  console.log(`\n── Cluster ───────────────────────────────────────────────`);
  const stillActive = state.clusterId
    ? await publicClient.readContract({ address: A.clusterManager, abi: clusterExtraAbi, functionName: "isActive", args: [state.clusterId] }).catch(() => false)
    : false;
  if (!stillActive) {
    const nodes = [nodeAddr(0), nodeAddr(1), nodeAddr(2)] as Address[];
    const propRc = await send(adminWallet, { address: A.clusterManager, abi: clusterAbi, functionName: "proposeCluster", args: [nodes, 0, 2, admin.address] }, "proposeCluster");
    state.clusterId = eventArg(propRc, clusterAbi, "ClusterProposed", "clusterId");
    saveState(state);
    const actMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [state.clusterId, state.clusterPub]));
    const actSigs = await multiSign([nodeAccts[0], nodeAccts[1]], actMsg);
    await send(adminWallet, { address: A.clusterManager, abi: clusterAbi, functionName: "activateCluster", args: [state.clusterId, state.clusterPub, actSigs, [nodeAddr(0), nodeAddr(1)]] }, "activateCluster");
    await send(adminWallet, { address: A.clusterManager, abi: clusterAbi, functionName: "setBlsGroupKey", args: [state.clusterId, groupKeyForSecret(state.blsSecret)] }, "setBlsGroupKey");
    await readUntil(() => publicClient.readContract({ address: A.clusterManager, abi: clusterExtraAbi, functionName: "isActive", args: [state.clusterId] }), (v) => v === true);
  }
  console.log(`   clusterId   ${state.clusterId}  (active)`);

  // ── 3. Compile + deploy the order_notional circuit (reuse if deployed) ─────
  console.log(`\n── Circuit + MXE ─────────────────────────────────────────`);
  if (!state.compDefId) {
    const cli = async (args: string[]) => {
      const p = Bun.spawn([CONFIDEVM_BIN, ...args], { stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
      if (code !== 0) throw new Error(`glaselvm ${args[0]} failed: ${err}`);
      return out;
    };
    await cli(["compile", "order_notional", "--out", CIRCUIT_BIN]);
    const deployOut = await cli(["deploy-circuit", CIRCUIT_BIN, "--rpc", rpc, "--private-key", pk, "--registry", A.compRegistry]);
    state.compDefId = (deployOut.match(/compDefId = (0x[0-9a-fA-F]{64})/) ?? [])[1] as Hex;
    if (!state.compDefId) throw new Error(`could not parse compDefId from:\n${deployOut}`);
    saveState(state);
  }
  console.log(`   compDefId   ${state.compDefId}`);
  if (!state.mxeId) {
    const mxeRc = await send(adminWallet, { address: A.mxeFactory, abi: mxeAbi, functionName: "createMXE", args: [state.clusterId, 0, [state.compDefId], ZERO32] }, "createMXE");
    state.mxeId = eventArg(mxeRc, mxeAbi, "MXECreated", "mxeId");
    saveState(state);
  }
  console.log(`   mxeId       ${state.mxeId}`);

  // ── 4. Ensure submitter has gas for submitResult ──────────────────────────
  if ((await publicClient.getBalance({ address: submitterAddr })) < parseEther("0.0008")) {
    const hash = await adminWallet.sendTransaction({ account: admin, chain, to: submitterAddr, value: parseEther("0.0008") });
    await publicClient.waitForTransactionReceipt({ hash });
  }

  // ── 5. Emit daemon config ──────────────────────────────────────────────────
  const toml = `# GlaselOS daemon config — live Base Sepolia cluster (generated by golive-wire.ts).
# Secrets are inlined here for the testnet bring-up; for production use env:/file: refs.
rpc_url = "${rpc}"
poll_interval_ms = 4000
start_block = ${await publicClient.getBlockNumber()}
run_once = false
metrics_addr = "0.0.0.0:9090"

[contracts]
coordinator = "${A.coordinator}"
cluster_manager = "${A.clusterManager}"
computation_registry = "${A.compRegistry}"

[cluster]
x25519_private_key = "${state.clusterPriv}"
# Hex encoding of the harness group secret (decimal 12345678901234567890123456789
# in bls.ts GROUP_SK). The daemon hex-decodes this and reduces mod r, yielding the
# same Fr the bls-sign binary derives from the decimal — so the daemon's signatures
# verify against the group key registered on-chain via setBlsGroupKey.
bls_group_secret = "${state.blsSecret}"

[engine]

[signers]
keys = ["${submitterKey}"]
`;
  writeFileSync(TOML_PATH, toml);

  console.log(`\n✅ Cluster is live and active on ${chain.name}.`);
  console.log(`   state  → ${STATE_PATH}`);
  console.log(`   config → ${TOML_PATH}`);
  console.log(`\n   Start the daemon on node-1, then run: bun run scripts/golive-demo.ts`);
}

main().catch((e) => { console.error(e); process.exit(1); });
