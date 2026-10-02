import { bytesToHex, fromRlp, hexToBytes, keccak256, toRlp, type Hex } from "viem";

const MAX_ENTRIES = 4_096;
const MAX_VALUE_BYTES = 8_192;
const MAX_TOTAL_VALUE_BYTES = 2_000_000;
const MAX_RAW_BLOCK_BYTES = 2_000_000;
const MAX_HEADER_BYTES = 4_096;
const MAX_PROOF_NODES = 20;

type RlpValue = Uint8Array | readonly RlpValue[];
type TrieEntry = { key: number[]; value: Uint8Array };
type TrieNode =
  | { kind: "leaf"; path: number[]; value: Uint8Array; rlp: RlpValue; encoded: Uint8Array }
  | { kind: "extension"; path: number[]; child: TrieNode; rlp: RlpValue; encoded: Uint8Array }
  | { kind: "branch"; children: (TrieNode | undefined)[]; value?: Uint8Array; rlp: RlpValue; encoded: Uint8Array };

export class MptProofInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MptProofInputError";
  }
}

export interface IndexedTrieProof {
  root: Hex;
  index: number;
  value: Hex;
  proof: Hex[];
}

export interface TransactionAndReceiptProofs {
  transactionRoot: Hex;
  receiptRoot: Hex;
  transaction: IndexedTrieProof;
  receipt: IndexedTrieProof;
}

export interface RawBlockInclusionProof {
  blockNumber: bigint;
  rawHeader: Hex;
  transactionIndex: number;
  transactionHash: Hex;
  proofs: TransactionAndReceiptProofs;
}

type DecodedRlp = Hex | readonly DecodedRlp[];

function fail(message: string): never {
  throw new MptProofInputError(message);
}

function indexKey(index: number): number[] {
  let integer = BigInt(index);
  const bytes: number[] = [];
  while (integer > 0n) {
    bytes.unshift(Number(integer & 0xffn));
    integer >>= 8n;
  }
  const encoded = toRlp(Uint8Array.from(bytes), "bytes") as Uint8Array;
  return [...encoded].flatMap((byte) => [byte >> 4, byte & 0x0f]);
}

function compactPath(path: number[], leaf: boolean): Uint8Array {
  const odd = path.length % 2 === 1;
  const nibbles = odd ? [((leaf ? 2 : 0) + 1), ...path] : [leaf ? 2 : 0, 0, ...path];
  const output = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < nibbles.length; i += 2) output[i / 2] = (nibbles[i]! << 4) | nibbles[i + 1]!;
  return output;
}

function commonPrefix(entries: TrieEntry[], depth: number): number {
  let length = 0;
  while (entries.every((entry) => entry.key[depth + length] !== undefined && entry.key[depth + length] === entries[0]!.key[depth + length])) {
    length++;
  }
  return length;
}

function childReference(child: TrieNode): RlpValue {
  return child.encoded.length < 32
    ? child.rlp
    : hexToBytes(keccak256(bytesToHex(child.encoded)));
}

function makeNode(value: RlpValue, kind: TrieNode["kind"], extra: object): TrieNode {
  const encoded = toRlp(value as never, "bytes") as Uint8Array;
  return { kind, ...extra, rlp: value, encoded } as TrieNode;
}

function buildNode(entries: TrieEntry[], depth: number): TrieNode {
  if (entries.length === 1) {
    const entry = entries[0]!;
    return makeNode([compactPath(entry.key.slice(depth), true), entry.value], "leaf", {
      path: entry.key.slice(depth), value: entry.value,
    });
  }

  const prefixLength = commonPrefix(entries, depth);
  if (prefixLength > 0) {
    const child = buildNode(entries, depth + prefixLength);
    return makeNode([compactPath(entries[0]!.key.slice(depth, depth + prefixLength), false), childReference(child)], "extension", {
      path: entries[0]!.key.slice(depth, depth + prefixLength), child,
    });
  }

  const children: (TrieNode | undefined)[] = Array.from({ length: 16 });
  let branchValue: Uint8Array | undefined;
  const groups: TrieEntry[][] = Array.from({ length: 16 }, () => []);
  for (const entry of entries) {
    if (depth === entry.key.length) {
      if (branchValue) fail("Two entries have the same trie key");
      branchValue = entry.value;
    } else {
      groups[entry.key[depth]!]!.push(entry);
    }
  }
  const rlpChildren: RlpValue[] = groups.map((group, nibble) => {
    if (group.length === 0) return new Uint8Array();
    const child = buildNode(group, depth + 1);
    children[nibble] = child;
    return childReference(child);
  });
  rlpChildren.push(branchValue ?? new Uint8Array());
  return makeNode(rlpChildren, "branch", {
    children,
    ...(branchValue === undefined ? {} : { value: branchValue }),
  });
}

