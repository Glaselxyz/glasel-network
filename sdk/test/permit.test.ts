import { test, expect } from "bun:test";
import { createWalletClient, http, recoverTypedDataAddress, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { signPermitWithDomain } from "../src/permit.js";

// Offline: build + sign an EIP-2612 permit, then recover the signer from the
// typed data and confirm it matches the owner — proves the permit is well-formed
// and verifiable on-chain (token.permit recovers the same way).
test("signPermitWithDomain produces a recoverable EIP-2612 signature", async () => {
  const account = privateKeyToAccount("0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80");
  const wallet = createWalletClient({ account, chain: baseSepolia, transport: http("http://127.0.0.1:8545") });

  const token = "0x5E59128684FBA57202dD603722F36b3183a354D1" as Address;
  const spender = "0x27E187D936C0C03BA72e8A4842ab9D77dA791FF5" as Address;
  const value = 5_000_000_000_000_000_000n; // 5 CONFIDE
  const deadline = 1_900_000_000n;
  const domain = { name: "Confide", chainId: 84532, nonce: 0n };

  const p = await signPermitWithDomain(wallet, token, account.address, spender, value, deadline, domain);

  expect(p.owner).toBe(account.address);
  expect(p.value).toBe(value);
  expect(p.v === 27 || p.v === 28).toBe(true);

  const recovered = await recoverTypedDataAddress({
    domain: { name: domain.name, version: "1", chainId: domain.chainId, verifyingContract: token },
    types: {
      Permit: [
        { name: "owner", type: "address" },
        { name: "spender", type: "address" },
        { name: "value", type: "uint256" },
        { name: "nonce", type: "uint256" },
        { name: "deadline", type: "uint256" },
      ],
    },
    primaryType: "Permit",
    message: { owner: account.address, spender, value, nonce: domain.nonce, deadline },
    signature: (p.r + p.s.slice(2) + p.v.toString(16)) as `0x${string}`,
  });
  expect(recovered.toLowerCase()).toBe(account.address.toLowerCase());
});
