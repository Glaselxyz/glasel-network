export const site = {
  name: "Glasel",
  title: "Glasel",
  tagline: "Private computation on a public chain.",
  description:
    "Glasel is a confidential computing network on Base. Data goes in encrypted, the network computes on it without ever seeing it, and the result comes back verified on-chain. Nobody — not a node, not Glasel, not a bot — ever sees your users' data.",
  url: "https://glasel.network",
  github: "https://github.com/confide-network/confide",
  chain: {
    name: "Base Sepolia",
    chainId: 84532,
    explorer: "https://sepolia.basescan.org",
  },
};

export type ContractRow = { name: string; address: string; note: string };

/** Live deployment — Base Sepolia (chainId 84532). See docs/TESTNET.md. */
export const contracts: ContractRow[] = [
  { name: "ComputationCoordinator", address: "0x8Da86E718964678f1Fd04467D3d7bc4B5A439A74", note: "Lifecycle orchestrator" },
  { name: "ConfideToken", address: "0x4550C5C3A5Ce9e62b09F956Ae895D5B931493Bd9", note: "CONFIDE — stake & fees" },
  { name: "StakingManager", address: "0xC320Dd6bAEc75D5D095DcE3008C848416B557ebf", note: "Stake, rewards, slashing" },
  { name: "ClusterManager", address: "0xeD336A97691Cdba986383eD1BAA942F49254CcBe", note: "Cluster formation & keys" },
  { name: "NodeRegistry", address: "0x585ef27873E278A235C227d504744F0FbF65b13A", note: "arxOS node identities" },
  { name: "MXEFactory", address: "0x102fB9E05A5b61C0C654ff58B2d9F92f3a7bdE46", note: "MPC execution environments" },
  { name: "ComputationRegistry", address: "0x611CbA595EA91E141a5292FD973Ef87c195afE3B", note: "Circuit definitions" },
  { name: "FeeOracle", address: "0xe07808DC4608d4F45cbE01667c9b69Af2dC7932C", note: "Fee & deadline pricing" },
];

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
