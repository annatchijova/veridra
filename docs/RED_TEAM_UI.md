# Security and quality audit — Veridra web UI, UI-Levels 1–3

## Red Team, integrated review

**Date:** 2026-10-08
**Method:** Red-Team Auditing (A–D–I), with `destination-driven-construction` (integrated review at the
stopping level), `frontend-accessibility-by-construction`, `resilient-ui-states`,
`client-side-trust-boundary` and `known-defect-disposition`.
**Scope:** everything under `web/` (UI-Levels 1–3: claim check, recent and historical tiers, receipt
export, receipt reverification). The `offchain/` library and the Solidity contracts are out of scope except
where the UI exposes their behavior.
**Base:** branch `feat/web-ui` @ `ff17547`, plus the uncommitted fixes this review produced.
**Runtime:** Node v22.23.2, viem 2.57.2, vitest 5.0.3, vite 6.4.4, axe-core 4.10.2 (tarball sha256
`b511cd9d…b75e3`, run in an ephemeral browser, not a project dependency), Monad testnet (chain 10143).
**Reproducible evidence:** `web/scripts/hung-rpc-bound.mjs`, `web/scripts/extraction-differential.mjs`,
`web/scripts/live-tamper-matrix.ts`, run from `web/` as `npm run live:hung-rpc`,
`npm run live:differential` and `npm run live:tamper` (`vite-node` 6.0.0 is a devDependency), and the
test suite in `web/src/*.test.ts`.

## Threat model

- **Attacker CAN:** choose the transaction hash and claim an operator pastes (it comes from a buyer);
  hand over an arbitrary receipt up to 256 KiB; deploy arbitrary contracts and transactions on testnet;
  serve inconsistent or malformed data *as if* it were the declared RPC (the declared evidence assurance
  already trusts that RPC, so this is a robustness question for the UI, not a break of `RPC_ATTESTED`).
- **Attacker CANNOT:** modify the page's code or its pinned verifier addresses and code hashes, control the
  operator's browser, or sign anything (the UI has no wallet and no write path).
- **Trust boundary crossed:** hostile text → DOM; hostile receipt → verdict shown to a human; hostile or
  hung network → state shown to a human.

## Epistemic legend

CODE FACT · PLAUSIBLE HYPOTHESIS · CONFIRMED BY INDUCTION · FALSIFIED

## Executive summary

| ID | Severity | Level | Area | Finding | State |
|----|----------|-------|------|---------|-------|
| F1 | P2 | CONFIRMED BY INDUCTION | resilience | A hung RPC held a "checking…" state for ~41 s per viem call; a tier makes several in sequence | fixed |
| F2 | P2 | CONFIRMED BY INDUCTION | accessibility | A disabled submit button dropped keyboard focus to `<body>` after every check | fixed |
| F3 | P3 | CONFIRMED BY INDUCTION | accessibility | Horizontal scroll at 320 px (WCAG 1.4.10): long assurance names did not wrap | fixed |
| F4 | P3 | CODE FACT | accessibility | No error summary on a failed submit (skill: SHOULD for forms beyond 1–2 fields) | fixed |
| F5 | P4 | CODE FACT | accessibility | "Reverification result" was an h2 sibling of its own section heading | fixed |
| F6 | P2 | CONFIRMED BY INDUCTION | integrity of the message | A tampered receipt proof read as "Unavailable" or a retryable error, not "rejected" | fixed |
| F7 | P3 | PLAUSIBLE HYPOTHESIS | integrity of the message | Two tiers could show opposite verdicts with no explanation | mitigated |
| F8 | P3 | CODE FACT (absence), mitigation CONFIRMED BY INDUCTION | hardening | No Content-Security-Policy | fixed (production build) |
| F9 | P4 | CODE FACT | privacy | The operator was not told the hash they type goes to the public RPC | fixed |
| F10 | P3 | CONFIRMED BY INDUCTION | integrity of the message | A deterministic size limit of the proof tiers was shown as a retryable "Try again" | fixed |

No finding allowed a false `VERIFIED`. F6, F7 and F10 concern what a human is told, not what is computed.

## Findings

### F1 — A hung RPC is not bounded to 15 s
**Severity:** P2 · **Level:** CONFIRMED BY INDUCTION · **Bucket:** vulnerability (resilience defect)
- **Surprise:** the UI plan said loading is "already bounded" by the library's 15 s RPC timeout. That is
  true only for the library's own `fetch` calls. The UI's viem client (`getTransaction`, `getBytecode`,
  `readContract`, `getChainId`) uses viem's defaults.
- **Abduction (ranked by cost to test):** (1) viem default timeout 10 s plus 3 retries → ~41 s per call;
  (2) a transport-level hang the timeout does not cover; (3) the library already wraps these calls.
