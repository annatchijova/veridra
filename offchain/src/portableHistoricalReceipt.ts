import { getAddress, keccak256, type Address, type Hex, type PublicClient } from "viem";
import { parsePaymentClaim } from "./claim.js";
import type { PaymentClaim } from "./rpcEvidence.js";
import type { AcquiredHistoricalInclusionProof } from "./verifyHistoricalInclusion.js";
import type { NamedCheck } from "./verifyReceipt.js";
import {
  readPinnedCheckpointAddress,
  snapshotHistoricalInclusionProof,
  verifyHistoricalInclusionOnchain,
} from "./verifyHistoricalInclusion.js";
import type { RawPaymentFact } from "./paymentFacts.js";
import type { VerifierDeploymentPin } from "./portableReceipt.js";

/**
 * Structurally identical to portableReceipt.ts's recent-inclusion format,
 * with one addition: `checkpointAddress`. This does not add a second
 * independent trust pin -- Solidity embeds an `immutable address` directly
 * into runtime bytecode, so the verifier's own runtimeCodeHash pin already
 * authenticates which checkpoint it trusts. It is recorded and re-checked
 * here purely so a reader does not have to reverse-engineer that fact from
 * bytecode to see which checkpoint a given historical receipt depends on.
 */
const FORMAT = "veridra.portable-historical-inclusion-receipt";
const SCHEMA_VERSION = 1;
const MAX_SERIALIZED_BYTES = 262_144;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_UINT256 = (1n << 256n) - 1n;
const VERDICTS = ["VERIFIED", "NOT_VERIFIED"] as const;
const CHECK_NAMES = ["transactionHash", "chainId", "execution", "sender", "recipient", "asset", "amount"] as const;
const CHECK_STATUSES = ["ABSTAIN", "PASS", "FAIL"] as const;
const TRANSACTION_TYPES = ["legacy", "eip2930", "eip1559", "eip7702"] as const;

export type PortableHistoricalReceiptVerification = {
  schemaVersion: 1;
  verification: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED";
  chainId: bigint;
  transactionHash: Hex;
  verdict: (typeof VERDICTS)[number];
  checks: NamedCheck[];
  paymentFact: RawPaymentFact;
  checkpointAddress: Address;
  provenance: {
    proofSourceId: Hex;
    producerVerifierRpcSourceId: Hex;
    verificationRpcSourceId: Hex;
  };
};

type ParsedHistoricalReceipt = {
  schemaVersion: 1;
  claim: PaymentClaim;
  paymentFact: RawPaymentFact;
  verdict: (typeof VERDICTS)[number];
  checks: NamedCheck[];
  supportedTokenAddresses: Address[];
  deploymentPin: VerifierDeploymentPin;
  checkpointAddress: Address;
  proofSourceId: Hex;
  producerVerifierRpcSourceId: Hex;
  proof: AcquiredHistoricalInclusionProof;
};

export class PortableHistoricalReceiptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PortableHistoricalReceiptError";
  }
}

export type CreatePortableHistoricalInclusionReceiptInput = {
  publicClient: PublicClient;
  verifierDeployment: VerifierDeploymentPin;
  expectedChainId: bigint;
  proof: AcquiredHistoricalInclusionProof;
  claim: unknown;
  supportedTokenAddresses: readonly Address[];
  /** Safe bytes32 identifier for the RPC/provider that supplied raw proof data. */
  proofSourceId: Hex;
  /** Safe bytes32 identifier for the RPC/provider used for the producer's eth_call. */
  producerVerifierRpcSourceId: Hex;
};

export type VerifyPortableHistoricalInclusionReceiptInput = {
  publicClient: PublicClient;
  verifierDeployment: VerifierDeploymentPin;
  expectedChainId: bigint;
  serializedReceipt: string;
  /** Safe bytes32 identifier for this consumer's eth_call RPC/provider. */
  verificationRpcSourceId: Hex;
};

function fail(message: string): never {
  throw new PortableHistoricalReceiptError(message);
}

function objectWithKeys(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${label} must be an object`);
  const record = value as Record<string, unknown>;
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has missing or unsupported fields`);
  }
  return record;
}

