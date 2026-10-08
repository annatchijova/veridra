import {
  acquirePaymentEvidence,
  acquireRecentInclusionProof,
  createPortableHistoricalInclusionReceipt,
  createPortableInclusionReceipt,
  parsePaymentClaim,
  parsePortableHistoricalInclusionReceipt,
  parsePortableInclusionReceipt,
  reEvaluateClaim,
  verifyPortableHistoricalInclusionReceipt,
  verifyPortableInclusionReceipt,
  type AcquiredRecentInclusionProof,
  type NamedCheck,
  type PaymentClaim,
} from "@veridra/monad-rpc";
import { TransactionNotFoundError, type Address, type Hex } from "viem";
import {
  BLOCKHASH_WINDOW,
  HISTORICAL_CHECKPOINT_ADDRESS,
  HISTORICAL_INCLUSION_VERIFIER_PIN,
  MONAD_TESTNET_CHAIN_ID,
  MONAD_TESTNET_RPC_URL,
  RECENT_INCLUSION_VERIFIER_PIN,
  REQUIRED_CONFIRMATIONS,
  RPC_PROVIDER_ID,
  checkpointedHashAbi,
  publicClient,
} from "./chain.js";
import {
  NOT_CHECKPOINTED_MESSAGE,
  NOT_MINED_MESSAGE,
  OUTSIDE_WINDOW_MESSAGE,
  translateReceiptError,
  translateTierError,
} from "./errorMessages.js";

export type ClaimInput = {
  transactionHash: string;
  sender: string;
  recipient: string;
  asset: string;
  amountBaseUnits: string;
};

export type Verdict = ReturnType<typeof reEvaluateClaim>["verdict"];
export type Assurance =
  | "RPC_ATTESTED"
  | "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED"
  | "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED";

export type TierState =
  | { status: "checking" }
  | {
      status: "result";
      assurance: Assurance;
      verdict: Verdict;
      checks: NamedCheck[];
      transactionHash: Hex;
      /** Only the RPC_ATTESTED tier has a confirmation policy; the recent tier is bounded by the BLOCKHASH window instead. */
      confirmations?: { observed: bigint; required: bigint };
      rawEvidence: unknown;
      /** Known for the RPC_ATTESTED tier, whose evidence names its block. */
      blockNumber?: bigint;
      /** The exact portable receipt this result was built from, ready to export. Only inclusion tiers have one. */
      serializedReceipt?: string;
      /** Plain lines describing the claim a re-verified receipt asserts, so the verdict is read relative to it. */
      claimSummary?: string[];
    }
  | { status: "unavailable" | "error" | "rejected"; message: string };

export type Acquire = typeof acquirePaymentEvidence;

/** Only fields the operator actually filled in are asserted; the rest stay ABSTAIN. */
export function claimSource(input: ClaimInput): Record<string, string> {
  const source: Record<string, string> = {
    transactionHash: input.transactionHash.trim(),
    chainId: MONAD_TESTNET_CHAIN_ID.toString(10),
  };
  if (input.sender.trim() !== "") source.sender = input.sender.trim();
  if (input.recipient.trim() !== "") source.recipient = input.recipient.trim();
  if (input.asset.trim() !== "") source.asset = input.asset.trim();
  if (input.amountBaseUnits.trim() !== "") source.amountBaseUnits = input.amountBaseUnits.trim();
  return source;
}

export function buildClaim(input: ClaimInput): PaymentClaim {
  return parsePaymentClaim(claimSource(input));
}

/** An asserted non-native asset is the only token a check is told to read. */
function tokenPolicy(claim: PaymentClaim): Address[] {
  return claim.assertsAsset && !/^0x0{40}$/.test(claim.asset) ? [claim.asset] : [];
}

/**
 * Level 1 (RPC_ATTESTED) lookup. Never throws: every failure becomes a scoped
 * tier state so one tier failing cannot blank another.
 */
