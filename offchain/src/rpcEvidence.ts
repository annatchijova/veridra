import {
  decodeEventLog,
  getAddress,
  keccak256,
  stringToHex,
  type Address,
  type Hex,
} from "viem";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const MAX_RPC_RESPONSE_BYTES = 2_000_000;
const RPC_TIMEOUT_MILLISECONDS = 15_000;
const MAX_CANONICAL_DEPTH = 16;
const MAX_CANONICAL_ITEMS = 8_192;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
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

export type PaymentClaim = {
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

export type PaymentEvidence = {
  available: boolean;
  transactionHash: Hex;
  chainId: bigint;
  blockNumber: bigint;
  blockHash: Hex;
  successful: boolean;
  sender: Address;
  recipient: Address;
  asset: Address;
  amount: bigint;
  transactionPayloadDigest: Hex;
  receiptPayloadDigest: Hex;
  logsDigest: Hex;
  finalityPolicyId: Hex;
  requiredConfirmations: bigint;
  observedConfirmations: bigint;
};

export type RpcEvidenceConfig = {
  rpcUrl: string;
  expectedChainId: bigint;
  providerId: Hex;
  requiredConfirmations: bigint;
  /** Explicitly configured token addresses. Symbols and decimals are ignored. */
  supportedTokenAddresses: readonly Address[];
};

export type AcquiredPaymentEvidence = {
  providerId: Hex;
  observedAt: bigint;
  evidence: PaymentEvidence;
};

export class InsufficientEvidenceError extends Error {
  readonly code = "INSUFFICIENT_EVIDENCE";

  constructor(message: string) {
    super(message);
    this.name = "InsufficientEvidenceError";
  }
}

type JsonObject = Record<string, unknown>;

function fail(message: string): never {
  throw new InsufficientEvidenceError(message);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(object: JsonObject, name: string): string {
  const value = object[name];
  if (typeof value !== "string") fail(`RPC field ${name} is missing or not a string`);
  return value;
}

function hexField(object: JsonObject, name: string, bytes?: number): Hex {
  const value = stringField(object, name);
  if (!/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail(`RPC field ${name} is malformed hex`);
  if (bytes !== undefined && value.length !== 2 + bytes * 2) {
    fail(`RPC field ${name} has the wrong byte length`);
  }
  return value as Hex;
}

function hashField(object: JsonObject, name: string): Hex {
  return hexField(object, name, 32);
}

function addressField(object: JsonObject, name: string): Address {
  const value = hexField(object, name, 20);
  return getAddress(value);
}

function quantity(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail(`RPC quantity ${field} is malformed`);
  }
  if (value.length > 66) fail(`RPC quantity ${field} exceeds uint256`);
  return BigInt(value);
}

function canonicalJson(value: unknown, depth = 0, budget = { remaining: MAX_CANONICAL_ITEMS }): string {
  if (depth > MAX_CANONICAL_DEPTH || budget.remaining-- <= 0) {
    fail("RPC payload exceeds canonicalization bounds");
  }
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") fail("Numeric JSON values are rejected; RPC quantities must be hex strings");
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry, depth + 1, budget)).join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key], depth + 1, budget)}`).join(",")}}`;
  }
  fail("RPC payload contains an unsupported JSON value");
}

function digestJson(value: unknown): Hex {
  return keccak256(stringToHex(canonicalJson(value)));
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) fail(`RPC returned HTTP ${response.status}`);
  const declaredSize = response.headers.get("content-length");
  if (declaredSize !== null) {
    if (!/^\d+$/.test(declaredSize)) fail("RPC content length is malformed");
    if (BigInt(declaredSize) > BigInt(MAX_RPC_RESPONSE_BYTES)) {
      fail("RPC response exceeds the configured size bound");
    }
  }
  if (response.body === null) fail("RPC response body is missing");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_RPC_RESPONSE_BYTES) {
      await reader.cancel();
      fail("RPC response exceeds the configured size bound");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    fail("RPC response is not valid UTF-8 JSON");
  }
}

async function rpcCall(url: string, method: string, params: readonly unknown[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    });
  } catch {
    fail(`RPC request failed for ${method}`);
  }
  const payload = await readBoundedJson(response);
  if (!isObject(payload) || payload.jsonrpc !== "2.0" || payload.id !== 1) {
    fail(`RPC returned an invalid envelope for ${method}`);
  }
  if (payload.error !== undefined) fail(`RPC reported an error for ${method}`);
  if (!("result" in payload)) fail(`RPC omitted the result for ${method}`);
  return payload.result;
}

function objectResult(value: unknown, label: string): JsonObject {
  if (!isObject(value)) fail(`${label} is unavailable or malformed`);
  return value;
}

function bytes32(value: Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(value)) fail("Expected a bytes32 value");
  return value;
}

