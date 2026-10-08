import { InsufficientEvidenceError } from "@veridra/monad-rpc";
import "@testing-library/dom";
import { fireEvent, getByRole, getByLabelText, queryByRole, waitFor } from "@testing-library/dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mountApp } from "./app.js";
import { translateTierError } from "./errorMessages.js";
import type { Acquire, HistoricalDeps, RecentDeps, ReverifyDeps } from "./verify.js";

const HASH = `0x${"ab".repeat(32)}`;
const SENDER = "0x1111111111111111111111111111111111111111";
const RECIPIENT = "0x2222222222222222222222222222222222222222";
const ZERO = "0x0000000000000000000000000000000000000000";

const evidence = (overrides: Record<string, unknown> = {}) => ({
  available: true,
  transactionHash: HASH,
  chainId: 10_143n,
  blockNumber: 100n,
  blockHash: `0x${"cd".repeat(32)}`,
  successful: true,
  sender: SENDER,
  recipient: RECIPIENT,
  asset: ZERO,
  amount: 5n,
  transactionPayloadDigest: `0x${"01".repeat(32)}`,
  receiptPayloadDigest: `0x${"02".repeat(32)}`,
  logsDigest: `0x${"03".repeat(32)}`,
  finalityPolicyId: `0x${"04".repeat(32)}`,
  requiredConfirmations: 1n,
  observedConfirmations: 3n,
  ...overrides,
});

const acquiring = (overrides?: Record<string, unknown>): Acquire =>
  (async () => ({ providerId: `0x${"05".repeat(32)}`, observedAt: 1n, evidence: evidence(overrides) })) as unknown as Acquire;

const notMined: RecentDeps = {
  locate: async () => ({ blockNumber: null, head: 0n }),
  acquireProof: vi.fn() as unknown as RecentDeps["acquireProof"],
  createReceipt: vi.fn() as unknown as RecentDeps["createReceipt"],
};

const notCheckpointed: HistoricalDeps = {
  locate: notMined.locate,
  checkpointedHash: async () => null,
  acquireProof: vi.fn() as unknown as HistoricalDeps["acquireProof"],
  createReceipt: vi.fn() as unknown as HistoricalDeps["createReceipt"],
};

function setup(acquire: Acquire, recent: RecentDeps = notMined, historical: HistoricalDeps = notCheckpointed, reverify?: ReverifyDeps) {
  document.body.innerHTML = "<main></main>";
  mountApp(document.querySelector("main")!, { acquire, recent, historical, chainHead: async () => 1_000n, search: "", ...(reverify ? { reverify } : {}) });
  const body = document.body;
  return {
    field: (label: RegExp) => getByLabelText(body, label) as HTMLInputElement,
    submit: () => fireEvent.click(getByRole(body, "button", { name: /check payment/i })),
    body,
  };
}

