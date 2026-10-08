import { el } from "./ui.js";

export type ChainChip = { element: HTMLElement; refresh(): Promise<void> };

/** Where the page is looking: one read of the chain head on load and after each check, no polling. */
export function createChainChip(head: () => Promise<bigint>): ChainChip {
  const text = el("span", { class: "chip-text" }, "Monad testnet · connecting…");
  const dot = el("span", { class: "chip-dot", "aria-hidden": "true" });
  const element = el("p", { class: "chip", "data-state": "connecting" }, dot, text);
  return {
    element,
    async refresh() {
      try {
        const block = await head();
        element.dataset.state = "up";
        text.textContent = `Monad testnet · block ${block.toLocaleString("en-US")}`;
      } catch {
        element.dataset.state = "down";
        text.textContent = "Monad testnet · RPC not responding";
      }
    },
  };
}
