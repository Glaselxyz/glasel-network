/**
 * Generates cross-language test vectors consumed by the Rust glasel-crypto
 * crate (node/crates/glasel-crypto/tests/vectors.json). Asserting the Rust
 * implementation reproduces these proves the node and SDK encryption stacks are
 * byte-for-byte identical.
 *
 * Run: bun run scripts/gen-vectors.ts
 */
import { bytesToHex } from "viem";
import { permute, rescueHash, deriveKey, ctrEncrypt } from "../src/rescue.js";
import { generateKeyPair, sharedSecretFe } from "../src/x25519.js";
import { encrypt } from "../src/crypto.js";
import { serializePayload } from "../src/codec.js";

const dec = (v: bigint[]) => v.map((x) => x.toString());

// 1. permutation
const permInput = [1n, 2n, 3n, 4n, 5n];
const permOutput = permute(permInput);

// 2. sponge hash
const hashOutput = rescueHash([42n], 5);

// 3. CTR cipher (deterministic given key + nonceFe)
const secret = 99n;
const key = deriveKey(secret);
const nonceFe = 0x1234567890abcdefn;
const plaintext = [1n, 2n, 3n, 4n, 5n, 6n, 7n];
const ciphertext = ctrEncrypt(plaintext, key, nonceFe);

// 4. ECDH
const a = generateKeyPair();
const b = generateKeyPair();
const ecdhShared = sharedSecretFe(a.privateKey, b.publicKey);

// 5. sealed payload (Rust must decrypt this)
const recipient = generateKeyPair();
const sealedPlain = [11n, 22n, 33n, 44n, 55n, 66n];
const payload = encrypt(sealedPlain, recipient.publicKey);
const sealedHex = serializePayload(payload);

const vectors = {
  permutation: { input: dec(permInput), output: dec(permOutput) },
  rescueHash: { input: ["42"], outLen: 5, output: dec(hashOutput) },
  ctr: {
    secret: secret.toString(),
    nonceFe: nonceFe.toString(),
    plaintext: dec(plaintext),
    ciphertext: dec(ciphertext),
  },
  ecdh: {
    privateKey: bytesToHex(a.privateKey),
    peerPublicKey: bytesToHex(b.publicKey),
    sharedFe: ecdhShared.toString(),
  },
  sealed: {
    recipientPrivateKey: bytesToHex(recipient.privateKey),
    payloadHex: sealedHex,
    expectedPlaintext: dec(sealedPlain),
  },
};

const outPath = new URL(
  "../../node/crates/glasel-crypto/tests/vectors.json",
  import.meta.url,
).pathname;
await Bun.write(outPath, JSON.stringify(vectors, null, 2));
console.log(`wrote ${outPath}`);