describe("claim form", () => {
  let ui: ReturnType<typeof setup>;
  beforeEach(() => {
    ui = setup(vi.fn() as unknown as Acquire);
  });

  it("validates the hash on blur, wires aria-invalid, and keeps what was typed", () => {
    const hash = ui.field(/transaction hash/i);
    fireEvent.change(hash, { target: { value: "0x123" } });
    expect(hash.getAttribute("aria-invalid")).toBeNull();
    fireEvent.blur(hash);
    expect(hash.getAttribute("aria-invalid")).toBe("true");
    expect(hash.value).toBe("0x123");
    const describedBy = hash.getAttribute("aria-describedby")!.split(" ");
    const text = describedBy.map((id) => document.getElementById(id)!.textContent).join(" ");
    expect(text).toMatch(/64 hex characters/);
  });

  it("does not call the network when submit is invalid, and focuses the first bad field", () => {
    const acquire = vi.fn();
    ui = setup(acquire as unknown as Acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    fireEvent.change(ui.field(/sender/i), { target: { value: "nope" } });
    fireEvent.change(ui.field(/amount/i), { target: { value: "1.5" } });
    ui.submit();
    expect(acquire).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(ui.field(/sender/i));
    expect(ui.field(/amount/i).getAttribute("aria-invalid")).toBe("true");
    expect(ui.field(/amount/i).value).toBe("1.5");
  });
});

describe("paste hash → see result", () => {
  it("VERIFIED with only the asserted fields checked; the rest ABSTAIN", async () => {
    const ui = setup(acquiring());
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    fireEvent.change(ui.field(/recipient/i), { target: { value: RECIPIENT } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: VERIFIED/));
    const row = (name: string) => getByRole(ui.body, "row", { name: new RegExp(`^${name}\\b`) });
    expect(row("recipient").textContent).toContain("PASS");
    expect(row("sender").textContent).toContain("ABSTAIN");
    expect(row("amount").textContent).toContain("ABSTAIN");
    expect(ui.body.textContent).toMatch(/RPC_ATTESTED/);
    expect(ui.body.textContent).toMatch(/Confirmations: 3 observed, 1 required/);
    expect(getByRole(ui.body, "link", { name: /explorer/i }).getAttribute("href")).toContain(HASH);
  });

  it("NOT_VERIFIED when an asserted field contradicts the chain; the failing check is named", async () => {
    const ui = setup(acquiring());
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    fireEvent.change(ui.field(/amount/i), { target: { value: "999" } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: NOT_VERIFIED/));
    expect(getByRole(ui.body, "row", { name: /^amount\b/ }).textContent).toContain("FAIL");
  });

  it("INSUFFICIENT_EVIDENCE below the confirmation threshold shows every check as ABSTAIN", async () => {
    const ui = setup(acquiring({ observedConfirmations: 0n }));
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: INSUFFICIENT_EVIDENCE/));
    expect(ui.body.textContent).toMatch(/Not enough yet/);
    expect(queryByRole(ui.body, "cell", { name: "PASS" })).toBeNull();
    expect(queryByRole(ui.body, "cell", { name: "FAIL" })).toBeNull();
  });

  it("shows a designed absence as 'Unavailable', not as an error, and never leaks library text", async () => {
    const acquire = (async () => {
      throw new InsufficientEvidenceError("Transaction or receipt is not available");
    }) as unknown as Acquire;
    const ui = setup(acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Unavailable — No mined transaction/));
    expect(ui.body.textContent).not.toMatch(/receipt is not available/);
  });

  it("shows a failed request as a retryable error, keeps the entered values, and re-enables the button", async () => {
    const acquire = (async () => {
      throw new InsufficientEvidenceError("RPC request failed for eth_chainId");
    }) as unknown as Acquire;
    const ui = setup(acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    fireEvent.change(ui.field(/recipient/i), { target: { value: RECIPIENT } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Try again/));
    expect(ui.field(/recipient/i).value).toBe(RECIPIENT);
    await waitFor(() => expect(getByRole(ui.body, "button", { name: /check payment/i }).getAttribute("aria-disabled")).toBeNull());
  });

  it("shows checking… while in flight and disables the button against duplicate submission", async () => {
    let release!: () => void;
    const acquire = (() =>
      new Promise((resolve) => {
        release = () => resolve({ providerId: `0x${"05".repeat(32)}`, observedAt: 1n, evidence: evidence() });
      })) as unknown as Acquire;
    const ui = setup(acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Checking… reading/));
    expect(getByRole(ui.body, "button", { name: /checking/i }).getAttribute("aria-disabled")).toBe("true");
    release();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: VERIFIED/));
  });
});

const parsedReceipt = (verdict: string, checks: [string, string][]) =>
  ({
    serialized: `{"mock":"${verdict}"}`,
    receipt: {
      verdict,
      checks: checks.map(([name, status]) => ({ name, status })),
      paymentFact: { sender: SENDER },
      checkpointAddress: ZERO,
      proof: { transactionHash: HASH },
    },
  }) as unknown as Awaited<ReturnType<RecentDeps["createReceipt"]>> & Awaited<ReturnType<HistoricalDeps["createReceipt"]>>;

