/**
 * EIP-2612 gasless approval for the CONFIDE fee token.
 *
 * Instead of a standing `approve` tx before every computation, the user signs a
 * permit off-chain; the signature is submitted alongside (or just before) the
 * commission. `$CONFIDE` is `ERC20Permit`, so this is a standard EIP-2612 flow.
 */
import { type Address, type Hex, type PublicClient, type WalletClient, hexToSignature } from "viem";

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

const permitReadAbi = [
  { type: "function", name: "nonces", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "name", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
] as const;

export interface SignedPermit {
  owner: Address;
  spender: Address;
  value: bigint;
  deadline: bigint;
  v: number;
  r: Hex;
  s: Hex;
}

export interface PermitDomain {
  name: string;
  chainId: number;
  nonce: bigint;
}

/** Build + sign an EIP-2612 permit given an explicit domain (no chain reads). */
export async function signPermitWithDomain(
  walletClient: WalletClient,
  token: Address,
  owner: Address,
  spender: Address,
  value: bigint,
  deadline: bigint,
  domain: PermitDomain,
): Promise<SignedPermit> {
  // Prefer the wallet's local account (signs offline); fall back to the owner
  // address (JSON-RPC account) only if no local account is attached.
  const signature = await walletClient.signTypedData({
    account: walletClient.account ?? owner,
    domain: { name: domain.name, version: "1", chainId: domain.chainId, verifyingContract: token },
    types: PERMIT_TYPES,
    primaryType: "Permit",
    message: { owner, spender, value, nonce: domain.nonce, deadline },
  });
  const { r, s, v } = hexToSignature(signature);
  return { owner, spender, value, deadline, v: Number(v), r, s };
}

/** Read nonce/name/chainId from chain, then build + sign the permit. */
export async function signPermit(params: {
  publicClient: PublicClient;
  walletClient: WalletClient;
  token: Address;
  owner: Address;
  spender: Address;
  value: bigint;
  deadline?: bigint;
}): Promise<SignedPermit> {
  const deadline = params.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 3600);
  const [nonce, name, chainId] = await Promise.all([
    params.publicClient.readContract({
      address: params.token,
      abi: permitReadAbi,
      functionName: "nonces",
      args: [params.owner],
    }) as Promise<bigint>,
    params.publicClient.readContract({ address: params.token, abi: permitReadAbi, functionName: "name" }) as Promise<string>,
    params.publicClient.getChainId(),
  ]);
  return signPermitWithDomain(params.walletClient, params.token, params.owner, params.spender, params.value, deadline, {
    name,
    chainId,
    nonce,
  });
}