export async function checkRpcAttested(
  claim: PaymentClaim,
  acquire: Acquire = acquirePaymentEvidence,
  now: () => number = Date.now,
): Promise<TierState> {
  try {
    const acquired = await acquire(claim.transactionHash as Hex, Math.floor(now() / 1000).toString(10), {
      rpcUrl: MONAD_TESTNET_RPC_URL,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      providerId: RPC_PROVIDER_ID,
      requiredConfirmations: REQUIRED_CONFIRMATIONS,
      supportedTokenAddresses: tokenPolicy(claim),
    });
    const adjudication = reEvaluateClaim(claim, acquired.evidence, MONAD_TESTNET_CHAIN_ID);
    return {
      status: "result",
      assurance: "RPC_ATTESTED",
      verdict: adjudication.verdict,
      checks: adjudication.checks,
      transactionHash: acquired.evidence.transactionHash,
      blockNumber: acquired.evidence.blockNumber,
      confirmations: {
        observed: acquired.evidence.observedConfirmations,
        required: acquired.evidence.requiredConfirmations,
      },
      rawEvidence: acquired.evidence,
    };
  } catch (error) {
    const failure = translateTierError(error);
    return { status: failure.kind, message: failure.message };
  }
}

export type RecentDeps = {
  /** Where the transaction was mined and the current head; `blockNumber` is null if it is not mined. */
  locate: (hash: Hex) => Promise<{ blockNumber: bigint | null; head: bigint }>;
  acquireProof: typeof acquireRecentInclusionProof;
  /** Verifies the proof on-chain through the pinned verifier and returns the parsed, adjudicated receipt. */
  createReceipt: (input: {
    proof: AcquiredRecentInclusionProof;
    claim: Record<string, string>;
    supportedTokenAddresses: Address[];
  }) => Promise<{ serialized: string; receipt: ReturnType<typeof parsePortableInclusionReceipt> }>;
};

export const defaultRecentDeps: RecentDeps = {
  async locate(hash) {
    const headPromise = publicClient.getBlockNumber();
    try {
      const transaction = await publicClient.getTransaction({ hash });
      return { blockNumber: transaction.blockNumber ?? null, head: await headPromise };
    } catch (error) {
      if (error instanceof TransactionNotFoundError) return { blockNumber: null, head: await headPromise };
      throw error;
    }
  },
  acquireProof: acquireRecentInclusionProof,
  async createReceipt({ proof, claim, supportedTokenAddresses }) {
    const serialized = await createPortableInclusionReceipt({
      publicClient,
      verifierDeployment: RECENT_INCLUSION_VERIFIER_PIN,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      proof,
      claim,
      supportedTokenAddresses,
      proofSourceId: RPC_PROVIDER_ID,
      producerVerifierRpcSourceId: RPC_PROVIDER_ID,
    });
    return { serialized, receipt: parsePortableInclusionReceipt(serialized) };
  },
};

/**
 * Level 2 (RPC_REPORTED_RECENT_INCLUSION_ACCEPTED) lookup. Independent of tier 1: it
 * locates the transaction itself, so tier 1 failing never blocks it. Never throws.
 */
export async function checkRecentInclusion(
  input: ClaimInput,
  deps: RecentDeps = defaultRecentDeps,
): Promise<TierState> {
  try {
    const claim = buildClaim(input);
    const { blockNumber, head } = await deps.locate(claim.transactionHash as Hex);
    if (blockNumber === null) {
      return { status: "unavailable", message: NOT_MINED_MESSAGE };
    }
    if (head - blockNumber > BLOCKHASH_WINDOW) return { status: "unavailable", message: OUTSIDE_WINDOW_MESSAGE };

    const supportedTokenAddresses = tokenPolicy(claim);
    const proof = await deps.acquireProof({
      rpcUrl: MONAD_TESTNET_RPC_URL,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      transactionHash: claim.transactionHash as Hex,
      supportedTokenAddresses,
    });
    const { serialized, receipt } = await deps.createReceipt({ proof, claim: claimSource(input), supportedTokenAddresses });
    return {
      status: "result",
      assurance: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED",
      verdict: receipt.verdict,
      checks: receipt.checks,
      transactionHash: receipt.proof.transactionHash,
      rawEvidence: { paymentFact: receipt.paymentFact, proof: receipt.proof },
      serializedReceipt: serialized,
    };
  } catch (error) {
    const failure = translateTierError(error);
    return { status: failure.kind, message: failure.message };
  }
}

