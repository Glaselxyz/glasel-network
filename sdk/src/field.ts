/**
 * Field arithmetic over F_p with p = 2^255 - 19 — the Curve25519 base field,
 * matching the Glasel encryption stack (§6.2). All Rescue-cipher operations
 * happen in this field so they remain arithmetization-friendly (evaluable inside
 * an MPC arithmetic circuit).
 */
import { Field } from "@noble/curves/abstract/modular";
import { numberToBytesBE, bytesToNumberBE } from "@noble/curves/abstract/utils";

/** p = 2^255 - 19 */
export const P: bigint = (1n << 255n) - 19n;

/** The prime field F_p. */
export const Fp = Field(P);

/** Number of bytes to canonically serialize a field element (p < 2^256). */
export const FIELD_BYTES = 32;

/** Reduce an arbitrary bigint into the field. */
export function fe(x: bigint): bigint {
  return Fp.create(x);
}

/** Serialize a field element to 32 big-endian bytes. */
export function feToBytes(x: bigint): Uint8Array {
  return numberToBytesBE(Fp.create(x), FIELD_BYTES);
}

/** Deserialize 32 big-endian bytes to a field element (reduced mod p). */
export function feFromBytes(b: Uint8Array): bigint {
  return Fp.create(bytesToNumberBE(b));
}

/** Serialize a vector of field elements to a flat byte array. */
export function feVecToBytes(v: bigint[]): Uint8Array {
  const out = new Uint8Array(v.length * FIELD_BYTES);
  for (let i = 0; i < v.length; i++) out.set(feToBytes(v[i]!), i * FIELD_BYTES);
  return out;
}

/** Deserialize a flat byte array into a vector of field elements. */
export function feVecFromBytes(b: Uint8Array): bigint[] {
  if (b.length % FIELD_BYTES !== 0) {
    throw new Error(`byte length ${b.length} is not a multiple of ${FIELD_BYTES}`);
  }
  const out: bigint[] = [];
  for (let i = 0; i < b.length; i += FIELD_BYTES) {
    out.push(feFromBytes(b.subarray(i, i + FIELD_BYTES)));
  }
  return out;
}
