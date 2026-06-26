/**
 * X25519 key generation and ECDH (§6.1). Clients encrypt inputs to a cluster's
 * combined X25519 public key (derived off-chain via DKG); the same ECDH primitive
 * seals results to an individual recipient.
 */
import { x25519 } from "@noble/curves/ed25519";
import { bytesToNumberBE } from "@noble/curves/abstract/utils";
import { fe } from "./field.js";

export interface KeyPair {
  privateKey: Uint8Array; // 32 bytes
  publicKey: Uint8Array; // 32 bytes
}

export function generateKeyPair(): KeyPair {
  const privateKey = x25519.utils.randomSecretKey();
  return { privateKey, publicKey: x25519.getPublicKey(privateKey) };
}

export function publicKeyFromPrivate(privateKey: Uint8Array): Uint8Array {
  return x25519.getPublicKey(privateKey);
}

/** Raw 32-byte ECDH shared secret. */
export function sharedSecret(privateKey: Uint8Array, peerPublicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, peerPublicKey);
}

/** ECDH shared secret reduced into F_p, ready for the Rescue KDF. */
export function sharedSecretFe(privateKey: Uint8Array, peerPublicKey: Uint8Array): bigint {
  return fe(bytesToNumberBE(sharedSecret(privateKey, peerPublicKey)));
}