const ALL = ["transactionHash", "chainId", "execution", "sender", "recipient", "asset", "amount"];
const rowsOf = (overrides: Record<string, string> = {}): [string, string][] =>
  ALL.map((name) => [name, overrides[name] ?? (["sender", "recipient", "asset", "amount"].includes(name) ? "ABSTAIN" : "PASS")]);

function recentDeps(distance: bigint, createReceipt: RecentDeps["createReceipt"]) {
  const acquireProof = vi.fn(async () => ({}) as never);
  const deps: RecentDeps = {
    locate: async () => ({ blockNumber: 1_000n, head: 1_000n + distance }),
    acquireProof: acquireProof as unknown as RecentDeps["acquireProof"],
    createReceipt,
  };
  return { deps, acquireProof };
}

async function runCheck(ui: ReturnType<typeof setup>) {
  fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
  ui.submit();
  await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: /));
}

describe("tier 2 — recent inclusion", () => {
  it("shows its own verdict under its real name, never as RECENT_BLOCKHASH_PROOF", async () => {
    const { deps } = recentDeps(10n, async () => parsedReceipt("VERIFIED", rowsOf()));
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/Evidence assurance: RPC_REPORTED_RECENT_INCLUSION_ACCEPTED/));
    expect(ui.body.textContent).toMatch(/not independently authenticated/);
    expect(ui.body.textContent).not.toMatch(/Evidence assurance: RECENT_BLOCKHASH_PROOF/);
  });

  it("does not attempt the proof when the block is outside the 256-block window", async () => {
    const { deps, acquireProof } = recentDeps(257n, async () => parsedReceipt("VERIFIED", rowsOf()));
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/outside the latest 256 blocks/));
    expect(acquireProof).not.toHaveBeenCalled();
  });

  it("still attempts it at exactly 256 blocks of distance (window boundary)", async () => {
    const { deps, acquireProof } = recentDeps(256n, async () => parsedReceipt("VERIFIED", rowsOf()));
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(acquireProof).toHaveBeenCalledTimes(1));
  });

  it("a tier 2 failure never blanks the tier 1 result", async () => {
    const { deps } = recentDeps(10n, async () => {
      throw new Error("RPC request failed for debug_getRawBlock");
    });
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: VERIFIED/));
    expect(ui.body.textContent).toMatch(/Evidence assurance: RPC_ATTESTED/);
  });

  it("tier 2 can reach a different verdict than tier 1, each under its own label", async () => {
    const { deps } = recentDeps(10n, async () => parsedReceipt("NOT_VERIFIED", rowsOf({ amount: "FAIL" })));
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: NOT_VERIFIED/));
    expect(ui.body.textContent).toMatch(/Verdict: VERIFIED/);
  });

  it("ladder marks only reachable rungs as reached; planned rungs say what is missing", async () => {
    const { deps } = recentDeps(10n, async () => parsedReceipt("VERIFIED", rowsOf()));
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/RPC_REPORTED_RECENT_INCLUSION_ACCEPTED — reached by this check/));
    const text = ui.body.textContent ?? "";
    expect(text).toMatch(/RECENT_BLOCKHASH_PROOF — planned, not reached/);
    expect(text).toMatch(/PERSISTENT_ROOT_PROOF — planned, not reached/);
    expect(text).not.toMatch(/RECENT_BLOCKHASH_PROOF — reached/);
  });
});

describe("error translation", () => {
  const revert = (signature: string) => new Error(`The contract function "verifyRecentInclusion" reverted with the following signature: ${signature}`);
  it("maps verifier custom-error selectors to plain sentences without leaking names", async () => {
    const { toFunctionSelector } = await import("viem");
    const outside = translateTierError(revert(toFunctionSelector("BlockOutsideWindow(uint256,uint256)")));
    expect(outside.kind).toBe("unavailable");
    expect(outside.message).toMatch(/256 blocks/);
    const rejected = translateTierError(revert(toFunctionSelector("HeaderHashMismatch(bytes32,bytes32)")));
    expect(rejected.message).toMatch(/rejected/);
    for (const m of [outside.message, rejected.message]) expect(m).not.toMatch(/BlockOutsideWindow|HeaderHashMismatch|0x[0-9a-f]{8}/);
  });
  it("treats viem transport failures as retryable errors", () => {
    const failure = translateTierError(Object.assign(new Error("fetch failed"), { name: "HttpRequestError" }));
    expect(failure.kind).toBe("error");
  });
});

