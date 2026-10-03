import assert from "node:assert/strict";
import { test } from "node:test";
import { encodeAbiParameters, getAddress, keccak256, stringToHex, toRlp, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { derivePaymentFactFromRawValues, RawPaymentFactError } from "./paymentFacts.js";

const CHAIN_ID = 10143n;
const ACCOUNT = privateKeyToAccount("0x0000000000000000000000000000000000000000000000000000000000000001");
const TOKEN = "0x00000000000000000000000000000000000000aa" as Address;
const OTHER_TOKEN = "0x00000000000000000000000000000000000000cc" as Address;
const RECIPIENT = "0x00000000000000000000000000000000000000bb" as Address;
const TRANSFER_TOPIC = keccak256(stringToHex("Transfer(address,address,uint256)"));
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function topicAddress(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

function rawReceipt(logs: readonly (readonly [Hex, readonly Hex[], Hex])[], typedPrefix?: Hex): Hex {
  const bloom = `0x${"00".repeat(256)}` as Hex;
  const rlpLogs = logs.map(([address, topics, data]) => [address, topics, data]);
  const payload = toRlp(["0x01", "0x5208", bloom, rlpLogs] as never, "hex");
  return (typedPrefix === undefined ? payload : `${typedPrefix}${payload.slice(2)}`) as Hex;
}

test("extracts a signed direct native transfer from transaction and receipt bytes", async () => {
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
  const fact = await derivePaymentFactFromRawValues(rawTransaction, rawReceipt([]), CHAIN_ID, []);

  assert.equal(fact.transactionHash, keccak256(rawTransaction));
  assert.equal(fact.sender, ACCOUNT.address);
  assert.equal(fact.recipient, RECIPIENT);
  assert.equal(fact.asset, ZERO_ADDRESS);
  assert.equal(fact.amount, 123n);
  assert.equal(fact.successful, true);
});

test("extracts exactly one allowlisted direct ERC-20 Transfer from typed bytes", async () => {
  const rawTransaction = await ACCOUNT.signTransaction({
    type: "eip1559",
    chainId: Number(CHAIN_ID),
    nonce: 1,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    gas: 60_000n,
    to: TOKEN,
    value: 0n,
    data: "0xa9059cbb",
  });
  const rawLog = [
    TOKEN as Hex,
    [TRANSFER_TOPIC, topicAddress(ACCOUNT.address), topicAddress(RECIPIENT)],
    encodeAbiParameters([{ type: "uint256" }], [987n]),
  ] as const;
  const fact = await derivePaymentFactFromRawValues(rawTransaction, rawReceipt([rawLog], "0x02"), CHAIN_ID, [TOKEN]);

  assert.equal(fact.transactionType, "eip1559");
  assert.equal(fact.sender, ACCOUNT.address);
  assert.equal(fact.recipient, RECIPIENT);
  assert.equal(fact.asset, getAddress(TOKEN));
  assert.equal(fact.amount, 987n);
  assert.equal(fact.successful, true);
});

test("snapshots the token allowlist before asynchronous signer recovery", async () => {
  const rawTransaction = await ACCOUNT.signTransaction({
    type: "eip1559",
    chainId: Number(CHAIN_ID),
    nonce: 2,
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
    gas: 60_000n,
    to: TOKEN,
    value: 0n,
    data: "0xa9059cbb",
  });
  const rawLog = [
    TOKEN as Hex,
    [TRANSFER_TOPIC, topicAddress(ACCOUNT.address), topicAddress(RECIPIENT)],
    encodeAbiParameters([{ type: "uint256" }], [5n]),
  ] as const;
  const allowlist = [TOKEN];
  const pendingFact = derivePaymentFactFromRawValues(rawTransaction, rawReceipt([rawLog], "0x02"), CHAIN_ID, allowlist);
  allowlist[0] = OTHER_TOKEN;

  const fact = await pendingFact;
  assert.equal(fact.asset, getAddress(TOKEN));
  assert.equal(fact.amount, 5n);
});

test("fails closed on unsupported transaction types and chain mismatch", async () => {
  await assert.rejects(
    derivePaymentFactFromRawValues("0x03c0", rawReceipt([]), CHAIN_ID, []),
    (error: unknown) => error instanceof RawPaymentFactError && /Unsupported transaction type/.test(error.message),
  );

  const rawTransaction = await ACCOUNT.signTransaction({
    type: "legacy",
    chainId: Number(CHAIN_ID),
    nonce: 0,
    gasPrice: 1n,
    gas: 21_000n,
    to: RECIPIENT,
    value: 1n,
    data: "0x",
  });
  await assert.rejects(
    derivePaymentFactFromRawValues(rawTransaction, rawReceipt([]), CHAIN_ID + 1n, []),
    (error: unknown) => error instanceof RawPaymentFactError && /chain ID/.test(error.message),
  );
});

test("rejects ambiguous, unallowlisted, and malformed payment evidence", async () => {
  const rawTransaction = await ACCOUNT.signTransaction({
    type: "legacy",
    chainId: Number(CHAIN_ID),
    nonce: 0,
    gasPrice: 1n,
    gas: 60_000n,
    to: TOKEN,
    value: 0n,
    data: "0xa9059cbb",
  });
  const log = [
    TOKEN as Hex,
    [TRANSFER_TOPIC, topicAddress(ACCOUNT.address), topicAddress(RECIPIENT)],
    encodeAbiParameters([{ type: "uint256" }], [1n]),
  ] as const;
  await assert.rejects(derivePaymentFactFromRawValues(rawTransaction, rawReceipt([log]), CHAIN_ID, []), RawPaymentFactError);
  await assert.rejects(derivePaymentFactFromRawValues(rawTransaction, rawReceipt([log, log]), CHAIN_ID, [TOKEN]), RawPaymentFactError);
  await assert.rejects(derivePaymentFactFromRawValues(rawTransaction, "0x01", CHAIN_ID, [TOKEN]), RawPaymentFactError);
});
