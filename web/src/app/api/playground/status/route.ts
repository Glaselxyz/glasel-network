/**
 * Single-shot status of a computation, so the browser can poll without an RPC of
 * its own. Returns the on-chain status and, once completed, the sealed result
 * (`encResult`) — which only the visitor's browser can decrypt.
 */
import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, http, isHex, type Hex } from "viem";
import { coordinatorAbi, ComputationStatus } from "@glasel/client";
import { activeChain } from "@/lib/chain";
import { defaultRpcUrl } from "@/lib/site";
import { playgroundAddresses } from "@/lib/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id || !isHex(id) || id.length !== 66) {
    return NextResponse.json({ error: "bad computation id" }, { status: 400 });
  }
  try {
    const rpc = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || defaultRpcUrl;
    const client = createPublicClient({ chain: activeChain, transport: http(rpc) });
    const comp = (await client.readContract({
      address: playgroundAddresses.coordinator,
      abi: coordinatorAbi,
      functionName: "getComputation",
      args: [id as Hex],
    })) as { status: number; encResult: Hex };

    const status = comp.status as ComputationStatus;
    const done = status === ComputationStatus.Completed;
    const failed = status === ComputationStatus.Failed || status === ComputationStatus.Slashed;
    return NextResponse.json(
      {
        status,
        state: done ? "completed" : failed ? "failed" : status === 0 ? "unknown" : "pending",
        encResult: done ? comp.encResult : null,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ error: "status read failed" }, { status: 502 });
  }
}
