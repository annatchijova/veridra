import { getAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { recentInclusionVerifierAbi } from "./abi/recentInclusionVerifierAbi.js";
import { derivePaymentFactFromRawValues, type RawPaymentFact } from "./paymentFacts.js";
import type { AcquiredRecentInclusionProof } from "./proofRpc.js";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER);
const MAX_PROOF_NODES = 20;
const MAX_NODE_BYTES = 8_256;
const MAX_PROOF_BYTES = 40_000;
const MAX_VALUE_BYTES = 8_192;
const MAX_HEADER_BYTES = 4_096;
const MAX_TOKEN_ALLOWLIST = 64;
const MAX_VERIFIER_BYTECODE_BYTES = 65_536;

export type VerifyRecentInclusionInput = {
  publicClient: PublicClient;
  /** Caller-maintained trust pin; this library does not choose the trusted deployment. */
  verifierDeployment: {
    chainId: bigint;
    address: Address;
    runtimeCodeHash: Hex;
  };
  expectedChainId: bigint;
  proof: AcquiredRecentInclusionProof;
  /** Explicit token policy used to rederive facts from the submitted trie values. */
  supportedTokenAddresses: readonly Address[];
};

export type OnchainRecentInclusionResult = {
  verification: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED";
  chainId: bigint;
  blockNumber: bigint;
  blockHash: AcquiredRecentInclusionProof["blockHash"];
  transactionHash: AcquiredRecentInclusionProof["transactionHash"];
  transactionIndex: number;
  paymentFact: RawPaymentFact;
};

export class RecentInclusionVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecentInclusionVerificationError";
  }
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new RecentInclusionVerificationError(message);
}

function boundedHex(value: unknown, label: string, maximumBytes: number): Hex {
  requireCondition(
    typeof value === "string" && /^0x(?:[0-9a-fA-F]{2})+$/.test(value),
    `${label} must be non-empty even-length hex`,
  );
  requireCondition((value.length - 2) / 2 <= maximumBytes, `${label} exceeds its configured byte bound`);
  return value as Hex;
}

function snapshotProofNodes(value: unknown, label: string): Hex[] {
  requireCondition(Array.isArray(value), `${label} nodes must be an array`);
  const nodeCount = value.length;
  requireCondition(nodeCount > 0 && nodeCount <= MAX_PROOF_NODES, `${label} node count is outside bounds`);
  let totalBytes = 0;
  const snapshot: Hex[] = [];
  for (let index = 0; index < nodeCount; index++) {
    const node = (value as unknown[])[index];
    const rawNode = boundedHex(node, `${label} node`, MAX_NODE_BYTES);
    totalBytes += (rawNode.length - 2) / 2;
    requireCondition(totalBytes <= MAX_PROOF_BYTES, `${label} exceeds its configured total byte bound`);
    snapshot.push(rawNode);
  }
  return snapshot;
}

/** Validate and copy the bounded proof so later async work cannot observe caller mutation. */
export function snapshotRecentInclusionProof(source: AcquiredRecentInclusionProof): AcquiredRecentInclusionProof {
  requireCondition(source !== null && typeof source === "object", "Inclusion proof must be an object");
  requireCondition(source.proofs !== null && typeof source.proofs === "object", "Inclusion proof paths are missing");
  const transaction = source.proofs.transaction;
  const receipt = source.proofs.receipt;
  requireCondition(transaction !== null && typeof transaction === "object", "Transaction proof is missing");
  requireCondition(receipt !== null && typeof receipt === "object", "Receipt proof is missing");
  const transactionValue = boundedHex(transaction.value, "Transaction value", MAX_VALUE_BYTES);
  const receiptValue = boundedHex(receipt.value, "Receipt value", MAX_VALUE_BYTES);
  const rawHeader = boundedHex(source.rawHeader, "Raw header", MAX_HEADER_BYTES);
  const transactionPath = snapshotProofNodes(transaction.proof, "Transaction proof");
  const receiptPath = snapshotProofNodes(receipt.proof, "Receipt proof");
  const attachedFact = source.paymentFact !== null && typeof source.paymentFact === "object"
    ? { ...source.paymentFact }
    : source.paymentFact;

  return {
    chainId: source.chainId,
    blockNumber: source.blockNumber,
    blockHash: source.blockHash,
    rawHeader,
    transactionIndex: source.transactionIndex,
    transactionHash: source.transactionHash,
    paymentFact: attachedFact,
    proofs: {
      transactionRoot: source.proofs.transactionRoot,
      receiptRoot: source.proofs.receiptRoot,
      transaction: { root: transaction.root, index: transaction.index, value: transactionValue, proof: transactionPath },
      receipt: { root: receipt.root, index: receipt.index, value: receiptValue, proof: receiptPath },
    },
  };
}

/**
 * Ask the deployed verifier to authenticate a locally acquired inclusion
 * proof against this chain's BLOCKHASH window, then re-derives and checks the
 * attached payment fact from the same raw trie values. The RPC result remains
 * provider-attributed; claim adjudication remains outside this function.
 */
