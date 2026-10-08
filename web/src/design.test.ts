import "@testing-library/dom";
import { fireEvent, getByRole, getByLabelText, waitFor } from "@testing-library/dom";
import { getAddress } from "viem";
import { describe, expect, it, vi } from "vitest";
import { mountApp, type AppDeps } from "./app.js";
import { EXAMPLES } from "./examples.js";
import { buildSearch, readClaimFromSearch } from "./permalink.js";
import { summarize } from "./summary.js";
import { buildClaim, type Acquire, type HistoricalDeps, type RecentDeps, type TierState } from "./verify.js";

const HASH = `0x${"ab".repeat(32)}`;
const result = (verdict: string, checks: Record<string, string>, assurance = "RPC_ATTESTED"): TierState =>
  ({
    status: "result",
    assurance,
    verdict,
    transactionHash: HASH,
    rawEvidence: {},
    checks: ["transactionHash", "chainId", "execution", "sender", "recipient", "asset", "amount"].map((name) => ({
      name,
      status: checks[name] ?? (["sender", "recipient", "asset", "amount"].includes(name) ? "ABSTAIN" : "PASS"),
    })),
  }) as unknown as TierState;
const unavailable: TierState = { status: "unavailable", message: "No mined transaction with this hash was found." };
const checking: TierState = { status: "checking" };

describe("summarize: one honest headline from the tiers", () => {
  it("says what is supported and what was not asserted, from the checks alone", () => {
    const s = summarize({ one: result("VERIFIED", { recipient: "PASS", amount: "PASS" }), two: unavailable, three: unavailable });
    expect(s.headline).toBe("VERIFIED");
    expect(s.assurance).toBe("RPC_ATTESTED");
    expect(s.sentence).toMatch(/Supported by the chain: recipient, amount\./);
    expect(s.sentence).toMatch(/Not asserted: sender, asset\./);
  });

  it("names exactly what the chain contradicts", () => {
    const s = summarize({ one: result("NOT_VERIFIED", { recipient: "FAIL", amount: "PASS" }), two: unavailable, three: unavailable });
    expect(s.headline).toBe("NOT_VERIFIED");
    expect(s.sentence).toMatch(/^The chain contradicts: recipient\./);
    expect(s.sentence).toMatch(/Supported by the chain: amount\./);
  });

  it("does not pretend more was checked when nothing was asserted", () => {
    const s = summarize({ one: result("VERIFIED", {}), two: unavailable, three: unavailable });
    expect(s.sentence).toMatch(/You asserted nothing more/);
  });

  it("uses the strongest tier that reached a real verdict", () => {
    const s = summarize({
      one: result("VERIFIED", {}),
      two: unavailable,
      three: result("VERIFIED", {}, "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED"),
    });
    expect(s.assurance).toBe("RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED");
  });

  it("reports a conflict instead of choosing a side when tiers disagree", () => {
    const s = summarize({
      one: result("VERIFIED", {}),
      two: result("NOT_VERIFIED", { amount: "FAIL" }, "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED"),
      three: unavailable,
    });
    expect(s.headline).toBe("CONFLICT");
    expect(s.assurance).toBeUndefined();
  });

  it("stays pending while nothing is decided, and flags a stronger tier still running", () => {
    expect(summarize({ one: checking, two: checking, three: checking }).headline).toBe("PENDING");
    const partial = summarize({ one: result("VERIFIED", {}), two: unavailable, three: checking });
    expect(partial.headline).toBe("VERIFIED");
    expect(partial.stillChecking).toBe(true);
  });

  it("insufficient evidence is not a verdict, and a failed lookup is no result with its own reason", () => {
    expect(summarize({ one: result("INSUFFICIENT_EVIDENCE", {}), two: unavailable, three: unavailable }).headline).toBe("INSUFFICIENT_EVIDENCE");
    const none = summarize({ one: unavailable, two: unavailable, three: unavailable });
    expect(none.headline).toBe("NO_RESULT");
    expect(none.sentence).toMatch(/No mined transaction/);
  });
});

describe("permalink", () => {
  it("prefills a claim from a link and ignores everything else", () => {
    const claim = readClaimFromSearch(`?tx=${HASH}&recipient=0xabc&evil=1`);
    expect(claim).toEqual({ transactionHash: HASH, recipient: "0xabc" });
  });
  it("needs a transaction, and bounds every value", () => {
    expect(readClaimFromSearch("?recipient=0xabc")).toBeNull();
    expect(readClaimFromSearch(`?tx=${"a".repeat(101)}`)).toBeNull();
  });
  it("only puts filled-in fields in a link", () => {
    const search = buildSearch({ transactionHash: HASH, sender: "", recipient: " 0xabc ", asset: "", amountBaseUnits: "5" });
    expect(search).toBe(`?tx=${HASH}&recipient=0xabc&amount=5`);
  });
});

describe("real examples", () => {
  it("every example is a claim the library accepts, with checksummed addresses", () => {
    for (const example of EXAMPLES) {
      expect(() => buildClaim(example.claim)).not.toThrow();
      for (const field of ["sender", "recipient"] as const) {
        const value = example.claim[field];
        if (value !== "") expect(value).toBe(getAddress(value));
      }
    }
  });
});

