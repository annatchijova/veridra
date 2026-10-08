import {
  HistoricalInclusionVerificationError,
  InclusionProofAcquisitionError,
  InsufficientEvidenceError,
  PortableHistoricalReceiptError,
  PortableReceiptError,
  RecentInclusionVerificationError,
} from "@veridra/monad-rpc";
import { toFunctionSelector } from "viem";

/**
 * `unavailable` is a designed absence (the evidence cannot exist or is not in a
 * supported shape). `error` is a request that actually failed and can be retried.
 */
export type TierFailure = { kind: "unavailable" | "error"; message: string };

/** A receipt that was read but did not check out. Distinct from a failed request and from a designed absence. */
export type ReceiptFailure = { kind: "unavailable" | "error" | "rejected"; message: string };

export const OUTSIDE_WINDOW_MESSAGE =
  "This block is outside the latest 256 blocks, the only ones the chain still keeps hashes for, so the recent-inclusion check can't run on it.";

const NETWORK_ERROR: TierFailure = {
  kind: "error",
  message: "Couldn't reach the Monad testnet RPC, or it didn't answer in time. Try again.",
};
export const NOT_MINED_MESSAGE =
  "No mined transaction with this hash was found on Monad testnet. Check the hash, or wait until it is included in a block.";
const NOT_FOUND: TierFailure = { kind: "unavailable", message: NOT_MINED_MESSAGE };
const OUTSIDE_WINDOW: TierFailure = { kind: "unavailable", message: OUTSIDE_WINDOW_MESSAGE };
export const NOT_CHECKPOINTED_MESSAGE =
  "No one has checkpointed this block. Checkpointing is what makes a payment provable after its block leaves the recent-block window, and this page is read-only, so it can't do it for you.";
const NOT_CHECKPOINTED: TierFailure = { kind: "unavailable", message: NOT_CHECKPOINTED_MESSAGE };
const TOO_RECENT: TierFailure = {
  kind: "unavailable",
  message: "This block is too recent for the chain to vouch for it yet. Wait a few seconds and check again.",
};
const REJECTED: TierFailure = {
  kind: "unavailable",
  message: "The on-chain verifier rejected the block data the RPC returned, so no result is shown. This can happen during a chain reorganization; try again.",
};

// Custom errors the verifier contracts can revert with. Matched by selector because
// the library ABI does not decode them; the names never reach the operator.
const REVERT_SELECTORS: readonly { selector: string; failure: TierFailure }[] = [
  { selector: toFunctionSelector("BlockOutsideWindow(uint256,uint256)"), failure: OUTSIDE_WINDOW },
  { selector: toFunctionSelector("BlockHashUnavailable(uint256)"), failure: OUTSIDE_WINDOW },
  { selector: toFunctionSelector("BlockNotCompleted(uint256,uint256)"), failure: TOO_RECENT },
  { selector: toFunctionSelector("BlockNotCheckpointed(uint256)"), failure: NOT_CHECKPOINTED },
  { selector: toFunctionSelector("BlockHashMismatch(bytes32,bytes32)"), failure: REJECTED },
  { selector: toFunctionSelector("HeaderHashMismatch(bytes32,bytes32)"), failure: REJECTED },
  { selector: toFunctionSelector("HeaderNumberMismatch(uint64,uint64)"), failure: REJECTED },
  { selector: toFunctionSelector("TransactionHashMismatch(bytes32,bytes32)"), failure: REJECTED },
];

const RULES: readonly { pattern: RegExp; failure: TierFailure }[] = [
  {
    pattern: /^(Raw proof )?RPC (request failed|returned HTTP|response|content length|returned an invalid envelope|reported an error|omitted the result)|exceeds the configured size bound/,
    failure: NETWORK_ERROR,
  },
  {
    pattern: /^Transaction chain ID does not match/,
    failure: { kind: "unavailable", message: "This transaction belongs to a different chain than Monad testnet." },
  },
  {
    pattern: /chain ID (does not match|differs)/,
    failure: { kind: "error", message: "The RPC answered for a different network than Monad testnet, so nothing was checked." },
  },
  {
    pattern: /^Transaction or receipt is not available|^Transaction is unavailable or malformed/,
    failure: NOT_FOUND,
  },
  {
    pattern: /outside the configured allowlist|not on the supported token allowlist|supported payment fact/,
    failure: {
      kind: "unavailable",
      message: "This transaction does not contain exactly one payment this check can read (one plain MON transfer, or one transfer of the token you entered).",
    },
  },
  {
    pattern: /direct target/,
    failure: {
      kind: "unavailable",
      message: "The token transfer went through another contract rather than a direct token transfer, which this check does not support.",
    },
  },
  {
    pattern: /Supported payment extraction failed/,
    failure: {
      kind: "unavailable",
      message: "This transaction does not contain exactly one payment this check can read (one plain MON transfer, or one transfer of the token you entered).",
    },
  },
  {
    pattern: /Verifier runtime code hash does not match|Pinned verifier deployment has no runtime bytecode|Could not read the pinned verifier/,
    failure: {
      kind: "error",
      message: "The verifier contract on the chain is not the one this page was built to trust, so the check was refused.",
    },
  },
  {
    pattern: /Onchain inclusion verifier did not affirm/,
    failure: REJECTED,
  },
];

