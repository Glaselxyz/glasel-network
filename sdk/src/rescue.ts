/**
 * Rescue-Prime permutation, sponge hash (KDF) and CTR-mode stream cipher over
 * F_{2^255-19} (§6.2).
 *
 * IMPLEMENTATION NOTE — this is a *self-consistent* Rescue-Prime instantiation.
 * The architecture cites Arcium's exact parameter/constant set, which is not
 * public in full. We therefore generate the MDS matrix (a Cauchy matrix) and the
 * round constants deterministically from a fixed domain-separated seed, so the
 * SDK and the node implementation agree byte-for-byte. Interop with an external
 * Arcium node would require swapping in their published constants — the
 * algorithmic structure (alpha-S-box, inverse-S-box, MDS, round-constant
 * injection, sponge, CTR) is unchanged.
 */
import { keccak_256 } from "@noble/hashes/sha3";
import { Fp, P, fe } from "./field.js";

const ALPHA = 5n; // S-box exponent; gcd(5, p-1) = 1 for p = 2^255-19
const ALPHA_INV = modInverse(ALPHA, P - 1n);
const ROUNDS = 10; // m=5 @ 128-bit per spec

// ─── Parameter cache per state width ──────────────────────────────────────────

interface Params {
  m: number;
  mds: bigint[][];
  rc: bigint[][]; // round constants: 2*ROUNDS vectors of length m
}

const cache = new Map<number, Params>();

function params(m: number): Params {
  let p = cache.get(m);
  if (!p) {
    p = { m, mds: cauchyMDS(m), rc: roundConstants(m, ROUNDS) };
    cache.set(m, p);
  }
  return p;
}

// ─── Core permutation ─────────────────────────────────────────────────────────

/** Rescue-Prime permutation on a state of width `m`. */
export function permute(state: bigint[]): bigint[] {
  const m = state.length;
  const { mds, rc } = params(m);
  let s = state.map((x) => Fp.create(x));

  for (let r = 0; r < ROUNDS; r++) {
    // First half-round: forward S-box, MDS, add constants.
    s = s.map((x) => Fp.pow(x, ALPHA));
    s = matMul(mds, s);
    s = addVec(s, rc[2 * r]!);

    // Second half-round: inverse S-box, MDS, add constants.
    s = s.map((x) => Fp.pow(x, ALPHA_INV));
    s = matMul(mds, s);
    s = addVec(s, rc[2 * r + 1]!);
  }
  return s;
}

// ─── Sponge hash (used for KDF) ───────────────────────────────────────────────

/**
 * Rescue-Prime sponge hash. Defaults to rate=7, capacity=5 (m=12) per the spec's
 * KDF parameters. Returns `outLen` field elements.
 */
export function rescueHash(inputs: bigint[], outLen: number, rate = 7, capacity = 5): bigint[] {
  const m = rate + capacity;
  let state = new Array<bigint>(m).fill(0n);

  // Absorb (pad with zeros to a multiple of `rate`).
  const padded = inputs.slice();
  while (padded.length % rate !== 0) padded.push(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate; i++) state[i] = Fp.add(state[i]!, padded[off + i]!);
    state = permute(state);
  }

  // Squeeze.
  const out: bigint[] = [];
  while (out.length < outLen) {
    for (let i = 0; i < rate && out.length < outLen; i++) out.push(state[i]!);
    if (out.length < outLen) state = permute(state);
  }
  return out;
}

/** Derive a 5-element Rescue cipher key from an ECDH shared secret. */
export function deriveKey(sharedSecret: bigint): bigint[] {
  return rescueHash([fe(sharedSecret)], 5);
}

// ─── CTR-mode stream cipher ───────────────────────────────────────────────────

const CIPHER_M = 5;

/** Keystream block for counter `i` under `key` (5 field elements) and `nonceFe`. */
function keystream(key: bigint[], nonceFe: bigint, i: number): bigint[] {
  const state: bigint[] = [
    Fp.add(key[0]!, nonceFe),
    Fp.add(key[1]!, fe(BigInt(i))),
    key[2]!,
    key[3]!,
    key[4]!,
  ];
  return permute(state);
}

