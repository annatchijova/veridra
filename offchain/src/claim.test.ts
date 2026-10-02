import assert from "node:assert/strict";
import { test } from "node:test";
import { InvalidPaymentClaimError, parsePaymentClaim } from "./claim.js";

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const TX_HASH = "0x" + "a1".repeat(32);
const SENDER = "0x00000000000000000000000000000000000000a1";
const RECIPIENT = "0x00000000000000000000000000000000000000b2";
const ASSET = "0x00000000000000000000000000000000000000c3";

function minimal(overrides: Record<string, unknown> = {}) {
  return { transactionHash: TX_HASH, chainId: "10143", ...overrides };
}

test("a minimal claim asserting nothing beyond hash/chainId parses with every optional field unasserted", () => {
  const claim = parsePaymentClaim(minimal());
  assert.equal(claim.transactionHash, TX_HASH);
  assert.equal(claim.chainId, 10143n);
  assert.equal(claim.assertsSender, false);
  assert.equal(claim.sender, ZERO_ADDRESS);
  assert.equal(claim.assertsRecipient, false);
  assert.equal(claim.assertsAsset, false);
  assert.equal(claim.assertsAmount, false);
  assert.equal(claim.amount, 0n);
});

test("every asserted field is carried through and marked asserted", () => {
  const claim = parsePaymentClaim(
    minimal({ sender: SENDER, recipient: RECIPIENT, asset: ASSET, amountBaseUnits: "100" }),
  );
  assert.equal(claim.assertsSender, true);
  assert.equal(claim.sender.toLowerCase(), SENDER);
  assert.equal(claim.assertsRecipient, true);
  assert.equal(claim.recipient.toLowerCase(), RECIPIENT);
  assert.equal(claim.assertsAsset, true);
  assert.equal(claim.asset.toLowerCase(), ASSET);
  assert.equal(claim.assertsAmount, true);
  assert.equal(claim.amount, 100n);
});

test("rejects a non-object input", () => {
  assert.throws(() => parsePaymentClaim("not an object"), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim(null), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim([1, 2, 3]), InvalidPaymentClaimError);
});

test("rejects an unsupported field so a typo does not silently become an unasserted claim", () => {
  assert.throws(
    () => parsePaymentClaim(minimal({ amount: "100" })),
    (error: unknown) => error instanceof InvalidPaymentClaimError && /Unsupported payment claim field: amount/.test(error.message),
  );
});

test("rejects a malformed transaction hash", () => {
  assert.throws(() => parsePaymentClaim(minimal({ transactionHash: "0x1234" })), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim({ ...minimal(), transactionHash: 123 }), InvalidPaymentClaimError);
});

test("rejects chainId zero, a non-canonical numeric string, and a JSON number", () => {
  assert.throws(() => parsePaymentClaim(minimal({ chainId: "0" })), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim(minimal({ chainId: "01" })), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim(minimal({ chainId: "-1" })), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim(minimal({ chainId: 10143 })), InvalidPaymentClaimError);
});

test("rejects an amount string that exceeds uint256", () => {
  const tooLarge = (1n << 256n).toString(10);
  assert.throws(
    () => parsePaymentClaim(minimal({ amountBaseUnits: tooLarge })),
    InvalidPaymentClaimError,
  );
});

test("rejects a malformed address for sender/recipient/asset", () => {
  assert.throws(() => parsePaymentClaim(minimal({ sender: "not-an-address" })), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim(minimal({ recipient: "0x1234" })), InvalidPaymentClaimError);
  assert.throws(() => parsePaymentClaim(minimal({ asset: ZERO_ADDRESS + "00" })), InvalidPaymentClaimError);
});
