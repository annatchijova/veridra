import { describe, expect, it, vi } from "vitest";
import { buildClaim, checkRpcAttested, type Acquire } from "./verify.js";

const HASH = `0x${"ab".repeat(32)}`;
const TOKEN = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";

async function allowlistFor(asset: string): Promise<readonly string[]> {
  const acquire = vi.fn(async () => {
    throw new Error("stop after capturing config");
  });
  await checkRpcAttested(buildClaim({ transactionHash: HASH, sender: "", recipient: "", asset, amountBaseUnits: "" }), acquire as unknown as Acquire);
  return (acquire.mock.calls[0] as unknown as [string, string, { supportedTokenAddresses: readonly string[] }])[2].supportedTokenAddresses;
}

describe("token allowlist wiring", () => {
  it("is empty when no asset is asserted", async () => {
    expect(await allowlistFor("")).toEqual([]);
  });
  it("is empty for native MON (zero address)", async () => {
    expect(await allowlistFor(ZERO)).toEqual([]);
  });
  it("contains exactly the asserted token", async () => {
    expect(await allowlistFor(TOKEN)).toEqual([TOKEN]);
  });
});
