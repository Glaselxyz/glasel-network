/** Write-side ABIs + events used only by the e2e orchestrator. */
export const tokenAbi = [
  { type: "function", name: "MINTER_ROLE", stateMutability: "view", inputs: [], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "grantRole", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "address" }], outputs: [] },
  { type: "function", name: "mint", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [{ type: "bool" }] },
] as const;

export const registryAbi = [
  { type: "function", name: "registerNode", stateMutability: "nonpayable", inputs: [{ type: "bytes" }, { type: "bytes32" }, { type: "bytes32" }, { type: "string" }], outputs: [] },
] as const;

export const stakingAbi = [
  { type: "function", name: "stake", stateMutability: "nonpayable", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [] },
] as const;

export const clusterAbi = [
  { type: "function", name: "proposeCluster", stateMutability: "nonpayable", inputs: [{ type: "address[]" }, { type: "uint8" }, { type: "uint32" }, { type: "address" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "activateCluster", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }, { type: "address[]" }], outputs: [] },
  { type: "function", name: "setBlsGroupKey", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint256[4]" }], outputs: [] },
  { type: "event", name: "ClusterProposed", inputs: [{ name: "clusterId", type: "bytes32", indexed: true }, { name: "nodes", type: "address[]", indexed: false }, { name: "minThreshold", type: "uint32", indexed: false }] },
] as const;

export const mxeAbi = [
  { type: "function", name: "createMXE", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "uint8" }, { type: "bytes32[]" }, { type: "bytes32" }], outputs: [{ type: "bytes32" }] },
  { type: "event", name: "MXECreated", inputs: [{ name: "mxeId", type: "bytes32", indexed: true }, { name: "clusterId", type: "bytes32", indexed: false }, { name: "protocol", type: "uint8", indexed: false }] },
] as const;

export const compRegAbi = [
  { type: "function", name: "deployComputationDefinition", stateMutability: "nonpayable", inputs: [{ type: "bytes" }, { type: "string" }, { type: "uint32" }, { type: "uint32" }, { type: "uint32" }], outputs: [{ type: "bytes32" }] },
  { type: "event", name: "ComputationDefinitionDeployed", inputs: [{ name: "compDefId", type: "bytes32", indexed: true }, { name: "deployer", type: "address", indexed: true }, { name: "estimatedGates", type: "uint32", indexed: false }] },
] as const;

export const coordWriteAbi = [
  { type: "function", name: "commission", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes32" }, { type: "bytes" }, { type: "string" }, { type: "address" }, { type: "bytes4" }, { type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bytes32" }] },
  { type: "function", name: "submitResult", stateMutability: "nonpayable", inputs: [{ type: "bytes32" }, { type: "bytes" }, { type: "uint256[2]" }], outputs: [] },
  { type: "event", name: "ComputationRequested", inputs: [{ name: "computationId", type: "bytes32", indexed: true }, { name: "mxeId", type: "bytes32", indexed: true }, { name: "compDefId", type: "bytes32", indexed: true }, { name: "encInputs", type: "bytes", indexed: false }, { name: "inputIpfsCid", type: "string", indexed: false }, { name: "deadline", type: "uint64", indexed: false }] },
] as const;