- **Deduction (stated before the run):** against a server that accepts and never answers, a viem call with
  defaults fails after roughly 41 s; with `timeout: 15_000, retryCount: 0` it fails after 15 s.
- **Induction:** `web/scripts/hung-rpc-bound.mjs` → defaults `41.1 s`, bounded `15.0 s`. Prediction held.
- **Consequence:** tier 2 and tier 3 each make 4 or more sequential viem calls, so the worst case for one
  "checking…" state exceeded 2.5 minutes. `resilient-ui-states` requires a bounded loading state.
- **Fix:** `chain.ts` sets `timeout: 15_000, retryCount: 0`.

### F2 — Keyboard focus lost after every check
**Severity:** P2 · **Level:** CONFIRMED BY INDUCTION · **Bucket:** vulnerability (accessibility)
- **Deduction (before the run):** focusing the submit button and pressing Enter leaves
  `document.activeElement === <body>`, because the button was set `disabled` while the check ran.
- **Induction:** in a real browser, `activeElement` was `BODY` after the check. Prediction held.
- **Consequence:** a keyboard user lands at the top of the document after each check and must Tab through
  the whole form again ("focus black hole" in `frontend-accessibility-by-construction`).
- **Fix:** the busy state uses `aria-disabled="true"` and ignores submits while set; focus never leaves the
  button. Same for the reverify button. Re-run live: `activeElement` stays the submit button.
  Regression tests: focus retained during and after, and a second submit is ignored.

### F3 — No reflow at 320 px
**Severity:** P3 · **Level:** CONFIRMED BY INDUCTION · **Bucket:** vulnerability (accessibility, WCAG 1.4.10)
- **Induction:** at 320 px with results on screen, `scrollWidth 463 > clientWidth 305`; the overflowing
  elements were the long monospace assurance names (`strong.mono`, ladder `span.mono`).
- **Fix:** `overflow-wrap: anywhere` on `body`. Re-run live: `scrollWidth 305 = clientWidth 305`.
- **Not verified:** jsdom does not compute layout, so there is no automated regression test for this.

### F4 — No error summary
**Level:** CODE FACT. `resilient-ui-states` makes an `role="alert"` summary a SHOULD for forms beyond 1–2
fields; this form has five. **Fix:** one alert names the fields that blocked the submit and states that
nothing was checked. Test added.

### F5 — Heading hierarchy
**Level:** CODE FACT. **Fix:** the reverification card is an h3 under its h2 section. Test added.

### F6 — A tampered receipt could read as an environment problem
**Severity:** P2 · **Level:** CONFIRMED BY INDUCTION · **Bucket:** vulnerability (misleading output; no
false verdict)
- **Surprise:** the first tamper pass (11 cases) found two misclassified as "Unavailable". A second round on
  proof *structure* was run to see how far it generalizes.
- **Deduction (before the run):** altering a proof node or truncating a proof makes the contract revert with
  a selector the UI has no sentence for, so the receipt shows as a retryable `error`.
- **Induction:** node tampering showed "Unavailable — could not be read in a form this check supports"
  (library error with an unrecognized message) and truncation showed "Try again" (unmapped revert).
  Both predictions held; neither produced `VERIFIED`.
- **Causal chain:**
  ```
  tampered proof node
      ↓ library: "Transaction root does not match its first proof node" (no matching rule)
        or contract revert with an unmapped selector
      ↓ falls through to the tier-level fallback (unavailable / retryable error)
      ↓ operator reads a forged receipt as "try again later"
  ```
- **Fix:** in a receipt context, once the receipt has been parsed and sent to the verifier, anything that is
  not a network or environment problem is `rejected`. Network failures and a differently deployed verifier
  stay retryable errors. 17-case live matrix, all as expected (script above).

### F7 — Tiers can disagree silently
**Severity:** P3 · **Level:** PLAUSIBLE HYPOTHESIS (the *occurrence* was not induced) · **Bucket:** design gap
- **Abduction:** tiers 1 and 2/3 extract the payment fact by different paths and from calls made at
  different instants, so a reorg or an inconsistent provider could yield opposite verdicts.
- **Induction attempted:** see "Discarded vectors", the extraction differential: 0 mismatches in 52
  transactions. The occurrence stays unreproduced; only the UI behavior was tested, with mocks.
- **Mitigation:** an explicit notice when two tiers that reached a real verdict disagree
  ("Do not rely on either verdict"). A tier with only insufficient evidence does not trigger it.

### F8 — No Content-Security-Policy
**Level:** CODE FACT for the absence. **Bucket:** hygiene / hardening.
- **Why it matters here:** the operator types claim data into a page that talks to one RPC. A script
  injection would have had no network restriction.
