/**
 * High-level encryption: combines X25519 ECDH (§6.1) with the Rescue KDF + CTR
 * cipher (§6.2) into the encrypt / decrypt / seal operations used by clients and
 * the (modelled) MPC nodes.
 *
 * Encryption is to a recipient's X25519 public key. The client generates an
 * ephemeral keypair, derives a shared secret via ECDH, runs the Rescue KDF to a
 * 5-element key, and CTR-encrypts the plaintext field elements. The recipient
 * (a cluster computing its combined secret in MPC, or an individual whose key a
 * result was sealed to) reverses it with the ephemeral public key + its private
 * key. "Sealing" a result is simply encrypting to a different recipient key.
 */
import { bytesToNumberBE } from "@noble/curves/abstract/utils";
import { deriveKey, ctrEncrypt, ctrDecrypt } from "./rescue.js";
import { generateKeyPair, sharedSecretFe } from "./x25519.js";

export interface EncryptedPayload {
  /** CTR ciphertext as field elements. */
  ciphertext: bigint[];
  /** Ephemeral X25519 public key (32 bytes). */
  ephemeralPublicKey: Uint8Array;
  /** 16-byte nonce. */
  nonce: Uint8Array;
}

function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(16));
}

/**
 * Encode a 32-byte X25519 public key as two field elements (high 16 bytes, low
 * 16 bytes). Carried as the first two elements of sealed computation inputs so a
 * node can re-seal the result to the requester. Mirrors the Rust
 * `glasel_crypto::pubkey_to_field_pair`.
 */
export function pubkeyToFieldPair(pk: Uint8Array): [bigint, bigint] {
  if (pk.length !== 32) throw new Error("public key must be 32 bytes");
  return [bytesToNumberBE(pk.slice(0, 16)), bytesToNumberBE(pk.slice(16, 32))];
}

/**
 * Encrypt plaintext field elements to `recipientPublicKey`.
 * @param nonce optional 16-byte nonce (defaults to random); pass for determinism in tests.
 */
export function encrypt(
  plaintext: bigint[],
  recipientPublicKey: Uint8Array,
  nonce: Uint8Array = randomNonce(),
): EncryptedPayload {
  if (nonce.length !== 16) throw new Error("nonce must be 16 bytes");
  const ephemeral = generateKeyPair();
  const secret = sharedSecretFe(ephemeral.privateKey, recipientPublicKey);
  const key = deriveKey(secret);
  const nonceFe = bytesToNumberBE(nonce);
  const ciphertext = ctrEncrypt(plaintext, key, nonceFe);
  return { ciphertext, ephemeralPublicKey: ephemeral.publicKey, nonce };
}

/** Decrypt a payload using the recipient's X25519 private key. */
export function decrypt(payload: EncryptedPayload, recipientPrivateKey: Uint8Array): bigint[] {
  const secret = sharedSecretFe(recipientPrivateKey, payload.ephemeralPublicKey);
  const key = deriveKey(secret);
  const nonceFe = bytesToNumberBE(payload.nonce);
  return ctrDecrypt(payload.ciphertext, key, nonceFe);
}

/**
 * Seal plaintext to a recipient — semantically the re-encryption an MPC circuit
 * performs (§6.4). Identical mechanics to {@link encrypt}, named for intent.
 */
export const seal = encrypt;