export async function verifyRecentInclusionOnchain(
  input: VerifyRecentInclusionInput,
): Promise<OnchainRecentInclusionResult> {
  const expectedChainId = input.expectedChainId;
  const proof = snapshotRecentInclusionProof(input.proof);
  const tokenAddressInput = input.supportedTokenAddresses;
  requireCondition(Array.isArray(tokenAddressInput), "Token allowlist must be an array");
  const tokenCount = tokenAddressInput.length;
  requireCondition(tokenCount <= MAX_TOKEN_ALLOWLIST, `Token allowlist must contain at most ${MAX_TOKEN_ALLOWLIST} entries`);
  const supportedTokenAddresses: Address[] = [];
  for (let index = 0; index < tokenCount; index++) {
    supportedTokenAddresses.push(tokenAddressInput[index]!);
  }
  const publicClient = input.publicClient;
  const deployment = input.verifierDeployment;
  requireCondition(deployment !== null && typeof deployment === "object", "Verifier deployment pin is required");
  const verifierAddress = getAddress(deployment.address);
  const expectedRuntimeCodeHash = deployment.runtimeCodeHash;
  requireCondition(
    expectedChainId > 0n && expectedChainId <= MAX_SAFE_CHAIN_ID,
    "Expected chain ID must be a positive safely representable integer",
  );
  requireCondition(deployment.chainId === expectedChainId, "Pinned verifier deployment is for a different chain");
  requireCondition(
    typeof expectedRuntimeCodeHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(expectedRuntimeCodeHash),
    "Pinned verifier runtime code hash must be bytes32",
  );
  requireCondition(proof.chainId === expectedChainId, "Proof was acquired from a different configured chain");
  requireCondition(proof.blockNumber >= 0n && proof.blockNumber <= MAX_UINT64, "Proof block number is outside uint64");
  requireCondition(
    Number.isSafeInteger(proof.transactionIndex)
      && proof.transactionIndex >= 0
      && BigInt(proof.transactionIndex) <= MAX_UINT64,
    "Proof transaction index is outside uint64",
  );
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(proof.blockHash), "Proof block hash must be bytes32");
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(proof.transactionHash), "Proof transaction hash must be bytes32");
  requireCondition(
    proof.proofs.transaction.index === proof.transactionIndex
      && proof.proofs.receipt.index === proof.transactionIndex,
    "Transaction and receipt proofs must use the same target index",
  );
  let paymentFact: RawPaymentFact;
  try {
    paymentFact = await derivePaymentFactFromRawValues(
      proof.proofs.transaction.value,
      proof.proofs.receipt.value,
      expectedChainId,
      supportedTokenAddresses,
    );
  } catch {
    throw new RecentInclusionVerificationError("Included transaction and receipt do not yield a supported payment fact");
  }
  const attachedFact = proof.paymentFact;
  requireCondition(
    attachedFact !== null && typeof attachedFact === "object"
      && paymentFact.transactionHash.toLowerCase() === proof.transactionHash.toLowerCase()
      && paymentFact.chainId === proof.chainId
      && paymentFact.transactionHash.toLowerCase() === attachedFact.transactionHash.toLowerCase()
      && paymentFact.chainId === attachedFact.chainId
      && paymentFact.transactionType === attachedFact.transactionType
      && paymentFact.successful === attachedFact.successful
      && paymentFact.sender.toLowerCase() === attachedFact.sender.toLowerCase()
      && paymentFact.recipient.toLowerCase() === attachedFact.recipient.toLowerCase()
      && paymentFact.asset.toLowerCase() === attachedFact.asset.toLowerCase()
      && paymentFact.amount === attachedFact.amount,
    "Attached payment fact differs from the decoded included transaction and receipt",
  );

  const clientChainId = await publicClient.getChainId();
  requireCondition(Number.isSafeInteger(clientChainId), "Public client returned an unsafe chain ID");
  requireCondition(BigInt(clientChainId) === expectedChainId, "Public client is connected to a different chain");

  let verifierBytecode: Hex | undefined;
  try {
    verifierBytecode = await publicClient.getBytecode({ address: verifierAddress });
  } catch {
    throw new RecentInclusionVerificationError("Could not read the pinned verifier deployment bytecode");
  }
  requireCondition(
    typeof verifierBytecode === "string"
      && /^0x(?:[0-9a-fA-F]{2})+$/.test(verifierBytecode),
    "Pinned verifier deployment has no runtime bytecode",
  );
  requireCondition(
    (verifierBytecode.length - 2) / 2 <= MAX_VERIFIER_BYTECODE_BYTES,
    "Pinned verifier runtime bytecode exceeds its configured byte bound",
  );
  requireCondition(
    keccak256(verifierBytecode).toLowerCase() === expectedRuntimeCodeHash.toLowerCase(),
    "Verifier runtime code hash does not match the deployment pin",
  );

  const verified = await publicClient.readContract({
    address: verifierAddress,
    abi: recentInclusionVerifierAbi,
    functionName: "verifyRecentInclusion",
    args: [
      proof.blockNumber,
      proof.blockHash,
      proof.rawHeader,
      BigInt(proof.transactionIndex),
      proof.transactionHash,
      proof.proofs.transaction.value,
      proof.proofs.transaction.proof,
      proof.proofs.receipt.value,
      proof.proofs.receipt.proof,
    ],
  });
  requireCondition(verified === true, "Onchain inclusion verifier did not affirm the proof");

  return {
    verification: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED",
    chainId: expectedChainId,
    blockNumber: proof.blockNumber,
    blockHash: proof.blockHash,
    transactionHash: proof.transactionHash,
    transactionIndex: proof.transactionIndex,
    paymentFact,
  };
}