- **Fix (production build only; the dev server injects inline code):** `default-src 'none'; script-src
  'self'; style-src 'self'; connect-src https://testnet-rpc.monad.xyz; img-src 'self'; base-uri 'none';
  form-action 'none'`.
- **Induction on the production build:** the app still completes checks and exports a receipt; a `fetch` to
  another origin was blocked ("violates … connect-src"); an injected inline script was blocked.
- **Limit:** a `<meta>` CSP cannot set `frame-ancestors`; irrelevant here because the page has no
  state-changing action.

### F9 — Disclosure of where the hash goes
**Level:** CODE FACT. The intro now says the hash is sent to the public Monad testnet RPC.

### F10 — A deterministic size limit was presented as retryable
**Severity:** P3 · **Level:** CONFIRMED BY INDUCTION · **Bucket:** vulnerability (misleading output; no false verdict)
- **Surprise:** a second run of the extraction differential (below) sampled different blocks and found
  one transaction where the two extraction paths diverge in *outcome*: a reverted transaction with large
  calldata. Tier 1 (JSON-RPC) returns evidence with `successful: false`; the raw-RLP path used by tiers 2
  and 3 refuses it with `MptProofInputError: Entry 1 exceeds 8192 bytes`.
- **Deduction (before the run):** that error class is not one the UI's translator recognizes, so it falls
  through to the generic retryable error.
- **Induction:** against the real transaction (`0xf8f5287f…ddfaf`) the UI would have shown
  "Something went wrong while checking. Nothing was verified. Try again." Prediction held.
- **Consequence:** a limit that is deterministic, so retrying can never help, was offered as a retry.
  It is not a verdict disagreement (the proof tiers produce no result), so F7's notice does not apply.
- **Fix:** `MptProofInputError` and `RawPaymentFactError` are recognized; a size-limit rule renders a
  designed absence that says retrying will not change it and that tier 1 is unaffected. In a receipt
  context the same limit is a rejection. Re-run live: the real transaction now maps to `unavailable`.

## Discarded (non-exploitable) vectors

| Vector | Result | Why it failed |
|--------|--------|---------------|
| Markup or script from RPC data, claim summary or failure text reaching the DOM | FALSIFIED | No HTML sinks in `web/src`; a test renders `<img onerror>` / `<script>` payloads through the card in three fields and asserts no elements and no execution. |
| Receipt-declared verdict used as the shown verdict | FALSIFIED | Declared verdict flipped, or claim altered with verdict kept → rejected; the shown verdict is the recomputed one. |
| Receipt carrying another verifier pin or checkpoint | FALSIFIED | Hash altered, address swapped, checkpoint altered → rejected (live). |
| Receipt that is a valid transaction but claims nothing | By design | `VERIFIED` is relative to the claim; the claim the receipt asserts is shown, and `ABSTAIN` fields are labeled "not asserted". |
| JSON-RPC extraction (tier 1) vs raw-RLP extraction (tiers 2/3) disagree on real transactions | FALSIFIED for the extracted *fact* (0 divergent facts); one divergence in *outcome* found (F10) | Run 1: 52 real transactions (10 native, 10 reverted, 10 payable calls, 10 token-via-contract, 10 plain calls, 2 direct token transfers), 0 mismatches. Run 2, different blocks, 47 transactions: 1 mismatch, an over-limit reverted transaction (F10). The result depends on the sample. **Not covered:** contract creation (none found), EIP-7702, and only 1–2 direct token transfers per run. |
| Double submission | FALSIFIED | A second submit during a check is ignored (test: one acquire call). |
| Oversized paste or file freezing or confusing the page | FALSIFIED | The byte length is checked before any parse, and an oversized file is not read (test for the paste path). |
| Dependency advisories | FALSIFIED | `npm audit`: 0 in `web/` and 0 in `offchain/`. |
| Wrong recent-verifier pin | FALSIFIED | The library re-checks runtime code on every call and live checks passed. |
| Automated accessibility violations | FALSIFIED | axe-core 4.10.2 (wcag2a/aa, 2.1, 2.2 aa, best-practice): 0 violations in the initial state and in the state with results plus a rejected receipt. Contrast is reported "incomplete" by axe; ratios were computed manually earlier (all ≥4.5:1). |

## Open items (known-defect-disposition records)

Each record's escalation analysis was actually run; none found a path to P0/P1.