function hex(value: unknown, label: string, maximumBytes: number, exactBytes?: number): Hex {
  if (typeof value !== "string" || !/^0x(?:[0-9a-fA-F]{2})+$/.test(value)) {
    fail(`${label} must be non-empty even-length hex`);
  }
  const byteLength = (value.length - 2) / 2;
  if (byteLength > maximumBytes) fail(`${label} exceeds its configured byte bound`);
  if (exactBytes !== undefined && byteLength !== exactBytes) fail(`${label} has the wrong byte length`);
  return value as Hex;
}

function decimal(value: unknown, label: string, maximum: bigint): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    fail(`${label} must be a canonical unsigned decimal string`);
  }
  if (value.length > maximum.toString(10).length) fail(`${label} exceeds its bound`);
  const parsed = BigInt(value);
  if (parsed > maximum) fail(`${label} exceeds its bound`);
  return parsed;
}

function address(value: unknown, label: string): Address {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) fail(`${label} must be a 20-byte address`);
  try {
    return getAddress(value);
  } catch {
    fail(`${label} is not a valid address`);
  }
}

function bytes32(value: unknown, label: string): Hex {
  const parsed = hex(value, label, 32, 32);
  if (/^0x0{64}$/i.test(parsed)) fail(`${label} must not be zero`);
  return parsed;
}

function canonicalClaim(claim: PaymentClaim): Record<string, string> {
  const result: Record<string, string> = {
    transactionHash: claim.transactionHash.toLowerCase(),
    chainId: claim.chainId.toString(10),
  };
  if (claim.assertsSender) result.sender = claim.sender;
  if (claim.assertsRecipient) result.recipient = claim.recipient;
  if (claim.assertsAsset) result.asset = claim.asset;
  if (claim.assertsAmount) result.amountBaseUnits = claim.amount.toString(10);
  return result;
}

function canonicalFact(fact: RawPaymentFact): Record<string, string | boolean> {
  return {
    chainId: fact.chainId.toString(10),
    transactionHash: fact.transactionHash.toLowerCase(),
    transactionType: fact.transactionType,
    successful: fact.successful,
    sender: fact.sender,
    recipient: fact.recipient,
    asset: fact.asset,
    amountBaseUnits: fact.amount.toString(10),
  };
}

function deriveAdjudication(claim: PaymentClaim, fact: RawPaymentFact): {
  verdict: (typeof VERDICTS)[number];
  checks: NamedCheck[];
} {
  const pass = (matches: boolean): "PASS" | "FAIL" => matches ? "PASS" : "FAIL";
  const checks: NamedCheck[] = [
    { name: "transactionHash", status: pass(claim.transactionHash.toLowerCase() === fact.transactionHash.toLowerCase()) },
    { name: "chainId", status: pass(claim.chainId === fact.chainId) },
    { name: "execution", status: pass(fact.successful) },
    { name: "sender", status: claim.assertsSender ? pass(claim.sender.toLowerCase() === fact.sender.toLowerCase()) : "ABSTAIN" },
    { name: "recipient", status: claim.assertsRecipient ? pass(claim.recipient.toLowerCase() === fact.recipient.toLowerCase()) : "ABSTAIN" },
    { name: "asset", status: claim.assertsAsset ? pass(claim.asset.toLowerCase() === fact.asset.toLowerCase()) : "ABSTAIN" },
    { name: "amount", status: claim.assertsAmount ? pass(claim.amount === fact.amount) : "ABSTAIN" },
  ];
  return {
    verdict: checks.some((check) => check.status === "FAIL") ? "NOT_VERIFIED" : "VERIFIED",
    checks,
  };
}

