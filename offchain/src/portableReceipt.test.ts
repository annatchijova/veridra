import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toRlp, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AcquiredRecentInclusionProof } from "./proofRpc.js";
import {
  createPortableInclusionReceipt,
  PortableReceiptError,
  verifyPortableInclusionReceipt,
} from "./portableReceipt.js";

const CHAIN_ID = 10143n;
const VERIFIER = `0x${"11".repeat(20)}` as Address;
const VERIFIER_CODE = "0x60006000" as Hex;
const PROOF_SOURCE_ID = `0x${"aa".repeat(32)}` as Hex;
const PRODUCER_RPC_SOURCE_ID = `0x${"bb".repeat(32)}` as Hex;
const CONSUMER_RPC_SOURCE_ID = `0x${"cc".repeat(32)}` as Hex;
const DEPLOYMENT = {
  chainId: CHAIN_ID,
  address: VERIFIER,
  runtimeCodeHash: keccak256(VERIFIER_CODE),
};
const ACCOUNT = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const RECIPIENT = "0x6666666666666666666666666666666666666666" as Address;
const OTHER_RECIPIENT = "0x7777777777777777777777777777777777777777" as Address;

async function proof(): Promise<AcquiredRecentInclusionProof> {
  const rawTransaction = await ACCOUNT.signTransaction({
    type: "legacy",
    chainId: Number(CHAIN_ID),
    nonce: 0,
    gasPrice: 1n,
    gas: 21_000n,
    to: RECIPIENT,
    value: 123n,
    data: "0x",
  });
  const rawReceipt = toRlp(["0x01", "0x5208", `0x${"00".repeat(256)}`, []] as never, "hex");
  const transactionHash = keccak256(rawTransaction);
  const node: Hex = "0xc0";
  const root = keccak256(node);
  return {
    chainId: CHAIN_ID,
    blockNumber: 12n,
    blockHash: `0x${"33".repeat(32)}` as Hex,
    rawHeader: "0x01",
    transactionIndex: 1,
    transactionHash,
    paymentFact: {
      chainId: CHAIN_ID,
      transactionHash,
      transactionType: "legacy",
      successful: true,
      sender: ACCOUNT.address,
      recipient: RECIPIENT,
      asset: "0x0000000000000000000000000000000000000000",
      amount: 123n,
    },
    proofs: {
      transactionRoot: root,
      receiptRoot: root,
      transaction: { root, index: 1, value: rawTransaction, proof: [node] },
      receipt: { root, index: 1, value: rawReceipt, proof: [node] },
    },
  };
}

function client(options: { verifierResult?: boolean; bytecode?: Hex } = {}) {
  let chainReads = 0;
  let codeReads = 0;
  let proofCalls = 0;
  const publicClient = {
    getChainId: async () => { chainReads++; return Number(CHAIN_ID); },
    getBytecode: async () => { codeReads++; return options.bytecode ?? VERIFIER_CODE; },
    readContract: async () => { proofCalls++; return options.verifierResult ?? true; },
  } as unknown as PublicClient;
  return {
    publicClient,
    counts: () => ({ chainReads, codeReads, proofCalls }),
  };
}

const claimFor = (transactionHash: Hex, recipient = RECIPIENT) => ({
  transactionHash,
  chainId: CHAIN_ID.toString(),
  sender: ACCOUNT.address,
  recipient,
  asset: "0x0000000000000000000000000000000000000000",
  amountBaseUnits: "123",
});

test("creates and independently rechecks a portable versioned receipt", async () => {
  const acquired = await proof();
  const producerClient = client();
  const serialized = await createPortableInclusionReceipt({
    publicClient: producerClient.publicClient,
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof: acquired,
    claim: claimFor(acquired.transactionHash),
    supportedTokenAddresses: [],
    proofSourceId: PROOF_SOURCE_ID,
    producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
  });

  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  assert.equal(parsed.format, "veridra.portable-inclusion-receipt");
  assert.equal(parsed.schemaVersion, 1);
  assert.equal((parsed.adjudication as { verdict: string }).verdict, "VERIFIED");

  const consumerClient = client();
  const result = await verifyPortableInclusionReceipt({
    publicClient: consumerClient.publicClient,
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    serializedReceipt: serialized,
    verificationRpcSourceId: CONSUMER_RPC_SOURCE_ID,
  });
  assert.equal(result.verification, "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED");
  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.paymentFact.amount, 123n);
  assert.deepEqual(result.provenance, {
    proofSourceId: PROOF_SOURCE_ID,
    producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
    verificationRpcSourceId: CONSUMER_RPC_SOURCE_ID,
  });
  assert.deepEqual(consumerClient.counts(), { chainReads: 1, codeReads: 1, proofCalls: 1 });
});

test("recomputes a contradicted claim as NOT_VERIFIED instead of trusting producer output", async () => {
  const acquired = await proof();
  const serialized = await createPortableInclusionReceipt({
    ...client(),
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof: acquired,
    claim: claimFor(acquired.transactionHash, OTHER_RECIPIENT),
    supportedTokenAddresses: [],
    proofSourceId: PROOF_SOURCE_ID,
    producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
  });
  const result = await verifyPortableInclusionReceipt({
    ...client(),
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    serializedReceipt: serialized,
    verificationRpcSourceId: CONSUMER_RPC_SOURCE_ID,
  });

  assert.equal(result.verdict, "NOT_VERIFIED");
  assert.deepEqual(result.checks.map(({ name, status }) => [name, status]).filter(([, status]) => status === "FAIL"), [
    ["recipient", "FAIL"],
  ]);
});

