import type { Hex } from "viem";
import { addresses } from "./site";

/**
 * The one live, pre-wired demo circuit the playground drives: an "order value"
 * MXE that computes `price * quantity` over an encrypted order, blind. These ids
 * are the same ones the quickstart + examples use.
 */
export const DEMO = {
  mxeId: "0x50efc3d07c4b042b06260c7b5de822c9961e9576ce1a8054fe9f50ba42bb1a66",
  compDefId: "0x2cef4b58d6963e92e8fd548d87c02ffd37472b3201c8d2bdb6a4377fed01ae64",
} as const satisfies Record<string, Hex>;

/** Coordinator + ClusterManager + MXEFactory for the active chain (from env). */
export const playgroundAddresses = {
  coordinator: addresses.coordinator as Hex,
  clusterManager: addresses.clusterManager as Hex,
  mxeFactory: (process.env.NEXT_PUBLIC_MXE_FACTORY || "0x0Ee8170F29D0590B08D879Baa5e4AEc27Ae7d0eD") as Hex,
};

/** Guardrails so the relayer can only be used for this demo, at a bounded size. */
export const MAX_ENCINPUTS_BYTES = 4096;
export const RATE_LIMIT = { perWindow: 5, windowMs: 60_000 }; // 5 runs/min per IP

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;
