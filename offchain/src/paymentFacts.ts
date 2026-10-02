import {
  decodeEventLog,
  fromRlp,
  getAddress,
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
  stringToHex,
  toRlp,
  type Address,
  type Hex,
  type TransactionSerialized,
} from "viem";

const MAX_RAW_VALUE_BYTES = 8_192;
const MAX_TOKEN_ALLOWLIST = 64;
const MAX_RECEIPT_LOGS = 64;
const MAX_TOPICS_PER_LOG = 4;
const MAX_UINT256 = (1n << 256n) - 1n;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const TRANSFER_TOPIC = keccak256(stringToHex("Transfer(address,address,uint256)"));
const TRANSFER_ABI = [
  {
    type: "event",
    name: "Transfer",
    anonymous: false,
    inputs: [
      { indexed: true, name: "from", type: "address" },
      { indexed: true, name: "to", type: "address" },
      { indexed: false, name: "value", type: "uint256" },
    ],
  },
] as const;

type DecodedRlp = Hex | readonly DecodedRlp[];
type SupportedTransactionType = "legacy" | "eip2930" | "eip1559" | "eip7702";
type ParsedPaymentTransaction = {
  type: string;
  chainId?: number;
  to?: Address;
  value?: bigint;
  data?: Hex;
};

export type RawPaymentFact = {
  /** Chain context selected by the caller and checked against any signed tx chainId. */
  chainId: bigint;
  transactionHash: Hex;
  transactionType: SupportedTransactionType;
  successful: boolean;
  sender: Address;
  recipient: Address;
  asset: Address;
  amount: bigint;
};

export class RawPaymentFactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RawPaymentFactError";
  }
}

function fail(message: string): never {
  throw new RawPaymentFactError(message);
}

function checkedRawHex(value: unknown, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) fail(`${label} must be non-empty even-length hex`);
  if ((value.length - 2) / 2 > MAX_RAW_VALUE_BYTES) fail(`${label} exceeds ${MAX_RAW_VALUE_BYTES} bytes`);
  return value as Hex;
}

function asList(value: DecodedRlp | undefined, label: string): readonly DecodedRlp[] {
  if (!Array.isArray(value)) fail(`${label} must be an RLP list`);
  return value as readonly DecodedRlp[];
}

function asBytes(value: DecodedRlp | undefined, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail(`${label} must be an RLP byte string`);
  return value;
}

function checkedAddress(value: string, label: string): Address {
  try {
    return getAddress(value);
  } catch {
    fail(`${label} is not a valid address`);
  }
}

function decodeCanonicalRlp(value: Hex, label: string): DecodedRlp {
  let decoded: DecodedRlp;
  try {
    decoded = fromRlp(value) as DecodedRlp;
  } catch {
    fail(`${label} is malformed RLP`);
  }
  if (toRlp(decoded as never, "hex").toLowerCase() !== value.toLowerCase()) fail(`${label} is not canonical RLP`);
  return decoded;
}

function transactionType(rawTransaction: Hex): SupportedTransactionType {
  const firstByte = Number.parseInt(rawTransaction.slice(2, 4), 16);
  if (firstByte >= 0xc0) return "legacy";
  if (firstByte === 0x01) return "eip2930";
  if (firstByte === 0x02) return "eip1559";
  if (firstByte === 0x04) return "eip7702";
  fail(`Unsupported transaction type 0x${firstByte.toString(16).padStart(2, "0")}`);
}

function canonicalTransactionPayload(rawTransaction: Hex, type: SupportedTransactionType): void {
  const payload = type === "legacy" ? rawTransaction : `0x${rawTransaction.slice(4)}` as Hex;
  const decoded = decodeCanonicalRlp(payload, "Raw transaction");
  asList(decoded, "Raw transaction payload");
}