test("rejects an altered stored verdict even when its proof still verifies", async () => {
  const acquired = await proof();
  const serialized = await createPortableInclusionReceipt({
    ...client(),
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof: acquired,
    claim: claimFor(acquired.transactionHash),
    supportedTokenAddresses: [],
    proofSourceId: PROOF_SOURCE_ID,
    producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
  });
  const altered = JSON.parse(serialized) as Record<string, unknown>;
  (altered.adjudication as { verdict: string }).verdict = "NOT_VERIFIED";
  const verifierClient = client();

  await assert.rejects(
    verifyPortableInclusionReceipt({
      ...verifierClient,
      verifierDeployment: DEPLOYMENT,
      expectedChainId: CHAIN_ID,
      serializedReceipt: JSON.stringify(altered),
      verificationRpcSourceId: CONSUMER_RPC_SOURCE_ID,
    }),
    (error: unknown) => error instanceof PortableReceiptError && /verdict/.test(error.message),
  );
  assert.equal(verifierClient.counts().proofCalls, 1);
});

test("rejects unknown schemas, unknown fields, and oversized JSON before RPC access", async () => {
  const acquired = await proof();
  const serialized = await createPortableInclusionReceipt({
    ...client(),
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof: acquired,
    claim: claimFor(acquired.transactionHash),
    supportedTokenAddresses: [],
    proofSourceId: PROOF_SOURCE_ID,
    producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
  });
  const original = JSON.parse(serialized) as Record<string, unknown>;
  const unknownVersion = { ...original, schemaVersion: 2 };
  const unknownField = { ...original, trusted: true };
  const duplicateKey = serialized.replace(
    '"format":"veridra.portable-inclusion-receipt"',
    '"format":"attacker-format","format":"veridra.portable-inclusion-receipt"',
  );
  const verifierClient = client();

  for (const invalid of [JSON.stringify(unknownVersion), JSON.stringify(unknownField), duplicateKey, " ".repeat(262_145)]) {
    await assert.rejects(
      verifyPortableInclusionReceipt({
        ...verifierClient,
        verifierDeployment: DEPLOYMENT,
        expectedChainId: CHAIN_ID,
        serializedReceipt: invalid,
        verificationRpcSourceId: CONSUMER_RPC_SOURCE_ID,
      }),
      PortableReceiptError,
    );
  }
  assert.deepEqual(verifierClient.counts(), { chainReads: 0, codeReads: 0, proofCalls: 0 });
});

test("rejects a claim/proof mismatch before asking the RPC verifier", async () => {
  const acquired = await proof();
  const verifierClient = client();

  await assert.rejects(
    createPortableInclusionReceipt({
      ...verifierClient,
      verifierDeployment: DEPLOYMENT,
      expectedChainId: CHAIN_ID,
      proof: acquired,
      claim: claimFor(`0x${"99".repeat(32)}` as Hex),
      supportedTokenAddresses: [],
      proofSourceId: PROOF_SOURCE_ID,
      producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
    }),
    (error: unknown) => error instanceof PortableReceiptError && /claim transaction hash/.test(error.message),
  );
  assert.deepEqual(verifierClient.counts(), { chainReads: 0, codeReads: 0, proofCalls: 0 });
});

test("rejects an all-zero provenance identifier before asking the RPC verifier", async () => {
  const acquired = await proof();
  const verifierClient = client();

  await assert.rejects(
    createPortableInclusionReceipt({
      ...verifierClient,
      verifierDeployment: DEPLOYMENT,
      expectedChainId: CHAIN_ID,
      proof: acquired,
      claim: claimFor(acquired.transactionHash),
      supportedTokenAddresses: [],
      proofSourceId: `0x${"00".repeat(32)}` as Hex,
      producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
    }),
    (error: unknown) => error instanceof PortableReceiptError && /zero/.test(error.message),
  );
  assert.deepEqual(verifierClient.counts(), { chainReads: 0, codeReads: 0, proofCalls: 0 });
});

test("serializes the same bounded proof snapshot that passed the asynchronous verifier call", async () => {
  const acquired = await proof();
  const originalHash = acquired.transactionHash;
  const originalTransaction = acquired.proofs.transaction.value;
  const originalNode = acquired.proofs.transaction.proof[0];
  const publicClient = {
    getChainId: async () => {
      acquired.transactionHash = `0x${"99".repeat(32)}` as Hex;
      acquired.proofs.transaction.value = "0x03";
      acquired.proofs.transaction.proof[0] = "0xc1";
      acquired.paymentFact.amount = 999n;
      return Number(CHAIN_ID);
    },
    getBytecode: async () => VERIFIER_CODE,
    readContract: async () => true,
  } as unknown as PublicClient;

  const serialized = await createPortableInclusionReceipt({
    publicClient,
    verifierDeployment: DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof: acquired,
    claim: claimFor(originalHash),
    supportedTokenAddresses: [],
    proofSourceId: PROOF_SOURCE_ID,
    producerVerifierRpcSourceId: PRODUCER_RPC_SOURCE_ID,
  });
  const parsed = JSON.parse(serialized) as {
    proof: { transactionHash: Hex; transaction: { value: Hex; proof: Hex[] } };
    paymentFact: { amountBaseUnits: string };
  };

  assert.equal(parsed.proof.transactionHash, originalHash);
  assert.equal(parsed.proof.transaction.value, originalTransaction);
  assert.equal(parsed.proof.transaction.proof[0], originalNode);
  assert.equal(parsed.paymentFact.amountBaseUnits, "123");
});