function serializeReceipt(input: {
  claim: PaymentClaim;
  paymentFact: RawPaymentFact;
  verdict: (typeof VERDICTS)[number];
  checks: NamedCheck[];
  supportedTokenAddresses: readonly Address[];
  proofSourceId: Hex;
  producerVerifierRpcSourceId: Hex;
  deploymentPin: VerifierDeploymentPin;
  checkpointAddress: Address;
  proof: AcquiredHistoricalInclusionProof;
}): string {
  const proof = input.proof;
  const serialized = JSON.stringify({
    format: FORMAT,
    schemaVersion: SCHEMA_VERSION,
    claim: canonicalClaim(input.claim),
    paymentFact: canonicalFact(input.paymentFact),
    adjudication: { verdict: input.verdict, checks: input.checks },
    tokenPolicy: { supportedTokenAddresses: input.supportedTokenAddresses },
    provenance: {
      proofSourceId: input.proofSourceId.toLowerCase(),
      producerVerifierRpcSourceId: input.producerVerifierRpcSourceId.toLowerCase(),
    },
    deploymentPin: {
      chainId: input.deploymentPin.chainId.toString(10),
      address: getAddress(input.deploymentPin.address),
      runtimeCodeHash: input.deploymentPin.runtimeCodeHash.toLowerCase(),
    },
    checkpointAddress: getAddress(input.checkpointAddress),
    proof: {
      chainId: proof.chainId.toString(10),
      blockNumber: proof.blockNumber.toString(10),
      blockHash: proof.blockHash.toLowerCase(),
      transactionIndex: proof.transactionIndex.toString(10),
      transactionHash: proof.transactionHash.toLowerCase(),
      rawHeader: proof.rawHeader.toLowerCase(),
      transaction: {
        root: proof.proofs.transaction.root.toLowerCase(),
        index: proof.proofs.transaction.index.toString(10),
        value: proof.proofs.transaction.value.toLowerCase(),
        proof: proof.proofs.transaction.proof.map((node) => node.toLowerCase()),
      },
      receipt: {
        root: proof.proofs.receipt.root.toLowerCase(),
        index: proof.proofs.receipt.index.toString(10),
        value: proof.proofs.receipt.value.toLowerCase(),
        proof: proof.proofs.receipt.proof.map((node) => node.toLowerCase()),
      },
    },
  });
  if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) {
    fail("Serialized portable receipt exceeds its configured byte bound");
  }
  return serialized;
}

function parseFact(value: unknown): RawPaymentFact {
  const source = objectWithKeys(value, [
    "chainId", "transactionHash", "transactionType", "successful", "sender", "recipient", "asset", "amountBaseUnits",
  ], "Payment fact");
  if (typeof source.transactionType !== "string" || !TRANSACTION_TYPES.includes(source.transactionType as typeof TRANSACTION_TYPES[number])) {
    fail("Payment fact has an unsupported transaction type");
  }
  if (typeof source.successful !== "boolean") fail("Payment fact successful must be boolean");
  return {
    chainId: decimal(source.chainId, "Payment fact chainId", MAX_UINT256),
    transactionHash: bytes32(source.transactionHash, "Payment fact transactionHash"),
    transactionType: source.transactionType as RawPaymentFact["transactionType"],
    successful: source.successful,
    sender: address(source.sender, "Payment fact sender"),
    recipient: address(source.recipient, "Payment fact recipient"),
    asset: address(source.asset, "Payment fact asset"),
    amount: decimal(source.amountBaseUnits, "Payment fact amount", MAX_UINT256),
  };
}

function parseChecks(value: unknown): NamedCheck[] {
  if (!Array.isArray(value) || value.length !== CHECK_NAMES.length) fail("Adjudication checks have an invalid shape");
  return value.map((entry, index) => {
    const source = objectWithKeys(entry, ["name", "status"], `Adjudication check ${index}`);
    if (source.name !== CHECK_NAMES[index]) fail("Adjudication check names or order are unsupported");
    if (typeof source.status !== "string" || !CHECK_STATUSES.includes(source.status as typeof CHECK_STATUSES[number])) {
      fail(`Adjudication check ${index} has an unsupported status`);
    }
    return { name: source.name as NamedCheck["name"], status: source.status as NamedCheck["status"] };
  });
}

