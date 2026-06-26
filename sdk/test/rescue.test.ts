import { test, expect, describe } from "bun:test";
import { P, Fp, fe, feToBytes, feFromBytes, feVecToBytes, feVecFromBytes } from "../src/field.js";
import { permute, rescueHash, deriveKey, ctrEncrypt, ctrDecrypt } from "../src/rescue.js";

describe("field", () => {
  test("P is 2^255 - 19", () => {
    expect(P).toBe((1n << 255n) - 19n);
  });

  test("byte round-trip", () => {
    const x = fe(123456789012345678901234567890n);
    expect(feFromBytes(feToBytes(x))).toBe(x);
  });

  test("vector byte round-trip", () => {
    const v = [1n, 2n, P - 1n, 0n, 999n];
    expect(feVecFromBytes(feVecToBytes(v))).toEqual(v.map((x) => Fp.create(x)));
  });
});

describe("rescue permutation", () => {
  test("deterministic", () => {
    const a = permute([1n, 2n, 3n, 4n, 5n]);
    const b = permute([1n, 2n, 3n, 4n, 5n]);
    expect(a).toEqual(b);
  });

  test("avalanche: flipping one input changes output", () => {
    const a = permute([1n, 2n, 3n, 4n, 5n]);
    const b = permute([1n, 2n, 3n, 4n, 6n]);
    expect(a).not.toEqual(b);
  });

  test("outputs are reduced field elements", () => {
    const out = permute([P - 1n, P - 2n, 7n, 8n, 9n]);
    for (const x of out) expect(x < P && x >= 0n).toBe(true);
  });
});

describe("rescue hash / KDF", () => {
  test("deterministic and right length", () => {
    const a = rescueHash([42n], 5);
    const b = rescueHash([42n], 5);
    expect(a).toEqual(b);
    expect(a.length).toBe(5);
  });

  test("deriveKey returns 5 elements and depends on secret", () => {
    const k1 = deriveKey(111n);
    const k2 = deriveKey(112n);
    expect(k1.length).toBe(5);
    expect(k1).not.toEqual(k2);
  });
});

describe("CTR cipher", () => {
  const key = deriveKey(0xc0ffeen);
  const nonce = 0x1234567890abcdefn;

  test("round-trips arbitrary length", () => {
    for (const n of [1, 5, 6, 13, 100]) {
      const pt = Array.from({ length: n }, (_, i) => fe(BigInt(i * 7 + 1)));
      const ct = ctrEncrypt(pt, key, nonce);
      expect(ctrDecrypt(ct, key, nonce)).toEqual(pt);
    }
  });

  test("ciphertext differs from plaintext", () => {
    const pt = [1n, 2n, 3n, 4n, 5n];
    const ct = ctrEncrypt(pt, key, nonce);
    expect(ct).not.toEqual(pt);
  });

  test("wrong nonce fails to decrypt", () => {
    const pt = [10n, 20n, 30n];
    const ct = ctrEncrypt(pt, key, nonce);
    const bad = ctrDecrypt(ct, key, nonce + 1n);
    expect(bad).not.toEqual(pt);
  });

  test("wrong key fails to decrypt", () => {
    const pt = [10n, 20n, 30n];
    const ct = ctrEncrypt(pt, key, nonce);
    const bad = ctrDecrypt(ct, deriveKey(999n), nonce);
    expect(bad).not.toEqual(pt);
  });
});
