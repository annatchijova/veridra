import { getAddress, type Address, type Hex } from "viem";
import type { PaymentClaim } from "./rpcEvidence.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MAX_UINT256 = (1n << 256n) - 1n;
const CLAIM_FIELDS = new Set([
  "transactionHash",
  "chainId",
  "sender",
  "recipient",
  "asset",
  "amountBaseUnits",
]);

export class InvalidPaymentClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidPaymentClaimError";
  }
}

function invalid(message: string): never {
  throw new InvalidPaymentClaimError(message);
}

function parseUnsigned(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    invalid(`${field} must be a canonical unsigned decimal string`);
  }
  if (value.length > 78) invalid(`${field} exceeds uint256`);
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256) invalid(`${field} exceeds uint256`);
  return parsed;
}

function parseAddress(value: unknown, field: string): Address {
  if (typeof value !== "string" || value.length !== 42) invalid(`${field} must be a 20-byte address string`);
  try {
    return getAddress(value);
  } catch {
    invalid(`${field} is not a valid EVM address`);
  }
}

/**
 * Parse the public claim shape. Amounts and chain IDs must be decimal strings;
 * JSON numbers and floating-point values are rejected at the boundary.
 */
export function parsePaymentClaim(input: unknown): PaymentClaim {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    invalid("Payment claim must be a JSON object");
  }
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!CLAIM_FIELDS.has(key)) invalid(`Unsupported payment claim field: ${key}`);
  }

  const transactionHash = source.transactionHash;
  if (typeof transactionHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    invalid("transactionHash must be a 32-byte hex string");
  }
  const chainId = parseUnsigned(source.chainId, "chainId");
  if (chainId === 0n) invalid("chainId must be positive");

  const assertsSender = Object.hasOwn(source, "sender");
  const assertsRecipient = Object.hasOwn(source, "recipient");
  const assertsAsset = Object.hasOwn(source, "asset");
  const assertsAmount = Object.hasOwn(source, "amountBaseUnits");

  return {
    transactionHash: transactionHash as Hex,
    chainId,
    assertsSender,
    sender: assertsSender ? parseAddress(source.sender, "sender") : ZERO_ADDRESS,
    assertsRecipient,
    recipient: assertsRecipient ? parseAddress(source.recipient, "recipient") : ZERO_ADDRESS,
    assertsAsset,
    asset: assertsAsset ? parseAddress(source.asset, "asset") : ZERO_ADDRESS,
    assertsAmount,
    amount: assertsAmount ? parseUnsigned(source.amountBaseUnits, "amountBaseUnits") : 0n,
  };
}