function parseProof(value: unknown, chainId: bigint): AcquiredHistoricalInclusionProof {
  const source = objectWithKeys(value, [
    "chainId", "blockNumber", "blockHash", "transactionIndex", "transactionHash", "rawHeader", "transaction", "receipt",
  ], "Proof bundle");
  const proofChainId = decimal(source.chainId, "Proof chainId", BigInt(Number.MAX_SAFE_INTEGER));
  if (proofChainId !== chainId) fail("Proof bundle chain differs from the receipt chain");
  const blockNumber = decimal(source.blockNumber, "Proof blockNumber", MAX_UINT64);
  const blockHash = bytes32(source.blockHash, "Proof blockHash");
  const transactionHash = bytes32(source.transactionHash, "Proof transactionHash");
  const transactionIndexBigint = decimal(source.transactionIndex, "Proof transactionIndex", MAX_UINT64);
  if (transactionIndexBigint > BigInt(Number.MAX_SAFE_INTEGER)) fail("Proof transactionIndex is not safely representable");
  const transactionIndex = Number(transactionIndexBigint);
  const rawHeader = hex(source.rawHeader, "Raw header", 4_096);

  const parsePath = (value: unknown, label: string) => {
    const path = objectWithKeys(value, ["root", "index", "value", "proof"], `${label} path`);
    const root = bytes32(path.root, `${label} root`);
    const indexValue = decimal(path.index, `${label} index`, MAX_UINT64);
    if (indexValue !== transactionIndexBigint) fail(`${label} proof uses a different transaction index`);
    const rawValue = hex(path.value, `${label} value`, 8_192);
    if (!Array.isArray(path.proof) || path.proof.length === 0 || path.proof.length > 20) {
      fail(`${label} proof node count is outside bounds`);
    }
    const nodes = path.proof.map((node, index) => hex(node, `${label} proof node ${index}`, 8_256));
    const proofBytes = nodes.reduce((total, node) => total + (node.length - 2) / 2, 0);
    if (proofBytes > 40_000) fail(`${label} proof exceeds its configured total byte bound`);
    if (keccak256(nodes[0]!).toLowerCase() !== root.toLowerCase()) fail(`${label} root does not match its first proof node`);
    return { root, index: transactionIndex, value: rawValue, proof: nodes };
  };

  const transaction = parsePath(source.transaction, "Transaction");
  const receipt = parsePath(source.receipt, "Receipt");
  return {
    chainId: proofChainId,
    blockNumber,
    blockHash,
    rawHeader,
    transactionIndex,
    transactionHash,
    paymentFact: {
      chainId,
      transactionHash,
      transactionType: "legacy",
      successful: false,
      sender: "0x0000000000000000000000000000000000000000",
      recipient: "0x0000000000000000000000000000000000000000",
      asset: "0x0000000000000000000000000000000000000000",
      amount: 0n,
    },
    proofs: {
      transactionRoot: transaction.root,
      receiptRoot: receipt.root,
      transaction,
      receipt,
    },
  };
}