describe("adversarial review, UI-Level 2", () => {
  it("a transaction from another chain is reported as such, not as a wrong-RPC problem", () => {
    const failure = translateTierError(new InsufficientEvidenceError("Transaction chain ID does not match configured chain"));
    expect(failure.kind).toBe("unavailable");
    expect(failure.message).toMatch(/different chain/);
  });

  it("the ladder does not mark a rung reached when its evidence was insufficient", async () => {
    const ui = setup(acquiring({ observedConfirmations: 0n }));
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    ui.submit();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: INSUFFICIENT_EVIDENCE/));
    const text = ui.body.textContent ?? "";
    expect(text).not.toMatch(/RPC_ATTESTED — reached/);
    expect(text).toMatch(/RPC_ATTESTED — not reached/);
  });
});

function historicalDeps(opts: { checkpointed: boolean; distance?: bigint }) {
  const acquireProof = vi.fn(async () => ({}) as never);
  const deps: HistoricalDeps = {
    locate: async () => ({ blockNumber: 1_000n, head: 1_000n + (opts.distance ?? 5_000n) }),
    checkpointedHash: async () => (opts.checkpointed ? (`0x${"ee".repeat(32)}` as const) : null),
    acquireProof: acquireProof as unknown as HistoricalDeps["acquireProof"],
    createReceipt: async () => parsedReceipt("VERIFIED", rowsOf()),
  };
  return { deps, acquireProof };
}

describe("tier 3 — historical inclusion", () => {
  it("an old, checkpointed block is verified under its own name, while tier 2 stays unavailable", async () => {
    const { deps } = historicalDeps({ checkpointed: true });
    const ui = setup(acquiring(), recentDeps(5_000n, vi.fn() as never).deps, deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/Evidence assurance: RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED/));
    expect(ui.body.textContent).toMatch(/outside the latest 256 blocks/);
    expect(ui.body.textContent).toMatch(/RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED — reached by this check/);
  });

  it("a block nobody checkpointed is a designed absence, and the heavy proof fetch is skipped", async () => {
    const { deps, acquireProof } = historicalDeps({ checkpointed: false });
    const ui = setup(acquiring(), notMined, deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/No one has checkpointed this block/));
    expect(acquireProof).not.toHaveBeenCalled();
    expect(ui.body.textContent).toMatch(/RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED — not reached — unavailable/);
  });
});

describe("export", () => {
  it("downloads exactly the serialized receipt the result was built from", async () => {
    const created: Blob[] = [];
    const clicked: string[] = [];
    URL.createObjectURL = ((blob: Blob) => (created.push(blob), "blob:mock")) as typeof URL.createObjectURL;
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    try {
      const { deps } = historicalDeps({ checkpointed: true });
      const ui = setup(acquiring(), notMined, deps);
      await runCheck(ui);
      await waitFor(() => getByRole(ui.body, "button", { name: /export receipt/i }));
      fireEvent.click(getByRole(ui.body, "button", { name: /export receipt/i }));
      expect(created).toHaveLength(1);
      const body = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(created[0]!);
      });
      expect(body).toBe('{"mock":"VERIFIED"}');
      expect(clicked[0]).toMatch(/^veridra-receipt-historical-abababab\.json$/);
    } finally {
      HTMLAnchorElement.prototype.click = realClick;
    }
  });

  it("tier 1 has no export, because it carries no portable receipt", async () => {
    const ui = setup(acquiring());
    await runCheck(ui);
    expect(queryByRole(ui.body, "button", { name: /export receipt/i })).toBeNull();
  });
});