function canonicalReceiptPayload(rawReceipt: Hex, expectedType: SupportedTransactionType): DecodedRlp {
  const firstByte = Number.parseInt(rawReceipt.slice(2, 4), 16);
  const receiptType = firstByte >= 0xc0 ? "legacy" : firstByte === 0x01 ? "eip2930" : firstByte === 0x02 ? "eip1559" : firstByte === 0x04 ? "eip7702" : "unsupported";
  if (receiptType !== expectedType) fail("Raw receipt envelope type differs from transaction type or is unsupported");
  const payload = receiptType === "legacy" ? rawReceipt : `0x${rawReceipt.slice(4)}` as Hex;
  return decodeCanonicalRlp(payload, "Raw receipt");
}

function decodeRlpUInt(value: DecodedRlp | undefined, label: string): bigint {
  const bytes = asBytes(value, label);
  if (bytes.length > 66 || (bytes.length > 2 && bytes.slice(2, 4) === "00")) fail(`${label} is not a canonical uint256`);
  const result = bytes === "0x" ? 0n : BigInt(bytes);
  if (result > MAX_UINT256) fail(`${label} exceeds uint256`);
  return result;
}

function parseReceipt(rawReceipt: Hex, type: SupportedTransactionType): {
  successful: boolean;
  logs: readonly DecodedRlp[];
} {
  const receipt = asList(canonicalReceiptPayload(rawReceipt, type), "Receipt payload");
  if (receipt.length !== 4) fail("Receipt must contain status, cumulative gas, bloom, and logs");
  const status = asBytes(receipt[0], "Receipt status");
  const successful = status === "0x01";
  if (!successful && status !== "0x") fail("Receipt status is unsupported or not canonical post-Byzantium status");
  decodeRlpUInt(receipt[1], "Receipt cumulative gas");
  if (asBytes(receipt[2], "Receipt logs bloom").length !== 2 + 256 * 2) fail("Receipt logs bloom must be 256 bytes");
  const logs = asList(receipt[3], "Receipt logs");
  if (logs.length > MAX_RECEIPT_LOGS) fail(`Receipt exceeds ${MAX_RECEIPT_LOGS} logs`);
  return { successful, logs };
}

function decodeTransferLog(log: DecodedRlp, index: number): {
  emitter: Address;
  topics: Hex[];
  data: Hex;
} {
  const fields = asList(log, `Receipt log ${index}`);
  if (fields.length !== 3) fail(`Receipt log ${index} must contain address, topics, and data`);
  const emitterHex = asBytes(fields[0], `Receipt log ${index} address`);
  if (emitterHex.length !== 42) fail(`Receipt log ${index} address must be 20 bytes`);
  const emitter = checkedAddress(emitterHex, `Receipt log ${index} address`);
  const topicItems = asList(fields[1], `Receipt log ${index} topics`);
  if (topicItems.length > MAX_TOPICS_PER_LOG) fail(`Receipt log ${index} exceeds ${MAX_TOPICS_PER_LOG} topics`);
  const topics = topicItems.map((topic, topicIndex) => {
    const value = asBytes(topic, `Receipt log ${index} topic ${topicIndex}`);
    if (value.length !== 66) fail(`Receipt log ${index} topic ${topicIndex} must be bytes32`);
    return value;
  });
  const data = asBytes(fields[2], `Receipt log ${index} data`);
  return { emitter, topics, data };
}

/**
 * Derive one supported payment fact from the exact raw transaction and receipt
 * trie values. Caller-supplied values, RPC JSON transaction objects, and logs
 * outside these committed bytes are never used. This does not authenticate the
 * header/proof or establish ERC-20 balance semantics.
 */
