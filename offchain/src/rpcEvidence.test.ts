import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { acquirePaymentEvidence, InsufficientEvidenceError, type RpcEvidenceConfig } from "./rpcEvidence.js";

const RPC_URL = "https://rpc.example.test";
const CHAIN_ID = 10143n;
const CHAIN_ID_HEX = "0x279f";
const TX_HASH = ("0x" + "11".repeat(32)) as `0x${string}`;
const BLOCK_HASH = ("0x" + "22".repeat(32)) as `0x${string}`;
const FROM = "0x" + "aa".repeat(20);
const NATIVE_RECIPIENT = "0x" + "bb".repeat(20);
const TOKEN = "0x" + "cc".repeat(20);
const TOKEN_RECIPIENT = "0x" + "dd".repeat(20);
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

type JsonRpcHandler = (params: unknown[]) => unknown;

let originalFetch: typeof fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function installMockRpc(handlers: Record<string, JsonRpcHandler>) {
  originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(init!.body as string) as { id: string; method: string; params: unknown[] };
    const handler = handlers[body.method];
    if (!handler) throw new Error(`Unexpected RPC method in test: ${body.method}`);
    const result = handler(body.params);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  }) as typeof fetch;
}

function baseConfig(overrides: Partial<RpcEvidenceConfig> = {}): RpcEvidenceConfig {
  return {
    rpcUrl: RPC_URL,
    expectedChainId: CHAIN_ID,
    providerId: ("0x" + "77".repeat(32)) as `0x${string}`,
    requiredConfirmations: 1n,
    supportedTokenAddresses: [TOKEN as `0x${string}`],
    ...overrides,
  };
}

function nativeTransferHandlers(options: { status?: "0x0" | "0x1"; blockNumber?: string; headNumber?: string } = {}) {
  const blockNumber = options.blockNumber ?? "0x64";
  const headNumber = options.headNumber ?? "0x65";
  const transaction = {
    hash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    from: FROM,
    to: NATIVE_RECIPIENT,
    value: "0x64",
    input: "0x",
    chainId: CHAIN_ID_HEX,
  };
  const receipt = {
    transactionHash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    status: options.status ?? "0x1",
    logs: [] as unknown[],
  };
  const block = {
    hash: BLOCK_HASH,
    number: blockNumber,
    transactions: [TX_HASH],
  };
  return {
    eth_chainId: () => CHAIN_ID_HEX,
    eth_getTransactionByHash: () => transaction,
    eth_getTransactionReceipt: () => receipt,
    eth_getBlockByHash: () => block,
    eth_blockNumber: () => headNumber,
  };
}

test("extracts a native MON transfer and reports its observed confirmation depth", async () => {
  installMockRpc(nativeTransferHandlers());

  const acquired = await acquirePaymentEvidence(TX_HASH, "1000", baseConfig());

  assert.equal(acquired.evidence.available, true);
  assert.equal(acquired.evidence.successful, true);
  assert.equal(acquired.evidence.sender.toLowerCase(), FROM);
  assert.equal(acquired.evidence.recipient.toLowerCase(), NATIVE_RECIPIENT);
  assert.equal(acquired.evidence.asset, "0x0000000000000000000000000000000000000000");
  assert.equal(acquired.evidence.amount, 100n);
  assert.equal(acquired.evidence.observedConfirmations, 2n);
  assert.equal(acquired.observedAt, 1000n);
});

test("extracts a direct ERC-20 Transfer when the token is the transaction's own target", async () => {
  const blockNumber = "0x64";
  const headNumber = "0x64";
  const transaction = {
    hash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    from: FROM,
    to: TOKEN,
    value: "0x0",
    input: "0xa9059cbb",
    chainId: CHAIN_ID_HEX,
  };
  const transferLog = {
    address: TOKEN,
    topics: [
      TRANSFER_TOPIC,
      "0x000000000000000000000000" + FROM.slice(2),
      "0x000000000000000000000000" + TOKEN_RECIPIENT.slice(2),
    ],
    data: "0x" + (500n).toString(16).padStart(64, "0"),
  };
  const receipt = {
    transactionHash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    status: "0x1",
    logs: [transferLog],
  };
  const block = { hash: BLOCK_HASH, number: blockNumber, transactions: [TX_HASH] };

  installMockRpc({
    eth_chainId: () => CHAIN_ID_HEX,
    eth_getTransactionByHash: () => transaction,
    eth_getTransactionReceipt: () => receipt,
    eth_getBlockByHash: () => block,
    eth_blockNumber: () => headNumber,
  });

  const acquired = await acquirePaymentEvidence(TX_HASH, "1000", baseConfig());

  assert.equal(acquired.evidence.asset.toLowerCase(), TOKEN);
  assert.equal(acquired.evidence.sender.toLowerCase(), FROM);
  assert.equal(acquired.evidence.recipient.toLowerCase(), TOKEN_RECIPIENT);
  assert.equal(acquired.evidence.amount, 500n);
});

