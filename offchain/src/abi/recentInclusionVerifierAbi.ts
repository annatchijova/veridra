export const recentInclusionVerifierAbi = [
  {
    inputs: [
      { internalType: "uint64", name: "blockNumber", type: "uint64" },
      { internalType: "bytes32", name: "expectedBlockHash", type: "bytes32" },
      { internalType: "bytes", name: "rawHeader", type: "bytes" },
      { internalType: "uint64", name: "transactionIndex", type: "uint64" },
      { internalType: "bytes32", name: "expectedTransactionHash", type: "bytes32" },
      { internalType: "bytes", name: "rawTransaction", type: "bytes" },
      { internalType: "bytes[]", name: "transactionProof", type: "bytes[]" },
      { internalType: "bytes", name: "rawReceipt", type: "bytes" },
      { internalType: "bytes[]", name: "receiptProof", type: "bytes[]" },
    ],
    name: "verifyRecentInclusion",
    outputs: [{ internalType: "bool", name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