const evidence = (hash: string) => ({
  available: true,
  transactionHash: hash,
  chainId: 10_143n,
  blockNumber: 67_403_462n,
  blockHash: `0x${"cd".repeat(32)}`,
  successful: true,
  sender: "0x1111111111111111111111111111111111111111",
  recipient: "0x9EDE2692DE229c3B558105b0591aD34EFe89481D",
  asset: "0x0000000000000000000000000000000000000000",
  amount: 10_000_000_000_000_000n,
  transactionPayloadDigest: `0x${"01".repeat(32)}`,
  receiptPayloadDigest: `0x${"02".repeat(32)}`,
  logsDigest: `0x${"03".repeat(32)}`,
  finalityPolicyId: `0x${"04".repeat(32)}`,
  requiredConfirmations: 1n,
  observedConfirmations: 5n,
});

function mount(extra: Partial<AppDeps> = {}) {
  document.body.innerHTML = "<main></main>";
  const acquire = vi.fn(async (hash: string) => ({ providerId: `0x${"05".repeat(32)}`, observedAt: 1n, evidence: evidence(hash) })) as unknown as Acquire;
  const recent: RecentDeps = { locate: async () => ({ blockNumber: null, head: 0n }), acquireProof: vi.fn() as never, createReceipt: vi.fn() as never };
  const historical: HistoricalDeps = { locate: recent.locate, checkpointedHash: async () => null, acquireProof: vi.fn() as never, createReceipt: vi.fn() as never };
  mountApp(document.querySelector("main")!, { acquire, recent, historical, chainHead: async () => 1_234n, search: "", ...extra });
  return { acquire, body: document.body };
}

describe("the page", () => {
  it("choosing an example runs the check with that example's claim, and the stamp appears", async () => {
    const { acquire, body } = mount();
    fireEvent.click(body.querySelector('button[data-example="correct"]')!);
    await waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    expect((acquire as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toBe(EXAMPLES[0]!.claim.transactionHash);
    await waitFor(() => expect(body.querySelector(".stamp[data-verdict]:not(.small)")!.getAttribute("data-verdict")).toBe("VERIFIED"));
    expect(body.textContent).toMatch(/Supported by the chain: recipient, amount\./);
    expect(body.textContent).toMatch(/67,403,462/);
  });

  it("a link prefills the form and says so, but never runs by itself", () => {
    const { acquire, body } = mount({ search: `?tx=${HASH}&recipient=0xabc` });
    expect((getByLabelText(body, /transaction hash/i) as HTMLInputElement).value).toBe(HASH);
    expect((getByLabelText(body, /recipient/i) as HTMLInputElement).value).toBe("0xabc");
    expect(body.textContent).toMatch(/Nothing runs until you press Check payment/);
    expect(acquire).not.toHaveBeenCalled();
  });

  it("copies a link containing only the claim that was run", async () => {
    const copyText = vi.fn(async () => {});
    const { body } = mount({ copyText });
    fireEvent.change(getByLabelText(body, /transaction hash/i), { target: { value: HASH } });
    fireEvent.click(getByRole(body, "button", { name: /check payment/i }));
    await waitFor(() => getByRole(body, "button", { name: /copy link/i }));
    fireEvent.click(getByRole(body, "button", { name: /copy link/i }));
    await waitFor(() => expect(copyText).toHaveBeenCalledTimes(1));
    expect((copyText.mock.calls[0] as unknown as [string])[0]).toContain(`?tx=${HASH}`);
    await waitFor(() => expect(body.textContent).toMatch(/Link copied/));
  });

  it("prints through the injected print function", async () => {
    const print = vi.fn();
    const { body } = mount({ print });
    fireEvent.change(getByLabelText(body, /transaction hash/i), { target: { value: HASH } });
    fireEvent.click(getByRole(body, "button", { name: /check payment/i }));
    await waitFor(() => getByRole(body, "button", { name: /print or save as pdf/i }));
    fireEvent.click(getByRole(body, "button", { name: /print or save as pdf/i }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("shows the chain head, and says plainly when the RPC does not answer", async () => {
    const up = mount();
    await waitFor(() => expect(up.body.querySelector(".chip")!.textContent).toMatch(/block 1,234/));
    const down = mount({ chainHead: async () => { throw new Error("down"); } });
    await waitFor(() => expect(down.body.querySelector(".chip")!.textContent).toMatch(/RPC not responding/));
    expect(down.body.querySelector(".chip")!.getAttribute("data-state")).toBe("down");
  });

  it("opens the claims disclosure when an invalid optional field blocks a submit", () => {
    const { body } = mount();
    fireEvent.change(getByLabelText(body, /transaction hash/i), { target: { value: HASH } });
    fireEvent.change(getByLabelText(body, /sender/i), { target: { value: "nope" } });
    const details = body.querySelector("details.claim-details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    fireEvent.click(getByRole(body, "button", { name: /check payment/i }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(getByLabelText(body, /sender/i));
  });
});