export type HistoricalDeps = {
  locate: RecentDeps["locate"];
  /** The checkpointed hash for a block, or null when nobody checkpointed it. */
  checkpointedHash: (blockNumber: bigint) => Promise<Hex | null>;
  acquireProof: typeof acquireRecentInclusionProof;
  createReceipt: (input: {
    proof: AcquiredRecentInclusionProof;
    claim: Record<string, string>;
    supportedTokenAddresses: Address[];
  }) => Promise<{ serialized: string; receipt: ReturnType<typeof parsePortableHistoricalInclusionReceipt> }>;
};

export const defaultHistoricalDeps: HistoricalDeps = {
  locate: defaultRecentDeps.locate,
  async checkpointedHash(blockNumber) {
    const hash = await publicClient.readContract({
      address: HISTORICAL_CHECKPOINT_ADDRESS,
      abi: checkpointedHashAbi,
      functionName: "checkpointedHash",
      args: [blockNumber],
    });
    return /^0x0{64}$/.test(hash) ? null : hash;
  },
  acquireProof: acquireRecentInclusionProof,
  async createReceipt({ proof, claim, supportedTokenAddresses }) {
    const serialized = await createPortableHistoricalInclusionReceipt({
      publicClient,
      verifierDeployment: HISTORICAL_INCLUSION_VERIFIER_PIN,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      proof,
      claim,
      supportedTokenAddresses,
      proofSourceId: RPC_PROVIDER_ID,
      producerVerifierRpcSourceId: RPC_PROVIDER_ID,
    });
    return { serialized, receipt: parsePortableHistoricalInclusionReceipt(serialized) };
  },
};

/**
 * Level 3 (RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED) lookup. Works at any age, but only
 * for a block someone checkpointed in time; otherwise it is a designed absence. Never throws.
 */
export async function checkHistoricalInclusion(
  input: ClaimInput,
  deps: HistoricalDeps = defaultHistoricalDeps,
): Promise<TierState> {
  try {
    const claim = buildClaim(input);
    const { blockNumber } = await deps.locate(claim.transactionHash as Hex);
    if (blockNumber === null) return { status: "unavailable", message: NOT_MINED_MESSAGE };
    if ((await deps.checkpointedHash(blockNumber)) === null) {
      return { status: "unavailable", message: NOT_CHECKPOINTED_MESSAGE };
    }

    const supportedTokenAddresses = tokenPolicy(claim);
    const proof = await deps.acquireProof({
      rpcUrl: MONAD_TESTNET_RPC_URL,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      transactionHash: claim.transactionHash as Hex,
      supportedTokenAddresses,
    });
    const { serialized, receipt } = await deps.createReceipt({ proof, claim: claimSource(input), supportedTokenAddresses });
    return {
      status: "result",
      assurance: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED",
      verdict: receipt.verdict,
      checks: receipt.checks,
      transactionHash: receipt.proof.transactionHash,
      rawEvidence: { paymentFact: receipt.paymentFact, checkpointAddress: receipt.checkpointAddress, proof: receipt.proof },
      serializedReceipt: serialized,
    };
  } catch (error) {
    const failure = translateTierError(error);
    return { status: failure.kind, message: failure.message };
  }
}

const HISTORICAL_FORMAT = "veridra.portable-historical-inclusion-receipt";
/** Matches the library's own bound; refusing earlier just avoids reading a huge paste. */
export const MAX_RECEIPT_BYTES = 262_144;

export type ReverifyDeps = {
  verifyRecent: (serialized: string) => ReturnType<typeof verifyPortableInclusionReceipt>;
  verifyHistorical: (serialized: string) => ReturnType<typeof verifyPortableHistoricalInclusionReceipt>;
};

