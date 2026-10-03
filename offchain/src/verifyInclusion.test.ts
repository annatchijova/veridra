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
const VERIFIER_CODE = "0x60006000" as Hex;
const VERIFIER_CODE_HASH = keccak256(VERIFIER_CODE);
const CHAIN_ID = 10143n;
const VERIFIER_DEPLOYMENT = {
  chainId: CHAIN_ID,
  address: VERIFIER,
  runtimeCodeHash: VERIFIER_CODE_HASH,
};
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
    getBytecode: async () => VERIFIER_CODE,
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
    verifierDeployment: VERIFIER_DEPLOYMENT,
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
      verifierDeployment: VERIFIER_DEPLOYMENT,
      expectedChainId: CHAIN_ID,
      proof: await acquiredProof(),
      supportedTokenAddresses: [],
    }),
    RecentInclusionVerificationError,
  );
  assert.equal(called, false);
});

test("rejects a verifier deployment whose runtime code hash is not pinned", async () => {
  let called = false;
  const publicClient = {
    getChainId: async () => Number(CHAIN_ID),
    getBytecode: async () => "0x6001",
    readContract: async () => {
      called = true;
      return true;
    },
  } as unknown as PublicClient;

  const input = {
    publicClient,
    verifierDeployment: VERIFIER_DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof: await acquiredProof(),
    supportedTokenAddresses: [],
  } as Parameters<typeof verifyRecentInclusionOnchain>[0];

  await assert.rejects(
    verifyRecentInclusionOnchain(input),
    (error: unknown) => error instanceof RecentInclusionVerificationError
      && /runtime code hash/.test(error.message),
  );
  assert.equal(called, false);
});

test("bounds untrusted verifier bytecode before hashing or making the inclusion call", async () => {
  let called = false;
  const oversizedBytecode = `0x${"00".repeat(65_537)}` as Hex;
  const publicClient = {
    getChainId: async () => Number(CHAIN_ID),
    getBytecode: async () => oversizedBytecode,
    readContract: async () => {
      called = true;
      return true;
    },
  } as unknown as PublicClient;

  await assert.rejects(
    verifyRecentInclusionOnchain({
      publicClient,
      verifierDeployment: VERIFIER_DEPLOYMENT,
      expectedChainId: CHAIN_ID,
      proof: await acquiredProof(),
      supportedTokenAddresses: [],
    }),
    (error: unknown) => error instanceof RecentInclusionVerificationError
      && /bytecode exceeds its configured byte bound/.test(error.message),
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
      verifierDeployment: VERIFIER_DEPLOYMENT,
      expectedChainId: CHAIN_ID,
      proof,
      supportedTokenAddresses: [],
    }),
    RecentInclusionVerificationError,
  );
  assert.equal(called, false);
});

test("uses a snapshot when the caller mutates the proof during the chain check", async () => {
  const proof = await acquiredProof();
  const originalHash = proof.transactionHash;
  const originalTransaction = proof.proofs.transaction.value;
  const replacementHash = `0x${"99".repeat(32)}` as Hex;
  let sentHash: Hex | undefined;
  let sentTransaction: Hex | undefined;
  const publicClient = {
    getChainId: async () => {
      proof.transactionHash = replacementHash;
      proof.paymentFact.amount = 999n;
      proof.proofs.transaction.value = "0x03";
      return Number(CHAIN_ID);
    },
    getBytecode: async () => VERIFIER_CODE,
    readContract: async (request: { args: readonly unknown[] }) => {
      sentHash = request.args[4] as Hex;
      sentTransaction = request.args[5] as Hex;
      return true;
    },
  } as unknown as PublicClient;

  const result = await verifyRecentInclusionOnchain({
    publicClient,
    verifierDeployment: VERIFIER_DEPLOYMENT,
    expectedChainId: CHAIN_ID,
    proof,
    supportedTokenAddresses: [],
  });

  assert.equal(sentHash, originalHash);
  assert.equal(sentTransaction, originalTransaction);
  assert.equal(result.transactionHash, originalHash);
  assert.equal(result.paymentFact.transactionHash, originalHash);
  assert.equal(result.paymentFact.amount, 123n);
});
