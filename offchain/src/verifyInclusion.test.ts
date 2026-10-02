import assert from "node:assert/strict";
import { test } from "node:test";
import { keccak256, toRlp, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { AcquiredRecentInclusionProof } from "./proofRpc.js";
import type { RawPaymentFact } from "./paymentFacts.js";
import { RecentInclusionVerificationError, verifyRecentInclusionOnchain } from "./verifyInclusion.js";

const VERIFIER = `0x${"11".repeat(20)}` as Address;
const BLOCK_HASH = `0x${"33".repeat(32)}` as Hex;
const ROOT = `0x${"44".repeat(32)}` as Hex;
const CHAIN_ID = 10143n;
const ACCOUNT = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const RECIPIENT = "0x6666666666666666666666666666666666666666" as Address;

async function acquiredProof(): Promise<AcquiredRecentInclusionProof> {
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
  const paymentFact: RawPaymentFact = {
    chainId: CHAIN_ID,
    transactionHash,
    transactionType: "legacy",
    successful: true,
    sender: ACCOUNT.address,
    recipient: RECIPIENT,
    asset: "0x0000000000000000000000000000000000000000",
    amount: 123n,
  };
  return {
    chainId: CHAIN_ID,
    blockNumber: 12n,
    blockHash: BLOCK_HASH,
    rawHeader: "0x01",
    transactionIndex: 1,
    transactionHash,
    paymentFact,
    proofs: {
      transactionRoot: ROOT,
      receiptRoot: ROOT,
      transaction: { root: ROOT, index: 1, value: rawTransaction, proof: ["0xc0"] },
      receipt: { root: ROOT, index: 1, value: rawReceipt, proof: ["0xc0"] },
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
      assert.equal(request.args[4], (await acquiredProof()).transactionHash);
      return true;
    },
  } as unknown as PublicClient;

  const result = await verifyRecentInclusionOnchain({
    publicClient,
    verifierAddress: VERIFIER,
    expectedChainId: CHAIN_ID,
    proof: await acquiredProof(),
    supportedTokenAddresses: [],
  });

  assert.equal(called, true);
  assert.equal(result.verification, "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED");
  assert.equal(result.paymentFact.amount, 123n);
  assert.equal(result.transactionHash, result.paymentFact.transactionHash);
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
      expectedChainId: CHAIN_ID,
      proof: await acquiredProof(),
      supportedTokenAddresses: [],
    }),
    RecentInclusionVerificationError,
  );
  assert.equal(called, false);
});

test("rejects a forged attached payment fact before calling the verifier", async () => {
  const proof = await acquiredProof();
  proof.paymentFact.amount = 999n;
  let called = false;
  const publicClient = {
    getChainId: async () => Number(CHAIN_ID),
    readContract: async () => {
      called = true;
      return true;
    },
  } as unknown as PublicClient;

  await assert.rejects(
    verifyRecentInclusionOnchain({
      publicClient,
      verifierAddress: VERIFIER,
      expectedChainId: CHAIN_ID,
      proof,
      supportedTokenAddresses: [],
    }),
    RecentInclusionVerificationError,
  );
  assert.equal(called, false);
});
