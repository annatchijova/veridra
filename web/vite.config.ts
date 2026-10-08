import { defineConfig, type Plugin } from "vitest/config";

// Production only (the dev server injects inline styles/scripts). Restricts the page to its own
// files and the one RPC it is meant to talk to, so a future script injection could not send what an
// operator typed anywhere else.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "connect-src https://testnet-rpc.monad.xyz",
  "img-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const contentSecurityPolicy: Plugin = {
  name: "veridra-csp",
  apply: "build",
  transformIndexHtml: () => [
    { tag: "meta", attrs: { "http-equiv": "Content-Security-Policy", content: CSP }, injectTo: "head-prepend" },
  ],
};

export default defineConfig({
  plugins: [contentSecurityPolicy],
  resolve: { dedupe: ["viem"] },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
