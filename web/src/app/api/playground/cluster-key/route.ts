/**
 * Returns the live cluster's X25519 public key for the demo MXE. Public value —
 * the browser needs it to encrypt inputs locally (so plaintext never leaves the
 * user's machine). Read-only, no key.
 */
import { NextResponse } from "next/server";
import { createPublicClient, http, bytesToHex } from "viem";
import { GlaselClient } from "@glasel/client";
import { activeChain } from "@/lib/chain";
import { defaultRpcUrl } from "@/lib/site";
import { DEMO, playgroundAddresses } from "@/lib/playground";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const rpc = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL || defaultRpcUrl;
    const publicClient = createPublicClient({ chain: activeChain, transport: http(rpc) });
    const glasel = new GlaselClient({
      publicClient,
      addresses: {
        coordinator: playgroundAddresses.coordinator,
        clusterManager: playgroundAddresses.clusterManager,
        mxeFactory: playgroundAddresses.mxeFactory,
      },
    });
    const key = await glasel.getClusterPublicKeyForMXE(DEMO.mxeId);
    return NextResponse.json(
      { clusterKey: bytesToHex(key), mxeId: DEMO.mxeId, compDefId: DEMO.compDefId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: "could not read cluster key" }, { status: 502 });
  }
}
