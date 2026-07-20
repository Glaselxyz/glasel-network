/**
 * Gasless relayer: commissions ONE demo confidential job on behalf of a visitor.
 *
 * The browser encrypts locally and posts only ciphertext (`encInputs`). This
 * route never sees plaintext — it pays gas, submits the commission tx against the
 * fixed demo MXE/circuit, and returns the on-chain ids. Guardrails: hard input
 * cap, ciphertext-only, fixed MXE/compDef, and a per-IP rate limit.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createPublicClient, createWalletClient, http, parseEventLogs, isHex, type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { coordinatorAbi } from "@glasel/client";
import { activeChain } from "@/lib/chain";
import { defaultRpcUrl } from "@/lib/site";
import { DEMO, playgroundAddresses, MAX_ENCINPUTS_BYTES, RATE_LIMIT, ZERO_ADDRESS } from "@/lib/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

// Best-effort per-IP limiter (per warm serverless instance). Combined with the
// input cap + fixed circuit, it's enough to keep a demo relayer from being drained.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const win = (hits.get(ip) ?? []).filter((t) => now - t < RATE_LIMIT.windowMs);
  if (win.length >= RATE_LIMIT.perWindow) return true;
  win.push(now);
  hits.set(ip, win);
  return false;
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "Rate limit — try again in a minute." }, { status: 429 });
  }

  let encInputs: string;
  try {
    ({ encInputs } = await req.json());
  } catch {
    return NextResponse.json({ error: "bad request" }, { status: 400 });
  }
  if (typeof encInputs !== "string" || !isHex(encInputs) || encInputs.length < 4) {
    return NextResponse.json({ error: "encInputs must be hex ciphertext" }, { status: 400 });
  }
  if ((encInputs.length - 2) / 2 > MAX_ENCINPUTS_BYTES) {
    return NextResponse.json({ error: "ciphertext too large" }, { status: 413 });
  }

  const key = process.env.PLAYGROUND_RELAYER_KEY;
  if (!key) return NextResponse.json({ error: "relayer not configured" }, { status: 503 });

  try {
    const rpc = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || defaultRpcUrl;
    const account = privateKeyToAccount((key.startsWith("0x") ? key : `0x${key}`) as Hex);
    const publicClient = createPublicClient({ chain: activeChain, transport: http(rpc) });
    const wallet = createWalletClient({ account, chain: activeChain, transport: http(rpc) });

    const params = {
      address: playgroundAddresses.coordinator,
      abi: coordinatorAbi,
      functionName: "commission" as const,
      args: [DEMO.mxeId, DEMO.compDefId, encInputs as Hex, "", ZERO_ADDRESS, "0x00000000", 0n, 0n],
    };
    let gas: bigint | undefined;
    try {
      gas = await publicClient.estimateContractGas({ ...params, account });
      gas += (gas * 6n) / 10n;
    } catch { /* fall back to node estimation */ }

    const hash = await wallet.writeContract({ ...params, account, chain: activeChain, ...(gas ? { gas } : {}) });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "commission reverted", txHash: hash }, { status: 502 });
    }
    const logs = parseEventLogs({ abi: coordinatorAbi, logs: receipt.logs, eventName: "ComputationRequested" });
    const computationId = (logs[0] as any)?.args?.computationId as Hex | undefined;
    if (!computationId) {
      return NextResponse.json({ error: "no computation id in receipt", txHash: hash }, { status: 502 });
    }
    return NextResponse.json(
      { computationId, txHash: hash, blockNumber: receipt.blockNumber.toString() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: "commission failed" }, { status: 502 });
  }
}
