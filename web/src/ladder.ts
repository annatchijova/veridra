import { breakable, el, replaceChildren } from "./ui.js";
import type { TierState } from "./verify.js";

export type Ladder = {
  element: HTMLElement;
  update(tier1: TierState | null, tier2: TierState | null, tier3: TierState | null): void;
};

type Rung = { name: string; note: string; state: "reached" | "checking" | "not-reached" | "planned" };

/**
 * The assurance progression itself, made visible. Only rungs this build can actually
 * produce are ever marked reached; the stronger planned rungs always read "not reached"
 * together with what is missing, so the ladder cannot imply assurance that does not exist.
 */
export function createLadder(): Ladder {
  const list = el("ol", { class: "ladder" });
  const element = el(
    "section",
    { class: "ladder-section", "aria-labelledby": "ladder-heading" },
    el("h2", { id: "ladder-heading", class: "eyebrow" }, "Assurance ladder"),
    el("p", { class: "hint" }, "How strongly the evidence is authenticated. Only rungs this build can produce are ever lit."),
    list,
  );

  const stateOf = (state: TierState | null): Rung["state"] => {
    if (state === null) return "not-reached";
    switch (state.status) {
      case "checking":
        return "checking";
      case "result":
        return state.verdict === "INSUFFICIENT_EVIDENCE" ? "not-reached" : "reached";
      default:
        return "not-reached";
    }
  };

  const status = (state: TierState | null): string => {
    if (state === null) return "not run yet";
    switch (state.status) {
      case "checking":
        return "checking…";
      case "result":
        return state.verdict === "INSUFFICIENT_EVIDENCE"
          ? "not reached — the evidence was not sufficient"
          : "reached by this check";
      case "unavailable":
        return "not reached — unavailable for this transaction";
      case "error":
        return "not reached — the request failed";
      case "rejected":
        return "not reached — rejected";
    }
  };

  return {
    element,
    update(tier1, tier2, tier3) {
      const rungs: Rung[] = [
        { name: "RPC_ATTESTED", note: status(tier1), state: stateOf(tier1) },
        { name: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED", note: status(tier2), state: stateOf(tier2) },
        { name: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED", note: status(tier3), state: stateOf(tier3) },
        {
          name: "RECENT_BLOCKHASH_PROOF",
          note: "planned, not reached — needs the verifier's answer to be authenticated, not just reported by the RPC",
          state: "planned",
        },
        { name: "PERSISTENT_ROOT_PROOF", note: "planned, not reached", state: "planned" },
      ];
      replaceChildren(
        list,
        ...rungs.map((rung) =>
          el(
            "li",
            { "data-state": rung.state },
            el("span", { class: "rung-name mono" }, ...breakable(rung.name)),
            el("span", { class: "dash", "aria-hidden": "true" }, " — "),
            el("span", { class: "rung-note" }, rung.note),
          ),
        ),
      );
    },
  };
}