const FALLBACK_UNAVAILABLE: TierFailure = {
  kind: "unavailable",
  message: "The data for this transaction could not be read in a form this check supports.",
};

const FALLBACK_ERROR: TierFailure = {
  kind: "error",
  message: "Something went wrong while checking. Nothing was verified. Try again.",
};

const NETWORK_ERROR_NAMES = new Set(["HttpRequestError", "TimeoutError", "RpcRequestError", "WebSocketRequestError"]);

function isLibraryError(error: unknown): boolean {
  return (
    error instanceof InsufficientEvidenceError
    || error instanceof InclusionProofAcquisitionError
    || error instanceof RecentInclusionVerificationError
    || error instanceof HistoricalInclusionVerificationError
    || error instanceof PortableReceiptError
    || error instanceof PortableHistoricalReceiptError
  );
}

function revertSelectorFailure(error: Error): TierFailure | undefined {
  // viem puts the revert signature in the message chain of the wrapped error.
  const text = [error.message, (error as { details?: unknown }).details, (error as { cause?: { message?: unknown } }).cause?.message]
    .filter((part): part is string => typeof part === "string")
    .join("\n")
    .toLowerCase();
  return REVERT_SELECTORS.find((entry) => text.includes(entry.selector.toLowerCase()))?.failure;
}

/** Maps any tier failure to one plain sentence. Raw library or Solidity text never reaches the operator. */
export function translateTierError(error: unknown): TierFailure {
  if (!(error instanceof Error)) return FALLBACK_ERROR;
  if (isLibraryError(error)) {
    for (const rule of RULES) {
      if (rule.pattern.test(error.message)) return rule.failure;
    }
    return FALLBACK_UNAVAILABLE;
  }
  if (NETWORK_ERROR_NAMES.has(error.name)) return NETWORK_ERROR;
  return revertSelectorFailure(error) ?? FALLBACK_ERROR;
}

const RECEIPT_RULES: readonly { pattern: RegExp; failure: ReceiptFailure }[] = [
  {
    pattern: /deployment pin differs/,
    failure: {
      kind: "rejected",
      message: "This receipt was produced against a different verifier contract than the one this page trusts, so it was not accepted.",
    },
  },
  {
    pattern: /chain differs from the consumer's expected chain/,
    failure: { kind: "rejected", message: "This receipt is for a different chain than Monad testnet, so it was not accepted." },
  },
  {
    pattern: /Stored .* differs from|differs from recomputation|differs from raw proof values|differs from the pinned verifier's actual checkpoint|differs from the decoded included/,
    failure: {
      kind: "rejected",
      message: "What this receipt states does not match what its own proof shows. Treat it as altered or corrupt; its stated verdict was not used.",
    },
  },
  {
    pattern: /Onchain inclusion verifier did not affirm|Onchain historical inclusion verifier did not affirm/,
    failure: {
      kind: "rejected",
      message: "The on-chain verifier did not accept this receipt's proof, so it was not accepted.",
    },
  },
  {
    pattern: /^Portable receipt|^Payment fact|^Adjudication|^Serialized portable receipt|must be an object|missing or unsupported fields|unsupported|not valid JSON|must be a canonical|exceeds its (configured|bound)|noncanonical|has the wrong byte length|must be non-empty even-length hex|must not be zero/,
    failure: {
      kind: "rejected",
      message: "This is not a receipt this page can read: the format, version or contents are not supported, or are malformed.",
    },
  },
];

const REJECTED_PROOF: ReceiptFailure = {
  kind: "rejected",
  message: "The on-chain verifier did not accept this receipt's proof, so it was not accepted. Treat it as altered, corrupt, or not valid for the verifier it names.",
};

const RECEIPT_EXPIRED: ReceiptFailure = {
  kind: "unavailable",
  message: "This receipt can't be rechecked anymore: it relies on a recent-block hash, and its block has left the 256-block window. Only a receipt backed by a checkpoint stays checkable.",
};

/**
 * Same plain-language rule as tiers, for pasted receipts. A receipt whose contents do not
 * check out is `rejected`, never `unavailable` or a retryable `error`.
 */
export function translateReceiptError(error: unknown): ReceiptFailure {
  // The on-chain verifier refusing a receipt's own proof means the receipt is bad, not that evidence is
  // missing or that a retry would help. Environment problems (wrong deployed code, wrong chain) stay errors.
  if (
    (error instanceof RecentInclusionVerificationError || error instanceof HistoricalInclusionVerificationError)
    && !/runtime code hash does not match|no runtime bytecode|Could not read the pinned verifier|Public client/.test(error.message)
  ) {
    return REJECTED_PROOF;
  }
  if (error instanceof Error && isLibraryError(error)) {
    for (const rule of RECEIPT_RULES) {
      if (rule.pattern.test(error.message)) return rule.failure;
    }
  }
  const failure = translateTierError(error);
  if (failure === OUTSIDE_WINDOW || failure === TOO_RECENT) return RECEIPT_EXPIRED;
  if (failure === REJECTED || failure === NOT_CHECKPOINTED) return REJECTED_PROOF;
  return failure;
}