describe("reverify a receipt", () => {
  const reverifyWith = (deps: Partial<ReverifyDeps>): ReverifyDeps => ({
    verifyRecent: vi.fn() as never,
    verifyHistorical: vi.fn() as never,
    ...deps,
  });
  const claimJson = (format: string) => JSON.stringify({ format });

  function paste(ui: ReturnType<typeof setup>, text: string) {
    fireEvent.change(getByLabelText(ui.body, /receipt json/i), { target: { value: text } });
    fireEvent.click(getByRole(ui.body, "button", { name: /reverify receipt/i }));
  }

  it("rejects text that is not JSON, in plain words, without calling any verifier", async () => {
    const deps = reverifyWith({});
    const ui = setup(acquiring(), notMined, notCheckpointed, deps);
    paste(ui, "not json at all");
    await waitFor(() => expect(ui.body.textContent).toMatch(/Receipt rejected — This is not a receipt this page can read/));
    expect(deps.verifyRecent).not.toHaveBeenCalled();
    expect(deps.verifyHistorical).not.toHaveBeenCalled();
  });

  it("a receipt whose own contents disagree is rejected, not shown as unavailable or retryable", async () => {
    const { PortableReceiptError } = await import("@veridra/monad-rpc");
    const deps = reverifyWith({
      verifyRecent: async () => {
        throw new PortableReceiptError("Stored payment fact differs from raw proof values");
      },
    });
    const ui = setup(acquiring(), notMined, notCheckpointed, deps);
    // Shape check happens in the library parser; a parse failure is also a rejection.
    paste(ui, claimJson("veridra.portable-inclusion-receipt"));
    await waitFor(() => expect(ui.body.textContent).toMatch(/Receipt rejected/));
    expect(ui.body.textContent).not.toMatch(/Try again/);
  });
});

