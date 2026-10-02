import {
  decodeEventLog,
  getAddress,
  type Address,
  type Account,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { veridraReceiptRegistryAbi } from "./abi/veridraReceiptRegistryAbi.js";
import {
  acquirePaymentEvidence,
  type PaymentClaim,
  type RpcEvidenceConfig,
} from "./rpcEvidence.js";

const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;

export type PublishReceiptInput = {
  claim: PaymentClaim;
  observedAtUnixSeconds: string;
  registryAddress: Address;
  rpc: RpcEvidenceConfig;
  publicClient: PublicClient<Transport, Chain>;
  walletClient: WalletClient<Transport, Chain, Account>;
};

export type PublishedReceipt = {
  receiptId: Hex;
  transactionHash: Hex;
  chainId: bigint;
  verdict: "VERIFIED" | "NOT_VERIFIED" | "INSUFFICIENT_EVIDENCE";
  schemaVersion: bigint;
  providerId: Hex;
  observedAt: bigint;
};

type StoredReceipt = {
  schemaVersion: number;
  evidenceAssurance: number;
  verdict: number;
  transactionHash: Hex;
  chainId: bigint;
  providerId: Hex;
  observedAt: bigint;
};

export class ReceiptPublicationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptPublicationError";
  }
}

function requireCondition(condition: boolean, message: string): asserts condition {
  if (!condition) throw new ReceiptPublicationError(message);
}

function validateClaim(claim: PaymentClaim): void {
  requireCondition(typeof claim.transactionHash === "string", "Claim transaction hash must be a string");
  requireCondition(/^0x[0-9a-fA-F]{64}$/.test(claim.transactionHash), "Claim transaction hash must be bytes32");
  requireCondition(typeof claim.chainId === "bigint", "Claim chain ID must be bigint");
  requireCondition(claim.chainId > 0n && claim.chainId <= MAX_UINT256, "Claim chain ID is outside uint256");
  requireCondition(typeof claim.amount === "bigint", "Claim amount must be bigint base units");
  requireCondition(claim.amount >= 0n && claim.amount <= MAX_UINT256, "Claim amount is outside uint256 base units");
  requireCondition(typeof claim.assertsSender === "boolean", "assertsSender must be boolean");
  requireCondition(typeof claim.assertsRecipient === "boolean", "assertsRecipient must be boolean");
  requireCondition(typeof claim.assertsAsset === "boolean", "assertsAsset must be boolean");
  requireCondition(typeof claim.assertsAmount === "boolean", "assertsAmount must be boolean");
  getAddress(claim.sender);
  getAddress(claim.recipient);
  getAddress(claim.asset);
  requireCondition(claim.assertsSender || claim.sender.toLowerCase() === ZERO_ADDRESS, "Unasserted sender must use the zero address");
  requireCondition(claim.assertsRecipient || claim.recipient.toLowerCase() === ZERO_ADDRESS, "Unasserted recipient must use the zero address");
  requireCondition(claim.assertsAsset || claim.asset.toLowerCase() === ZERO_ADDRESS, "Unasserted asset must use the zero address");
  requireCondition(claim.assertsAmount || claim.amount === 0n, "Unasserted amount must be zero");
}

const VERDICTS = ["VERIFIED", "NOT_VERIFIED", "INSUFFICIENT_EVIDENCE"] as const;

function asPublishedReceipt(receiptId: Hex, receipt: StoredReceipt): PublishedReceipt {
  requireCondition(receipt.schemaVersion === 1, "Stored receipt has an unsupported schema version");
  requireCondition(receipt.evidenceAssurance === 1, "Stored receipt has an unsupported assurance variant");
  requireCondition(Number.isInteger(receipt.verdict) && receipt.verdict >= 0 && receipt.verdict < VERDICTS.length, "Stored receipt has an unknown verdict");
  return {
    receiptId,
    transactionHash: receipt.transactionHash,
    chainId: receipt.chainId,
    verdict: VERDICTS[receipt.verdict]!,
    schemaVersion: BigInt(receipt.schemaVersion),
    providerId: receipt.providerId,
    observedAt: receipt.observedAt,
  };
}

/**
 * Acquire RPC evidence, submit the bounded claim/evidence to the registry, and
 * return its emitted receipt identifier. The caller owns signer creation and
 * key custody; this function never reads or persists private key material.
 */
