import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { dedupe: ["viem"] },
  test: { environment: "jsdom", include: ["src/**/*.test.ts"] },
});