describe("receipt error translation", () => {
  it("separates a rejected receipt, an expired recent receipt, and a network failure", async () => {
    const { PortableReceiptError, PortableHistoricalReceiptError } = await import("@veridra/monad-rpc");
    const { translateReceiptError } = await import("./errorMessages.js");
    const { toFunctionSelector } = await import("viem");
    expect(translateReceiptError(new PortableReceiptError("Portable receipt deployment pin differs from the consumer's configured verifier")).kind).toBe("rejected");
    expect(translateReceiptError(new PortableHistoricalReceiptError("Stored checkpoint address differs from the pinned verifier's actual checkpoint")).kind).toBe("rejected");
    const expired = translateReceiptError(new Error(`reverted with the following signature: ${toFunctionSelector("BlockOutsideWindow(uint256,uint256)")}`));
    expect(expired.kind).toBe("unavailable");
    expect(expired.message).toMatch(/can't be rechecked anymore/);
    expect(translateReceiptError(Object.assign(new Error("x"), { name: "HttpRequestError" })).kind).toBe("error");
  });
});

describe("receipt error translation, adversarial review of UI-Level 3", () => {
  it("a proof the verifier refuses is a rejected receipt, never unavailable or retryable", async () => {
    const { HistoricalInclusionVerificationError, RecentInclusionVerificationError } = await import("@veridra/monad-rpc");
    const { translateReceiptError } = await import("./errorMessages.js");
    const { toFunctionSelector } = await import("viem");
    const refused = [
      new RecentInclusionVerificationError("Included transaction and receipt do not yield a supported payment fact"),
      new HistoricalInclusionVerificationError("Attached payment fact differs from the decoded included transaction and receipt"),
      new Error(`reverted with the following signature: ${toFunctionSelector("HeaderHashMismatch(bytes32,bytes32)")}`),
      new Error(`reverted with the following signature: ${toFunctionSelector("BlockNotCheckpointed(uint256)")}`),
    ];
    for (const error of refused) {
      const failure = translateReceiptError(error);
      expect(failure.kind).toBe("rejected");
      expect(failure.message).not.toMatch(/try again/i);
    }
  });

  it("environment problems with the verifier stay errors, not a verdict on the receipt", async () => {
    const { RecentInclusionVerificationError } = await import("@veridra/monad-rpc");
    const { translateReceiptError } = await import("./errorMessages.js");
    const failure = translateReceiptError(new RecentInclusionVerificationError("Verifier runtime code hash does not match the deployment pin"));
    expect(failure.kind).toBe("error");
  });
});

describe("integral review regressions", () => {
  it("keeps keyboard focus on the submit button while and after a check (never uses `disabled`)", async () => {
    let release!: () => void;
    const acquire = (() =>
      new Promise((resolve) => {
        release = () => resolve({ providerId: `0x${"05".repeat(32)}`, observedAt: 1n, evidence: evidence() });
      })) as unknown as Acquire;
    const ui = setup(acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    const button = getByRole(ui.body, "button", { name: /check payment/i }) as HTMLButtonElement;
    button.focus();
    fireEvent.click(button);
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBe("true"));
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(document.activeElement).toBe(button);
    release();
    await waitFor(() => expect(button.getAttribute("aria-disabled")).toBeNull());
    expect(document.activeElement).toBe(button);
  });

  it("ignores a second submit while a check is in flight", async () => {
    let release!: () => void;
    const acquire = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ providerId: `0x${"05".repeat(32)}`, observedAt: 1n, evidence: evidence() });
        }),
    );
    const ui = setup(acquire as unknown as Acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    ui.submit();
    await waitFor(() => expect(acquire).toHaveBeenCalledTimes(1));
    fireEvent.submit(document.querySelector("form[aria-label='Payment claim']")!);
    fireEvent.submit(document.querySelector("form[aria-label='Payment claim']")!);
    expect(acquire).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(ui.body.textContent).toMatch(/Verdict: VERIFIED/));
  });

  it("announces which fields blocked a submit in one alert, and checks nothing", () => {
    const acquire = vi.fn();
    const ui = setup(acquire as unknown as Acquire);
    fireEvent.change(ui.field(/transaction hash/i), { target: { value: HASH } });
    fireEvent.change(ui.field(/sender/i), { target: { value: "nope" } });
    fireEvent.change(ui.field(/amount/i), { target: { value: "1.5" } });
    ui.submit();
    const alert = getByRole(ui.body, "alert");
    expect(alert.textContent).toMatch(/Nothing was checked/);
    expect(alert.textContent).toMatch(/Sender/);
    expect(alert.textContent).toMatch(/Amount in base units/);
    expect(acquire).not.toHaveBeenCalled();
    fireEvent.change(ui.field(/sender/i), { target: { value: "" } });
    fireEvent.change(ui.field(/amount/i), { target: { value: "" } });
    ui.submit();
    expect(getByRole(ui.body, "alert", { hidden: true }).textContent).toBe("");
  });

  it("the reverification card is a level-3 heading under its level-2 section", () => {
    const ui = setup(acquiring());
    const section = getByRole(ui.body, "heading", { name: "Reverify a receipt", level: 2 });
    const card = getByRole(ui.body, "heading", { name: "Reverification result", level: 3, hidden: true });
    expect(section).toBeTruthy();
    expect(card).toBeTruthy();
  });
});

describe("receipt error translation, tampered proof structure (integral review F6)", () => {
  it("a library structural mismatch and an unmapped contract revert are both rejections, not environment problems", async () => {
    const { PortableHistoricalReceiptError } = await import("@veridra/monad-rpc");
    const { translateReceiptError } = await import("./errorMessages.js");
    const structural = translateReceiptError(new PortableHistoricalReceiptError("Transaction root does not match its first proof node"));
    const unmappedRevert = translateReceiptError(
      new Error('The contract function "verifyHistoricalInclusion" reverted with the following signature:\n0xdeadbeef'),
    );
    for (const failure of [structural, unmappedRevert]) {
      expect(failure.kind).toBe("rejected");
      expect(failure.message).not.toMatch(/try again|could not be read in a form/i);
    }
  });

  it("network failures and a different deployed verifier stay retryable errors", async () => {
    const { RecentInclusionVerificationError } = await import("@veridra/monad-rpc");
    const { translateReceiptError } = await import("./errorMessages.js");
    expect(translateReceiptError(Object.assign(new Error("x"), { name: "TimeoutError" })).kind).toBe("error");
    expect(translateReceiptError(new RecentInclusionVerificationError("Verifier runtime code hash does not match the deployment pin")).kind).toBe("error");
  });
});

