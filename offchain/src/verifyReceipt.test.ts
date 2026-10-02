import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex } from "viem";
import {
  ReceiptIntegrityError,
  ReceiptNotFoundError,
  UnsupportedReceiptVariantError,
  verifyReceipt,
} from "./verifyReceipt.js";

const REGISTRY = ("0x" + "11".repeat(20)) as Address;
const RECEIPT_ID = ("0x" + "22".repeat(32)) as Hex;
const TX_HASH = ("0x" + "33".repeat(32)) as Hex;
const CHAIN_ID = 10143n;
const SENDER = "0x" + "aa".repeat(20);
const RECIPIENT = "0x" + "bb".repeat(20);
const FINALITY_POLICY = ("0x" + "44".repeat(32)) as Hex;

function fakeClient(storedReceipt: unknown) {
  return {
    readContract: async () => storedReceipt,
  } as unknown as Parameters<typeof verifyReceipt>[0]["publicClient"];
}

function verifiedReceipt() {
  return {
    schemaVersion: 1,
    evidenceAssurance: 1,
    verdict: 0, // VERIFIED
    checks: [1, 1, 1, 0, 0, 0, 0], // PASS, PASS, PASS, ABSTAIN x4
    transactionHash: TX_HASH,
    chainId: CHAIN_ID,
    blockNumber: 100n,
    blockHash: ("0x" + "55".repeat(32)) as Hex,
    providerId: ("0x" + "66".repeat(32)) as Hex,
    observedAt: 1000n,
    recordedAt: 1000n,
    claimDigest: ("0x" + "77".repeat(32)) as Hex,
    evidenceDigest: ("0x" + "88".repeat(32)) as Hex,
    claim: {
      transactionHash: TX_HASH,
      chainId: CHAIN_ID,
      assertsSender: false,
      sender: "0x0000000000000000000000000000000000000000",
      assertsRecipient: false,
      recipient: "0x0000000000000000000000000000000000000000",
      assertsAsset: false,
      asset: "0x0000000000000000000000000000000000000000",
      assertsAmount: false,
      amount: 0n,
    },
    evidence: {
      available: true,
      transactionHash: TX_HASH,
      chainId: CHAIN_ID,
      blockNumber: 100n,
      blockHash: ("0x" + "55".repeat(32)) as Hex,
      successful: true,
      sender: SENDER,
      recipient: RECIPIENT,
      asset: "0x0000000000000000000000000000000000000000",
      amount: 0n,
      transactionPayloadDigest: ("0x" + "99".repeat(32)) as Hex,
      receiptPayloadDigest: ("0x" + "aa".repeat(32)) as Hex,
      logsDigest: ("0x" + "bb".repeat(32)) as Hex,
      finalityPolicyId: FINALITY_POLICY,
      requiredConfirmations: 1n,
      observedConfirmations: 3n,
    },
  };
}

test("an unknown receipt id is reported as not found, not as a passing verdict", async () => {
  await assert.rejects(
    () =>
      verifyReceipt({
        publicClient: fakeClient({ ...verifiedReceipt(), schemaVersion: 0 }),
        registryAddress: REGISTRY,
        receiptId: RECEIPT_ID,
        expectedChainId: CHAIN_ID,
      }),
    ReceiptNotFoundError,
  );
});

test("a receipt whose stored verdict matches independent recomputation verifies successfully", async () => {
  const result = await verifyReceipt({
    publicClient: fakeClient(verifiedReceipt()),
    registryAddress: REGISTRY,
    receiptId: RECEIPT_ID,
    expectedChainId: CHAIN_ID,
  });

  assert.equal(result.verdict, "VERIFIED");
  assert.equal(result.evidenceAssurance, "RPC_ATTESTED");
  assert.deepEqual(
    result.checks.map((c) => c.status),
    ["PASS", "PASS", "PASS", "ABSTAIN", "ABSTAIN", "ABSTAIN", "ABSTAIN"],
  );
});

test("rejects a schema version this verifier was not written to understand", async () => {
  await assert.rejects(
    () =>
      verifyReceipt({
        publicClient: fakeClient({ ...verifiedReceipt(), schemaVersion: 2 }),
        registryAddress: REGISTRY,
        receiptId: RECEIPT_ID,
        expectedChainId: CHAIN_ID,
      }),
    UnsupportedReceiptVariantError,
  );
});

test("rejects an evidence assurance variant this verifier was not written to understand", async () => {
  await assert.rejects(
    () =>
      verifyReceipt({
        publicClient: fakeClient({ ...verifiedReceipt(), evidenceAssurance: 2 }),
        registryAddress: REGISTRY,
        receiptId: RECEIPT_ID,
        expectedChainId: CHAIN_ID,
      }),
    UnsupportedReceiptVariantError,
  );
});

test("rejects a receipt recorded under a different chain than the caller expects", async () => {
  await assert.rejects(
    () =>
      verifyReceipt({
        publicClient: fakeClient(verifiedReceipt()),
        registryAddress: REGISTRY,
        receiptId: RECEIPT_ID,
        expectedChainId: CHAIN_ID + 1n,
      }),
    UnsupportedReceiptVariantError,
  );
});

test("a VERIFIED claim with an unasserted-but-mismatched evidence field recomputes VERIFIED, since unasserted fields abstain", async () => {
  const receipt = verifiedReceipt();
  receipt.evidence.sender = "0x" + "cc".repeat(20); // diverges from a hypothetical assertion that isn't made
  const result = await verifyReceipt({
    publicClient: fakeClient(receipt),
    registryAddress: REGISTRY,
    receiptId: RECEIPT_ID,
    expectedChainId: CHAIN_ID,
  });
  assert.equal(result.verdict, "VERIFIED");
});

test("flags integrity when the stored verdict disagrees with independent recomputation", async () => {
  const receipt = verifiedReceipt();
  receipt.verdict = 0; // stored as VERIFIED
  receipt.evidence.successful = false; // but execution actually failed -> should recompute NOT_VERIFIED

  await assert.rejects(
    () =>
      verifyReceipt({
        publicClient: fakeClient(receipt),
        registryAddress: REGISTRY,
        receiptId: RECEIPT_ID,
        expectedChainId: CHAIN_ID,
      }),
    ReceiptIntegrityError,
  );
});

test("flags integrity when a stored per-check status disagrees with recomputation", async () => {
  const receipt = verifiedReceipt();
  receipt.checks = [1, 1, 2, 0, 0, 0, 0]; // claims execution FAILed, but evidence.successful is true

  await assert.rejects(
    () =>
      verifyReceipt({
        publicClient: fakeClient(receipt),
        registryAddress: REGISTRY,
        receiptId: RECEIPT_ID,
        expectedChainId: CHAIN_ID,
      }),
    ReceiptIntegrityError,
  );
});

test("insufficient evidence recomputes to an all-ABSTAIN check row", async () => {
  const receipt = verifiedReceipt();
  receipt.verdict = 2; // INSUFFICIENT_EVIDENCE
  receipt.checks = [0, 0, 0, 0, 0, 0, 0];
  receipt.evidence.available = false;

  const result = await verifyReceipt({
    publicClient: fakeClient(receipt),
    registryAddress: REGISTRY,
    receiptId: RECEIPT_ID,
    expectedChainId: CHAIN_ID,
  });

  assert.equal(result.verdict, "INSUFFICIENT_EVIDENCE");
  assert.ok(result.checks.every((c) => c.status === "ABSTAIN"));
});