export async function derivePaymentFactFromRawValues(
  rawTransactionInput: Hex,
  rawReceiptInput: Hex,
  expectedChainId: bigint,
  supportedTokenAddresses: readonly Address[],
): Promise<RawPaymentFact> {
  const rawTransaction = checkedRawHex(rawTransactionInput, "Raw transaction");
  const rawReceipt = checkedRawHex(rawReceiptInput, "Raw receipt");
  if (typeof expectedChainId !== "bigint" || expectedChainId <= 0n || expectedChainId > MAX_UINT256) fail("Expected chain ID must fit a positive uint256");
  if (!Array.isArray(supportedTokenAddresses) || supportedTokenAddresses.length > MAX_TOKEN_ALLOWLIST) fail(`Token allowlist must be an array of at most ${MAX_TOKEN_ALLOWLIST} entries`);

  const type = transactionType(rawTransaction);
  canonicalTransactionPayload(rawTransaction, type);
  let parsed: ParsedPaymentTransaction;
  let sender: Address;
  try {
    parsed = parseTransaction(rawTransaction as TransactionSerialized) as ParsedPaymentTransaction;
    sender = await recoverTransactionAddress({ serializedTransaction: rawTransaction as TransactionSerialized });
  } catch {
    fail("Raw transaction cannot be decoded or its signer cannot be recovered");
  }
  if (parsed.type !== type) fail("Decoded transaction type differs from the raw envelope");
  if (parsed.chainId !== undefined && (!Number.isSafeInteger(parsed.chainId) || BigInt(parsed.chainId) !== expectedChainId)) {
    fail("Signed transaction chain ID differs from the expected chain");
  }

  const receipt = parseReceipt(rawReceipt, type);
  const to = parsed.to === undefined ? null : checkedAddress(parsed.to, "Transaction target");
  const transactionValue = parsed.value ?? 0n;
  const input = parsed.data ?? "0x";
  let allowedTokens: Set<string>;
  try {
    allowedTokens = new Set(supportedTokenAddresses.map((address) => getAddress(address).toLowerCase()));
  } catch {
    fail("Token allowlist contains an invalid address");
  }
  const tokenTransfers: { asset: Address; sender: Address; recipient: Address; amount: bigint }[] = [];

  if (!receipt.successful && receipt.logs.length !== 0) fail("Failed transaction receipt must not contain logs");
  for (let i = 0; i < receipt.logs.length; i++) {
    const log = decodeTransferLog(receipt.logs[i]!, i);
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
    if (!allowedTokens.has(log.emitter.toLowerCase())) fail("Transfer event came from a token outside the allowlist");
    if (to === null || to.toLowerCase() !== log.emitter.toLowerCase()) fail("Transfer event was not emitted by the transaction's direct target");

    if (log.topics.length !== 3) fail("Standard Transfer event must have exactly three topics");
    const topicsTuple = log.topics as [Hex, Hex, Hex];
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data: log.data, topics: topicsTuple, strict: true });
      if (decoded.eventName !== "Transfer") fail("Transfer event decoding returned an unexpected event");
      tokenTransfers.push({
        asset: log.emitter,
        sender: checkedAddress(decoded.args.from, "Transfer sender"),
        recipient: checkedAddress(decoded.args.to, "Transfer recipient"),
        amount: decoded.args.value,
      });
    } catch {
      fail("Allowlisted Transfer event is malformed");
    }
  }

  if (!receipt.successful) {
    return {
      chainId: expectedChainId,
      transactionHash: keccak256(rawTransaction),
      transactionType: type,
      successful: false,
      sender,
      recipient: to ?? ZERO_ADDRESS,
      asset: ZERO_ADDRESS,
      amount: 0n,
    };
  }

  const nativeTransfer = to !== null && input === "0x" && transactionValue > 0n
    ? { asset: ZERO_ADDRESS, sender, recipient: to, amount: transactionValue }
    : null;
  if (tokenTransfers.length + (nativeTransfer === null ? 0 : 1) !== 1) {
    fail("Transaction does not contain exactly one supported payment fact");
  }
  const payment = nativeTransfer ?? tokenTransfers[0]!;
  if (payment.amount === 0n) fail("Supported payment amount must be positive");

  return {
    chainId: expectedChainId,
    transactionHash: keccak256(rawTransaction),
    transactionType: type,
    successful: true,
    sender: payment.sender,
    recipient: payment.recipient,
    asset: payment.asset,
    amount: payment.amount,
  };
}
