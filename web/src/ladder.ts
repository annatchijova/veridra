import { el, replaceChildren } from "./ui.js";
import type { TierState } from "./verify.js";

export type Ladder = {
  element: HTMLElement;
  update(tier1: TierState | null, tier2: TierState | null, tier3: TierState | null): void;
};

type Rung = { name: string; note: string };

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
    el("h2", { id: "ladder-heading" }, "Assurance ladder"),
    list,
  );

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
        { name: "RPC_ATTESTED", note: status(tier1) },
        { name: "RPC_REPORTED_RECENT_INCLUSION_ACCEPTED", note: status(tier2) },
        { name: "RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED", note: status(tier3) },
        {
          name: "RECENT_BLOCKHASH_PROOF",
          note: "planned, not reached — needs the verifier's answer to be authenticated, not just reported by the RPC",
        },
        { name: "PERSISTENT_ROOT_PROOF", note: "planned, not reached" },
      ];
      replaceChildren(
        list,
        ...rungs.map((rung) => el("li", {}, el("span", { class: "mono" }, rung.name), ` — ${rung.note}`)),
      );
    },
  };
}
