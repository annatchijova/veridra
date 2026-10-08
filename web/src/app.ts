import { createClaimForm } from "./claimForm.js";
import { createLadder } from "./ladder.js";
import { createTierCard } from "./resultCard.js";
import { createReverifySection } from "./reverify.js";
import { el } from "./ui.js";
import {
  buildClaim,
  checkHistoricalInclusion,
  checkRecentInclusion,
  checkRpcAttested,
  type Acquire,
  type ClaimInput,
  type HistoricalDeps,
  type RecentDeps,
  type ReverifyDeps,
  type TierState,
} from "./verify.js";

export type AppDeps = { acquire?: Acquire; recent?: RecentDeps; historical?: HistoricalDeps; reverify?: ReverifyDeps };

export function mountApp(main: HTMLElement, deps: AppDeps = {}): void {
  const form = createClaimForm(run);
  const tier1 = createTierCard("Evidence tier 1 — RPC_ATTESTED", "Checking… reading the transaction and its receipt from the RPC.");
  const tier2 = createTierCard(
    "Evidence tier 2 — RPC_REPORTED_RECENT_INCLUSION_ACCEPTED",
    "Checking… fetching block data and asking the on-chain verifier.",
  );
  const tier3 = createTierCard(
    "Evidence tier 3 — RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED",
    "Checking… looking for a checkpoint of this block, then asking the on-chain verifier.",
  );
  const ladder = createLadder();
  const revealed = [tier1.element, tier2.element, tier3.element, ladder.element];
  for (const element of revealed) element.hidden = true;

  const results = el("div", { id: "results", "aria-live": "polite" }, tier1.element, tier2.element, tier3.element);

  let currentRun = 0;

  async function run(input: ClaimInput): Promise<void> {
    const claim = buildClaim(input);
    const runId = ++currentRun;
    const states: { one: TierState | null; two: TierState | null; three: TierState | null } = {
      one: { status: "checking" },
      two: { status: "checking" },
      three: { status: "checking" },
    };
    const render = () => {
      if (runId !== currentRun) return;
      ladder.update(states.one, states.two, states.three);
    };

    form.setBusy(true);
    results.setAttribute("aria-busy", "true");
    for (const element of revealed) element.hidden = false;
    tier1.update(states.one!);
    tier2.update(states.two!);
    tier3.update(states.three!);
    render();

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
  }

  main.append(
    el(
      "p",
      {},
      "Paste a transaction hash and whatever the buyer claims about it. Veridra reports which claimed facts the chain data supports. It reads only; it never asks for a wallet.",
    ),
    form.element,
    results,
    ladder.element,
    createReverifySection(deps.reverify),
  );
}
