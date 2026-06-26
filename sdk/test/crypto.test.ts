import { test, expect, describe } from "bun:test";
import { generateKeyPair, sharedSecretFe } from "../src/x25519.js";
import { encrypt, decrypt, seal } from "../src/crypto.js";
import { fe } from "../src/field.js";

describe("x25519 ECDH", () => {
  test("both sides derive the same shared secret", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const sa = sharedSecretFe(a.privateKey, b.publicKey);
    const sb = sharedSecretFe(b.privateKey, a.publicKey);
    expect(sa).toBe(sb);
  });
});

describe("encrypt / decrypt", () => {
  test("round-trips to the cluster key", () => {
    // Model a cluster: combined keypair (in production this is a DKG output).
    const cluster = generateKeyPair();
    const plaintext = [fe(1000n), fe(5n), fe(1n)]; // e.g. price, qty, side
    const payload = encrypt(plaintext, cluster.publicKey);

    // The cluster (holding the combined private key) decrypts.
    const recovered = decrypt(payload, cluster.privateKey);
    expect(recovered).toEqual(plaintext);
  });

  test("wrong private key cannot decrypt", () => {
    const cluster = generateKeyPair();
    const attacker = generateKeyPair();
    const plaintext = [fe(42n)];
    const payload = encrypt(plaintext, cluster.publicKey);
    expect(decrypt(payload, attacker.privateKey)).not.toEqual(plaintext);
  });

  test("deterministic with a fixed nonce", () => {
    const cluster = generateKeyPair();
    const nonce = new Uint8Array(16).fill(7);
    // Same ephemeral randomness is NOT fixed, so ciphertext differs run-to-run;
    // but decryption always recovers the plaintext.
    const p1 = encrypt([fe(9n)], cluster.publicKey, nonce);
    expect(decrypt(p1, cluster.privateKey)).toEqual([fe(9n)]);
  });

  test("payload shapes are correct", () => {
    const cluster = generateKeyPair();
    const payload = encrypt([fe(1n), fe(2n)], cluster.publicKey);
    expect(payload.ephemeralPublicKey.length).toBe(32);
    expect(payload.nonce.length).toBe(16);
    expect(payload.ciphertext.length).toBe(2);
  });
});

describe("seal to recipient (§6.4)", () => {
  test("only the recipient can open a sealed result", () => {
    const recipient = generateKeyPair();
    const other = generateKeyPair();
    const trade = [fe(100n), fe(10n)];
    const sealed = seal(trade, recipient.publicKey);

    expect(decrypt(sealed, recipient.privateKey)).toEqual(trade);
    expect(decrypt(sealed, other.privateKey)).not.toEqual(trade);
  });
});
