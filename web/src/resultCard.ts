import { EXPLORER_TX_URL, MONAD_TESTNET_RPC_URL } from "./chain.js";
import { downloadReceipt } from "./receiptExport.js";
import { el, replaceChildren, stringifyEvidence } from "./ui.js";
import type { Assurance, TierState } from "./verify.js";

export type TierCard = {
  element: HTMLElement;
  update(state: TierState): void;
};

const RPC_HOST = new URL(MONAD_TESTNET_RPC_URL).host;

const SCOPE: Record<Assurance, string> = {
  RPC_ATTESTED: `Relative to data read from ${RPC_HOST}. That RPC did not cryptographically sign it, and a ledger fact is not proof of wallet ownership, legal settlement or delivery.`,
  RPC_REPORTED_RECENT_INCLUSION_ACCEPTED: `The transaction's inclusion in a recent block was accepted by the pinned on-chain verifier, but the verifier's answer was itself delivered by ${RPC_HOST} and is not independently authenticated. A ledger fact is not proof of wallet ownership, legal settlement or delivery.`,
  RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED: `The transaction's inclusion was accepted by the pinned on-chain verifier against a checkpoint someone recorded earlier. That checkpoint is only as honest as whoever recorded it, and the verifier's answer was itself delivered by ${RPC_HOST} and is not independently authenticated. A ledger fact is not proof of wallet ownership, legal settlement or delivery.`,
};

const EXPORT_NOTE: Record<Assurance, string> = {
  RPC_ATTESTED: "",
  RPC_REPORTED_RECENT_INCLUSION_ACCEPTED:
    "Anyone can re-verify this file below, but only while its block is still inside the 256-block window.",
  RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED: "Anyone can re-verify this file below, at any later time.",
};

/** One evidence tier. Its slot exists from the start so the page never reflows as results land. */
export function createTierCard(title: string, checkingText: string, headingLevel: 2 | 3 = 2): TierCard {
  const headingId = `tier-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const heading = el(headingLevel === 2 ? "h2" : "h3", { id: headingId }, title);
  const body = el("div", { class: "tier-body" });
  const element = el("section", { class: "tier", "aria-labelledby": headingId }, heading, body);

  return {
    element,
    update(state) {
      replaceChildren(body, ...render(state, checkingText));
    },
  };
}

function render(state: TierState, checkingText: string): Node[] {
  switch (state.status) {
    case "checking":
      return [el("p", { class: "state" }, checkingText)];
    case "unavailable":
      return [el("p", { class: "state" }, `Unavailable — ${state.message}`)];
    case "error":
      return [el("p", { class: "state state-error" }, state.message)];
    case "rejected":
      return [el("p", { class: "state state-error" }, el("strong", {}, "Receipt rejected — "), state.message)];
    case "result":
      return renderResult(state);
  }
}

function renderResult(state: Extract<TierState, { status: "result" }>): Node[] {
  const rows = state.checks.map((check) =>
    el(
      "tr",
      {},
      el("th", { scope: "row" }, check.name),
      el("td", { class: `check check-${check.status}` }, check.status),
    ),
  );
  const nodes: Node[] = [
    el("p", { class: `verdict verdict-${state.verdict}` }, "Verdict: ", el("strong", {}, state.verdict)),
    el("p", {}, "Evidence assurance: ", el("strong", { class: "mono" }, state.assurance)),
    el("p", { class: "hint" }, SCOPE[state.assurance]),
  ];
  if (state.claimSummary !== undefined) {
    nodes.push(
      el("p", {}, "Claim asserted by this receipt:"),
      el("ul", { class: "mono" }, ...state.claimSummary.map((line) => el("li", {}, line))),
      el("p", { class: "hint" }, "The verdict shown here was recomputed from the receipt's own proof. It is not the verdict the receipt declares."),
    );
  }
  if (state.confirmations !== undefined) {
    nodes.push(
      el(
        "p",
        {},
        `Confirmations: ${state.confirmations.observed} observed, ${state.confirmations.required} required by this check. `,
        state.verdict === "INSUFFICIENT_EVIDENCE"
          ? "Not enough yet, so nothing was checked against the claim."
          : "A block with few confirmations can still be reorganized.",
      ),
    );
  }
  nodes.push(
    el(
      "table",
      {},
      el("caption", {}, "Checks"),
      el("thead", {}, el("tr", {}, el("th", { scope: "col" }, "Check"), el("th", { scope: "col" }, "Result"))),
      el("tbody", {}, ...rows),
    ),
    el("p", { class: "hint" }, "ABSTAIN means the field was not asserted, so it was not checked."),
    el(
      "p",
      {},
      el(
        "a",
        { href: `${EXPLORER_TX_URL}${state.transactionHash}`, target: "_blank", rel: "noopener noreferrer" },
        "View this transaction on the Monad testnet explorer",
      ),
    ),
    el("details", {}, el("summary", {}, "View raw evidence"), el("pre", { class: "mono" }, stringifyEvidence(state.rawEvidence))),
  );
  const serialized = state.serializedReceipt;
  if (serialized !== undefined) {
    const button = el("button", { type: "button", class: "secondary" }, "Export receipt (JSON)");
    button.addEventListener("click", () => downloadReceipt(serialized, state.transactionHash, state.assurance));
    nodes.push(el("p", {}, button), el("p", { class: "hint" }, EXPORT_NOTE[state.assurance]));
  }
  return nodes;
}
