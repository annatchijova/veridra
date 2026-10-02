import assert from "node:assert/strict";
import { test } from "node:test";
import { hexToBytes, keccak256, toRlp, type Hex } from "viem";
import { buildInclusionProofFromRawBlock, buildTransactionAndReceiptProofs, MptProofInputError } from "./mptProof.js";

test("single-entry transaction and receipt tries match the canonical RLP(0) leaf vectors", () => {
  const result = buildTransactionAndReceiptProofs(["0x01"], ["0x02"], 0);

  assert.equal(result.transactionRoot, "0xac92bc8d02906a87a573c32c72bb427036f0e43d7a7375c5c491ebba064add15");
  assert.equal(result.receiptRoot, "0x0c6c0e36f63e44856ee063dbf497da186454b1a857b286686461207698a894c5");
  assert.deepEqual(result.transaction.proof, ["0xc482208001"]);
  assert.deepEqual(result.receipt.proof, ["0xc482208002"]);
});

test("two-entry tries embed short leaf nodes and produce one root-only proof path", () => {
  const result = buildTransactionAndReceiptProofs(["0x01", "0x03"], ["0x02", "0x04"], 1);

  assert.equal(result.transactionRoot, "0x3e246932c27684bc24fbe8790c22bc183ec3719c851db5ea4cdb2316bd0bf5a6");
  assert.equal(result.receiptRoot, "0xae833f5f13bb80272f61f8d5ecaef29eb2077476f81cac03a365ebfce99c1d25");
  assert.deepEqual(result.transaction.proof, ["0xd5c2310380808080808080c230018080808080808080"]);
  assert.deepEqual(result.receipt.proof, ["0xd5c2310480808080808080c230028080808080808080"]);
  assert.equal(result.transaction.index, 1);
  assert.equal(result.receipt.index, 1);
});

test("rejects empty, malformed, mismatched, and out-of-range proof inputs", () => {
  const reject = (transactions: readonly Hex[], receipts: readonly Hex[], index: number) =>
    assert.throws(() => buildTransactionAndReceiptProofs(transactions, receipts, index), MptProofInputError);

  reject([], [], 0);
  reject(["0x01"], [], 0);
  reject(["0x0" as Hex], ["0x02"], 0);
  reject(["0x01"], ["0x02"], 1);
  reject(["0x01"], ["0x02"], -1);
});

test("raw block decoding locates the transaction and checks both header roots", () => {
  const txRoot = hexToBytes("0x3e246932c27684bc24fbe8790c22bc183ec3719c851db5ea4cdb2316bd0bf5a6");
  const receiptRoot = hexToBytes("0xae833f5f13bb80272f61f8d5ecaef29eb2077476f81cac03a365ebfce99c1d25");
  const header = [
    hexToBytes(`0x${"11".repeat(32)}`),
    hexToBytes(`0x${"22".repeat(32)}`),
    hexToBytes(`0x${"33".repeat(20)}`),
    hexToBytes(`0x${"44".repeat(32)}`),
    txRoot,
    receiptRoot,
    hexToBytes(`0x${"55".repeat(256)}`),
    hexToBytes("0x"),
    hexToBytes("0x01"),
    hexToBytes("0x5208"),
    hexToBytes("0x01"),
    hexToBytes("0x01"),
    hexToBytes("0x"),
    hexToBytes(`0x${"66".repeat(32)}`),
    hexToBytes(`0x${"00".repeat(8)}`),
  ];
  const rawBlock = toRlp([header, [hexToBytes("0x01"), hexToBytes("0x03")], []], "hex");
  const proof = buildInclusionProofFromRawBlock(rawBlock, ["0x02", "0x04"], keccak256("0x03"));

  assert.equal(proof.blockNumber, 1n);
  assert.equal(proof.transactionIndex, 1);
  assert.equal(proof.transactionHash, keccak256("0x03"));
  assert.equal(proof.proofs.transactionRoot, "0x3e246932c27684bc24fbe8790c22bc183ec3719c851db5ea4cdb2316bd0bf5a6");
  assert.equal(proof.proofs.receiptRoot, "0xae833f5f13bb80272f61f8d5ecaef29eb2077476f81cac03a365ebfce99c1d25");

  const alteredHeader = [...header];
  alteredHeader[5] = hexToBytes(`0x${"77".repeat(32)}`);
  const alteredBlock = toRlp([alteredHeader, [hexToBytes("0x01"), hexToBytes("0x03")], []], "hex");
  assert.throws(
    () => buildInclusionProofFromRawBlock(alteredBlock, ["0x02", "0x04"], keccak256("0x03")),
    /receipt root differs from raw block header/,
  );
});
