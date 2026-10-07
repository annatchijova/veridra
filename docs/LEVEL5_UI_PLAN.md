# Veridra — Level 5 UI plan

**Status:** PLAN, not yet built, but fully confirmed as of 2026-10-07 —
every open decision below was resolved with Anna in this planning session.
This document exists to satisfy `destination-driven-construction`'s rule:
name the evidence model, scope, and acceptance conditions before writing a
line of UI code.

## Level 5 entry conditions (per `TECHNICAL_README.md`)

Level 5's own bar: *"the first user and the workflow being replaced are
named; integrations receive the same scoped evidence result as the
verifier; repeated requests are safe; and no external action is triggered
by a result whose required evidence is unavailable or unauthenticated."*

- **First user — [CONFIRMED]:** a marketplace or merchant **operations
  person**, not a developer. This is the persona already implicit in
  `docs/ARCHITECTURE_FRACTURE.md`'s "problem being tested": they receive a
  transaction hash (or a screenshot that contains one) from a buyer
  disputing or asserting a payment, and need to decide — in minutes, not by
  writing code — whether the specific claimed facts (sender, recipient,
  asset, amount) are actually supported by onchain evidence.
- **Workflow being replaced:** manually opening a block explorer, reading
  raw transaction data, and eyeballing whether it matches what the buyer
  claims — with no structured verdict, no record of what was checked, and
  no way to hand the result to someone else as evidence. Veridra's "useful
  output is not merely 'this transaction exists'" framing (same doc)
  applies directly: the UI's job is to turn that manual lookup into one
  scoped verdict plus a reusable artifact.
