/**
 * Network status — on-chain health of the Glasel testnet. Read-only, no key needed.
 *
 * Reports: RPC reachable + latest block, whether the coordinator is accepting jobs
 * (not paused), and whether the live operator cluster is active. The page polls this.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, type Address, type Hex } from "viem";
import { baseSepolia } from "viem/chains";
import { addresses, clusterId, defaultRpcUrl } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const coordinatorAbi = [
  { type: "function", name: "paused", stateMutability: "view", inputs: [], outputs: [{ type: "bool" }] },
] as const;
const clusterAbi = [
  { type: "function", name: "isActive", stateMutability: "view", inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
] as const;

export async function GET() {
  const rpc = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || defaultRpcUrl;
  const client = createPublicClient({ chain: baseSepolia, transport: http(rpc) });

  const out: {
    rpcReachable: boolean;
    blockNumber: string | null;
    coordinatorAcceptingJobs: boolean | null;
    clusterActive: boolean | null;
    checkedAt: string;
  } = {
    rpcReachable: false,
    blockNumber: null,
    coordinatorAcceptingJobs: null,
    clusterActive: null,
    checkedAt: new Date().toISOString(),
  };

  try {
    out.blockNumber = (await client.getBlockNumber()).toString();
    out.rpcReachable = true;
  } catch {
    return NextResponse.json(out, { status: 200 });
  }

  // Best-effort reads — a revert just leaves the field null rather than failing.
  try {
    const paused = await client.readContract({
      address: addresses.coordinator as Address, abi: coordinatorAbi, functionName: "paused",
    });
    out.coordinatorAcceptingJobs = !paused;
  } catch { /* leave null */ }

  try {
    out.clusterActive = (await client.readContract({
      address: addresses.clusterManager as Address, abi: clusterAbi, functionName: "isActive", args: [clusterId as Hex],
    })) as boolean;
  } catch { /* leave null */ }

  return NextResponse.json(out, { status: 200 });
}
