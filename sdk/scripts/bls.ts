/**
 * Threshold-BLS signing for the e2e/testnet harnesses.
 *
 * The on-chain result path is BLS-only (`submitResult(bytes32,bytes,uint256[2])`),
 * verified against the cluster's BN254 group key. Rather than reimplement BN254
 * pairing-friendly signing in TS, we shell out to the same Rust `bls-sign` binary
 * the contract tests use (FFI), so the off-chain signer and on-chain verifier are
 * guaranteed to agree. `σ = sk·H(m)` equals the threshold-combined signature.
 *
 * Requires the binary built: `cargo build -p glasel-bls --bin bls-sign`.
 */
const BLS_SIGN = new URL("../../node/target/debug/bls-sign", import.meta.url).pathname;

/**
 * Fixed group secret for the SELF-CONTAINED TEST HARNESS ONLY (`testnet.ts`,
 * `loadtest.ts`). Those scripts stand up their own throwaway cluster and register
 * this key's pubkey on it — so a public value here is harmless. The LIVE cluster
 * (`golive-wire.ts`) uses a RANDOM per-cluster secret (see `randomGroupSecret` /
 * `groupKeyForSecret`), persisted only in the gitignored `golive-state*.json`.
 * NEVER use this constant as a production cluster key.
 */
export const GROUP_SK = "12345678901234567890123456789";

export type GroupKey = readonly [bigint, bigint, bigint, bigint];
export type Sig = readonly [bigint, bigint];

/** A fresh random group secret (31 bytes → always < r), as hex for a daemon
 *  config `bls_group_secret`. Persist it (gitignored); never hardcode/commit it. */
export function randomGroupSecret(): string {
  const b = new Uint8Array(31);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

/** The G2 group public key for `setBlsGroupKey`, computed from an arbitrary
 *  hex secret via the same `bls-sign` binary the daemon + contract use (so the
 *  registered key always matches what the daemon will sign with). */
export function groupKeyForSecret(secretHex: string): GroupKey {
  const dec = BigInt(secretHex.startsWith("0x") ? secretHex : "0x" + secretHex).toString();
  const proc = Bun.spawnSync([BLS_SIGN, dec, "0x" + "00".repeat(32)]);
  if (!proc.success) {
    throw new Error(`bls-sign failed (built? cargo build -p glasel-bls --bin bls-sign):\n${proc.stderr.toString()}`);
  }
  const out = proc.stdout.toString().trim().replace(/^0x/, "");
  const word = (i: number) => BigInt("0x" + out.slice(i * 64, i * 64 + 64));
  return [word(0), word(1), word(2), word(3)];
}

/** Sign `messageHex` (0x-prefixed) with the group key. Returns the on-chain
 *  encodings: G2 group public key `[x.c1,x.c0,y.c1,y.c0]` and G1 sig `[x,y]`. */
export function blsSign(messageHex: string): { pk: GroupKey; sig: Sig } {
  const proc = Bun.spawnSync([BLS_SIGN, GROUP_SK, messageHex]);
  if (!proc.success) {
    throw new Error(`bls-sign failed (built? cargo build -p glasel-bls --bin bls-sign):\n${proc.stderr.toString()}`);
  }
  const out = proc.stdout.toString().trim().replace(/^0x/, "");
  const word = (i: number) => BigInt("0x" + out.slice(i * 64, i * 64 + 64));
  return { pk: [word(0), word(1), word(2), word(3)], sig: [word(4), word(5)] };
}

/** The group public key for `setBlsGroupKey` (independent of any message). */
export function blsGroupKey(): GroupKey {
  return blsSign("0x" + "00".repeat(32)).pk;
}
