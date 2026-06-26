/** Minimal ABIs for the contract reads the SDK performs. */

export const clusterManagerAbi = [
  {
    type: "function",
    name: "clusterPubKey",
    stateMutability: "view",
    inputs: [{ name: "clusterId", type: "bytes32" }],
    outputs: [{ type: "bytes32" }],
  },
  {
    type: "function",
    name: "isActive",
    stateMutability: "view",
    inputs: [{ name: "clusterId", type: "bytes32" }],
    outputs: [{ type: "bool" }],
  },
] as const;

export const mxeFactoryAbi = [
  {
    type: "function",
    name: "getMXE",
    stateMutability: "view",
    inputs: [{ name: "mxeId", type: "bytes32" }],
    outputs: [
      {
        type: "tuple",
        components: [
          { name: "clusterId", type: "bytes32" },
          { name: "protocol", type: "uint8" },
          { name: "allowedComputationDefs", type: "bytes32[]" },
          { name: "owner", type: "address" },
          { name: "active", type: "bool" },
          { name: "createdAt", type: "uint64" },
          { name: "fallbackClusterId", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

const computationTuple = {
  type: "tuple",
  components: [
    { name: "mxeId", type: "bytes32" },
    { name: "compDefId", type: "bytes32" },
    { name: "encInputs", type: "bytes" },
    { name: "inputIpfsCid", type: "string" },
    { name: "callbackContract", type: "address" },
    { name: "callbackSelector", type: "bytes4" },
    { name: "callbackGasLimit", type: "uint256" },
    { name: "feeDeposit", type: "uint256" },
    { name: "priorityFee", type: "uint256" },
    { name: "requester", type: "address" },
    { name: "commissionedAt", type: "uint64" },
    { name: "deadline", type: "uint64" },
    { name: "status", type: "uint8" },
    { name: "encResult", type: "bytes" },
    { name: "resultCommitment", type: "bytes32" },
    { name: "callbackSucceeded", type: "bool" },
    { name: "participants", type: "address[]" },
    { name: "threshold", type: "uint32" },
  ],
} as const;

export const coordinatorAbi = [
  {
    type: "function",
    name: "getComputation",
    stateMutability: "view",
    inputs: [{ name: "computationId", type: "bytes32" }],
    outputs: [computationTuple],
  },
  {
    type: "function",
    name: "statusOf",
    stateMutability: "view",
    inputs: [{ name: "computationId", type: "bytes32" }],
    outputs: [{ type: "uint8" }],
  },
  {
    type: "event",
    name: "ComputationCompleted",
    inputs: [
      { name: "computationId", type: "bytes32", indexed: true },
      { name: "resultCommitment", type: "bytes32", indexed: false },
      { name: "callbackSucceeded", type: "bool", indexed: false },
    ],
  },
  {
    type: "event",
    name: "ComputationFailed",
    inputs: [
      { name: "computationId", type: "bytes32", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },
] as const;

/** Mirrors Types.ComputationStatus. */
export enum ComputationStatus {
  None = 0,
  Pending = 1,
  InProgress = 2,
  Completed = 3,
  Failed = 4,
  Slashed = 5,
}