export const defaultReverifyDeps: ReverifyDeps = {
  verifyRecent: (serializedReceipt) =>
    verifyPortableInclusionReceipt({
      publicClient,
      verifierDeployment: RECENT_INCLUSION_VERIFIER_PIN,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      serializedReceipt,
      verificationRpcSourceId: RPC_PROVIDER_ID,
    }),
  verifyHistorical: (serializedReceipt) =>
    verifyPortableHistoricalInclusionReceipt({
      publicClient,
      verifierDeployment: HISTORICAL_INCLUSION_VERIFIER_PIN,
      expectedChainId: MONAD_TESTNET_CHAIN_ID,
      serializedReceipt,
      verificationRpcSourceId: RPC_PROVIDER_ID,
    }),
};

function describeClaim(claim: PaymentClaim): string[] {
  const asserted = (value: boolean, label: string, text: string) => `${label}: ${value ? text : "not asserted"}`;
  return [
    `Transaction: ${claim.transactionHash}`,
    asserted(claim.assertsSender, "Sender", claim.sender),
    asserted(claim.assertsRecipient, "Recipient", claim.recipient),
    asserted(claim.assertsAsset, "Asset", claim.asset),
    asserted(claim.assertsAmount, "Amount (base units)", claim.amount.toString(10)),
  ];
}

/**
 * Flow 2. The receipt is untrusted input: it is re-derived from its own raw proof and checked
 * against THIS page's pinned verifier. The verdict shown is the recomputed one, never the
 * verdict the receipt declares. Never throws.
 */
export async function reverifyReceipt(
  serialized: string,
  deps: ReverifyDeps = defaultReverifyDeps,
): Promise<TierState> {
  try {
    if (new TextEncoder().encode(serialized).byteLength > MAX_RECEIPT_BYTES) {
      return { status: "rejected", message: "This receipt is larger than any receipt this page can read." };
    }
    let format: unknown;
    try {
      format = (JSON.parse(serialized) as { format?: unknown } | null)?.format;
    } catch {
      return { status: "rejected", message: "This is not a receipt this page can read: it is not valid JSON." };
    }
    if (format === HISTORICAL_FORMAT) {
      const claim = parsePortableHistoricalInclusionReceipt(serialized).claim;
      const result = await deps.verifyHistorical(serialized);
      return {
        status: "result",
        assurance: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED",
        verdict: result.verdict,
        checks: result.checks,
        transactionHash: result.transactionHash,
        rawEvidence: result,
        claimSummary: describeClaim(claim),
      };
    }
    const claim = parsePortableInclusionReceipt(serialized).claim;
    const result = await deps.verifyRecent(serialized);
    return {
      status: "result",
      assurance: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED",
      verdict: result.verdict,
      checks: result.checks,
      transactionHash: result.transactionHash,
      rawEvidence: result,
      claimSummary: describeClaim(claim),
    };
  } catch (error) {
    const failure = translateReceiptError(error);
    return { status: failure.kind, message: failure.message };
  }
}

/**
 * Tiers that reached a real verdict (not INSUFFICIENT_EVIDENCE) should agree: they adjudicate the same
 * claim over the same transaction. If they do not, the chain reorganized between calls or a provider
 * answered inconsistently, and neither verdict should be relied on.
 */
export function tierDisagreement(tiers: readonly { label: string; state: TierState | null }[]): string | null {
  const decided = tiers.flatMap(({ label, state }) =>
    state !== null && state.status === "result" && state.verdict !== "INSUFFICIENT_EVIDENCE" ? [{ label, verdict: state.verdict }] : [],
  );
  if (new Set(decided.map((tier) => tier.verdict)).size <= 1) return null;
  return `The evidence tiers disagree (${decided.map((tier) => `${tier.label}: ${tier.verdict}`).join("; ")}). Do not rely on either verdict. This can happen if the chain reorganized or a provider answered inconsistently; check again.`;
}
