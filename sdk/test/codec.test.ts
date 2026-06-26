import { test, expect, describe } from "bun:test";
import {
  encodeValues,
  decodeValues,
  serializePayload,
  deserializePayload,
  schemaWidth,
  ORDER_SCHEMA,
  type Schema,
} from "../src/codec.js";
import { encrypt, decrypt } from "../src/crypto.js";
import { generateKeyPair, publicKeyFromPrivate } from "../src/x25519.js";
import { bytesToHex } from "viem";

describe("codec primitives", () => {
  const schema: Schema = [
    { name: "a", type: "u64" },
    { name: "b", type: "bool" },
    { name: "c", type: "address" },
    { name: "d", type: "bytes32" },
  ];

  test("encode/decode round-trip", () => {
    const addr = "0x00112233445566778899aabbccddeeff00112233" as `0x${string}`;
    const b32 = ("0x" + "ab".repeat(32)) as `0x${string}`;
    const values = { a: 123456789n, b: true, c: addr, d: b32 };
    const elements = encodeValues(schema, values);
    expect(elements.length).toBe(schemaWidth(schema)); // 1+1+1+2 = 5
    const decoded = decodeValues(schema, elements);
    expect(decoded.a).toBe(123456789n);
    expect(decoded.b).toBe(true);
    expect((decoded.c as string).toLowerCase()).toBe(addr);
    expect((decoded.d as string).toLowerCase()).toBe(b32);
  });

  test("ORDER_SCHEMA is exactly one cipher block (5 elements)", () => {
    expect(schemaWidth(ORDER_SCHEMA)).toBe(5);
  });

  test("rejects negative unsigned", () => {
    expect(() => encodeValues([{ name: "x", type: "u64" }], { x: -1n })).toThrow();
  });
});

describe("payload serialization", () => {
  test("serialize/deserialize round-trip", () => {
    const cluster = generateKeyPair();
    const payload = encrypt([1n, 2n, 3n, 4n, 5n], cluster.publicKey);
    const hex = serializePayload(payload);
    const back = deserializePayload(hex);
    expect(bytesToHex(back.ephemeralPublicKey)).toBe(bytesToHex(payload.ephemeralPublicKey));
    expect(bytesToHex(back.nonce)).toBe(bytesToHex(payload.nonce));
    expect(back.ciphertext).toEqual(payload.ciphertext);
  });

  test("rejects malformed encInputs", () => {
    expect(() => deserializePayload("0x1234")).toThrow();
  });
});

describe("end-to-end: encrypt Order -> encInputs -> decrypt", () => {
  test("dark-pool order round-trips through the wire format", () => {
    const cluster = generateKeyPair();
    const trader = generateKeyPair();
    const order = {
      price: 1000n,
      quantity: 5n,
      side: false, // Buy
      buyerKey: bytesToHex(publicKeyFromPrivate(trader.privateKey)),
    };

    // Client side: encode + encrypt to cluster.
    const elements = encodeValues(ORDER_SCHEMA, order);
    const payload = encrypt(elements, cluster.publicKey);
    const encInputs = serializePayload(payload);

    // Node side (modelled): parse encInputs, decrypt with cluster key, decode.
    const parsed = deserializePayload(encInputs);
    const recovered = decrypt(parsed, cluster.privateKey);
    const decoded = decodeValues(ORDER_SCHEMA, recovered);

    expect(decoded.price).toBe(1000n);
    expect(decoded.quantity).toBe(5n);
    expect(decoded.side).toBe(false);
    expect((decoded.buyerKey as string).toLowerCase()).toBe(order.buyerKey.toLowerCase());
  });
});