describe("tier disagreement notice (integral review F7)", () => {
  it("warns, in words, when two tiers reach opposite verdicts", async () => {
    const { deps } = recentDeps(10n, async () => parsedReceipt("NOT_VERIFIED", rowsOf({ amount: "FAIL" })));
    const ui = setup(acquiring(), deps);
    await runCheck(ui);
    await waitFor(() => expect(ui.body.textContent).toMatch(/The evidence tiers disagree/));
    expect(ui.body.textContent).toMatch(/tier 1: VERIFIED; tier 2: NOT_VERIFIED/);
  });

  it("stays silent when tiers agree, and when one tier has only insufficient evidence", async () => {
    const { deps } = recentDeps(10n, async () => parsedReceipt("VERIFIED", rowsOf()));
    const agree = setup(acquiring(), deps);
    await runCheck(agree);
    await waitFor(() => expect(agree.body.textContent).toMatch(/RPC_REPORTED_RECENT_INCLUSION_ACCEPTED — reached/));
    expect(agree.body.textContent).not.toMatch(/disagree/);

    const insufficient = setup(acquiring({ observedConfirmations: 0n }), recentDeps(10n, async () => parsedReceipt("NOT_VERIFIED", rowsOf({ amount: "FAIL" }))).deps);
    await runCheck(insufficient);
    await waitFor(() => expect(insufficient.body.textContent).toMatch(/Verdict: NOT_VERIFIED/));
    expect(insufficient.body.textContent).not.toMatch(/disagree/);
  });
});

describe("hostile strings are rendered as text, never as DOM (integral review)", () => {
  it("a markup payload in raw evidence, a claim summary line, or a failure message creates no elements", async () => {
    const { createTierCard } = await import("./resultCard.js");
    const payload = '<img src=x onerror="window.__pwned=1"><script>window.__pwned=1</script>';
    const card = createTierCard("t", "checking");
    document.body.innerHTML = "";
    document.body.append(card.element);
    card.update({
      status: "result",
      assurance: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED",
      verdict: "VERIFIED",
      checks: [{ name: "transactionHash", status: "PASS" }] as never,
      transactionHash: HASH as `0x${string}`,
      rawEvidence: { note: payload },
      claimSummary: [payload],
    });
    expect(document.querySelectorAll("img, script").length).toBe(0);
    expect(card.element.textContent).toContain("<img src=x");
    card.update({ status: "rejected", message: payload });
    expect(document.querySelectorAll("img, script").length).toBe(0);
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });
});

describe("deterministic size limits are not retryable (integral review F10)", () => {
  it("an over-limit transaction is a designed absence that says retrying will not help", async () => {
    const { MptProofInputError } = await import("@veridra/monad-rpc");
    const failure = translateTierError(new MptProofInputError("Entry 1 exceeds 8192 bytes"));
    expect(failure.kind).toBe("unavailable");
    expect(failure.message).toMatch(/Retrying will not change that/);
    expect(failure.message).not.toMatch(/Try again|8192/);
  });

  it("in a receipt context the same limit is a rejection", async () => {
    const { MptProofInputError } = await import("@veridra/monad-rpc");
    const { translateReceiptError } = await import("./errorMessages.js");
    expect(translateReceiptError(new MptProofInputError("Entry 1 exceeds 8192 bytes")).kind).toBe("rejected");
  });
});