function createProof(root: TrieNode, key: number[], value: Uint8Array, index: number): IndexedTrieProof {
  const proof: Uint8Array[] = [];
  let node: TrieNode | undefined = root;
  let offset = 0;
  let includeNode = true;
  while (node) {
    if (includeNode) proof.push(node.encoded);
    if (node.kind === "leaf") {
      if (offset + node.path.length !== key.length || node.path.some((nibble, i) => nibble !== key[offset + i]) || bytesToHex(node.value) !== bytesToHex(value)) {
        fail("Internal proof path did not reach the requested value");
      }
      break;
    }
    if (node.kind === "extension") {
      if (node.path.some((nibble, i) => nibble !== key[offset + i])) fail("Internal extension path mismatch");
      offset += node.path.length;
      node = node.child;
      includeNode = node.encoded.length >= 32;
      continue;
    }
    if (offset === key.length) {
      if (!node.value || bytesToHex(node.value) !== bytesToHex(value)) fail("Internal branch value mismatch");
      break;
    }
    const nibble = key[offset++]!;
    node = node.children[nibble];
    if (!node) fail("Internal proof branch is missing");
    includeNode = node.encoded.length >= 32;
  }
  if (!node || proof.length === 0 || proof.length > MAX_PROOF_NODES) fail("Generated proof is outside verifier bounds");
  return {
    root: keccak256(bytesToHex(root.encoded)),
    index,
    value: bytesToHex(value),
    proof: proof.map((encoded) => bytesToHex(encoded)),
  };
}

/**
 * Build canonical Ethereum-style transaction and receipt trie proofs locally.
 * Inputs must be the complete block's raw, ordered transaction/receipt values.
 * This function does not authenticate a block header or query an RPC endpoint.
 */
export function buildTransactionAndReceiptProofs(
  transactions: readonly Hex[],
  receipts: readonly Hex[],
  index: number,
): TransactionAndReceiptProofs {
  if (!Number.isSafeInteger(index) || index < 0 || index > 0xffff_ffff_ffff_ffff) fail("index must be a uint64 integer");
  if (transactions.length === 0 || transactions.length !== receipts.length || transactions.length > MAX_ENTRIES || index >= transactions.length) {
    fail("Transactions and receipts must be non-empty, equally sized, bounded, and contain index");
  }

  let totalBytes = 0;
  const parseValues = (values: readonly Hex[]): Uint8Array[] => values.map((value, entryIndex) => {
    if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) fail(`Entry ${entryIndex} must be non-empty even-length hex`);
    const bytes = hexToBytes(value);
    if (bytes.length > MAX_VALUE_BYTES) fail(`Entry ${entryIndex} exceeds ${MAX_VALUE_BYTES} bytes`);
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_VALUE_BYTES) fail("Combined transaction and receipt data exceeds 2 MB");
    return bytes;
  });
  const txValues = parseValues(transactions);
  const receiptValues = parseValues(receipts);
  const entriesFor = (values: Uint8Array[]): TrieEntry[] => values.map((value, entryIndex) => ({
    key: indexKey(entryIndex), value,
  }));

  const txRoot = buildNode(entriesFor(txValues), 0);
  const receiptRoot = buildNode(entriesFor(receiptValues), 0);
  const targetKey = indexKey(index);
  return {
    transactionRoot: keccak256(bytesToHex(txRoot.encoded)),
    receiptRoot: keccak256(bytesToHex(receiptRoot.encoded)),
    transaction: createProof(txRoot, targetKey, txValues[index]!, index),
    receipt: createProof(receiptRoot, targetKey, receiptValues[index]!, index),
  };
}

