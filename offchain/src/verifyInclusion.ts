import { getAddress, type Address, type PublicClient } from "viem";
import { recentInclusionVerifierAbi } from "./abi/recentInclusionVerifierAbi.js";
import { derivePaymentFactFromRawValues, type RawPaymentFact } from "./paymentFacts.js";
import type { AcquiredRecentInclusionProof } from "./proofRpc.js";

const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_SAFE_CHAIN_ID = BigInt(Number.MAX_SAFE_INTEGER);

export type VerifyRecentInclusionInput = {
  publicClient: PublicClient;
  verifierAddress: Address;
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

/**
 * Ask the deployed verifier to authenticate a locally acquired inclusion
 * proof against this chain's BLOCKHASH window, then re-derives and checks the
 * attached payment fact from the same raw trie values. The RPC result remains
 * provider-attributed; claim adjudication remains outside this function.
 */
export async function verifyRecentInclusionOnchain(
  input: VerifyRecentInclusionInput,
): Promise<OnchainRecentInclusionResult> {
  requireCondition(
    input.expectedChainId > 0n && input.expectedChainId <= MAX_SAFE_CHAIN_ID,
    "Expected chain ID must be a positive safely representable integer",
  );
  requireCondition(input.proof.chainId === input.expectedChainId, "Proof was acquired from a different configured chain");
  requireCondition(input.proof.blockNumber >= 0n && input.proof.blockNumber <= MAX_UINT64, "Proof block number is outside uint64");
  requireCondition(
    Number.isSafeInteger(input.proof.transactionIndex)
      && input.proof.transactionIndex >= 0
      && BigInt(input.proof.transactionIndex) <= MAX_UINT64,
    "Proof transaction index is outside uint64",
  );
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(input.proof.blockHash), "Proof block hash must be bytes32");
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(input.proof.transactionHash), "Proof transaction hash must be bytes32");
  requireCondition(
    input.proof.proofs.transaction.index === input.proof.transactionIndex
      && input.proof.proofs.receipt.index === input.proof.transactionIndex,
    "Transaction and receipt proofs must use the same target index",
  );
  let paymentFact: RawPaymentFact;
  try {
    paymentFact = await derivePaymentFactFromRawValues(
      input.proof.proofs.transaction.value,
      input.proof.proofs.receipt.value,
      input.expectedChainId,
      input.supportedTokenAddresses,
    );
  } catch {
    throw new RecentInclusionVerificationError("Included transaction and receipt do not yield a supported payment fact");
  }
  const attachedFact = input.proof.paymentFact;
  requireCondition(
    attachedFact !== null && typeof attachedFact === "object"
      && paymentFact.transactionHash.toLowerCase() === input.proof.transactionHash.toLowerCase()
      && paymentFact.chainId === input.proof.chainId
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

  const verifierAddress = getAddress(input.verifierAddress);
  const clientChainId = await input.publicClient.getChainId();
  requireCondition(Number.isSafeInteger(clientChainId), "Public client returned an unsafe chain ID");
  requireCondition(BigInt(clientChainId) === input.expectedChainId, "Public client is connected to a different chain");

  const verified = await input.publicClient.readContract({
    address: verifierAddress,
    abi: recentInclusionVerifierAbi,
    functionName: "verifyRecentInclusion",
    args: [
      input.proof.blockNumber,
      input.proof.blockHash,
      input.proof.rawHeader,
      BigInt(input.proof.transactionIndex),
      input.proof.transactionHash,
      input.proof.proofs.transaction.value,
      input.proof.proofs.transaction.proof,
      input.proof.proofs.receipt.value,
      input.proof.proofs.receipt.proof,
    ],
  });
  requireCondition(verified === true, "Onchain inclusion verifier did not affirm the proof");

  return {
    verification: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED",
    chainId: input.expectedChainId,
    blockNumber: input.proof.blockNumber,
    blockHash: input.proof.blockHash,
    transactionHash: input.proof.transactionHash,
    transactionIndex: input.proof.transactionIndex,
    paymentFact,
  };
}
