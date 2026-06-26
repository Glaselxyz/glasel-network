/**
 * External-developer example — "confidential order notional".
 *
 * Shows the whole Glasel developer flow with the `@glasel/client` SDK:
 *   1. encrypt a typed value to a cluster key  → on-chain `encInputs`
 *   2. (commission on-chain; the MPC cluster computes over the ciphertext)
 *   3. decrypt the sealed result with your own key
 *
 * It is fully self-contained: step 2 (the cluster decrypt → compute → re-seal)
 * is inlined so you can run and test it with no network. To talk to the LIVE
 * Base Sepolia deployment, replace the local `cluster` keypair with the real
 * key read from chain — see `liveClusterKey()` at the bottom.
 *
 * In-repo imports use "../src/…"; an external project imports from
 * "@glasel/client".
 */
import { generateKeyPair, publicKeyFromPrivate } from "../src/x25519.js";
import {
  ORDER_SCHEMA,
  encodeValues,
  decodeValues,
  serializePayload,
  deserializePayload,
  type Schema,
} from "../src/codec.js";
import { encrypt, decrypt, seal } from "../src/crypto.js";
import type { Hex } from "viem";

/** The result the `order_notional` circuit returns. */
export const NOTIONAL_SCHEMA: Schema = [{ name: "notional", type: "u128" }];

function toHex32(bytes: Uint8Array): Hex {
  return ("0x" + Buffer.from(bytes).toString("hex")) as Hex;
}

/**
 * Compute `price * quantity` confidentially and return the decrypted notional.
 */
export function runConfidentialOrder(order: { price: bigint; quantity: bigint }): bigint {
  // The cluster's X25519 key. On the live network this comes from chain:
  //   const clusterKey = await client.getClusterPublicKeyForMXE(mxeId)
  const cluster = generateKeyPair();
  // Your own key — the result is sealed so only you can read it.
  const me = generateKeyPair();

  // 1) Encrypt the typed order to the cluster key. `encInputs` is what you'd
  //    pass to `commission(...)` on-chain; it reveals nothing.
  const encInputs = serializePayload(
    encrypt(
      encodeValues(ORDER_SCHEMA, {
        price: order.price,
        quantity: order.quantity,
        side: false, // buy
        buyerKey: toHex32(publicKeyFromPrivate(me.privateKey)),
      }),
      cluster.publicKey,
    ),
  );

  // 2) What the MPC cluster does after you commission: decrypt in-cluster,
  //    evaluate the circuit, and re-seal the result to you. (On the real
  //    network no single node can do this alone — see node/crates/glasel-mpc.)
  const decoded = decodeValues(ORDER_SCHEMA, decrypt(deserializePayload(encInputs), cluster.privateKey));
  const notional = (decoded.price as bigint) * (decoded.quantity as bigint);
  const encResult = serializePayload(seal(encodeValues(NOTIONAL_SCHEMA, { notional }), me.publicKey));

  // 3) Decrypt the sealed result with your key.
  const out = decodeValues(NOTIONAL_SCHEMA, decrypt(deserializePayload(encResult), me.privateKey));
  return out.notional as bigint;
}

// ── Run directly: `bun run examples/confidential-order.ts` ──────────────────
if (import.meta.main) {
  const notional = runConfidentialOrder({ price: 1000n, quantity: 7n });
  console.log(`confidential notional = ${notional}`); // 7000, computed without revealing inputs
}