/** Encrypt a vector of field-element plaintext blocks in CTR mode. */
export function ctrEncrypt(plaintext: bigint[], key: bigint[], nonceFe: bigint): bigint[] {
  if (key.length !== CIPHER_M) throw new Error("key must be 5 field elements");
  const out: bigint[] = [];
  for (let i = 0; i < plaintext.length; i++) {
    const ks = keystream(key, nonceFe, Math.floor(i / CIPHER_M));
    out.push(Fp.add(plaintext[i]!, ks[i % CIPHER_M]!));
  }
  return out;
}

/** Decrypt CTR-mode ciphertext produced by {@link ctrEncrypt}. */
export function ctrDecrypt(ciphertext: bigint[], key: bigint[], nonceFe: bigint): bigint[] {
  if (key.length !== CIPHER_M) throw new Error("key must be 5 field elements");
  const out: bigint[] = [];
  for (let i = 0; i < ciphertext.length; i++) {
    const ks = keystream(key, nonceFe, Math.floor(i / CIPHER_M));
    out.push(Fp.sub(ciphertext[i]!, ks[i % CIPHER_M]!));
  }
  return out;
}

// ─── Deterministic parameter generation ───────────────────────────────────────

/** Cauchy matrix A[i][j] = 1/(i + m + j + 1) — MDS over F_p. */
function cauchyMDS(m: number): bigint[][] {
  const a: bigint[][] = [];
  for (let i = 0; i < m; i++) {
    const row: bigint[] = [];
    for (let j = 0; j < m; j++) row.push(Fp.inv(fe(BigInt(i + m + j + 1))));
    a.push(row);
  }
  return a;
}

/** 2*rounds round-constant vectors of length m, from a domain-separated keccak stream. */
function roundConstants(m: number, rounds: number): bigint[][] {
  const total = 2 * rounds * m;
  const seed = new TextEncoder().encode(`confide/rescue-prime/rc/m=${m}`);
  const vals: bigint[] = [];
  let counter = 0;
  while (vals.length < total) {
    const buf = new Uint8Array(seed.length + 4);
    buf.set(seed, 0);
    buf[seed.length] = (counter >>> 24) & 0xff;
    buf[seed.length + 1] = (counter >>> 16) & 0xff;
    buf[seed.length + 2] = (counter >>> 8) & 0xff;
    buf[seed.length + 3] = counter & 0xff;
    const h = keccak_256(buf);
    let acc = 0n;
    for (const byte of h) acc = (acc << 8n) | BigInt(byte);
    vals.push(Fp.create(acc));
    counter++;
  }
  const out: bigint[][] = [];
  for (let r = 0; r < 2 * rounds; r++) out.push(vals.slice(r * m, r * m + m));
  return out;
}

function matMul(mat: bigint[][], vec: bigint[]): bigint[] {
  const out: bigint[] = [];
  for (let i = 0; i < mat.length; i++) {
    let acc = 0n;
    const row = mat[i]!;
    for (let j = 0; j < vec.length; j++) acc = Fp.add(acc, Fp.mul(row[j]!, vec[j]!));
    out.push(acc);
  }
  return out;
}

function addVec(a: bigint[], b: bigint[]): bigint[] {
  return a.map((x, i) => Fp.add(x, b[i]!));
}

/** Modular inverse via extended Euclidean algorithm (modulus need not be prime). */
function modInverse(a: bigint, mod: bigint): bigint {
  let [old_r, r] = [((a % mod) + mod) % mod, mod];
  let [old_s, s] = [1n, 0n];
  while (r !== 0n) {
    const q = old_r / r;
    [old_r, r] = [r, old_r - q * r];
    [old_s, s] = [s, old_s - q * s];
  }
  if (old_r !== 1n) throw new Error("not invertible");
  return ((old_s % mod) + mod) % mod;
}
