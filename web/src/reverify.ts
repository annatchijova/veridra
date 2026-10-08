import { createTierCard } from "./resultCard.js";
import { el } from "./ui.js";
import { MAX_RECEIPT_BYTES, reverifyReceipt, type ReverifyDeps } from "./verify.js";

/** Flow 2: paste or choose a portable receipt and re-check it from scratch against the chain. */
export function createReverifySection(deps?: ReverifyDeps): HTMLElement {
  const card = createTierCard("Reverification result", "Checking… rebuilding the payment fact from the proof and asking the on-chain verifier.");
  card.element.hidden = true;

  const textarea = el("textarea", {
    id: "receipt-text",
    class: "mono",
    rows: "8",
    spellcheck: "false",
    autocomplete: "off",
    "aria-describedby": "receipt-text-hint",
  });
  const file = el("input", { id: "receipt-file", type: "file", accept: "application/json,.json", "aria-describedby": "receipt-file-hint" });
  const button = el("button", { type: "button" }, "Reverify receipt");
  const fileNote = el("p", { id: "receipt-file-hint", class: "hint" }, "Optional. The file's text replaces what is in the box.");

  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    if (chosen === undefined) return;
    if (chosen.size > MAX_RECEIPT_BYTES) {
      fileNote.textContent = "That file is larger than any receipt this page can read, so it was not loaded.";
      return;
    }
    textarea.value = await chosen.text();
    fileNote.textContent = `Loaded ${chosen.name}.`;
  });

  button.addEventListener("click", async () => {
    button.disabled = true;
    card.element.hidden = false;
    card.update({ status: "checking" });
    try {
      card.update(await reverifyReceipt(textarea.value, deps));
    } finally {
      button.disabled = false;
    }
  });

  return el(
    "section",
    { class: "reverify", "aria-labelledby": "reverify-heading" },
    el("h2", { id: "reverify-heading" }, "Reverify a receipt"),
    el(
      "p",
      {},
      "Got a receipt from someone else? Paste it here. It is not taken on trust: the payment fact is rebuilt from its own proof and checked against the verifier this page trusts.",
    ),
    el("div", { class: "field" }, el("label", { for: "receipt-text" }, "Receipt JSON"), el("p", { id: "receipt-text-hint", class: "hint" }, "Paste the contents of an exported Veridra receipt."), textarea),
    el("div", { class: "field" }, el("label", { for: "receipt-file" }, "Or choose a receipt file"), fileNote, file),
    button,
    el("div", { id: "reverify-results", "aria-live": "polite" }, card.element),
  );
}
