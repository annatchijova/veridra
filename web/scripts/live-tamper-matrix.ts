// Integral review: tampered-receipt matrix against the live chain, through the UI's own reverify code.
// Run from web/ with   npm run live:tamper   (needs network; builds its own receipt first)
// Builds its own receipt for the historical transaction recorded in README.md, then mutates it.
import { checkHistoricalInclusion, defaultHistoricalDeps, reverifyReceipt } from "../src/verify.ts";

const HISTORICAL_TX = "0x0b343d385355dbc1d437c3a650e6a4ca59671e643a9e208c17903a2aa7e9b13a";
const built = await checkHistoricalInclusion(
  { transactionHash: HISTORICAL_TX, sender: "", recipient: "", asset: "", amountBaseUnits: "" },
  defaultHistoricalDeps,
);
if (built.status !== "result" || built.serializedReceipt === undefined) {
  console.error("could not build a receipt:", built);
  process.exit(2);
}
const original = built.serializedReceipt;
const flip = (hex: string) => hex.slice(0, -2) + (hex.endsWith("00") ? "01" : "00");
const mutate = (fn: (d: any) => void) => {
  const d = JSON.parse(original);
  fn(d);
  return JSON.stringify(d);
};
const OTHER_VERIFIER = "0x6f0512740A569a4EF2e3f148513866Df97D5E0a8";

const cases: [string, string, "result" | "rejected"][] = [
  ["untouched receipt", original, "result"],
  ["declared verdict flipped", mutate((d) => { d.adjudication.verdict = "NOT_VERIFIED"; }), "rejected"],
  ["claim asserts wrong amount, verdict kept", mutate((d) => { d.claim.amountBaseUnits = "999"; }), "rejected"],
  ["pin hash altered", mutate((d) => { d.deploymentPin.runtimeCodeHash = "0x" + "11".repeat(32); }), "rejected"],
  ["pin address swapped", mutate((d) => { d.deploymentPin.address = OTHER_VERIFIER; }), "rejected"],
  ["receipt trie value tampered", mutate((d) => { d.proof.receipt.value = flip(d.proof.receipt.value); }), "rejected"],
  ["raw header tampered", mutate((d) => { d.proof.rawHeader = flip(d.proof.rawHeader); }), "rejected"],
  ["tx proof node tampered", mutate((d) => { d.proof.transaction.proof[0] = flip(d.proof.transaction.proof[0]); }), "rejected"],
  ["receipt proof node tampered", mutate((d) => { d.proof.receipt.proof[0] = flip(d.proof.receipt.proof[0]); }), "rejected"],
  ["tx proof truncated", mutate((d) => { d.proof.transaction.proof = [d.proof.transaction.proof[0]]; }), "rejected"],
  ["blockNumber moved", mutate((d) => { d.proof.blockNumber = String(BigInt(d.proof.blockNumber) + 1n); }), "rejected"],
  ["extra field", mutate((d) => { d.extra = 1; }), "rejected"],
  ["schema version 2", mutate((d) => { d.schemaVersion = 2; }), "rejected"],
  ["format relabelled", mutate((d) => { d.format = "veridra.portable-inclusion-receipt"; }), "rejected"],
  ["checkpoint address altered", mutate((d) => { d.checkpointAddress = OTHER_VERIFIER; }), "rejected"],
  ["not JSON", "hello", "rejected"],
  ["empty", "", "rejected"],
];

let unexpected = 0;
for (const [name, text, want] of cases) {
  const state = await reverifyReceipt(text);
  const ok = state.status === want && (want !== "result" || (state.status === "result" && state.verdict === "VERIFIED"));
  if (!ok) unexpected++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name.padEnd(42)} -> ${state.status}${state.status === "result" ? " " + state.verdict : ""}`);
}
console.log(`\n${cases.length} cases, ${unexpected} unexpected`);
process.exit(unexpected === 0 ? 0 : 1);