```yaml
id: UI-0001
title: HistoricalInclusionVerifier runtime code hash is pinned but not confirmed against the deploy log
severity_initial: P2
severity_reviewed: P2
escalation_analysis:
  adversarial_control: only whoever controls the address in README.md (the deployer) or Sourcify's record
  composition: a wrong pin would make receipts verify against the wrong contract
  affected_invariants: "which verifier authenticates a historical receipt"
  reachable_consequence: >
    A receipt checked against a contract that is not the intended verifier. Reduced by: the hash derived
    from the RPC code equals Sourcify's exact_match runtime bytecode, and checkpoint() equals the README
    address and is embedded in the code.
  p0_p1_path_found: false
  evidence: derivation recorded in web/src/chain.ts; live reverify of a real receipt passes under this pin
disposition: DEFERRED
reason: the authoritative value is in Anna's deploy log, which this review cannot read
why_not_fixed_now: needs a human to compare one value
known_impact: none observed
accepted_exposure: trust in the README address plus Sourcify, until confirmed
revisit_trigger: Anna confirms 0xac66b1c1…2d800788 matches the deploy log, or any mismatch is seen
owner: Anna
```

```yaml
id: UI-0002
title: Screen-reader behavior of the live region is untested
severity_initial: P3
severity_reviewed: P3
escalation_analysis:
  adversarial_control: none (not attacker-reachable)
  composition: three tier cards plus a notice update inside one polite live region
  affected_invariants: "a screen-reader user is told when results land"
  reachable_consequence: possible verbose or repeated announcements; no wrong information
  p0_p1_path_found: false
  evidence: axe 0 violations and keyboard order checked; no NVDA or VoiceOver run was performed
disposition: DEFERRED
reason: no screen reader available in this environment
why_not_fixed_now: needs a manual test with a real assistive technology
known_impact: unknown announcement verbosity
accepted_exposure: internal tool with no external users yet
revisit_trigger: before any user outside the maintainer relies on the page
owner: Anna
```

```yaml
id: UI-0003
title: The extraction differential does not cover contract creation, EIP-7702, or more than 2 direct token transfers
severity_initial: P3
severity_reviewed: P3
escalation_analysis:
  adversarial_control: an attacker can send such transactions to testnet
  composition: a differing extraction between tiers would give opposite verdicts
  affected_invariants: "tiers adjudicate the same fact"
  reachable_consequence: >
    Bounded by F7: opposite verdicts are now shown with an explicit "do not rely on either" notice.
  p0_p1_path_found: false
  evidence: >
    Run 1: 0 mismatches in 52 transactions. Run 2: 1 mismatch in 47, an over-limit transaction (F10, fixed).
    The uncovered shapes were absent from the sampled blocks.
disposition: DEFERRED
reason: testnet traffic during the sample had none of those shapes
why_not_fixed_now: needs constructing such transactions on testnet
known_impact: unknown for the uncovered shapes
accepted_exposure: tier disagreement is surfaced to the operator
revisit_trigger: the ERC-20 live matrix named as outstanding in TECHNICAL_README.md, or any observed disagreement
owner: Anna
```

```yaml
id: UI-0004
title: A check makes roughly 8–12 requests to the public RPC, with no retry
severity_initial: P3
severity_reviewed: P3
escalation_analysis:
  adversarial_control: none (a shared-RPC rate limit is not attacker-controlled)
  composition: F1's fix removed retries, so a transient failure is visible instead of masked
  affected_invariants: "a failed request is shown as an error, never as a verdict"
  reachable_consequence: a retryable error state; no wrong verdict
  p0_p1_path_found: false
  evidence: network failures render as a retryable error (tests and live)
disposition: DEFERRED
reason: only one public RPC is declared; a second provider is a product decision
why_not_fixed_now: out of scope for this pass
known_impact: occasional "try again" under rate limiting
accepted_exposure: operator retries manually
revisit_trigger: first observed rate-limit failure, or when a second provider is added
owner: Anna
```

```yaml
id: UI-0005
title: Cosmetic and minor accessibility notes
severity_initial: P4
severity_reviewed: P4
escalation_analysis:
  adversarial_control: none
  composition: none found
  affected_invariants: none
  reachable_consequence: favicon.ico returns 404; the explorer link opens a new tab without saying so
  p0_p1_path_found: false
  evidence: console 404 on /favicon.ico; links use target=_blank rel=noopener noreferrer
disposition: DEFERRED
reason: no operational impact
why_not_fixed_now: trivial and cosmetic
known_impact: one console error
accepted_exposure: none
revisit_trigger: when a hosting target is chosen
owner: Anna
```

## What this review did not establish

- The recent and historical tiers were exercised live with native transfers only; no ERC-20.
- The network-error state was exercised with mocks and a hung local server, not with a real provider outage.
- `NOT_VERIFIED` through tier 2 or tier 3 was exercised in tests (mocked) but not live in this review; it was
  exercised live for tier 1 in the earlier UI-Level 1 pass.
- Everything here used one public RPC for both acquisition and the verifier calls, so none of it establishes
  independent-provider behavior or authenticated RPC responses (see `TECHNICAL_README.md`).
- axe-core automates only part of WCAG; keyboard order, focus and reflow were checked by hand in one
  browser (Chromium via Playwright).
