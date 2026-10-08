import type { NamedCheck } from "@veridra/monad-rpc";
import type { Assurance, TierState } from "./verify.js";

export type Headline = "VERIFIED" | "NOT_VERIFIED" | "INSUFFICIENT_EVIDENCE" | "CONFLICT" | "NO_RESULT" | "PENDING";

export type Summary = {
  headline: Headline;
  /** The strongest tier that reached a real verdict; absent when no tier did. */
  assurance?: Assurance;
  sentence: string;
  /** Checks of the tier the headline comes from, for the compact view. */
  checks?: NamedCheck[];
  /** True while a stronger tier is still running, so the headline may still change. */
  stillChecking: boolean;
};

type Tiers = { one: TierState | null; two: TierState | null; three: TierState | null };

const LABEL: Record<string, string> = {
  transactionHash: "transaction",
  chainId: "chain",
  execution: "execution (the transaction reverted)",
  sender: "sender",
  recipient: "recipient",
  asset: "asset",
  amount: "amount",
};
const ASSERTABLE = ["sender", "recipient", "asset", "amount"] as const;

const list = (names: string[]): string => names.join(", ");

function describe(headline: "VERIFIED" | "NOT_VERIFIED", checks: NamedCheck[]): string {
  const status = (name: string) => checks.find((check) => check.name === name)?.status;
  const contradicted = checks.filter((check) => check.status === "FAIL").map((check) => LABEL[check.name] ?? check.name);
  const supported = ASSERTABLE.filter((name) => status(name) === "PASS");
  const notAsserted = ASSERTABLE.filter((name) => status(name) === "ABSTAIN");
  const parts: string[] = [];
  if (headline === "NOT_VERIFIED") parts.push(`The chain contradicts: ${list(contradicted)}.`);
  else parts.push("The transaction exists and succeeded on Monad testnet.");
  if (supported.length > 0) parts.push(`Supported by the chain: ${list([...supported])}.`);
  else if (headline === "VERIFIED") parts.push("You asserted nothing more, so nothing else was checked.");
  if (notAsserted.length > 0 && supported.length + contradicted.length > 0) parts.push(`Not asserted: ${list([...notAsserted])}.`);
  return parts.join(" ");
}

/**
 * One plain-language headline for the whole check, derived only from the tiers' own verdicts and
 * checks. It never invents a stronger result: it uses the strongest tier that reached a real verdict,
 * and says so when tiers contradict each other.
 */
export function summarize(tiers: Tiers): Summary {
  const ordered: { state: TierState | null }[] = [{ state: tiers.three }, { state: tiers.two }, { state: tiers.one }];
  const stillChecking = ordered.some(({ state }) => state?.status === "checking");

  const decided = ordered.flatMap(({ state }) =>
    state?.status === "result" && state.verdict !== "INSUFFICIENT_EVIDENCE" ? [state] : [],
  );
  if (new Set(decided.map((state) => state.verdict)).size > 1) {
    return {
      headline: "CONFLICT",
      sentence: "The evidence tiers reached opposite verdicts. Do not rely on either; check again.",
      stillChecking,
    };
  }
  const best = decided[0];
  if (best !== undefined && (best.verdict === "VERIFIED" || best.verdict === "NOT_VERIFIED")) {
    return { headline: best.verdict, assurance: best.assurance, sentence: describe(best.verdict, best.checks), checks: best.checks, stillChecking };
  }

  if (stillChecking) return { headline: "PENDING", sentence: "Checking the chain…", stillChecking };
  if (ordered.some(({ state }) => state?.status === "result")) {
    return {
      headline: "INSUFFICIENT_EVIDENCE",
      sentence: "There is not yet enough confirmation on the chain to judge this claim. Check again in a moment.",
      stillChecking,
    };
  }
  const reason = [tiers.one, tiers.two, tiers.three].find(
    (state): state is Extract<TierState, { message: string }> => state !== null && "message" in state,
  );
  return { headline: "NO_RESULT", sentence: reason?.message ?? "Nothing could be checked.", stillChecking };
}