export async function publishReceipt(input: PublishReceiptInput): Promise<PublishedReceipt> {
  validateClaim(input.claim);
  const registryAddress = getAddress(input.registryAddress);
  const account = input.walletClient.account;

  const [publicChainId, walletChainId, publisher, schemaVersion, assurance] = await Promise.all([
    input.publicClient.getChainId(),
    input.walletClient.getChainId(),
    input.publicClient.readContract({
      address: registryAddress,
      abi: veridraReceiptRegistryAbi,
      functionName: "publisher",
    }),
    input.publicClient.readContract({
      address: registryAddress,
      abi: veridraReceiptRegistryAbi,
      functionName: "RECEIPT_SCHEMA_VERSION",
    }),
    input.publicClient.readContract({
      address: registryAddress,
      abi: veridraReceiptRegistryAbi,
      functionName: "RPC_ATTESTED",
    }),
  ]);

  requireCondition(Number.isSafeInteger(publicChainId), "Public client returned an unsafe chain ID");
  requireCondition(Number.isSafeInteger(walletChainId), "Wallet client returned an unsafe chain ID");
  const configuredChainId = input.rpc.expectedChainId;
  requireCondition(configuredChainId <= BigInt(Number.MAX_SAFE_INTEGER), "Viem chain configuration cannot represent this chain ID exactly");
  requireCondition(BigInt(publicChainId) === configuredChainId, "Public client chain differs from configured RPC chain");
  requireCondition(BigInt(walletChainId) === configuredChainId, "Wallet client is connected to a different chain");
  requireCondition(BigInt(input.walletClient.chain.id) === configuredChainId, "Wallet client is configured for a different chain");
  requireCondition(publisher.toLowerCase() === account.address.toLowerCase(), "Connected account is not the registry publisher");
  requireCondition(schemaVersion === 1, "Unsupported receipt schema version");
  requireCondition(assurance === 1, "Unsupported evidence assurance variant");

  const acquired = await acquirePaymentEvidence(
    input.claim.transactionHash,
    input.observedAtUnixSeconds,
    input.rpc,
  );
  const simulation = await input.publicClient.simulateContract({
    account,
    address: registryAddress,
    abi: veridraReceiptRegistryAbi,
    functionName: "publish",
    args: [input.claim, acquired.evidence, acquired.providerId, acquired.observedAt],
  });
  const receiptId = simulation.result;
  const existing = await input.publicClient.readContract({
    address: registryAddress,
    abi: veridraReceiptRegistryAbi,
    functionName: "getReceipt",
    args: [receiptId],
  });
  if (existing.schemaVersion !== 0) {
    requireCondition(existing.transactionHash.toLowerCase() === input.claim.transactionHash.toLowerCase(), "Stored receipt has an unexpected transaction hash");
    requireCondition(existing.chainId === configuredChainId, "Stored receipt has an unexpected chain ID");
    requireCondition(existing.providerId.toLowerCase() === acquired.providerId.toLowerCase(), "Stored receipt has an unexpected provider ID");
    requireCondition(existing.observedAt === acquired.observedAt, "Stored receipt has an unexpected observation time");
    return asPublishedReceipt(receiptId, existing);
  }

  const transactionHash = await input.walletClient.writeContract({
    ...simulation.request,
    chain: input.walletClient.chain,
  });
  const transactionReceipt = await input.publicClient.waitForTransactionReceipt({ hash: transactionHash });
  requireCondition(transactionReceipt.status === "success", "Receipt publication transaction reverted");

  const published: PublishedReceipt[] = [];
  for (const log of transactionReceipt.logs) {
    if (log.address.toLowerCase() !== registryAddress.toLowerCase()) continue;
    try {
      const decoded = decodeEventLog({
        abi: veridraReceiptRegistryAbi,
        data: log.data,
        topics: log.topics,
        strict: true,
      });
      if (decoded.eventName !== "ReceiptPublished") continue;
      const args = decoded.args;
      requireCondition(args.receiptId.toLowerCase() === receiptId.toLowerCase(), "Published event has an unexpected receipt ID");
      requireCondition(args.publisher.toLowerCase() === account.address.toLowerCase(), "Published event has an unexpected publisher");
      requireCondition(args.schemaVersion === 1 && args.evidenceAssurance === 1, "Published event has an unsupported schema or assurance");
      requireCondition(args.transactionHash.toLowerCase() === input.claim.transactionHash.toLowerCase(), "Published event has an unexpected transaction hash");
      requireCondition(args.chainId === configuredChainId, "Published event has an unexpected chain ID");
      requireCondition(args.providerId.toLowerCase() === acquired.providerId.toLowerCase(), "Published event has an unexpected provider ID");
      requireCondition(args.observedAt === acquired.observedAt, "Published event has an unexpected observation time");
      const verdictIndex = Number(args.verdict);
      requireCondition(Number.isInteger(verdictIndex) && verdictIndex >= 0 && verdictIndex < VERDICTS.length, "Published event has an unknown verdict");
      published.push({
        receiptId: args.receiptId,
        transactionHash: args.transactionHash,
        chainId: args.chainId,
        verdict: VERDICTS[verdictIndex]!,
        schemaVersion: BigInt(args.schemaVersion),
        providerId: args.providerId,
        observedAt: BigInt(args.observedAt),
      });
    } catch (error) {
      if (error instanceof ReceiptPublicationError) throw error;
      // Other registry events are ignored; malformed candidate logs do not
      // become a receipt result.
    }
  }
  requireCondition(published.length <= 1, "Publication transaction emitted multiple Veridra receipts");
  if (published.length === 1) return published[0]!;

  // Concurrent identical publication can make this transaction idempotent on
  // chain, so no second event is emitted. Read the deterministic simulated ID.
  const stored = await input.publicClient.readContract({
    address: registryAddress,
    abi: veridraReceiptRegistryAbi,
    functionName: "getReceipt",
    args: [receiptId],
  });
  requireCondition(stored.schemaVersion !== 0, "Publication emitted no event and no matching receipt exists");
  requireCondition(stored.transactionHash.toLowerCase() === input.claim.transactionHash.toLowerCase(), "Stored receipt has an unexpected transaction hash");
  requireCondition(stored.chainId === configuredChainId, "Stored receipt has an unexpected chain ID");
  requireCondition(stored.providerId.toLowerCase() === acquired.providerId.toLowerCase(), "Stored receipt has an unexpected provider ID");
  requireCondition(stored.observedAt === acquired.observedAt, "Stored receipt has an unexpected observation time");
  return asPublishedReceipt(receiptId, stored);
}