function finalityPolicyId(chainId: bigint, confirmations: bigint): Hex {
  return keccak256(stringToHex(`veridra/finality/v1:${chainId.toString(10)}:${confirmations.toString(10)}`));
}

function checkedUint64(value: bigint, label: string): bigint {
  if (value < 0n || value > MAX_UINT64) fail(`${label} does not fit uint64`);
  return value;
}

/**
 * Acquire one bounded payment fact from a declared Monad-compatible JSON-RPC.
 * The returned evidence is still RPC_ATTESTED: the provider response is not
 * cryptographically authenticated here. This function never adjudicates a claim.
 */
export async function acquirePaymentEvidence(
  transactionHash: Hex,
  observedAtUnixSeconds: string,
  config: RpcEvidenceConfig,
): Promise<AcquiredPaymentEvidence> {
  bytes32(transactionHash);
  bytes32(config.providerId);
  if (config.supportedTokenAddresses.length > 64) fail("Configured token allowlist exceeds 64 entries");
  let rpcUrl: URL;
  try {
    rpcUrl = new URL(config.rpcUrl);
  } catch {
    fail("RPC URL is malformed");
  }
  const isLoopback = rpcUrl.hostname === "localhost" || rpcUrl.hostname === "127.0.0.1" || rpcUrl.hostname === "[::1]";
  if ((rpcUrl.protocol !== "https:" && !(rpcUrl.protocol === "http:" && isLoopback)) || rpcUrl.username || rpcUrl.password) {
    fail("RPC URL must use HTTPS, or loopback HTTP for local development, without embedded credentials");
  }
  if (config.expectedChainId <= 0n || config.expectedChainId > MAX_UINT256) {
    fail("Configured chain ID must fit uint256 and be positive");
  }
  if (config.requiredConfirmations <= 0n) fail("Required confirmations must be positive");
  checkedUint64(config.requiredConfirmations, "requiredConfirmations");
  const observedAt = checkedUint64(parseUnsignedDecimal(observedAtUnixSeconds, "observedAt"), "observedAt");

  const [chainValue, transactionValue, receiptValue] = await Promise.all([
    rpcCall(config.rpcUrl, "eth_chainId", []),
    rpcCall(config.rpcUrl, "eth_getTransactionByHash", [transactionHash]),
    rpcCall(config.rpcUrl, "eth_getTransactionReceipt", [transactionHash]),
  ]);
  const rpcChainId = quantity(chainValue, "chainId");
  if (rpcChainId !== config.expectedChainId) fail("RPC chain ID does not match configured chain");
  if (transactionValue === null || receiptValue === null) fail("Transaction or receipt is not available");
  const transaction = objectResult(transactionValue, "Transaction");
  const receipt = objectResult(receiptValue, "Receipt");

  const txHash = hashField(transaction, "hash");
  const receiptHash = hashField(receipt, "transactionHash");
  if (txHash.toLowerCase() !== transactionHash.toLowerCase() || receiptHash.toLowerCase() !== txHash.toLowerCase()) {
    fail("Transaction hash differs across request, transaction, and receipt");
  }
  const txBlockNumber = quantity(transaction.blockNumber, "transaction.blockNumber");
  const receiptBlockNumber = quantity(receipt.blockNumber, "receipt.blockNumber");
  const transactionIndex = quantity(transaction.transactionIndex, "transaction.transactionIndex");
  const receiptIndex = quantity(receipt.transactionIndex, "receipt.transactionIndex");
  const txBlockHash = hashField(transaction, "blockHash");
  const receiptBlockHash = hashField(receipt, "blockHash");
  if (txBlockNumber !== receiptBlockNumber || transactionIndex !== receiptIndex || txBlockHash.toLowerCase() !== receiptBlockHash.toLowerCase()) {
    fail("Transaction and receipt disagree on block or transaction index");
  }

  const blockValue = await rpcCall(config.rpcUrl, "eth_getBlockByHash", [txBlockHash, false]);
  const headValue = await rpcCall(config.rpcUrl, "eth_blockNumber", []);
  const block = objectResult(blockValue, "Containing block");
  const blockHash = hashField(block, "hash");
  const blockNumber = quantity(block.number, "block.number");
  const transactions = block.transactions;
  if (!Array.isArray(transactions) || transactionIndex >= BigInt(transactions.length)) {
    fail("Containing block omits the transaction index");
  }
  const blockTransaction = transactions[Number(transactionIndex)];
  if (typeof blockTransaction !== "string" || blockTransaction.toLowerCase() !== txHash.toLowerCase()) {
    fail("Containing block transaction list does not match the receipt");
  }
  if (blockHash.toLowerCase() !== txBlockHash.toLowerCase() || blockNumber !== txBlockNumber) {
    fail("Containing block does not match transaction and receipt");
  }
  const head = quantity(headValue, "headBlockNumber");
  if (head < blockNumber) fail("RPC head precedes the transaction block");
  const observedConfirmations = checkedUint64(head - blockNumber + 1n, "observedConfirmations");

  const txChainIdValue = transaction.chainId;
  if (txChainIdValue !== null && txChainIdValue !== undefined && quantity(txChainIdValue, "transaction.chainId") !== config.expectedChainId) {
    fail("Transaction chain ID does not match configured chain");
  }
  const from = addressField(transaction, "from");
  const toValue = transaction.to;
  const to = toValue === null ? null : getAddress(hexField(transaction, "to", 20));
  const statusValue = receipt.status;
  if (statusValue !== "0x0" && statusValue !== "0x1") fail("Receipt execution status is unsupported");
  const successful = statusValue === "0x1";
  const transactionValueAmount = quantity(transaction.value, "transaction.value");
  const input = hexField(transaction, "input");

  const supportedTokens = new Set(config.supportedTokenAddresses.map((address) => getAddress(address).toLowerCase()));
  const logsValue = receipt.logs;
  if (!Array.isArray(logsValue)) fail("Receipt logs are missing or malformed");
  const supportedTransfers: { asset: Address; sender: Address; recipient: Address; amount: bigint }[] = [];
  for (const rawLog of logsValue) {
    if (!isObject(rawLog)) fail("Receipt contains a malformed log");
    const emitter = addressField(rawLog, "address");
    const topicsValue = rawLog.topics;
    if (!Array.isArray(topicsValue) || topicsValue.length === 0 || typeof topicsValue[0] !== "string") {
      fail("Receipt contains malformed log topics");
    }
    const topic0 = topicsValue[0];
    if (typeof topic0 !== "string" || topic0.toLowerCase() !== TRANSFER_TOPIC.toLowerCase()) continue;
    if (!supportedTokens.has(emitter.toLowerCase())) {
      fail("Transaction contains a Transfer event from a token outside the configured allowlist");
    }
    if (to === null || to.toLowerCase() !== emitter.toLowerCase()) {
      fail("Configured token Transfer event was not emitted by the transaction's direct target");
    }
    if (topicsValue.length !== 3) fail("Configured token Transfer log has an invalid topic count");
    const topics = topicsValue.map((topic) => {
      if (typeof topic !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(topic)) fail("Transfer log topic is malformed");
      return topic as Hex;
    }) as [Hex, Hex, Hex];
    const data = hexField(rawLog, "data");
    try {
      const decoded = decodeEventLog({ abi: TRANSFER_ABI, data, topics, strict: true });
      if (decoded.eventName === "Transfer") {
        supportedTransfers.push({
          asset: emitter,
          sender: getAddress(decoded.args.from),
          recipient: getAddress(decoded.args.to),
          amount: decoded.args.value,
        });
      }
    } catch {
      fail("A configured token emitted an unsupported or malformed log");
    }
  }

  const nativeTransfer = successful && to !== null && input === "0x" && transactionValueAmount > 0n
    ? { asset: ZERO_ADDRESS, sender: from, recipient: to, amount: transactionValueAmount }
    : null;
  let payment: { asset: Address; sender: Address; recipient: Address; amount: bigint };
  if (!successful) {
    // A reverted transaction proves execution failure. Its reverted logs do not
    // establish a token payment; execution failure alone prevents VERIFIED.
    payment = { asset: ZERO_ADDRESS, sender: from, recipient: to ?? ZERO_ADDRESS, amount: 0n };
  } else {
    if (supportedTransfers.length + (nativeTransfer === null ? 0 : 1) !== 1) {
      fail("Transaction does not contain exactly one supported payment fact");
    }
    const extracted = nativeTransfer ?? supportedTransfers[0];
    if (extracted === undefined || extracted.amount === 0n) fail("Supported payment extraction failed");
    payment = extracted;
  }

  const finalityPolicy = finalityPolicyId(config.expectedChainId, config.requiredConfirmations);
  const evidence: PaymentEvidence = {
    available: true,
    transactionHash: txHash,
    chainId: rpcChainId,
    blockNumber,
    blockHash,
    successful,
    sender: payment.sender,
    recipient: payment.recipient,
    asset: payment.asset,
    amount: payment.amount,
    transactionPayloadDigest: digestJson(transaction),
    receiptPayloadDigest: digestJson(receipt),
    logsDigest: digestJson(receipt.logs),
    finalityPolicyId: finalityPolicy,
    requiredConfirmations: config.requiredConfirmations,
    observedConfirmations,
  };

  // The adjudicator returns INSUFFICIENT_EVIDENCE when observed depth is below
  // the policy threshold, while preserving the evidence for that receipt.
  return { providerId: config.providerId, observedAt, evidence };
}

function parseUnsignedDecimal(value: string, label: string): bigint {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) fail(`${label} must be a canonical unsigned decimal string`);
  if (value.length > 20) fail(`${label} exceeds uint64`);
  return BigInt(value);
}
