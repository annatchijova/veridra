export const veridraReceiptRegistryAbi = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "publisher_",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [
      {
        "internalType": "uint64",
        "name": "observedAt",
        "type": "uint64"
      },
      {
        "internalType": "uint256",
        "name": "currentTimestamp",
        "type": "uint256"
      }
    ],
    "name": "FutureObservation",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidClaim",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidEvidence",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidProvenance",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidPublisher",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "caller",
        "type": "address"
      }
    ],
    "name": "UnauthorizedPublisher",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "receiptId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "transactionHash",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "publisher",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "uint16",
        "name": "schemaVersion",
        "type": "uint16"
      },
      {
        "indexed": false,
        "internalType": "uint8",
        "name": "evidenceAssurance",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "enum PaymentAdjudicator.Verdict",
        "name": "verdict",
        "type": "uint8"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "providerId",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "observedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "uint64",
        "name": "recordedAt",
        "type": "uint64"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "claimDigest",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "evidenceDigest",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "enum PaymentAdjudicator.CheckStatus[7]",
        "name": "checks",
        "type": "uint8[7]"
      }
    ],
    "name": "ReceiptPublished",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "RECEIPT_SCHEMA_VERSION",
    "outputs": [
      {
        "internalType": "uint16",
        "name": "",
        "type": "uint16"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "RPC_ATTESTED",
    "outputs": [
      {
        "internalType": "uint8",
        "name": "",
        "type": "uint8"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "receiptId",
        "type": "bytes32"
      }
    ],
    "name": "getReceipt",
    "outputs": [
      {
        "components": [
          {
            "internalType": "uint16",
            "name": "schemaVersion",
            "type": "uint16"
          },
          {
            "internalType": "uint8",
            "name": "evidenceAssurance",
            "type": "uint8"
          },
          {
            "internalType": "enum PaymentAdjudicator.Verdict",
            "name": "verdict",
            "type": "uint8"
          },
          {
            "internalType": "enum PaymentAdjudicator.CheckStatus[7]",
            "name": "checks",
            "type": "uint8[7]"
          },
          {
            "internalType": "bytes32",
            "name": "transactionHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "chainId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "blockNumber",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "blockHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "providerId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "observedAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "recordedAt",
            "type": "uint64"
          },
          {
            "internalType": "bytes32",
            "name": "claimDigest",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "evidenceDigest",
            "type": "bytes32"
          },
          {
            "components": [
              {
                "internalType": "bytes32",
                "name": "transactionHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "chainId",
                "type": "uint256"
              },
              {
                "internalType": "bool",
                "name": "assertsSender",
                "type": "bool"
              },
              {
                "internalType": "address",
                "name": "sender",
                "type": "address"
              },
              {
                "internalType": "bool",
                "name": "assertsRecipient",
                "type": "bool"
              },
              {
                "internalType": "address",
                "name": "recipient",
                "type": "address"
              },
              {
                "internalType": "bool",
                "name": "assertsAsset",
                "type": "bool"
              },
              {
                "internalType": "address",
                "name": "asset",
                "type": "address"
              },
              {
                "internalType": "bool",
                "name": "assertsAmount",
                "type": "bool"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              }
            ],
            "internalType": "struct PaymentAdjudicator.Claim",
            "name": "claim",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "bool",
                "name": "available",
                "type": "bool"
              },
              {
                "internalType": "bytes32",
                "name": "transactionHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "chainId",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "blockNumber",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "blockHash",
                "type": "bytes32"
              },
              {
                "internalType": "bool",
                "name": "successful",
                "type": "bool"
              },
              {
                "internalType": "address",
                "name": "sender",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "recipient",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "asset",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "transactionPayloadDigest",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "receiptPayloadDigest",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "logsDigest",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "finalityPolicyId",
                "type": "bytes32"
              },
              {
                "internalType": "uint64",
                "name": "requiredConfirmations",
                "type": "uint64"
              },
              {
                "internalType": "uint64",
                "name": "observedConfirmations",
                "type": "uint64"
              }
            ],
            "internalType": "struct PaymentAdjudicator.Evidence",
            "name": "evidence",
            "type": "tuple"
          }
        ],
        "internalType": "struct VeridraReceiptRegistry.Receipt",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "transactionHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "chainId",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "assertsSender",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "assertsRecipient",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "assertsAsset",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "asset",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "assertsAmount",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "internalType": "struct PaymentAdjudicator.Claim",
        "name": "claim",
        "type": "tuple"
      },
      {
        "components": [
          {
            "internalType": "bool",
            "name": "available",
            "type": "bool"
          },
          {
            "internalType": "bytes32",
            "name": "transactionHash",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "chainId",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "blockNumber",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "blockHash",
            "type": "bytes32"
          },
          {
            "internalType": "bool",
            "name": "successful",
            "type": "bool"
          },
          {
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "asset",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "transactionPayloadDigest",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "receiptPayloadDigest",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "logsDigest",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "finalityPolicyId",
            "type": "bytes32"
          },
          {
            "internalType": "uint64",
            "name": "requiredConfirmations",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "observedConfirmations",
            "type": "uint64"
          }
        ],
        "internalType": "struct PaymentAdjudicator.Evidence",
        "name": "evidence",
        "type": "tuple"
      },
      {
        "internalType": "bytes32",
        "name": "providerId",
        "type": "bytes32"
      },
      {
        "internalType": "uint64",
        "name": "observedAt",
        "type": "uint64"
      }
    ],
    "name": "publish",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "receiptId",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "publisher",
    "outputs": [
      {
        "internalType": "address",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  }
] as const;