function asList(value: DecodedRlp | undefined, label: string): readonly DecodedRlp[] {
  if (!Array.isArray(value)) fail(`${label} must be an RLP list`);
  return value as readonly DecodedRlp[];
}

function asBytes(value: DecodedRlp | undefined, label: string): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})*$/.test(value)) fail(`${label} must be an RLP byte string`);
  return value;
}

function decodeHeaderNumber(value: DecodedRlp | undefined): bigint {
  const bytes = asBytes(value, "Header block number");
  if (bytes.length > 18 || (bytes.length > 2 && bytes.slice(2, 4) === "00")) fail("Header block number is not a canonical uint64");
  const number = bytes === "0x" ? 0n : BigInt(bytes);
  if (number > 0xffff_ffff_ffff_ffffn) fail("Header block number exceeds uint64");
  return number;
}

/**
 * Decode a bounded raw RLP block and raw receipts, locate the requested
 * transaction by hash, and build proofs. The raw RPC payloads remain
 * untrusted; this checks local structure/root consistency, not consensus.
 */
export function buildInclusionProofFromRawBlock(
  rawBlock: Hex,
  rawReceipts: readonly Hex[],
  expectedTransactionHash: Hex,
): RawBlockInclusionProof {
  if (typeof rawBlock !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(rawBlock)) fail("Raw block must be non-empty even-length hex");
  if ((rawBlock.length - 2) / 2 > MAX_RAW_BLOCK_BYTES) fail("Raw block exceeds 2 MB");
  if (!/^0x[0-9a-fA-F]{64}$/.test(expectedTransactionHash)) fail("Expected transaction hash must be bytes32");

  let decoded: DecodedRlp;
  try {
    decoded = fromRlp(rawBlock) as DecodedRlp;
  } catch {
    fail("Raw block is not valid RLP");
  }
  const block = asList(decoded, "Raw block");
  if (block.length !== 3) fail("Raw block must contain header, transactions, and ommers");
  if (toRlp(block as never, "hex").toLowerCase() !== rawBlock.toLowerCase()) fail("Raw block RLP is not canonical");

  const header = asList(block[0], "Block header");
  if (header.length < 15 || header.length > 32) fail("Block header has an unsupported field count");
  const rawHeader = toRlp(header as never, "hex");
  if ((rawHeader.length - 2) / 2 > MAX_HEADER_BYTES) fail("Block header exceeds 4 KiB");
  const blockNumber = decodeHeaderNumber(header[8]);
  const transactionRoot = asBytes(header[4], "Header transactionsRoot");
  const receiptRoot = asBytes(header[5], "Header receiptsRoot");
  if (!/^0x[0-9a-fA-F]{64}$/.test(transactionRoot) || !/^0x[0-9a-fA-F]{64}$/.test(receiptRoot)) {
    fail("Header transaction and receipt roots must be bytes32");
  }

  const transactionItems = asList(block[1], "Block transactions");
  if (transactionItems.length === 0 || transactionItems.length > MAX_ENTRIES || rawReceipts.length !== transactionItems.length) {
    fail("Transaction and receipt counts must be equal, non-empty, and bounded");
  }
  const transactions = transactionItems.map((item, index) => {
    const transaction = Array.isArray(item) ? toRlp(item as never, "hex") : asBytes(item, `Transaction ${index}`);
    if (transaction === "0x") fail(`Transaction ${index} is empty`);
    return transaction;
  });
  const matches: number[] = [];
  transactions.forEach((transaction, index) => {
    if (keccak256(transaction).toLowerCase() === expectedTransactionHash.toLowerCase()) matches.push(index);
  });
  if (matches.length !== 1) fail("Expected transaction hash must occur exactly once in the raw block");

  const proofs = buildTransactionAndReceiptProofs(transactions, rawReceipts, matches[0]!);
  if (proofs.transactionRoot.toLowerCase() !== transactionRoot.toLowerCase()) fail("Locally built transaction root differs from raw block header");
  if (proofs.receiptRoot.toLowerCase() !== receiptRoot.toLowerCase()) fail("Locally built receipt root differs from raw block header");

  return {
    blockNumber,
    rawHeader,
    transactionIndex: matches[0]!,
    transactionHash: expectedTransactionHash,
    proofs,
  };
}