- **Scope — [CONFIRMED]: read-only.** The UI never requires a wallet, signs
  no transaction, and spends no gas. It only calls view functions /
  `eth_call` / `debug_get*` reads. This is a real architectural fit, not a
  shortcut: verification (Levels 1–3) was already read-only by design —
  only *publishing* a receipt into `VeridraReceiptRegistry` needs a signer,
  and publishing is out of scope for this UI (see "Explicitly out of
  scope" below).
- **Evidence model exposed:** all three evidence tiers already built,
  surfaced honestly and separately, never collapsed into one undifferentiated
  "verified" badge:
  1. **Level 1 — `RPC_ATTESTED`.** Always attempted. Works for any valid,
     mined transaction regardless of age.
  2. **Level 2 — `RPC_REPORTED_RECENT_INCLUSION_ACCEPTED`.** Attempted only
     if the transaction's block is within the live 256-block `BLOCKHASH`
     window. Reported as *unavailable*, not an error, otherwise.
  3. **Level 3 — `RPC_REPORTED_HISTORICAL_INCLUSION_ACCEPTED`.** Attempted
     only if that specific block was already checkpointed by someone,
     before the window closed. **Honesty constraint, stated now so it is
     never fudged in the UI:** for an arbitrary transaction the operator
     pastes in, this will usually be unavailable — nobody runs a
     checkpointing service yet (see "Known gap" below). The UI must say
     exactly that, not imply Level 3 coverage that doesn't exist.
- **No external action on insufficient/unauthenticated evidence:** the UI
  triggers nothing automatically (no auto-refund, no auto-dispute-resolution)
  — it only displays a verdict and lets a human decide and act elsewhere.
  This trivially satisfies that bar because the UI has no write path at all.

## Product shape

One primary flow, one secondary (stretch) flow. No navigation maze — this
is a tool used in the middle of a support ticket, not a destination site.

### Flow 1 — Check a claim (the core flow, all UI levels build toward this)

1. **Input:** transaction hash (required). Optional claim fields — sender,
   recipient, asset, amount — each independently assertable, mirroring
   `PaymentAdjudicator`'s own design: an unasserted field is `ABSTAIN`, not
   a forced guess. The operator fills in only what they actually know from
   the dispute, which is usually incomplete.
2. **Check button** fires all evidence-tier lookups the transaction's age
   allows, in parallel (Level 1 always; Level 2 if age permits; Level 3 if
   checkpointed).
3. **Result:** one card per evidence tier actually produced, each showing:
   - the verdict (`VERIFIED` / `NOT_VERIFIED` / `INSUFFICIENT_EVIDENCE`),
     with color/weight reserved for this and nothing else (no gradient
     "mostly verified" — the product's whole point is refusing that);
   - the `evidence_assurance` label spelled out, not abbreviated into an
     icon that loses the distinction between tiers;
   - the seven named checks (`transactionHash`, `chainId`, `execution`,
     `sender`, `recipient`, `asset`, `amount`) each as `PASS` / `FAIL` /
     `ABSTAIN` — this is where "which facts are and aren't supported"
     actually becomes visible, not just the headline verdict;
   - a link to the transaction on the Monad testnet explorer, so the
     operator can always drop to raw ground truth.
4. **Export receipt:** downloads the portable JSON (recent- or
   historical-format, whichever tier the check actually reached) as the
   artifact the operator attaches to the dispute record or sends back to
   the buyer.

### Flow 2 — Reverify a receipt (stretch, UI-Level 3)

Paste or upload a previously exported portable receipt (either format).
The UI re-parses it, independently re-derives the payment fact, recomputes
the verdict, and re-calls the pinned verifier onchain — showing live,
in front of whoever is watching, that the artifact is not a trust-me PDF:
it is actually re-checked from scratch against the chain, the same way
`verifyPortableInclusionReceipt` / `verifyPortableHistoricalInclusionReceipt`
already do in the test suite. This is the single best demo moment the
product has, because it is the literal point of the whole receipt format
made visible.

## Build levels (each independently shippable and demoable)

Mirrors this project's own `destination-driven-construction` discipline —
stop at any level and still have something real to show.

- **UI-Level 1:** Flow 1, Level-1-evidence (`RPC_ATTESTED`) only. No Level
  2/3 tiers yet. Already a complete, honest, demoable product: paste a
  hash and claim, get a scoped verdict with per-field checks.
- **UI-Level 2:** Add the Level 2 (recent inclusion) tier as a second card
  when available, plus a visual assurance-ladder indicator (`RPC_ATTESTED`
  → `RECENT_BLOCKHASH_PROOF` → `PERSISTENT_ROOT_PROOF`) so the *progression*
  itself — Veridra's actual intellectual contribution — is visible, not
  just implied by which cards happen to appear.
- **UI-Level 3:** Add the Level 3 (historical) tier, the portable-receipt
  export button, and Flow 2 (reverify a receipt). This is where the
  product's durability claim becomes demonstrable rather than theoretical.
- **UI-Level 4 — [CONFIRMED 2026-10-07: out of scope for this pass].** A
  "checkpoint coverage" panel (display-only: is this block checkpointed,
  yes/no) was considered, along with a button to call the permissionless
  `checkpoint()` directly from the UI. The button is explicitly deferred —
  it is the one action that would need a wallet/gas, breaking the
  read-only scope the rest of the UI holds to. Not building it now keeps
  the whole UI wallet-free. Revisit only if a later session decides that
  trade-off is worth it.

## Technical architecture

- **Stack — [CONFIRMED]:** Vite + TypeScript + viem, no framework —
  matching both `offchain/`'s existing stack and the pattern Anna already
  used for MUSTER's `web/` (vanilla TS, hand-rolled DOM, one module per
  concern: `chain.ts`, `verify.ts`, `ui.ts`, `style.css`, …). Chosen for
  consistency across both hackathon entries, not re-decided per project.
- **No backend.** Checked just now, not assumed: the public Monad testnet
  RPC (`$MONAD_TESTNET_RPC_URL`) returns `Access-Control-Allow-Origin`
  reflecting any origin for both `eth_call`-style methods and
  `debug_getRawBlock`/`debug_getRawReceipts` — confirmed live with `curl`
  carrying an `Origin` header, not inferred from documentation. The whole
  Flow 1 (including proof acquisition, which needs the `debug_*` methods)
  can run directly browser → public RPC, same as the Node.js library does
  today, with zero server component.
- **Code reuse:** the UI imports `offchain/dist` directly (same package
  already used by the CLI and every Node test) — `acquireRecentInclusionProof`,
  `verifyRecentInclusionOnchain`, `verifyHistoricalInclusionOnchain`,
  `createPortableInclusionReceipt` / `Historical` variants, and
  `verifyPortableInclusionReceipt` / `Historical` variants. No
  reimplementation of acquisition, proof-checking, or adjudication logic in
  the UI layer — the UI is presentation over the existing, already-tested
  library, which is itself the point of having built that library with a
  clean exported surface.
- **Deployment:** static hosting (no server to run), e.g. Vercel/Netlify/
  GitHub Pages. Trivial given no backend.
- **Verifier deployment pins:** hardcode the known-good `(chainId, address,
  runtimeCodeHash)` pins for `RecentInclusionVerifier` and
  `HistoricalInclusionVerifier` (already recorded in `README.md`/
  `TECHNICAL_README.md`) as the UI's own `VerifierDeploymentPin` — the UI
  is itself a "caller" in the architecture's terms and must maintain its
  own pin, not trust an RPC-supplied address.

## Design language — [CONFIRMED 2026-10-07: forensic, sober, no exaggeration]

A deliberately *un*-flashy, evidentiary register — closer to a forensic
report or an audit tool than a DeFi dashboard. Monospace for
hashes/addresses, a restrained palette where color is reserved exclusively
for verdict state (never decorative), generous whitespace around the
per-check breakdown so "which fact failed" reads instantly. No gradients,
no glow, no crypto-dashboard flourish — sober stays sober even where it
would be easy to over-decorate a "VERIFIED" state. The product's actual
differentiator is honesty about uncertainty; the UI's visual register
should carry that, not compete with it.

## Known gap this UI will make visible, not hide

Level 3 coverage for an arbitrary historical transaction depends entirely
on someone having checkpointed that exact block before the 256-window
closed — and nobody runs that continuously today. The UI's honest behavior
(Level 3 card simply does not appear when unavailable, with a one-line
explanation why) turns this into a visible, legible limitation instead of
a silent gap. UI-Level 4's optional coverage panel is the natural place to
eventually turn this from "a gap we disclose" into "a gap the operator can
personally close for the one transaction they care about," but that is
explicitly a stretch, not part of the core plan.

## Explicitly out of scope for this UI

- **Publishing** a receipt into `VeridraReceiptRegistry` (needs the
  single-publisher wallet; not this operator's action).
- **Level 4** (prior payment expectations) and **Level 6/7** UI — those
  levels are not built yet in the contracts/library layer; there is nothing
  for a UI to expose.
- **Wallet connection of any kind** for the core flows (Flow 1, Flow 2).
  Revisit only if UI-Level 4's checkpoint button is built.
- **Multi-chain.** Monad testnet only, matching everything else in the repo
  today.

## Decisions confirmed 2026-10-07 — ready to build

1. Design language: forensic, sober, no exaggeration (above).
2. UI-Level 4's checkpoint button: deferred, out of scope for this pass.
3. Repo location: new `web/` directory in this repo, matching MUSTER's
   convention.

No open decisions remain blocking UI-Level 1 implementation.
