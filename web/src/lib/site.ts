import { activeChain, chainKey } from "./chain";

/** Human network label per deployment (used in marketing copy). */
const NETWORK_LABEL: Record<string, string> = {
  "base-sepolia": "Base",
  "robinhood-testnet": "Robinhood Chain",
  "robinhood-mainnet": "Robinhood Chain",
};
const networkLabel = NETWORK_LABEL[chainKey] ?? activeChain.name;

/** Where developers get native gas ETH for the current chain. */
const GAS_FAUCET: Record<string, string> = {
  "base-sepolia": "a public Base Sepolia ETH faucet (Coinbase Developer Platform, Alchemy)",
  "robinhood-testnet": "the Robinhood Chain testnet faucet (faucet.testnet.chain.robinhood.com)",
  "robinhood-mainnet": "a bridge to Robinhood Chain",
};
const gasFaucetHint = GAS_FAUCET[chainKey] ?? "a public faucet for your network";

export const site = {
  name: "Glasel",
  title: "Glasel",
  tagline: "Private computation on a public chain.",
  description: `Glasel is a confidential computing network on ${networkLabel}. Data goes in encrypted, the network computes on it without ever seeing it, and the result comes back verified on-chain. Nobody — not a node, not Glasel, not a bot — ever sees your users' data.`,
  networkLabel,
  gasFaucetHint,
  url: "https://glasel.network",
  github: "https://github.com/Glaselxyz/glasel-network",
  x: "https://x.com/glasel",
  chain: {
    name: activeChain.name,
    chainId: activeChain.id,
    explorer: activeChain.blockExplorers?.default.url ?? "",
  },
};

export type ContractRow = { name: string; address: string; note: string };

type Deployment = {
  contracts: ContractRow[];
  addresses: { coordinator: string; token: string; staking: string; clusterManager: string; registry: string };
  clusterId: string;
};

/** Live deployment — Base Sepolia (chainId 84532). See docs/COMPATIBILITY.md. */
const baseSepoliaDeployment: Deployment = {
  contracts: [
    { name: "ComputationCoordinator", address: "0x1FbB367715D26F752357dc7ee60b957CB40d8452", note: "Lifecycle orchestrator" },
    { name: "GlaselToken", address: "0xa9E29104Fa0287db5bb5BB048a729C93f746b09C", note: "GLASEL — stake & fees" },
    { name: "StakingManager", address: "0x957100d7a9B2E85958D8e1Be503977b2b1D8a01A", note: "Stake, rewards, slashing" },
    { name: "ClusterManager", address: "0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523", note: "Cluster formation & keys" },
    { name: "NodeRegistry", address: "0xBA585F1f16b57e1443B1EA01143aa56D3fe432e0", note: "glaseld node identities" },
    { name: "MXEFactory", address: "0x7CE839Eea76EA1F2F808E4c831a0910A23425f30", note: "MPC execution environments" },
    { name: "ComputationRegistry", address: "0x359e6fd81BD1EAE7F4ae7a7Fdc29b1986f679F72", note: "Circuit definitions" },
    { name: "FeeOracle", address: "0x0d3cCA64CaAC0b9c1CBaE9420898A33d8b3615Fc", note: "Fee & deadline pricing" },
  ],
  addresses: {
    coordinator: "0x1FbB367715D26F752357dc7ee60b957CB40d8452",
    token: "0xa9E29104Fa0287db5bb5BB048a729C93f746b09C",
    staking: "0x957100d7a9B2E85958D8e1Be503977b2b1D8a01A",
    clusterManager: "0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523",
    registry: "0xBA585F1f16b57e1443B1EA01143aa56D3fe432e0",
  },
  clusterId: "0xdcc20d23e53232465d569e2498bb798a6f7e3b54b5f9d16ad2b0b0d2ba1eefe2",
};

/**
 * Deployment sourced from env — for chains not yet baked in (Robinhood). After
 * deploying, set these on Vercel (NEXT_PUBLIC_*) and the site picks them up.
 */
const env = (k: string) => process.env[k] ?? "";
function envDeployment(): Deployment {
  const a = {
    coordinator: env("NEXT_PUBLIC_COORDINATOR"),
    token: env("NEXT_PUBLIC_TOKEN"),
    staking: env("NEXT_PUBLIC_STAKING"),
    clusterManager: env("NEXT_PUBLIC_CLUSTER_MANAGER"),
    registry: env("NEXT_PUBLIC_REGISTRY"),
  };
  return {
    addresses: a,
    clusterId: env("NEXT_PUBLIC_CLUSTER_ID"),
    contracts: [
      { name: "ComputationCoordinator", address: a.coordinator, note: "Lifecycle orchestrator" },
      { name: "GLS", address: a.token, note: "GLS — stake & fees" },
      { name: "StakingManager", address: a.staking, note: "Stake, rewards, slashing" },
      { name: "ClusterManager", address: a.clusterManager, note: "Cluster formation & keys" },
      { name: "NodeRegistry", address: a.registry, note: "glaseld node identities" },
      { name: "MXEFactory", address: env("NEXT_PUBLIC_MXE_FACTORY"), note: "MPC execution environments" },
      { name: "ComputationRegistry", address: env("NEXT_PUBLIC_COMP_REGISTRY"), note: "Circuit definitions" },
      { name: "FeeOracle", address: env("NEXT_PUBLIC_FEE_ORACLE"), note: "Fee & deadline pricing" },
    ].filter((c) => c.address),
  };
}

const DEPLOYMENTS: Record<string, Deployment> = {
  "base-sepolia": baseSepoliaDeployment,
  "robinhood-testnet": envDeployment(),
  "robinhood-mainnet": envDeployment(),
};
const active = DEPLOYMENTS[chainKey] ?? baseSepoliaDeployment;

/** Contracts table for the current chain. */
export const contracts: ContractRow[] = active.contracts;

/** Named address lookups for app routes (faucet, status). Single source of truth. */
export const addresses = active.addresses;

/** Live operator cluster id on the current chain. */
export const clusterId = active.clusterId;

/** Default public RPC; override with NEXT_PUBLIC_RPC_URL / RPC_URL (see docs/RPC.md). */
export const defaultRpcUrl =
  process.env.NEXT_PUBLIC_RPC_URL || activeChain.rpcUrls.default.http[0]!;

export type NavItem = { title: string; href: string };
export type NavGroup = { title: string; items: NavItem[] };

export const docsNav: NavGroup[] = [
  {
    title: "Get started",
    items: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
      { title: "Core concepts", href: "/docs/concepts" },
    ],
  },
  {
    title: "Protocol",
    items: [
      { title: "Architecture", href: "/docs/architecture" },
      { title: "Computation lifecycle", href: "/docs/lifecycle" },
      { title: "Encryption stack", href: "/docs/encryption" },
      { title: "Security model", href: "/docs/security" },
    ],
  },
  {
    title: "Build",
    items: [
      { title: "SDK reference", href: "/docs/sdk" },
      { title: "Circuits (Arcis)", href: "/docs/circuits" },
      { title: "Run a node", href: "/docs/node" },
    ],
  },
  {
    title: "Network",
    items: [{ title: "Deployments", href: "/docs/network" }],
  },
];

export const flatDocs: NavItem[] = docsNav.flatMap((g) => g.items);
