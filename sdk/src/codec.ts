/**
 * Typed codec: encodes structured values into F_p field elements (the form the
 * Rescue cipher operates on) and serializes encrypted payloads into the
 * `encInputs` bytes the ComputationCoordinator stores on-chain. Mirrors the
 * Arcis `@arcis_type` ABI (§6.3, §7.3).
 */
import { bytesToHex, hexToBytes, type Hex } from "viem";
import { P, feToBytes, feFromBytes, feVecToBytes, feVecFromBytes } from "./field.js";
import type { EncryptedPayload } from "./crypto.js";

/** Supported primitive field types. */
export type FieldType = "u64" | "u128" | "bool" | "address" | "bytes32";

export interface Field {
  name: string;
  type: FieldType;
}
/** An ordered list of fields describing a struct (e.g. an Order). */
export type Schema = readonly Field[];

export type FieldValue = bigint | boolean | Hex | Uint8Array;

/** How many field elements each primitive occupies. */
function widthOf(t: FieldType): number {
  return t === "bytes32" ? 2 : 1; // bytes32 split hi/lo to stay < p
}

export function schemaWidth(schema: Schema): number {
  return schema.reduce((n, f) => n + widthOf(f.type), 0);
}

function toBytes32(v: Hex | Uint8Array): Uint8Array {
  const b = typeof v === "string" ? hexToBytes(v) : v;
  if (b.length !== 32) throw new Error("bytes32 must be 32 bytes");
  return b;
}

/** Encode struct values (in schema order) into field elements. */
export function encodeValues(schema: Schema, values: Record<string, FieldValue>): bigint[] {
  const out: bigint[] = [];
  for (const f of schema) {
    const v = values[f.name];
    if (v === undefined) throw new Error(`missing field ${f.name}`);
    switch (f.type) {
      case "u64":
      case "u128": {
        const x = BigInt(v as bigint);
        if (x < 0n) throw new Error(`${f.name} must be unsigned`);
        out.push(x % P);
        break;
      }
      case "bool":
        out.push(v ? 1n : 0n);
        break;
      case "address": {
        const b = toBytesN(v as Hex | Uint8Array, 20);
        out.push(feFromBytes(padLeft(b, 32)));
        break;
      }
      case "bytes32": {
        const b = toBytes32(v as Hex | Uint8Array);
        // Split into two 16-byte halves, each < 2^128 < p.
        out.push(feFromBytes(padLeft(b.subarray(0, 16), 32)));
        out.push(feFromBytes(padLeft(b.subarray(16, 32), 32)));
        break;
      }
    }
  }
  return out;
}

/** Decode field elements back into struct values. */
export function decodeValues(schema: Schema, elements: bigint[]): Record<string, FieldValue> {
  const out: Record<string, FieldValue> = {};
  let i = 0;
  for (const f of schema) {
    switch (f.type) {
      case "u64":
      case "u128":
        out[f.name] = elements[i++]!;
        break;
      case "bool":
        out[f.name] = elements[i++]! !== 0n;
        break;
      case "address": {
        const full = feToBytes(elements[i++]!);
        out[f.name] = bytesToHex(full.subarray(12, 32));
        break;
      }
      case "bytes32": {
        const hi = feToBytes(elements[i++]!).subarray(16, 32);
        const lo = feToBytes(elements[i++]!).subarray(16, 32);
        const b = new Uint8Array(32);
        b.set(hi, 0);
        b.set(lo, 16);
        out[f.name] = bytesToHex(b);
        break;
      }
    }
  }
  return out;
}

// ─── encInputs wire format ─────────────────────────────────────────────────────
// [ ephemeralPublicKey (32) | nonce (16) | ciphertext (32 * n) ]

export function serializePayload(p: EncryptedPayload): Hex {
  const ct = feVecToBytes(p.ciphertext);
  const out = new Uint8Array(32 + 16 + ct.length);
  out.set(p.ephemeralPublicKey, 0);
  out.set(p.nonce, 32);
  out.set(ct, 48);
  return bytesToHex(out);
}

export function deserializePayload(encInputs: Hex): EncryptedPayload {
  const b = hexToBytes(encInputs);
  if (b.length < 48 || (b.length - 48) % 32 !== 0) {
    throw new Error("malformed encInputs");
  }
  return {
    ephemeralPublicKey: b.subarray(0, 32),
    nonce: b.subarray(32, 48),
    ciphertext: feVecFromBytes(b.subarray(48)),
  };
}

function toBytesN(v: Hex | Uint8Array, n: number): Uint8Array {
  const b = typeof v === "string" ? hexToBytes(v) : v;
  if (b.length !== n) throw new Error(`expected ${n} bytes, got ${b.length}`);
  return b;
}

function padLeft(b: Uint8Array, n: number): Uint8Array {
  if (b.length === n) return b;
  const out = new Uint8Array(n);
  out.set(b, n - b.length);
  return out;
}

/** Convenience schema for the dark-pool Order (§7.1): 5 field elements. */
export const ORDER_SCHEMA: Schema = [
  { name: "price", type: "u64" },
  { name: "quantity", type: "u64" },
  { name: "side", type: "bool" }, // false = Buy, true = Sell
  { name: "buyerKey", type: "bytes32" },
];
