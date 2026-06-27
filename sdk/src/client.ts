/**
 * GlaselClient — high-level entry point for applications (§8.2). Reads the
 * cluster's public key, encrypts typed inputs, watches a computation to
 * completion, and decrypts results.
 */
import { hexToBytes, parseAbiItem, type Hex, type PublicClient } from "viem";
import { encrypt as cryptoEncrypt, decrypt as cryptoDecrypt, pubkeyToFieldPair } from "./crypto.js";
import {
  encodeValues,
  decodeValues,
  serializePayload,
  deserializePayload,
  type Schema,
  type FieldValue,
} from "./codec.js";
import {
  clusterManagerAbi,
  mxeFactoryAbi,
  coordinatorAbi,
  ComputationStatus,
} from "./abi.js";

export interface GlaselAddresses {
  coordinator: Hex;
  clusterManager: Hex;
  mxeFactory?: Hex;
}

export interface GlaselClientConfig {
  publicClient: PublicClient;
  addresses: GlaselAddresses;
}

export interface EncryptResult {
  encInputs: Hex;
  ephemeralPublicKey: Uint8Array;
  nonce: Uint8Array;
}

export interface ComputationResult {
  success: boolean;
  status: ComputationStatus;
  encResult: Hex;
}

export class GlaselClient {
  readonly publicClient: PublicClient;
  readonly addresses: GlaselAddresses;

  constructor(config: GlaselClientConfig) {
    this.publicClient = config.publicClient;
    this.addresses = config.addresses;
  }

  /** Combined X25519 public key for a cluster (32 bytes). */
  async getClusterPublicKey(clusterId: Hex): Promise<Uint8Array> {
    const key = (await this.publicClient.readContract({
      address: this.addresses.clusterManager,
      abi: clusterManagerAbi,
      functionName: "clusterPubKey",
      args: [clusterId],
    })) as Hex;
    return hexToBytes(key);
  }

  /** Resolve a cluster key from an MXE id (requires the MXEFactory address). */
  async getClusterPublicKeyForMXE(mxeId: Hex): Promise<Uint8Array> {
    if (!this.addresses.mxeFactory) throw new Error("mxeFactory address not configured");
    const mxe = (await this.publicClient.readContract({
      address: this.addresses.mxeFactory,
      abi: mxeFactoryAbi,
      functionName: "getMXE",
      args: [mxeId],
    })) as { clusterId: Hex };
    return this.getClusterPublicKey(mxe.clusterId);
  }

  /**
   * Encrypt a typed value to the cluster key, producing on-chain `encInputs`.
   *
   * Pass `recipientPublicKey` (your own X25519 public key) so the node seals the
   * result back to you and only you can decrypt it — it is prepended to the
   * inputs as two field elements, which the node strips off before evaluating the
   * circuit. This is required for the live network; omit it only for tests that
   * model the node themselves.
   */
  encrypt(params: {
    schema: Schema;
    value: Record<string, FieldValue>;
    clusterKey: Uint8Array;
    recipientPublicKey?: Uint8Array;
    nonce?: Uint8Array;
  }): EncryptResult {
    const encoded = encodeValues(params.schema, params.value);
    const plaintext = params.recipientPublicKey
      ? [...pubkeyToFieldPair(params.recipientPublicKey), ...encoded]
      : encoded;
    const payload = cryptoEncrypt(plaintext, params.clusterKey, params.nonce);
    return {
      encInputs: serializePayload(payload),
      ephemeralPublicKey: payload.ephemeralPublicKey,
      nonce: payload.nonce,
    };
  }

  /** Poll a computation until it completes, fails, or times out. */
  async watchComputation(params: {
    computationId: Hex;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<ComputationResult> {
    const timeoutMs = params.timeoutMs ?? 120_000;
    const pollMs = params.pollMs ?? 1_000;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      const comp = (await this.publicClient.readContract({
        address: this.addresses.coordinator,
        abi: coordinatorAbi,
        functionName: "getComputation",
        args: [params.computationId],
      })) as { status: number; encResult: Hex };

      const status = comp.status as ComputationStatus;
      if (status === ComputationStatus.Completed) {
        return { success: true, status, encResult: comp.encResult };
      }
      if (status === ComputationStatus.Failed || status === ComputationStatus.Slashed) {
        return { success: false, status, encResult: "0x" };
      }
      if (Date.now() >= deadline) {
        throw new Error(`watchComputation timed out after ${timeoutMs}ms`);
      }
      await sleep(pollMs);
    }
  }

  /**
   * Watch by listening for the `ComputationCompleted`/`ComputationFailed` events
   * (filtered by computationId) rather than polling mutable `getComputation`
   * state — more robust on load-balanced RPCs with no read-your-writes. On
   * completion it reads back the sealed `encResult`.
   */
  async watchComputationByEvent(params: {
    computationId: Hex;
    fromBlock?: bigint;
    timeoutMs?: number;
    pollMs?: number;
  }): Promise<ComputationResult> {
    const timeoutMs = params.timeoutMs ?? 120_000;
    const pollMs = params.pollMs ?? 1_500;
    const deadline = Date.now() + timeoutMs;
    const completedEvt = parseAbiItem(
      "event ComputationCompleted(bytes32 indexed computationId, bytes32 resultCommitment, bool callbackSucceeded)",
    );
    const failedEvt = parseAbiItem("event ComputationFailed(bytes32 indexed computationId, string reason)");
    const fromBlock = params.fromBlock ?? (await this.publicClient.getBlockNumber()) - 100n;

    for (;;) {
      const done = await this.publicClient.getLogs({
        address: this.addresses.coordinator,
        event: completedEvt,
        args: { computationId: params.computationId },
        fromBlock,
      });
      if (done.length > 0) {
        const comp = (await this.publicClient.readContract({
          address: this.addresses.coordinator,
          abi: coordinatorAbi,
          functionName: "getComputation",
          args: [params.computationId],
        })) as { status: number; encResult: Hex };
        return { success: true, status: ComputationStatus.Completed, encResult: comp.encResult };
      }
      const failed = await this.publicClient.getLogs({
        address: this.addresses.coordinator,
        event: failedEvt,
        args: { computationId: params.computationId },
        fromBlock,
      });
      if (failed.length > 0) {
        return { success: false, status: ComputationStatus.Failed, encResult: "0x" };
      }
      if (Date.now() >= deadline) {
        throw new Error(`watchComputationByEvent timed out after ${timeoutMs}ms`);
      }
      await sleep(pollMs);
    }
  }

  /** Decrypt and decode a result that was sealed to `privateKey`. */
  decryptResult(params: {
    encResult: Hex;
    privateKey: Uint8Array;
    schema: Schema;
  }): Record<string, FieldValue> {
    const payload = deserializePayload(params.encResult);
    const elements = cryptoDecrypt(payload, params.privateKey);
    return decodeValues(params.schema, elements);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
