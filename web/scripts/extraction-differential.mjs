// Integral review H-differential: do the JSON-RPC extraction (tier 1) and the raw-RLP extraction
// (tiers 2/3) agree on real transactions of different shapes?
// Run from web/ after `npm run build:offchain` with   npm run live:differential   (VERBOSE=1 for detail)
const lib = await import(new URL("../../offchain/dist/index.js", import.meta.url));
const { keccak256, stringToHex } = await import(new URL("../../offchain/node_modules/viem/_esm/index.js", import.meta.url));
const RPC = "https://testnet-rpc.monad.xyz";
const CHAIN = 10143n;
const TRANSFER = keccak256(stringToHex("Transfer(address,address,uint256)"));
const CAP = 10;

async function rpc(method, params) {
  const res = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const head = Number(BigInt(await rpc("eth_blockNumber", [])));
const buckets = { nativeTransfer: [], directTokenTransfer: [], reverted: [], creation: [], payableCall: [], tokenViaContract: [], plainCall: [] };
for (let n = head - 5; n > head - 400 && Object.values(buckets).some((b) => b.length < CAP); n--) {
  const tag = "0x" + n.toString(16);
  const block = await rpc("eth_getBlockByNumber", [tag, true]);
  const receipts = new Map((await rpc("eth_getBlockReceipts", [tag])).map((r) => [r.transactionHash, r]));
  for (const tx of block.transactions) {
    const receipt = receipts.get(tx.hash);
    if (!receipt) continue;
    const transfers = receipt.logs.filter((log) => log.topics[0] === TRANSFER);
    let kind;
    if (receipt.status === "0x0") kind = "reverted";
    else if (tx.to === null) kind = "creation";
    else if (tx.input === "0x" && BigInt(tx.value) > 0n) kind = "nativeTransfer";
    else if (transfers.length === 1 && transfers[0].address.toLowerCase() === tx.to.toLowerCase()) kind = "directTokenTransfer";
    else if (transfers.length > 0) kind = "tokenViaContract";
    else if (BigInt(tx.value) > 0n) kind = "payableCall";
    else kind = "plainCall";
    if (buckets[kind].length < CAP) buckets[kind].push({ hash: tx.hash, to: tx.to, type: tx.type });
  }
}
console.log("collected:", Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])));

const providerId = keccak256(stringToHex(`veridra/rpc/${RPC}`));
const normalize = (f) => JSON.stringify({ ok: f.successful, s: f.sender.toLowerCase(), r: f.recipient.toLowerCase(), a: f.asset.toLowerCase(), v: f.amount.toString() });
let total = 0;
let mismatches = 0;
for (const [kind, list] of Object.entries(buckets)) {
  for (const tx of list) {
    total++;
    const tokens = kind === "directTokenTransfer" ? [tx.to] : [];
    let viaJson;
    let viaRaw;
    try {
      const { evidence: e } = await lib.acquirePaymentEvidence(tx.hash, "1", { rpcUrl: RPC, expectedChainId: CHAIN, providerId, requiredConfirmations: 1n, supportedTokenAddresses: tokens });
      viaJson = { ok: true, v: normalize(e) };
    } catch (error) { viaJson = { ok: false, why: error.message.slice(0, 70) }; }
    try {
      const { paymentFact: f } = await lib.acquireRecentInclusionProof({ rpcUrl: RPC, expectedChainId: CHAIN, transactionHash: tx.hash, supportedTokenAddresses: tokens });
      viaRaw = { ok: true, v: normalize(f) };
    } catch (error) { viaRaw = { ok: false, why: error.message.slice(0, 70) }; }
    const agree = viaJson.ok === viaRaw.ok && (!viaJson.ok || viaJson.v === viaRaw.v);
    if (!agree) {
      mismatches++;
      console.log("MISMATCH", kind, "type", tx.type, tx.hash, "\n  json-rpc:", JSON.stringify(viaJson), "\n  raw-rlp :", JSON.stringify(viaRaw));
    } else if (process.env.VERBOSE) console.log("ok", kind, viaJson.ok ? "both extract" : `both reject: ${viaJson.why}`);
  }
}
console.log(`\nchecked ${total} real transactions across ${Object.keys(buckets).length} shapes; mismatches: ${mismatches}`);
