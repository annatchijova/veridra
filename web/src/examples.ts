import type { ClaimInput } from "./verify.js";
import { el } from "./ui.js";

export type Example = { id: string; title: string; hint: string; claim: ClaimInput };

/**
 * Real Monad testnet transactions recorded in README.md ("Live on Monad testnet"), not made-up data.
 * The first two share one transaction: same chain evidence, a claim that is true and a claim that is false.
 */
export const EXAMPLES: readonly Example[] = [
  {
    id: "correct",
    title: "Correct claim",
    hint: "0.01 MON, right recipient and amount",
    claim: {
      transactionHash: "0x27d5f9bd45f4022cd87a343c29218e4d6671fbfad626aeafe56fd28f5142fba6",
      sender: "",
      recipient: "0x9EDE2692DE229c3B558105b0591aD34EFe89481D",
      asset: "",
      amountBaseUnits: "10000000000000000",
    },
  },
  {
    id: "wrong-recipient",
    title: "Wrong recipient",
    hint: "Same transaction, a false recipient",
    claim: {
      transactionHash: "0x27d5f9bd45f4022cd87a343c29218e4d6671fbfad626aeafe56fd28f5142fba6",
      sender: "",
      recipient: "0x000000000000000000000000000000000000dEaD",
      asset: "",
      amountBaseUnits: "10000000000000000",
    },
  },
  {
    id: "old-block",
    title: "Old block, checkpointed",
    hint: "Provable long after the recent-block window",
    claim: {
      transactionHash: "0x0b343d385355dbc1d437c3a650e6a4ca59671e643a9e208c17903a2aa7e9b13a",
      sender: "0x298b1699B81660B027aF05A70b3B10CCaCdd2063",
      recipient: "0x298b1699B81660B027aF05A70b3B10CCaCdd2063",
      asset: "",
      amountBaseUnits: "1",
    },
  },
];

export function createExamples(onPick: (claim: ClaimInput) => void): HTMLElement {
  const buttons = EXAMPLES.map((example) => {
    const button = el(
      "button",
      { type: "button", class: "example", "data-example": example.id },
      el("span", { class: "example-title" }, example.title),
      el("span", { class: "example-hint" }, example.hint),
    );
    button.addEventListener("click", () => onPick(example.claim));
    return el("li", {}, button);
  });
  return el(
    "section",
    { class: "examples", "aria-labelledby": "examples-heading" },
    el("h2", { id: "examples-heading", class: "eyebrow" }, "Try a real case"),
    el("ul", { class: "example-list" }, ...buttons),
    el("p", { class: "hint" }, "Real transactions from Monad testnet. Choosing one runs a live check."),
  );
}
