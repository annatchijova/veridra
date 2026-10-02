import type { Address, Hex, PublicClient } from "viem";
import { veridraReceiptRegistryAbi } from "./abi/veridraReceiptRegistryAbi.js";

const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INSUFFICIENT_EVIDENCE"] as const;
const CHECK_STATUSES = ["ABSTAIN", "PASS", "FAIL"] as const;
const CHECK_NAMES = [
  "transactionHash",
  "chainId",
  "execution",
  "sender",
  "recipient",
  "asset",
  "amount",
] as const;

type Verdict = (typeof VERDICTS)[number];
type CheckStatus = (typeof CHECK_STATUSES)[number];

export type NamedCheck = { name: (typeof CHECK_NAMES)[number]; status: CheckStatus };

export type VerifiedReceipt = {
  receiptId: Hex;
  schemaVersion: number;
  evidenceAssurance: "RPC_ATTESTED";
  verdict: Verdict;
  checks: NamedCheck[];
  transactionHash: Hex;
  chainId: bigint;
  providerId: Hex;
  observedAt: bigint;
  recordedAt: bigint;
};

export class ReceiptNotFoundError extends Error {
  constructor(receiptId: Hex) {
    super(`No receipt is stored for id ${receiptId}`);
    this.name = "ReceiptNotFoundError";
  }
}

export class UnsupportedReceiptVariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedReceiptVariantError";
  }
}

/// Raised when an independent recomputation of the claim/evidence comparison
/// disagrees with the verdict or per-check results the contract stored. This
/// must never happen for a correctly behaving registry; it exists so a
/// divergence is reported loudly instead of silently trusted.
export class ReceiptIntegrityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptIntegrityError";
  }
}

type StoredClaim = {
  transactionHash: Hex;
  chainId: bigint;
  assertsSender: boolean;
  sender: Address;
  assertsRecipient: boolean;
  recipient: Address;
  assertsAsset: boolean;
  asset: Address;
  assertsAmount: boolean;
  amount: bigint;
};

type StoredEvidence = {
  available: boolean;
  transactionHash: Hex;
  chainId: bigint;
  successful: boolean;
  sender: Address;
  recipient: Address;
  asset: Address;
  amount: bigint;
  finalityPolicyId: Hex;
  requiredConfirmations: bigint;
  observedConfirmations: bigint;
};

/**
 * An independent re-implementation of PaymentAdjudicator.evaluate(), written
 * without reusing the Solidity control flow, so a verifier that reads the
 * same claim/evidence the contract stored can reach its own verdict rather
 * than trusting the contract's arithmetic. The field order and dominance
 * rule intentionally mirror src/PaymentAdjudicator.sol exactly.
 */
function reEvaluateClaim(claim: StoredClaim, evidence: StoredEvidence, expectedChainId: bigint): {
  verdict: Verdict;
  checks: NamedCheck[];
} {
  const abstainAll = (): NamedCheck[] => CHECK_NAMES.map((name) => ({ name, status: "ABSTAIN" as const }));

  if (
    !evidence.available
    || evidence.finalityPolicyId === ("0x" + "0".repeat(64))
    || evidence.requiredConfirmations === 0n
    || evidence.observedConfirmations < evidence.requiredConfirmations
  ) {
    return { verdict: "INSUFFICIENT_EVIDENCE", checks: abstainAll() };
  }

  const pass = (matches: boolean): CheckStatus => (matches ? "PASS" : "FAIL");
  const checks: NamedCheck[] = [
    { name: "transactionHash", status: pass(claim.transactionHash.toLowerCase() === evidence.transactionHash.toLowerCase()) },
    {
      name: "chainId",
      status: pass(claim.chainId === expectedChainId && evidence.chainId === expectedChainId),
    },
    { name: "execution", status: pass(evidence.successful) },
    {
      name: "sender",
      status: claim.assertsSender ? pass(claim.sender.toLowerCase() === evidence.sender.toLowerCase()) : "ABSTAIN",
    },
    {
      name: "recipient",
      status: claim.assertsRecipient
        ? pass(claim.recipient.toLowerCase() === evidence.recipient.toLowerCase())
        : "ABSTAIN",
    },
    {
      name: "asset",
      status: claim.assertsAsset ? pass(claim.asset.toLowerCase() === evidence.asset.toLowerCase()) : "ABSTAIN",
    },
    {
      name: "amount",
      status: claim.assertsAmount ? pass(claim.amount === evidence.amount) : "ABSTAIN",
    },
  ];

  const verdict: Verdict = checks.some((check) => check.status === "FAIL") ? "NOT_VERIFIED" : "VERIFIED";
  return { verdict, checks };
}

