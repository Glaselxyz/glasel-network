/**
 * Live Base Sepolia test harness (Phase 7).
 *
 * Drives the FULL protocol lifecycle against an already-deployed Glasel core
 * on Base Sepolia, plus a battery of edge-case assertions. Everything is driven
 * from ONE funded deployer/admin EOA (read from contracts/.env): node
 * sub-accounts are derived deterministically and topped up with gas from the
 * deployer, so the whole run bootstraps off a single faucet deposit.
 *
 * Normal path:
 *   register + stake 3 nodes → propose + activate a cluster → deploy a
 *   computation definition + MXE → commission → threshold-sign + submitResult →
 *   SDK reads the cluster key, watches to Completed, and decrypts the result.
 *
 * Edge cases (mostly `simulateContract`, which reverts WITHOUT spending gas):
 *   C-1 id uniqueness, below-threshold, duplicate signer, non-member signer,
 *   wrong-message signature, unknown definition, access control, paused
 *   coordinator, deadline-floor guard (M-3), slash-timed-out (H-2), and
 *   commission against a dissolved cluster (H-1).
 *
 * Run:  cd sdk && bun run scripts/testnet.ts
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  encodeAbiParameters,
  parseEventLogs,
  bytesToHex,
  toHex,
  parseEther,
  formatEther,
  type Hex,
  type Address,
  type WalletClient,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { readFileSync } from "node:fs";
import { resolveChain, defaultRpc, broadcastDir } from "./chain.js";
import { generateKeyPair, publicKeyFromPrivate } from "../src/x25519.js";

const chain = resolveChain();
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

// ── extra ABIs not in e2e-abi.ts ────────────────────────────────────────────
const clusterExtraAbi = [
  ...clusterAbi,
  { type: "function", name: "dissolveCluster", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

const coordExtraAbi = [
  ...coordWriteAbi,
  { type: "function", name: "slashTimedOut", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }], outputs: [] },
  { type: "function", name: "statusOf", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "uint8" }] },
  { type: "function", name: "pause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "unpause", stateMutability: "nonpayable", inputs: [], outputs: [] },
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;

const feeOracleAbi = [
  { type: "function", name: "setDeadlineParams", stateMutability: "nonpayable", inputs: [{ type: "uint256" }, { type: "uint256" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "estimateFee", stateMutability: "view", inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [{ type: "uint256" }] },
] as const;

const stakingViewAbi = [
  { type: "function", name: "getStakeInfo", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "tuple", components: [
    { name: "selfStaked", type: "uint256" }, { name: "delegatedStake", type: "uint256" }, { name: "totalStake", type: "uint256" },
    { name: "reputationScore", type: "uint256" }, { name: "computationsCompleted", type: "uint256" }, { name: "computationsFailed", type: "uint256" },
    { name: "accumulatedRewards", type: "uint256" }, { name: "pendingSlash", type: "uint256" },
  ] }] },
] as const;

// Custom error definitions so viem can decode revert *names* (not just selectors).
const protocolErrors = [
  { type: "error", name: "BadBLSSignature", inputs: [] },
  { type: "error", name: "InvalidGroupKey", inputs: [] },
  { type: "error", name: "BelowThreshold", inputs: [] },
  { type: "error", name: "DuplicateSigner", inputs: [] },
  { type: "error", name: "SignerNotInCluster", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
  { type: "error", name: "BadSignatureLength", inputs: [] },
  { type: "error", name: "UnknownDefinition", inputs: [] },
  { type: "error", name: "ClusterNotActive", inputs: [] },
  { type: "error", name: "MXENotActive", inputs: [] },
  { type: "error", name: "DefNotAllowed", inputs: [] },
  { type: "error", name: "EnforcedPause", inputs: [] },
  { type: "error", name: "AccessControlUnauthorizedAccount", inputs: [{ type: "address" }, { type: "bytes32" }] },
] as const;

const registerSimAbi = [
  { type: "function", name: "registerNode", stateMutability: "nonpayable", inputs: [{ type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }, { type: "string" }], outputs: [] },
  { type: "error", name: "AlreadyRegistered", inputs: [] },
  { type: "error", name: "BlsKeyAlreadyRegistered", inputs: [] },
  { type: "error", name: "InvalidBlsKeyLength", inputs: [] },
  { type: "error", name: "InvalidG1Point", inputs: [] },
] as const;

// ── constants ────────────────────────────────────────────────────────────────
const ZERO = "0x0000000000000000000000000000000000000000" as Address;
const ZERO32 = `0x${"00".repeat(32)}` as Hex;
const MIN_STAKE = 10_000n * 10n ** 18n;
const ROOT = new URL("../..", import.meta.url).pathname;
const CONTRACTS_DIR = `${ROOT}/contracts`;

const Status = { None: 0, Pending: 1, InProgress: 2, Completed: 3, Failed: 4, Slashed: 5 } as const;

let pass = 0;
let fail = 0;
function check(ok: boolean, msg: string, detail = "") {
  console.log(`${ok ? "  ✓" : "  ✗"} ${msg}${detail ? `  ${detail}` : ""}`);
  ok ? pass++ : fail++;
}
function section(t: string) {
  console.log(`\n── ${t} ${"─".repeat(Math.max(0, 60 - t.length))}`);
}

// ── env / config ─────────────────────────────────────────────────────────────
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
  if (proxies.length !== 8) throw new Error(`expected 8 proxies in broadcast, found ${proxies.length}`);
  const [token, registry, staking, clusterManager, mxeFactory, compRegistry, feeOracle, coordinator] = proxies;
  return { token, registry, staking, clusterManager, mxeFactory, compRegistry, feeOracle, coordinator } as Record<string, Address>;
}

async function main() {
  const { rpc, pk } = loadEnv();
  const A = loadAddresses();
  const publicClient = createPublicClient({ chain, transport: http(rpc) }) as PublicClient;

  const admin = privateKeyToAccount(pk);
  const adminWallet = createWalletClient({ account: admin, chain, transport: http(rpc) });

  // Deterministic node sub-accounts (so reruns reuse the same identities).
  const nodeKeys: Hex[] = [1, 2, 3].map((i) =>
    keccak256(toHex(`glasel-testnet-node-${i}`)) as Hex,
  );
  const nodeAccts = nodeKeys.map((k) => privateKeyToAccount(k));
  const nodeWallets = nodeAccts.map((acct) => createWalletClient({ account: acct, chain, transport: http(rpc) }));
  const nodeAddr = (i: number) => nodeAccts[i]!.address as Address;

  console.log(`Network        : ${chain.name} (chainId ${await publicClient.getChainId()})`);
  console.log(`Admin/deployer : ${admin.address}`);
  console.log(`Nodes          : ${nodeAccts.map((a) => a.address).join("\n                 ")}`);
  console.log(`Coordinator    : ${A.coordinator}`);
  const adminBal = await publicClient.getBalance({ address: admin.address });
  console.log(`Admin balance  : ${formatEther(adminBal)} ETH`);
  if (adminBal === 0n) throw new Error("deployer has 0 ETH — fund it first");

  // ── helpers ──────────────────────────────────────────────────────────────
  const send = async (wc: WalletClient, p: any, label = "") => {
    // Estimate + 60% buffer: OP-stack estimation can be tight for same-block txs.
    let gas: bigint | undefined;
    try {
      gas = await publicClient.estimateContractGas({ ...p, account: wc.account! } as any);
      gas = gas + gas * 6n / 10n;
    } catch { /* fall back to viem's internal estimate */ }
    const hash = await wc.writeContract({ ...p, chain, account: wc.account!, ...(gas ? { gas } : {}) });
    const rc = await publicClient.waitForTransactionReceipt({ hash });
    if (rc.status !== "success") throw new Error(`tx reverted: ${label} (${hash})`);
    return rc;
  };
  const eventArg = (rc: any, abi: any, ev: string, key: string) =>
    (parseEventLogs({ abi, logs: rc.logs, eventName: ev })[0] as any).args[key] as Hex;

  // Walk a viem error's cause chain, collecting decoded error names + reasons.
  const revertInfo = (e: any): string => {
    const parts: string[] = [];
    let cur: any = e;
    for (let d = 0; cur && d < 10; d++) {
      if (typeof cur.errorName === "string") parts.push(cur.errorName);
      if (cur.data && typeof cur.data.errorName === "string") parts.push(cur.data.errorName);
      if (typeof cur.reason === "string") parts.push(cur.reason);
      if (typeof cur.signature === "string") parts.push(cur.signature);
      cur = cur.cause;
    }
    if (parts.length === 0 && e?.shortMessage) parts.push(String(e.shortMessage));
    if (parts.length === 0 && e?.message) parts.push(String(e.message).split("\n")[0]);
    return [...new Set(parts)].join(" | ");
  };

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // Poll a read until `ok` holds (absorbs public-RPC read-your-writes lag).
  const readUntil = async <T>(read: () => Promise<T>, ok: (v: T) => boolean, tries = 12, delayMs = 2000): Promise<T> => {
    let v = await read();
    for (let i = 0; i < tries && !ok(v); i++) { await sleep(delayMs); v = await read(); }
    return v;
  };

  // Expect a state-changing call to REVERT (simulateContract: no gas spent).
  // Retries when it unexpectedly does NOT revert, to absorb replica lag after a
  // preceding state-change tx.
  const expectRevert = async (
    address: Address, abi: any, functionName: string, args: any[], account: any, label: string, wantSubstr?: string, tries = 6,
  ) => {
    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        await publicClient.simulateContract({ address, abi, functionName, args, account });
        if (attempt < tries - 1) { await sleep(2000); continue; }
        check(false, label, "(did NOT revert)");
      } catch (e: any) {
        const info = revertInfo(e);
        check(!wantSubstr || info.includes(wantSubstr), label, `↦ ${info.slice(0, 70)}`);
        return;
      }
    }
  };

  // ABIs merged with error definitions, for revert-name decoding at edge sites.
  const coordErrAbi = [...coordExtraAbi, ...protocolErrors] as const;
  const tokenErrAbi = [...tokenAbi, ...protocolErrors] as const;

  const sign = async (acct: any, message: Hex) =>
    acct.signMessage({ message: { raw: message } });
  // Concatenate 65-byte sigs from the given accounts (order matters).
  const multiSign = async (accts: any[], message: Hex): Promise<Hex> => {
    let out = "0x";
    for (const a of accts) out += (await sign(a, message)).slice(2);
    return out as Hex;
  };

  // ── 0. Fund node gas + mint stake tokens ───────────────────────────────────
  section("Bootstrap: gas + tokens + stake");
  for (let i = 0; i < 3; i++) {
    const bal = await publicClient.getBalance({ address: nodeAddr(i) });
    if (bal < parseEther("0.0002")) {
      const hash = await adminWallet.sendTransaction({ account: admin, chain, to: nodeAddr(i), value: parseEther("0.0005") });
      await publicClient.waitForTransactionReceipt({ hash });
    }
  }
  check(true, "node gas funded (>=0.0002 ETH each)");

  // Admin needs MINTER_ROLE (granted at deploy as DEFAULT_ADMIN; grant minter to self).
  const MINTER = (await publicClient.readContract({ address: A.token, abi: tokenAbi, functionName: "MINTER_ROLE" })) as Hex;
  try {
    await send(adminWallet, { address: A.token, abi: tokenAbi, functionName: "grantRole", args: [MINTER, admin.address] }, "grant minter");
  } catch { /* already granted */ }
  const balOf = async (a: Address) =>
    (await publicClient.readContract({ address: A.token, abi: [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }], functionName: "balanceOf", args: [a] })) as bigint;
  for (let i = 0; i < 3; i++) {
    if ((await balOf(nodeAddr(i))) < MIN_STAKE)
      await send(adminWallet, { address: A.token, abi: tokenAbi, functionName: "mint", args: [nodeAddr(i), MIN_STAKE] }, "mint node");
  }
  if ((await balOf(admin.address)) < 1000n * 10n ** 18n)
    await send(adminWallet, { address: A.token, abi: tokenAbi, functionName: "mint", args: [admin.address, 1_000_000n * 10n ** 18n] }, "mint admin");
  check(true, "minted stake tokens to nodes + fee tokens to admin");

  // ── 1. Register + stake nodes (idempotent) ─────────────────────────────────
  for (let i = 0; i < 3; i++) {
    const bls = new Uint8Array(48); bls[0] = i + 1; bls[47] = i + 1;
    const x25519 = `0x${(i + 1).toString().padStart(64, "0")}` as Hex;
    let needsRegister = true;
    try {
      await publicClient.simulateContract({ address: A.registry, abi: registerSimAbi, functionName: "registerNode", args: [bytesToHex(bls), x25519, ZERO32, "US"], account: nodeAccts[i] });
    } catch (e: any) {
      const info = revertInfo(e);
      if (info.includes("AlreadyRegistered") || info.includes("BlsKeyAlreadyRegistered")) needsRegister = false;
      else throw e; // a real, unexpected registration failure
    }
    if (needsRegister) {
      await send(nodeWallets[i]!, { address: A.registry, abi: registryAbi, functionName: "registerNode", args: [bytesToHex(bls), x25519, ZERO32, "US"] }, "registerNode");
    }
    // stake if not already eligible
    const info: any = await publicClient.readContract({ address: A.staking, abi: stakingViewAbi, functionName: "getStakeInfo", args: [nodeAddr(i)] });
    if (info.selfStaked < MIN_STAKE) {
      await send(nodeWallets[i]!, { address: A.token, abi: tokenAbi, functionName: "approve", args: [A.staking, MIN_STAKE] }, "approve stake");
      await send(nodeWallets[i]!, { address: A.staking, abi: stakingAbi, functionName: "stake", args: [nodeAddr(i), MIN_STAKE] }, "stake");
    }
  }
  check(true, "3 nodes registered + staked (>= min stake)");

  // ── 2. Propose + activate cluster (threshold 2) ────────────────────────────
  section("Normal lifecycle");
  const clusterKp = generateKeyPair();
  const clusterPub = bytesToHex(clusterKp.publicKey) as Hex;
  const nodes = [nodeAddr(0), nodeAddr(1), nodeAddr(2)] as Address[];
  const propRc = await send(adminWallet, { address: A.clusterManager, abi: clusterAbi, functionName: "proposeCluster", args: [nodes, 0, 2, admin.address] }, "proposeCluster");
  const clusterId = eventArg(propRc, clusterAbi, "ClusterProposed", "clusterId");
  const actMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes32" }], [clusterId, clusterPub]));
  const actSigs = await multiSign([nodeAccts[0], nodeAccts[1]], actMsg);
  await send(adminWallet, { address: A.clusterManager, abi: clusterExtraAbi, functionName: "activateCluster", args: [clusterId, clusterPub, actSigs, [nodeAddr(0), nodeAddr(1)]] }, "activateCluster");
  // Register the cluster's BLS group key (the sole result path is BLS).
  await send(adminWallet, { address: A.clusterManager, abi: clusterExtraAbi, functionName: "setBlsGroupKey", args: [clusterId, blsGroupKey()] }, "setBlsGroupKey");
  const active = await readUntil(
    () => publicClient.readContract({ address: A.clusterManager, abi: clusterExtraAbi, functionName: "isActive", args: [clusterId] }),
    (v) => v === true,
  );
  check(active === true, "cluster proposed + activated", clusterId.slice(0, 14) + "…");

  // ── 3. Deploy compDef + MXE ────────────────────────────────────────────────
  const defRc = await send(adminWallet, { address: A.compRegistry, abi: compRegAbi, functionName: "deployComputationDefinition", args: ["0xabcdef", "", 50_000, 2, 1] }, "deployDef");
  const compDefId = eventArg(defRc, compRegAbi, "ComputationDefinitionDeployed", "compDefId");
  const mxeRc = await send(adminWallet, { address: A.mxeFactory, abi: mxeAbi, functionName: "createMXE", args: [clusterId, 0, [compDefId], ZERO32] }, "createMXE");
  const mxeId = eventArg(mxeRc, mxeAbi, "MXECreated", "mxeId");
  check(true, "computation definition + MXE created", mxeId.slice(0, 14) + "…");

  // approve coordinator to pull fees from admin (requester)
  await send(adminWallet, { address: A.token, abi: tokenAbi, functionName: "approve", args: [A.coordinator, 2n ** 255n] }, "approve fees");

  // ── 4. Commission + submit result + SDK decrypt ────────────────────────────
  const recipient = generateKeyPair();
  const trade = { price: 1000n, quantity: 7n, side: true, buyerKey: bytesToHex(publicKeyFromPrivate(recipient.privateKey)) };
  const encResult = serializePayload(seal(encodeValues(ORDER_SCHEMA, trade), recipient.publicKey));

  const comRc = await send(adminWallet, { address: A.coordinator, abi: coordWriteAbi, functionName: "commission", args: [mxeId, compDefId, "0x00", "", ZERO, "0x00000000", 0n, 0n] }, "commission");
  const computationId = eventArg(comRc, coordWriteAbi, "ComputationRequested", "computationId");
  const resMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes" }], [computationId, encResult]));
  const { sig: resSig } = blsSign(resMsg); // one aggregated BN254 signature
  await send(adminWallet, { address: A.coordinator, abi: coordWriteAbi, functionName: "submitResult", args: [computationId, encResult, resSig] }, "submitResult");
  check(true, "computation commissioned + result submitted", computationId.slice(0, 14) + "…");

  const client = new GlaselClient({ publicClient, addresses: { coordinator: A.coordinator, clusterManager: A.clusterManager, mxeFactory: A.mxeFactory } });
  const onChainKey = await client.getClusterPublicKey(clusterId);
  check(bytesToHex(onChainKey) === clusterPub, "SDK reads cluster public key back, matches");
  const res = await client.watchComputation({ computationId, timeoutMs: 30_000, pollMs: 1500 });
  check(res.success, "SDK watchComputation → Completed");
  check(res.encResult.toLowerCase() === encResult.toLowerCase(), "on-chain encResult == sealed bytes");
  const decoded = client.decryptResult({ encResult: res.encResult, privateKey: recipient.privateKey, schema: ORDER_SCHEMA });
  check(decoded.price === 1000n && decoded.quantity === 7n && decoded.side === true, "SDK decrypts result == original trade");

  // ── 5. Edge cases ──────────────────────────────────────────────────────────
  section("Edge cases — invariants & guards");

  // C-1: two commissions with identical params yield DISTINCT ids.
  const c1 = await send(adminWallet, { address: A.coordinator, abi: coordWriteAbi, functionName: "commission", args: [mxeId, compDefId, "0xdead", "", ZERO, "0x00000000", 0n, 0n] }, "commission#a");
  const id1 = eventArg(c1, coordWriteAbi, "ComputationRequested", "computationId");
  const c2 = await send(adminWallet, { address: A.coordinator, abi: coordWriteAbi, functionName: "commission", args: [mxeId, compDefId, "0xdead", "", ZERO, "0x00000000", 0n, 0n] }, "commission#b");
  const id2 = eventArg(c2, coordWriteAbi, "ComputationRequested", "computationId");
  check(id1 !== id2, "C-1: identical commissions get distinct computationIds", `${id1.slice(0, 10)} != ${id2.slice(0, 10)}`);

  // Use id1 (a fresh Pending computation) for the signature-edge simulation.
  const edgeId = id1;
  // Tampered result: a valid BLS signature over one result must NOT authorize a
  // different result. (The BLS path has a single aggregated sig — there is no
  // signer list, so the ECDSA-era below-threshold / duplicate / non-member /
  // signer-list checks no longer exist; this is the BLS analogue.)
  const edgeMsg = keccak256(encodeAbiParameters([{ type: "bytes32" }, { type: "bytes" }], [edgeId, "0xdead" as Hex]));
  const { sig: edgeSig } = blsSign(edgeMsg);
  await expectRevert(A.coordinator, coordErrAbi, "submitResult", [edgeId, "0xbeef", edgeSig], admin, "tampered-result BLS signature rejected", "BadBLSSignature");

  // unknown definition: random compDefId.
  await expectRevert(A.coordinator, coordErrAbi, "commission", [mxeId, keccak256(toHex("nope")), "0x00", "", ZERO, "0x00000000", 0n, 0n], admin, "unknown definition rejected", "UnknownDefinition");

  // access control: node tries to mint (no MINTER_ROLE).
  await expectRevert(A.token, tokenErrAbi, "mint", [nodeAddr(0), 1n], nodeAccts[0], "unauthorized mint rejected", "AccessControlUnauthorizedAccount");

  // M-3: deadline floor must be > 0.
  await expectRevert(A.feeOracle, feeOracleAbi, "setDeadlineParams", [0n, 0n, 600n], admin, "M-3: zero deadline floor rejected", "deadline floor=0");

  // paused coordinator rejects commission.
  await send(adminWallet, { address: A.coordinator, abi: coordExtraAbi, functionName: "pause", args: [] }, "pause");
  await readUntil(() => publicClient.readContract({ address: A.coordinator, abi: coordExtraAbi, functionName: "paused", args: [] }), (v) => v === true);
  await expectRevert(A.coordinator, coordErrAbi, "commission", [mxeId, compDefId, "0x00", "", ZERO, "0x00000000", 0n, 0n], admin, "paused coordinator rejects commission", "EnforcedPause");
  await send(adminWallet, { address: A.coordinator, abi: coordExtraAbi, functionName: "unpause", args: [] }, "unpause");
  check(true, "coordinator unpaused");

  // ── 6. Slash timed-out (H-2): state-mutating, runs near the end ─────────────
  section("Edge cases — slashing & dissolved cluster (state-mutating)");
  // Shorten the deadline floor so a fresh computation expires quickly.
  await send(adminWallet, { address: A.feeOracle, abi: feeOracleAbi, functionName: "setDeadlineParams", args: [0n, 1n, 600n] }, "shorten deadline");
  const slRc = await send(adminWallet, { address: A.coordinator, abi: coordWriteAbi, functionName: "commission", args: [mxeId, compDefId, "0xfeed", "", ZERO, "0x00000000", 0n, 0n] }, "commission(short)");
  const slId = eventArg(slRc, coordWriteAbi, "ComputationRequested", "computationId");
  const before: any = await publicClient.readContract({ address: A.staking, abi: stakingViewAbi, functionName: "getStakeInfo", args: [nodeAddr(0)] });
  // wait for the deadline to pass (a couple of 2s Base blocks).
  console.log("  …waiting ~12s for the 1s deadline to elapse on-chain");
  await new Promise((r) => setTimeout(r, 12_000));
  await send(adminWallet, { address: A.coordinator, abi: coordExtraAbi, functionName: "slashTimedOut", args: [slId] }, "slashTimedOut");
  const slStatus = Number(await readUntil(
    () => publicClient.readContract({ address: A.coordinator, abi: coordExtraAbi, functionName: "statusOf", args: [slId] }),
    (v) => Number(v) === Status.Failed,
  ));
  check(slStatus === Status.Failed, "slashTimedOut → computation Failed", `status=${slStatus}`);
  const after: any = await readUntil(
    () => publicClient.readContract({ address: A.staking, abi: stakingViewAbi, functionName: "getStakeInfo", args: [nodeAddr(0)] }),
    (v: any) => before.totalStake > v.totalStake || v.pendingSlash > before.pendingSlash || v.computationsFailed > before.computationsFailed,
  );
  const slashed = before.totalStake > after.totalStake || after.pendingSlash > before.pendingSlash || after.computationsFailed > before.computationsFailed;
  check(slashed, "assigned node penalized by slash", `stake ${formatEther(before.totalStake)}→${formatEther(after.totalStake)}`);
  // restore deadline params
  await send(adminWallet, { address: A.feeOracle, abi: feeOracleAbi, functionName: "setDeadlineParams", args: [30n, 60n, 600n] }, "restore deadline");

  // H-1: commission against a dissolved cluster reverts.
  await send(adminWallet, { address: A.clusterManager, abi: clusterExtraAbi, functionName: "dissolveCluster", args: [clusterId] }, "dissolveCluster");
  await readUntil(() => publicClient.readContract({ address: A.clusterManager, abi: clusterExtraAbi, functionName: "isActive", args: [clusterId] }), (v) => v === false);
  await expectRevert(A.coordinator, coordErrAbi, "commission", [mxeId, compDefId, "0x00", "", ZERO, "0x00000000", 0n, 0n], admin, "H-1: commission on dissolved cluster rejected", "ClusterNotActive");

  // ── summary ────────────────────────────────────────────────────────────────
  section("Summary");
  console.log(`  ${pass} passed, ${fail} failed`);
  console.log(`\nDeployed addresses (Base Sepolia):`);
  for (const [k, v] of Object.entries(A)) console.log(`  ${k.padEnd(14)} ${v}`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
