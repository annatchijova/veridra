// Integral review F1: how long does a hung RPC hold a "checking…" state?
// Run from web/ with   npm run live:hung-rpc   (about 41 s)
import net from "node:net";
const { createPublicClient, http } = await import(new URL("../../offchain/node_modules/viem/_esm/index.js", import.meta.url));

// Accepts connections and never answers.
const server = net.createServer((socket) => socket.on("error", () => {}));
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;

async function time(label, transport) {
  const started = Date.now();
  try {
    await createPublicClient({ transport }).getBlockNumber();
  } catch (error) {
    console.log(`${label}: failed after ${((Date.now() - started) / 1000).toFixed(1)}s (${error.name})`);
  }
}
await Promise.all([
  time("viem defaults                ", http(url)),
  time("timeout 15s, retryCount 0 (shipped fix)", http(url, { timeout: 15_000, retryCount: 0 })),
]);
server.close();
process.exit(0);
