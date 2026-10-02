import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address, Hex, PublicClient } from "viem";
import type { AcquiredRecentInclusionProof } from "./proofRpc.js";
import { RecentInclusionVerificationError, verifyRecentInclusionOnchain } from "./verifyInclusion.js";

const VERIFIER = `0x${"11".repeat(20)}` as Address;
const TX_HASH = `0x${"22".repeat(32)}` as Hex;
const BLOCK_HASH = `0x${"33".repeat(32)}` as Hex;
const ROOT = `0x${"44".repeat(32)}` as Hex;

function acquiredProof(): AcquiredRecentInclusionProof {
  return {
    chainId: 10143n,
    blockNumber: 12n,
    blockHash: BLOCK_HASH,
    rawHeader: "0x01",
    transactionIndex: 1,
    transactionHash: TX_HASH,
    proofs: {
      transactionRoot: ROOT,
      receiptRoot: ROOT,
      transaction: { root: ROOT, index: 1, value: "0x01", proof: ["0xc0"] },
      receipt: { root: ROOT, index: 1, value: "0x02", proof: ["0xc0"] },
    },
  };
}

test("reports only RPC-attributed inclusion acceptance after a true verifier call", async () => {
  let called = false;
  const publicClient = {
    getChainId: async () => 10143,
    readContract: async (request: { functionName: string; args: readonly unknown[] }) => {
      called = true;
      assert.equal(request.functionName, "verifyRecentInclusion");
      assert.equal(request.args[0], 12n);
      assert.equal(request.args[3], 1n);
      assert.equal(request.args[4], TX_HASH);
      return true;
    },
  } as unknown as PublicClient;

  const result = await verifyRecentInclusionOnchain({
    publicClient,
    verifierAddress: VERIFIER,
    expectedChainId: 10143n,
    proof: acquiredProof(),
  });

  assert.equal(called, true);
  assert.equal(result.verification, "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED");
  assert.equal(result.transactionHash, TX_HASH);
});

test("does not call the verifier when the connected chain differs", async () => {
  let called = false;
  const publicClient = {
    getChainId: async () => 1,
    readContract: async () => {
      called = true;
      return true;
    },
  } as unknown as PublicClient;

  await assert.rejects(
    verifyRecentInclusionOnchain({
      publicClient,
      verifierAddress: VERIFIER,
      expectedChainId: 10143n,
      proof: acquiredProof(),
    }),
    RecentInclusionVerificationError,
  );
  assert.equal(called, false);
});