test("a Transfer log from a configured token emitted by a different contract than the tx target is rejected, not silently ignored", async () => {
  const blockNumber = "0x64";
  const transaction = {
    hash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    from: FROM,
    to: NATIVE_RECIPIENT, // a router/contract that is NOT the token itself
    value: "0x0",
    input: "0xabcdef01",
    chainId: CHAIN_ID_HEX,
  };
  const transferLog = {
    address: TOKEN,
    topics: [
      TRANSFER_TOPIC,
      "0x000000000000000000000000" + FROM.slice(2),
      "0x000000000000000000000000" + TOKEN_RECIPIENT.slice(2),
    ],
    data: "0x" + (500n).toString(16).padStart(64, "0"),
  };
  const receipt = {
    transactionHash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    status: "0x1",
    logs: [transferLog],
  };
  const block = { hash: BLOCK_HASH, number: blockNumber, transactions: [TX_HASH] };

  installMockRpc({
    eth_chainId: () => CHAIN_ID_HEX,
    eth_getTransactionByHash: () => transaction,
    eth_getTransactionReceipt: () => receipt,
    eth_getBlockByHash: () => block,
    eth_blockNumber: () => blockNumber,
  });

  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig()),
    InsufficientEvidenceError,
  );
});

test("a reverted transaction yields available, unsuccessful evidence instead of throwing", async () => {
  installMockRpc(nativeTransferHandlers({ status: "0x0" }));

  const acquired = await acquirePaymentEvidence(TX_HASH, "1000", baseConfig());

  assert.equal(acquired.evidence.available, true);
  assert.equal(acquired.evidence.successful, false);
  assert.equal(acquired.evidence.amount, 0n);
});

test("a transaction with no supported payment fact fails closed", async () => {
  const blockNumber = "0x64";
  const transaction = {
    hash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    from: FROM,
    to: NATIVE_RECIPIENT,
    value: "0x0", // no native value moved
    input: "0x",
    chainId: CHAIN_ID_HEX,
  };
  const receipt = {
    transactionHash: TX_HASH,
    blockNumber,
    blockHash: BLOCK_HASH,
    transactionIndex: "0x0",
    status: "0x1",
    logs: [],
  };
  const block = { hash: BLOCK_HASH, number: blockNumber, transactions: [TX_HASH] };

  installMockRpc({
    eth_chainId: () => CHAIN_ID_HEX,
    eth_getTransactionByHash: () => transaction,
    eth_getTransactionReceipt: () => receipt,
    eth_getBlockByHash: () => block,
    eth_blockNumber: () => blockNumber,
  });

  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig()),
    InsufficientEvidenceError,
  );
});

test("a chain ID mismatch between the RPC and the configured network fails closed", async () => {
  installMockRpc({
    ...nativeTransferHandlers(),
    eth_chainId: () => "0x1", // mainnet, not the configured Monad chain
  });

  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig()),
    InsufficientEvidenceError,
  );
});

test("a missing transaction or receipt fails closed instead of treating null as evidence", async () => {
  installMockRpc({
    ...nativeTransferHandlers(),
    eth_getTransactionReceipt: () => null,
  });

  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig()),
    InsufficientEvidenceError,
  );
});

test("a transaction whose block omits it at the claimed index fails closed", async () => {
  installMockRpc({
    ...nativeTransferHandlers(),
    eth_getBlockByHash: () => ({
      hash: BLOCK_HASH,
      number: "0x64",
      transactions: [("0x" + "99".repeat(32)) as `0x${string}`], // different transaction
    }),
  });

  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig()),
    InsufficientEvidenceError,
  );
});

test("acquisition is deterministic: identical RPC responses produce identical evidence digests", async () => {
  installMockRpc(nativeTransferHandlers());
  const first = await acquirePaymentEvidence(TX_HASH, "1000", baseConfig());

  installMockRpc(nativeTransferHandlers());
  const second = await acquirePaymentEvidence(TX_HASH, "1000", baseConfig());

  assert.equal(first.evidence.transactionPayloadDigest, second.evidence.transactionPayloadDigest);
  assert.equal(first.evidence.receiptPayloadDigest, second.evidence.receiptPayloadDigest);
  assert.equal(first.evidence.logsDigest, second.evidence.logsDigest);
  assert.equal(first.evidence.finalityPolicyId, second.evidence.finalityPolicyId);
});

test("rejects more than 64 configured token addresses", async () => {
  const manyTokens = Array.from({ length: 65 }, (_, i) => ("0x" + i.toString(16).padStart(40, "0")) as `0x${string}`);
  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig({ supportedTokenAddresses: manyTokens })),
    InsufficientEvidenceError,
  );
});

test("rejects a malformed RPC URL and a non-HTTPS remote URL", async () => {
  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig({ rpcUrl: "not-a-url" })),
    InsufficientEvidenceError,
  );
  await assert.rejects(
    () => acquirePaymentEvidence(TX_HASH, "1000", baseConfig({ rpcUrl: "http://rpc.example.test" })),
    InsufficientEvidenceError,
  );
});
