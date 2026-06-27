/**
 * GLASEL testnet faucet — drips test tokens so developers can pay computation fees.
 *
 * POST { address } -> mints FAUCET_AMOUNT GLASEL to the address (rate-limited per
 * address per 24h). Requires the operator to set env in the deployment:
 *
 *   FAUCET_PRIVATE_KEY   a key holding MINTER_ROLE on GlaselToken (server-only)
 *   RPC_URL              Base Sepolia RPC (optional; defaults to public)
 *   FAUCET_AMOUNT        GLASEL per claim, in whole tokens (optional; default 1000)
 *
 * Without FAUCET_PRIVATE_KEY the endpoint returns 503 so the site still builds and
 * deploys; the operator flips it on by setting the env var.
 *
 * NOTE: the rate limiter is in-process and resets on cold start / across serverless
 * instances. For production put it behind a shared store (Vercel KV / Upstash).
 */
import { NextResponse } from "next/server";
import {
  createPublicClient, createWalletClient, http, isAddress, parseEther, formatEther,
  type Hex, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { addresses, defaultRpcUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const tokenAbi = [
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

const RATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const lastClaim = new Map<string, number>();

function rpcUrl(): string {
  return process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || defaultRpcUrl;
}

export async function POST(req: Request) {
  let body: { address?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const address = (body.address || "").trim();
  if (!isAddress(address)) {
    return NextResponse.json({ error: "not a valid Ethereum address" }, { status: 400 });
  }

  const key = process.env.FAUCET_PRIVATE_KEY as Hex | undefined;
  if (!key) {
    return NextResponse.json(
      { error: "faucet is not configured yet — set FAUCET_PRIVATE_KEY in the deployment" },
      { status: 503 },
    );
  }

  // Rate limit per recipient address.
  const now = Date.now();
  const prev = lastClaim.get(address.toLowerCase());
  if (prev && now - prev < RATE_WINDOW_MS) {
    const hrs = Math.ceil((RATE_WINDOW_MS - (now - prev)) / 3_600_000);
    return NextResponse.json(
      { error: `already claimed — try again in ~${hrs}h (one claim per address per day)` },
      { status: 429 },
    );
  }

  const amountWhole = BigInt(process.env.FAUCET_AMOUNT || "1000");
  const amount = parseEther(amountWhole.toString());

  try {
    const chain = baseSepolia;
    const transport = http(rpcUrl());
    const publicClient = createPublicClient({ chain, transport });
    const account = privateKeyToAccount(key.startsWith("0x") ? key : (`0x${key}` as Hex));
    const wallet = createWalletClient({ account, chain, transport });
    const token = addresses.token as Address;

    // Estimate + buffer (OP-stack estimation is tight); fall back to viem's default.
    let gas: bigint | undefined;
    try {
      gas = await publicClient.estimateContractGas({
        address: token, abi: tokenAbi, functionName: "mint", args: [address as Address, amount], account,
      });
      gas = gas + gas / 2n;
    } catch { /* let viem estimate */ }

    const hash = await wallet.writeContract({
      address: token, abi: tokenAbi, functionName: "mint", args: [address as Address, amount], chain, account,
      ...(gas ? { gas } : {}),
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      return NextResponse.json({ error: "mint transaction reverted", txHash: hash }, { status: 502 });
    }

    lastClaim.set(address.toLowerCase(), now);
    const bal = await publicClient.readContract({ address: token, abi: tokenAbi, functionName: "balanceOf", args: [address as Address] });
    return NextResponse.json({
      ok: true,
      txHash: hash,
      amount: amountWhole.toString(),
      balance: formatEther(bal as bigint),
    });
  } catch (e: any) {
    const msg = e?.shortMessage || e?.message || "mint failed";
    return NextResponse.json({ error: String(msg).split("\n")[0] }, { status: 500 });
  }
}