export type VerifyReceiptInput = {
  publicClient: PublicClient;
  registryAddress: Address;
  receiptId: Hex;
  /** The chain the caller believes they are querying; must match the
   *  receipt's recorded chain ID, independent of whatever the RPC endpoint
   *  itself claims. */
  expectedChainId: bigint;
};

/**
 * Read a stored receipt and independently recompute its verdict from the
 * claim and evidence it carries. This is a read-only check: it never calls
 * `publish()`, never trusts the contract's own verdict without
 * recomputation, and rejects a schema version or evidence-assurance variant
 * it was not written to understand rather than guessing at its meaning.
 */
export async function verifyReceipt(input: VerifyReceiptInput): Promise<VerifiedReceipt> {
  const stored = await input.publicClient.readContract({
    address: input.registryAddress,
    abi: veridraReceiptRegistryAbi,
    functionName: "getReceipt",
    args: [input.receiptId],
  });

  if (stored.schemaVersion === 0) throw new ReceiptNotFoundError(input.receiptId);
  if (stored.schemaVersion !== 1) {
    throw new UnsupportedReceiptVariantError(
      `This verifier supports schema version 1 only; receipt has version ${stored.schemaVersion}`,
    );
  }
  if (stored.evidenceAssurance !== 1) {
    throw new UnsupportedReceiptVariantError(
      `This verifier supports evidence assurance RPC_ATTESTED (1) only; receipt has variant ${stored.evidenceAssurance}`,
    );
  }
  if (stored.chainId !== input.expectedChainId) {
    throw new UnsupportedReceiptVariantError(
      `Receipt is recorded under chain ${stored.chainId}, not the expected chain ${input.expectedChainId}`,
    );
  }

  const recomputed = reEvaluateClaim(stored.claim, stored.evidence, input.expectedChainId);
  const storedVerdict = VERDICTS[stored.verdict];
  if (storedVerdict === undefined) {
    throw new UnsupportedReceiptVariantError(`Receipt has an unknown verdict code ${stored.verdict}`);
  }
  if (recomputed.verdict !== storedVerdict) {
    throw new ReceiptIntegrityError(
      `Stored verdict ${storedVerdict} disagrees with independently recomputed verdict ${recomputed.verdict} for receipt ${input.receiptId}`,
    );
  }
  for (let i = 0; i < CHECK_NAMES.length; i++) {
    const storedCheck = CHECK_STATUSES[stored.checks[i]!];
    const recomputedCheck = recomputed.checks[i]!;
    if (storedCheck !== recomputedCheck.status) {
      throw new ReceiptIntegrityError(
        `Stored check '${recomputedCheck.name}' is ${storedCheck}, but independent recomputation found ${recomputedCheck.status} for receipt ${input.receiptId}`,
      );
    }
  }

  return {
    receiptId: input.receiptId,
    schemaVersion: stored.schemaVersion,
    evidenceAssurance: "RPC_ATTESTED",
    verdict: storedVerdict,
    checks: recomputed.checks,
    transactionHash: stored.transactionHash,
    chainId: stored.chainId,
    providerId: stored.providerId,
    observedAt: stored.observedAt,
    recordedAt: stored.recordedAt,
  };
}