/** Parse and bound a portable historical receipt; unknown versions and fields fail closed. */
export function parsePortableHistoricalInclusionReceipt(serialized: string): ParsedHistoricalReceipt {
  if (typeof serialized !== "string" || serialized.length > MAX_SERIALIZED_BYTES) {
    fail("Serialized portable receipt exceeds its configured size bound");
  }
  let decoded: unknown;
  try {
    if (new TextEncoder().encode(serialized).byteLength > MAX_SERIALIZED_BYTES) fail("Serialized portable receipt exceeds its configured size bound");
    decoded = JSON.parse(serialized) as unknown;
  } catch (error) {
    if (error instanceof PortableHistoricalReceiptError) throw error;
    fail("Serialized portable receipt is not valid JSON");
  }
  if (JSON.stringify(decoded) !== serialized) fail("Serialized portable receipt is not in canonical JSON form");
  const source = objectWithKeys(decoded, [
    "format", "schemaVersion", "claim", "paymentFact", "adjudication", "tokenPolicy", "provenance",
    "deploymentPin", "checkpointAddress", "proof",
  ], "Portable receipt");
  if (source.format !== FORMAT) fail("Portable receipt format is unsupported");
  if (source.schemaVersion !== SCHEMA_VERSION) fail(`Portable receipt schema version ${String(source.schemaVersion)} is unsupported`);

  let claim: PaymentClaim;
  try {
    claim = parsePaymentClaim(source.claim);
  } catch (error) {
    fail(`Portable receipt claim is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  const paymentFact = parseFact(source.paymentFact);
  const adjudicationSource = objectWithKeys(source.adjudication, ["verdict", "checks"], "Adjudication");
  if (typeof adjudicationSource.verdict !== "string" || !VERDICTS.includes(adjudicationSource.verdict as typeof VERDICTS[number])) {
    fail("Adjudication verdict is unsupported");
  }
  const checks = parseChecks(adjudicationSource.checks);

  const tokenPolicy = objectWithKeys(source.tokenPolicy, ["supportedTokenAddresses"], "Token policy");
  if (!Array.isArray(tokenPolicy.supportedTokenAddresses) || tokenPolicy.supportedTokenAddresses.length > 64) {
    fail("Token policy must contain at most 64 addresses");
  }
  const supportedTokenAddresses = tokenPolicy.supportedTokenAddresses.map((entry, index) => address(entry, `Token policy address ${index}`));

  const provenanceSource = objectWithKeys(source.provenance, ["proofSourceId", "producerVerifierRpcSourceId"], "Provenance");
  const proofSourceId = bytes32(provenanceSource.proofSourceId, "Proof source ID");
  const producerVerifierRpcSourceId = bytes32(provenanceSource.producerVerifierRpcSourceId, "Producer verifier RPC source ID");

  const deploymentSource = objectWithKeys(source.deploymentPin, ["chainId", "address", "runtimeCodeHash"], "Deployment pin");
  const deploymentPin: VerifierDeploymentPin = {
    chainId: decimal(deploymentSource.chainId, "Pinned deployment chainId", BigInt(Number.MAX_SAFE_INTEGER)),
    address: address(deploymentSource.address, "Pinned verifier address"),
    runtimeCodeHash: bytes32(deploymentSource.runtimeCodeHash, "Pinned verifier runtimeCodeHash"),
  };
  const checkpointAddress = address(source.checkpointAddress, "Checkpoint address");
  const proofChainId = decimal((source.proof as Record<string, unknown> | null)?.chainId, "Proof chainId", BigInt(Number.MAX_SAFE_INTEGER));
  const proof = parseProof(source.proof, proofChainId);
  if (claim.chainId !== proof.chainId || claim.transactionHash.toLowerCase() !== proof.transactionHash.toLowerCase()) {
    fail("Claim does not match the proof transaction hash and chain");
  }
  if (paymentFact.chainId !== proof.chainId || paymentFact.transactionHash.toLowerCase() !== proof.transactionHash.toLowerCase()) {
    fail("Payment fact does not match the proof transaction hash and chain");
  }
  if (deploymentPin.chainId !== proof.chainId) fail("Pinned verifier deployment chain differs from proof chain");

  return {
    schemaVersion: 1,
    claim,
    paymentFact,
    verdict: adjudicationSource.verdict as ParsedHistoricalReceipt["verdict"],
    checks,
    supportedTokenAddresses,
    deploymentPin,
    checkpointAddress,
    proofSourceId,
    producerVerifierRpcSourceId,
    proof: { ...proof, paymentFact },
  };
}

/**
 * Produce a bounded, versioned JSON package only after the configured RPC
 * reports that the pinned historical verifier accepted the inclusion proof.
 * Stored facts and verdict remain assertions and must be recomputed by
 * every consumer.
 */
export async function createPortableHistoricalInclusionReceipt(
  input: CreatePortableHistoricalInclusionReceiptInput,
): Promise<string> {
  const proof = snapshotHistoricalInclusionProof(input.proof);
  let claim: PaymentClaim;
  try {
    claim = parsePaymentClaim(input.claim);
  } catch (error) {
    fail(`Payment claim is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  if (claim.chainId !== proof.chainId || claim.transactionHash.toLowerCase() !== proof.transactionHash.toLowerCase()) {
    fail("Payment claim transaction hash and chain must match the inclusion proof");
  }
  if (!Array.isArray(input.supportedTokenAddresses) || input.supportedTokenAddresses.length > 64) {
    fail("Token policy must contain at most 64 addresses");
  }
  const supportedTokenAddresses = input.supportedTokenAddresses.map((entry) => getAddress(entry));
  const proofSourceId = bytes32(input.proofSourceId, "Proof source ID");
  const producerVerifierRpcSourceId = bytes32(input.producerVerifierRpcSourceId, "Producer verifier RPC source ID");
  const deploymentPin = {
    chainId: input.verifierDeployment.chainId,
    address: getAddress(input.verifierDeployment.address),
    runtimeCodeHash: input.verifierDeployment.runtimeCodeHash,
  };
  const verified = await verifyHistoricalInclusionOnchain({
    publicClient: input.publicClient,
    verifierDeployment: deploymentPin,
    expectedChainId: input.expectedChainId,
    proof,
    supportedTokenAddresses,
  });
  const checkpointAddress = await readPinnedCheckpointAddress(input.publicClient, deploymentPin.address);
  const adjudication = deriveAdjudication(claim, verified.paymentFact);
  return serializeReceipt({
    claim,
    paymentFact: verified.paymentFact,
    verdict: adjudication.verdict,
    checks: adjudication.checks,
    supportedTokenAddresses,
    proofSourceId,
    producerVerifierRpcSourceId,
    deploymentPin,
    checkpointAddress,
    proof: { ...proof, paymentFact: verified.paymentFact },
  });
}

/** Re-run the raw-proof, deployment-pin, checkpoint-pin, fact, claim, and verdict checks. */
export async function verifyPortableHistoricalInclusionReceipt(
  input: VerifyPortableHistoricalInclusionReceiptInput,
): Promise<PortableHistoricalReceiptVerification> {
  const receipt = parsePortableHistoricalInclusionReceipt(input.serializedReceipt);
  const localPin = input.verifierDeployment;
  if (
    localPin.chainId !== receipt.deploymentPin.chainId
    || getAddress(localPin.address) !== receipt.deploymentPin.address
    || localPin.runtimeCodeHash.toLowerCase() !== receipt.deploymentPin.runtimeCodeHash.toLowerCase()
  ) {
    fail("Portable receipt deployment pin differs from the consumer's configured verifier");
  }
  if (input.expectedChainId !== receipt.proof.chainId) fail("Portable receipt chain differs from the consumer's expected chain");
  const verificationRpcSourceId = bytes32(input.verificationRpcSourceId, "Verification RPC source ID");

  const verified = await verifyHistoricalInclusionOnchain({
    publicClient: input.publicClient,
    verifierDeployment: { ...localPin },
    expectedChainId: input.expectedChainId,
    proof: receipt.proof,
    supportedTokenAddresses: receipt.supportedTokenAddresses,
  });
  const actualCheckpointAddress = await readPinnedCheckpointAddress(input.publicClient, getAddress(localPin.address));
  if (actualCheckpointAddress !== receipt.checkpointAddress) {
    fail("Stored checkpoint address differs from the pinned verifier's actual checkpoint");
  }
  const recomputed = deriveAdjudication(receipt.claim, verified.paymentFact);
  if (!sameFact(receipt.paymentFact, verified.paymentFact)) fail("Stored payment fact differs from raw proof values");
  if (receipt.verdict !== recomputed.verdict) fail("Stored adjudication verdict differs from recomputation");
  for (let index = 0; index < CHECK_NAMES.length; index++) {
    const stored = receipt.checks[index]!;
    const actual = recomputed.checks[index]!;
    if (stored.name !== actual.name || stored.status !== actual.status) {
      fail(`Stored adjudication check '${actual.name}' differs from recomputation`);
    }
  }
  return {
    schemaVersion: 1,
    verification: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED",
    chainId: verified.chainId,
    transactionHash: verified.transactionHash,
    verdict: recomputed.verdict,
    checks: recomputed.checks,
    paymentFact: verified.paymentFact,
    checkpointAddress: actualCheckpointAddress,
    provenance: {
      proofSourceId: receipt.proofSourceId,
      producerVerifierRpcSourceId: receipt.producerVerifierRpcSourceId,
      verificationRpcSourceId,
    },
  };
}

function sameFact(left: RawPaymentFact, right: RawPaymentFact): boolean {
  return left.chainId === right.chainId
    && left.transactionHash.toLowerCase() === right.transactionHash.toLowerCase()
    && left.transactionType === right.transactionType
    && left.successful === right.successful
    && left.sender.toLowerCase() === right.sender.toLowerCase()
    && left.recipient.toLowerCase() === right.recipient.toLowerCase()
    && left.asset.toLowerCase() === right.asset.toLowerCase()
    && left.amount === right.amount;
}
