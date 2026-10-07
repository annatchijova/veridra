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

## Frontend-skills review (2026-10-07)

Ran the plan above through `frontend-accessibility-by-construction`,
`resilient-ui-states`, `non-overwhelming-ux`, `frontend-component-boundaries`,
`frontend-performance-budgets`, and `frontend-testing-strategy` before
writing any code. Findings below are concrete acceptance checks and module
shape, not new open decisions — nothing here changes the confirmed scope,
persona, stack, or design language above.

### Accessibility

- Every interactive element is a native one — `<button>` for Check / Export
  / Reverify, `<input>` + a real associated `<label>` for every field (tx
  hash, sender, recipient, asset, amount). Nothing in this plan needs a
  custom ARIA widget (no dropdown, tabs, or modal), so the native-first rule
  fully covers it — no ARIA authoring patterns to get wrong.
- **Verdict and per-check state must never be color-only.** `VERIFIED` /
  `NOT_VERIFIED` / `INSUFFICIENT_EVIDENCE` and each check's `PASS` / `FAIL`
  / `ABSTAIN` render as text, color-coded in addition — not a colored dot
  alone. This is also just more consistent with the forensic register
  already confirmed: text reads as more sober than a status chip.
- The results container is one `aria-live="polite"` region, so a
  screen-reader user is told when a check's result lands without
  re-wrapping already-static content in a live region "just in case"
  (the anti-pattern the skill names directly) — this region only exists
  because content genuinely changes after the Check action.
- No modal exists anywhere in this plan, so no focus-trap/return-focus
  concerns apply; the live-region announcement is the correct mechanism
  here, not a focus steal.
- Acceptance checks before shipping any palette: every verdict/check color
  pairing meets 4.5:1 text contrast (WCAG 1.4.3); every button/badge meets
  the ≥24×24px target-size floor (2.5.8).

### Resilient states

- **Each of the three evidence-tier cards is independently stateful** —
  Level 1/2/3 each have their own loading → (success | empty | error)
  lifecycle. A Level 3 RPC failure must never blank the Level 1 card that
  already resolved (scoped failure, not a page-level error boundary) — this
  is the direct frontend expression of this project's own
  `honest-degradation` discipline (a partial result stays a partial result,
  never collapsed into a page-wide failure).
- **Three states previously collapsed into one informal "unavailable"
  concept must render distinguishably:** `checking…` (loading) vs.
  `unavailable — <plain reason>` (empty — e.g. "outside the 256-block
  window" or "this block was never checkpointed", a designed absence, not a
  failure) vs. `couldn't reach the network — try again` (error, a request
  that actually failed). Collapsing "unavailable by design" into "error"
  would misrepresent an honest architectural limitation as a bug.
- Loading already has a bound for free: `offchain/src/proofRpc.ts`'s
  existing `RPC_TIMEOUT_MILLISECONDS = 15_000` means no new infinite-spinner
  risk — the UI only needs to render that specific failure as "the network
  didn't respond in time," not a generic error string.
- Tx-hash format validation fires on blur, not keystroke. An invalid submit
  shows an inline error (`aria-invalid` + `aria-describedby`) and clears
  nothing — every claim field the operator already filled in survives any
  error, including a failed RPC call.

### Cognitive load (the operator is mid-dispute, not browsing)

- **Plain-language error translation is a required module, not a nice-to-
  have.** Raw Solidity revert reasons (`BlockNotCheckpointed`,
  `BlockOutsideWindow`, `HeaderHashMismatch`) and library exception classes
  must never reach the operator verbatim — each known failure maps to one
  plain sentence, ≤2 clauses, written for someone who has never read
  Solidity. This is where `errorMessages.ts` (below) earns its place as its
  own module rather than inline strings.
- **Predictable layout:** all three tier-card slots render immediately (as
  `checking…`) rather than popping in as each resolves — nothing on the
  page reorders or reflows as results stream in across the three parallel
  lookups.
- **Progressive disclosure:** verdict + the seven-check breakdown is the
  default view; raw proof bytes and header hex live behind a collapsed
  "view raw evidence" disclosure. The operator needs the verdict in
  seconds, not the RLP.
- No countdown, no autosubmit, no modal stacking — already true by
  construction given this plan has no timers and no modals; stated here as
  a confirmed non-goal so a future addition doesn't casually introduce one.

### Module boundaries (vanilla TS, no framework — extends "Technical architecture" above)

One module per cohesive concern, matching MUSTER's `web/` precedent
(`chain.ts`, `ui.ts`, one file per feature) rather than one-file-per-DOM-
element fragmentation:

- `chain.ts` — public client setup; the hardcoded `VerifierDeploymentPin`s
  for both verifiers.
- `claimForm.ts` — the input form: fields, blur-validation, and its own
  inline-error state. Label + input + error stay fused (cohesive unit per
  the skill — splitting them would just force this module to re-wire
  `aria-describedby` across file boundaries for no benefit).
- `verify.ts` — orchestrates the three parallel tier lookups through
  `offchain/dist`; owns each tier's loading/empty/error/success state
  locally, not lifted to a shared store (no second consumer exists yet to
  justify lifting it).
- `resultCard.ts` — renders one tier's result. Reused three times with
  identical behavior — a real, current reuse case, not a speculative one.
- `errorMessages.ts` — the plain-language translation layer named above.
- `receiptExport.ts`, `reverify.ts` — Flow 2 and the export action.
- `ui.ts`, `style.css` — shared render helpers, matching MUSTER's role split.

### Performance

This is low-traffic internal tooling used during a live dispute, not a
high-traffic entry point — the skill's own stated exception applies:
formal LCP/INP/CLS field-data budgeting is skipped by design, not by
oversight. Several of the causal budgets are already satisfied for free by
decisions made earlier in this plan: no framework runtime to hydrate, no
images, a system monospace/sans stack (no custom webfont to swap or
shift), no third-party scripts beyond `viem`. One real latency source is
worth naming rather than discovering later: `debug_getRawBlock` /
`debug_getRawReceipts` payload size scales with block size, so proof
acquisition is plausibly the slowest step in a Check. It is already bounded
by the existing 15s RPC timeout (see Resilient states above); its loading
state should say "fetching block data," not a generic spinner, since the
operator benefits from knowing which step is slow.

### Testing

The acquisition/verification/adjudication logic this UI calls is already
covered by 67/67 tests in `offchain/`'s own suite — the UI layer's test
responsibility is presentation only, not re-proving that logic:

- **Static:** TypeScript strict mode, carried into `web/` from the
  `offchain/` convention already in place.
- **Integration (the main investment):** render `resultCard` with a mocked
  tier result for each of loading/success/empty/error; render `claimForm`
  and assert blur-validation, `aria-invalid` wiring, and that a failed
  submit preserves entered values. Query by accessible role/label/text
  (`getByRole`, `getByLabelText`) — never by CSS class or DOM structure, so
  a visual refactor with identical behavior doesn't break the suite.
  Mock the public client; no live network call inside a test.
  One or two integration tests cover the real "paste hash → see result"
  path end-to-end against that mock.
- **No E2E.** This plan has no auth, no multi-page routing, and no payment
  flow — the skill's own bar for E2E ("the integration between real systems
  is itself the thing under test") isn't met. Manual live-testing against
  the real chain, the same pattern `offchain/`'s own live-induction runs
  already use, covers the one thing a mocked integration test can't: that
  the real RPC actually behaves the way the mock assumes.
