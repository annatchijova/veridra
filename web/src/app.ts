import { publicClient } from "./chain.js";
import { createChainChip } from "./chainStatus.js";
import { createClaimForm } from "./claimForm.js";
import { createExamples } from "./examples.js";
import { createLadder } from "./ladder.js";
import { buildSearch, readClaimFromSearch } from "./permalink.js";
import { createTierCard } from "./resultCard.js";
import { createReverifySection } from "./reverify.js";
import { createSheet } from "./sheet.js";
import { summarize } from "./summary.js";
import { el } from "./ui.js";
import {
  buildClaim,
  checkHistoricalInclusion,
  checkRecentInclusion,
  checkRpcAttested,
  tierDisagreement,
  type Acquire,
  type ClaimInput,
  type HistoricalDeps,
  type RecentDeps,
  type ReverifyDeps,
  type TierState,
} from "./verify.js";

export type AppDeps = {
  acquire?: Acquire;
  recent?: RecentDeps;
  historical?: HistoricalDeps;
  reverify?: ReverifyDeps;
  /** The current chain head, for the status chip. Injected so tests never touch the network. */
  chainHead?: () => Promise<bigint>;
  now?: () => Date;
  copyText?: (text: string) => Promise<void>;
  print?: () => void;
  /** The query string to prefill from; defaults to the page's own. */
  search?: string;
};

const REPO_URL = "https://github.com/annatchijova/veridra";

