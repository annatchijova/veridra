import { keccak256, type Hex } from "viem";
import { buildInclusionProofFromRawBlock, type RawBlockInclusionProof } from "./mptProof.js";

const MAX_RPC_RESPONSE_BYTES = 5_000_000;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const RPC_TIMEOUT_MILLISECONDS = 15_000;

type JsonObject = Record<string, unknown>;

export type RecentInclusionProofInput = {
  rpcUrl: string;
  expectedChainId: bigint;
  transactionHash: Hex;
};

export type AcquiredRecentInclusionProof = RawBlockInclusionProof & {
  blockHash: Hex;
  chainId: bigint;
};

export class InclusionProofAcquisitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InclusionProofAcquisitionError";
  }
}

function fail(message: string): never {
  throw new InclusionProofAcquisitionError(message);
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseQuantity(value: unknown, field: string, maximum = MAX_UINT64): bigint {
  if (typeof value !== "string" || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(value)) {
    fail(`RPC quantity ${field} is malformed`);
  }
  const parsed = BigInt(value);
  if (parsed > maximum) fail(`RPC quantity ${field} exceeds its configured integer bound`);
  return parsed;
}

function parseHash(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) fail(`RPC hash ${field} is malformed`);
  return value as Hex;
}

async function readBoundedJson(response: Response): Promise<unknown> {
  if (!response.ok) fail(`RPC returned HTTP ${response.status}`);
  const declaredSize = response.headers.get("content-length");
  if (declaredSize !== null) {
    if (!/^\d+$/.test(declaredSize) || BigInt(declaredSize) > BigInt(MAX_RPC_RESPONSE_BYTES)) {
      fail("Raw proof RPC response exceeds the configured size bound");
    }
  }
  if (response.body === null) fail("Raw proof RPC response body is missing");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_RPC_RESPONSE_BYTES) {
      await reader.cancel();
      fail("Raw proof RPC response exceeds the configured size bound");
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
    fail("Raw proof RPC response is not valid UTF-8 JSON");
  }
}

async function rpcCall(url: string, id: string, method: string, params: readonly unknown[]): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
      redirect: "error",
      signal: AbortSignal.timeout(RPC_TIMEOUT_MILLISECONDS),
    });
  } catch {
    fail(`RPC request failed for ${method}`);
  }
  const payload = await readBoundedJson(response);
  if (!isObject(payload) || payload.jsonrpc !== "2.0" || payload.id !== id) {
    fail(`RPC returned an invalid envelope for ${method}`);
  }
  if (payload.error !== undefined) fail(`RPC reported an error for ${method}`);
  if (!("result" in payload)) fail(`RPC omitted the result for ${method}`);
  return payload.result;
}

/**
 * Acquire raw block/receipt data for one transaction and build its inclusion
 * proof. RPC output is checked for internal consistency only; consensus
 * authentication still happens when the returned header is checked onchain.
 */
export async function acquireRecentInclusionProof(
  input: RecentInclusionProofInput,
): Promise<AcquiredRecentInclusionProof> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.transactionHash)) fail("Transaction hash must be bytes32");
  if (input.expectedChainId <= 0n || input.expectedChainId > MAX_UINT256) fail("Expected chain ID must fit a positive uint256");

  let rpcUrl: URL;
  try {
    rpcUrl = new URL(input.rpcUrl);
  } catch {
    fail("RPC URL is malformed");
  }
  const loopback = rpcUrl.hostname === "localhost" || rpcUrl.hostname === "127.0.0.1" || rpcUrl.hostname === "[::1]";
  if ((rpcUrl.protocol !== "https:" && !(rpcUrl.protocol === "http:" && loopback)) || rpcUrl.username || rpcUrl.password) {
    fail("RPC URL must use HTTPS, or loopback HTTP for local development, without embedded credentials");
  }

  const [chainValue, transactionValue] = await Promise.all([
    rpcCall(input.rpcUrl, "veridra-proof-chain", "eth_chainId", []),
    rpcCall(input.rpcUrl, "veridra-proof-transaction", "eth_getTransactionByHash", [input.transactionHash]),
  ]);
  const chainId = parseQuantity(chainValue, "chainId", MAX_UINT256);
  if (chainId !== input.expectedChainId) fail("RPC chain ID differs from the configured chain");
  if (!isObject(transactionValue)) fail("Transaction is unavailable or malformed");

  const returnedHash = parseHash(transactionValue.hash, "transaction.hash");
  const blockHash = parseHash(transactionValue.blockHash, "transaction.blockHash");
  const blockNumber = parseQuantity(transactionValue.blockNumber, "transaction.blockNumber");
  const transactionIndex = parseQuantity(transactionValue.transactionIndex, "transaction.transactionIndex");
  if (returnedHash.toLowerCase() !== input.transactionHash.toLowerCase()) fail("RPC returned a different transaction hash");

  const blockParameter = `0x${blockNumber.toString(16)}`;
  const [rawBlockValue, rawReceiptsValue] = await Promise.all([
    rpcCall(input.rpcUrl, "veridra-proof-block", "debug_getRawBlock", [blockParameter]),
    rpcCall(input.rpcUrl, "veridra-proof-receipts", "debug_getRawReceipts", [blockParameter]),
  ]);
  if (typeof rawBlockValue !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(rawBlockValue)) {
    fail("Raw block result is malformed");
  }
  if (!Array.isArray(rawReceiptsValue) || rawReceiptsValue.length === 0 || rawReceiptsValue.length > 4_096) {
    fail("Raw receipts result is malformed or outside the entry bound");
  }
  const rawReceipts = rawReceiptsValue.map((receipt, index) => {
    if (typeof receipt !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(receipt)) {
      fail(`Raw receipt ${index} is malformed`);
    }
    return receipt as Hex;
  });

  const proof = buildInclusionProofFromRawBlock(rawBlockValue as Hex, rawReceipts, input.transactionHash);
  if (proof.blockNumber !== blockNumber) fail("Raw block header number differs from transaction lookup");
  if (BigInt(proof.transactionIndex) !== transactionIndex) fail("Raw block transaction index differs from transaction lookup");
  if (keccak256(proof.rawHeader).toLowerCase() !== blockHash.toLowerCase()) {
    fail("Raw block header hash differs from transaction lookup");
  }
  return { ...proof, blockHash, chainId };
}