export function mountApp(main: HTMLElement, deps: AppDeps = {}): void {
  const now = deps.now ?? (() => new Date());
  const form = createClaimForm(run);
  const chip = createChainChip(deps.chainHead ?? (() => publicClient.getBlockNumber()));

  let lastInput: ClaimInput | null = null;
  const copyLink = async (): Promise<boolean> => {
    if (lastInput === null) return false;
    const link = `${window.location.origin}${window.location.pathname}${buildSearch(lastInput)}`;
    try {
      await (deps.copyText ?? ((text) => navigator.clipboard.writeText(text)))(link);
      return true;
    } catch {
      return false;
    }
  };
  const sheet = createSheet({ copyLink, print: deps.print ?? (() => window.print()) });

  const tier1 = createTierCard("Evidence tier 1 — RPC_ATTESTED", "Checking… reading the transaction and its receipt from the RPC.", 3);
  const tier2 = createTierCard(
    "Evidence tier 2 — RPC_REPORTED_RECENT_INCLUSION_ACCEPTED",
    "Checking… fetching block data and asking the on-chain verifier.",
    3,
  );
  const tier3 = createTierCard(
    "Evidence tier 3 — RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED",
    "Checking… looking for a checkpoint of this block, then asking the on-chain verifier.",
    3,
  );
  const ladder = createLadder();
  const notice = el("p", { class: "notice", id: "tier-notice" });
  const results = el("div", { id: "results", "aria-live": "polite" }, notice, tier1.element, tier2.element, tier3.element);
  const evidence = el("section", { class: "paper evidence", "aria-labelledby": "evidence-heading" }, el("h2", { id: "evidence-heading", class: "eyebrow" }, "Evidence by tier"), results);

  const revealed = [sheet.element, evidence, ladder.element, tier1.element, tier2.element, tier3.element];
  for (const element of revealed) element.hidden = true;

  const examples = createExamples((claim) => {
    form.fill(claim);
    form.submit();
  });

  const fromLink = readClaimFromSearch(deps.search ?? window.location.search);
  const linkNote = el("p", { class: "hint", role: "status" });
  if (fromLink !== null) {
    form.fill(fromLink);
    linkNote.textContent = "Loaded from a link. Nothing runs until you press Check payment.";
  }

  let currentRun = 0;

  async function run(input: ClaimInput): Promise<void> {
    const claim = buildClaim(input);
    const runId = ++currentRun;
    lastInput = input;
    window.history.replaceState(null, "", buildSearch(input));
    linkNote.textContent = "";
    const checkedAt = now();
    const states: { one: TierState | null; two: TierState | null; three: TierState | null } = {
      one: { status: "checking" },
      two: { status: "checking" },
      three: { status: "checking" },
    };
    const render = () => {
      if (runId !== currentRun) return;
      ladder.update(states.one, states.two, states.three);
      notice.textContent =
        tierDisagreement([
          { label: "tier 1", state: states.one },
          { label: "tier 2", state: states.two },
          { label: "tier 3", state: states.three },
        ]) ?? "";
      sheet.update(summarize(states), {
        transactionHash: claim.transactionHash,
        checkedAt,
        blockNumber: states.one?.status === "result" ? states.one.blockNumber : undefined,
      });
    };

    form.setBusy(true);
    results.setAttribute("aria-busy", "true");
    for (const element of revealed) element.hidden = false;
    tier1.update(states.one!);
    tier2.update(states.two!);
    tier3.update(states.three!);
    render();
    // The report sits below the hero; without this a click on an example would appear to do nothing.
    const reduced = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    sheet.element.scrollIntoView?.({ behavior: reduced ? "auto" : "smooth", block: "start" });

    // Each tier settles on its own: one failing or finishing late never blanks the other.
    await Promise.all([
      checkRpcAttested(claim, deps.acquire).then((state) => {
        if (runId !== currentRun) return;
        states.one = state;
        tier1.update(state);
        render();
      }),
      checkRecentInclusion(input, deps.recent).then((state) => {
        if (runId !== currentRun) return;
        states.two = state;
        tier2.update(state);
        render();
      }),
      checkHistoricalInclusion(input, deps.historical).then((state) => {
        if (runId !== currentRun) return;
        states.three = state;
        tier3.update(state);
        render();
      }),
    ]);
    if (runId !== currentRun) return;
    results.setAttribute("aria-busy", "false");
    form.setBusy(false);
    void chip.refresh();
  }

  const outcome = (verdict: string, label: string, text: string) =>
    el("li", {}, el("p", { class: "stamp small", "data-verdict": verdict }, label), el("p", { class: "outcome-text" }, text));
  const outcomes = el(
    "section",
    { class: "outcomes", "aria-labelledby": "outcomes-heading" },
    el("h2", { id: "outcomes-heading", class: "eyebrow" }, "Three possible answers"),
    el(
      "ul",
      {},
      outcome("VERIFIED", "Verified", "Every fact you asserted matches the evidence."),
      outcome("NOT_VERIFIED", "Not verified", "At least one asserted fact contradicts the evidence."),
      outcome("INSUFFICIENT_EVIDENCE", "Insufficient evidence", "The evidence is missing, or not confirmed enough, to judge."),
    ),
    el(
      "p",
      { class: "hint" },
      "A fact you don't assert is shown as ABSTAIN: not checked, and not a pass. A ledger fact is not proof of wallet ownership, legal settlement or delivery.",
    ),
  );

  const masthead = el(
    "header",
    { class: "masthead" },
    el("p", { class: "brand" }, el("img", { src: "/favicon.svg", alt: "", width: "28", height: "28" }), el("span", {}, "Veridra")),
    chip.element,
  );

  const hero = el(
    "section",
    { class: "hero", "aria-labelledby": "hero-heading" },
    el(
      "div",
      { class: "hero-main" },
      el("h1", { id: "hero-heading" }, "Did this payment really happen?"),
      el(
        "p",
        { class: "lede" },
        "Paste a transaction hash and what the buyer says about it. Veridra shows which of those facts the chain supports, which it contradicts, and what it couldn't establish.",
      ),
      form.element,
      linkNote,
      examples,
      el("p", { class: "fine" }, "Read-only: no wallet, no signing. The transaction hash you enter is sent to the public Monad testnet RPC (testnet-rpc.monad.xyz)."),
    ),
    outcomes,
  );

  const footer = el(
    "footer",
    { class: "colophon" },
    el("p", {}, "Veridra · Apache-2.0 · ", el("a", { href: REPO_URL, target: "_blank", rel: "noopener noreferrer" }, "Source and design notes")),
  );

  main.replaceChildren(
    masthead,
    hero,
    el("div", { class: "stage" }, el("div", { class: "stage-main" }, sheet.element, evidence), el("aside", { class: "rail" }, ladder.element)),
    createReverifySection(deps.reverify),
    footer,
  );

  void chip.refresh();
}
