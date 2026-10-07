# Red-team review — Level 3 historical checkpoint and inclusion

**Date:** 2026-10-07  **Round:** 3 (invariants + one documentation claim checked empirically)  **Base:** `main` at `5c1b77a` with the adversarial tests added in the working tree  **Runtime:** solc 0.8.24, Foundry  **Reproducible evidence:** `test/RedTeamRound3_HistoricalCheckpoint.t.sol`

## Threat model

- **Attacker can:** choose which blocks to checkpoint and when (the function is permissionless); choose the raw header, transaction/receipt bytes, trie nodes, and expected hash passed to the verifier's public view function; observe all onchain state.
- **Attacker cannot:** supply a caller-controlled hash to `checkpoint()` (it takes only a block number); force `blockhash(blockNumber)` to return an arbitrary value; alter deployed verifier/checkpoint bytecode after deployment.
- **Trust boundary:** untrusted proof bytes + an onchain-persisted hash that was itself derived from a possibly-stale `BLOCKHASH` read → header/MPT-proof inclusion result.

## Epistemic legend

CODE FACT · PLAUSIBLE HYPOTHESIS · **CONFIRMED BY INDUCTION** · FALSIFIED

## Executive summary

| ID | Severity | Level | Module | Finding |
|----|----------|-------|--------|---------|
| L3-01 | None (documentation claim verified, not a defect) | **CONFIRMED BY INDUCTION** | `HistoricalInclusionVerifier.sol` | A shipped documentation/code claim — that `runtimeCodeHash` alone authenticates which checkpoint a verifier is pinned to, because Solidity embeds `immutable` addresses in bytecode — had never been executed. It holds. |
| L3-02 | None (designed behavior confirmed, not a defect) | **CONFIRMED BY INDUCTION** | `HistoricalRootCheckpoint.sol` + `HistoricalInclusionVerifier.sol` | Re-checkpointing a block after a simulated reorg overwrites the stored hash with no guard. Confirmed this is safe in the sense that matters: a previously-issued proof built against the stale hash fails closed (`HeaderHashMismatch`) on replay; it does not silently keep validating. |
| L3-03 | Low (hygiene — the existing bound was correct, just unpinned by a dedicated test) | **CONFIRMED BY INDUCTION** | `HistoricalRootCheckpoint.sol` | `MIN_CONFIRMATION_DEPTH`'s boundary is exactly 3, with no off-by-one: 2 confirmations reverts, 3 succeeds. Previously only the 1-confirmation case had a dedicated regression. |

**None of these are new vulnerabilities.** This round found that the design holds up under the two angles most likely to break it, and pinned an untested boundary. The discarded-vectors table below records what was considered and set aside without a full experiment, and why.

## Findings

### L3-01 — `checkpointAddress`'s "redundant with runtimeCodeHash" claim, verified

**Severity:** None — this is a documentation/API-design claim check, not a vulnerability search.  **Epistemic level:** CONFIRMED BY INDUCTION.  **Bucket:** none of the three (verification of an architectural claim already made in shipped docs).

- **Surprise / expectation violated:** `TECHNICAL_README.md` and `portableHistoricalReceipt.ts`'s docstring both assert that `checkpointAddress` in a portable historical receipt is informational only, because a `HistoricalInclusionVerifier`'s immutable `checkpoint` reference is embedded in its own runtime bytecode — so two verifiers pinned to different checkpoints necessarily have different `runtimeCodeHash` values, and the existing bytecode-hash pin already authenticates the checkpoint transitively. **This claim was written into shipped documentation from Solidity-semantics reasoning alone and had never been executed.** Per this skill's own rule, that caps it at PLAUSIBLE HYPOTHESIS regardless of how standard the underlying Solidity behavior is — and an un-run claim in production documentation is exactly the kind of overclaim this round exists to catch.
- **Rival hypotheses:** (1) the claim holds, as Solidity's immutable-variable code-embedding behavior predicts; (2) the optimizer or `viaIR` compilation pipeline could normalize or strip the embedded value in some path, making two differently-pinned verifiers share a codehash; (3) the claim holds for the *constructor* bytecode but not the deployed *runtime* bytecode specifically (the two are compiled differently, and only runtime code hash is what the receipt format actually pins).
- **Deduction:** if (1), `address(verifierA).codehash != address(verifierB).codehash` for two instances built from the same source but different constructor arguments. If (2) or (3), the codehashes would collide despite different checkpoints.
- **Induction:** `forge test --match-test test_H6_differentPinnedCheckpointsProduceDifferentRuntimeCodeHash -vv`. Deployed two `HistoricalRootCheckpoint` instances and two `HistoricalInclusionVerifier` instances, one pinned to each, under this repository's actual `viaIR = true` Foundry configuration (not a simplified reproduction). Result: the two runtime code hashes differ, and each verifier's `checkpoint()` getter independently round-trips to the address it was constructed with. (1) holds; (2) and (3) are falsified for this toolchain.
- **Causal chain:** constructor arg (checkpoint address) → Solidity patches the immutable's bytes directly into the deployed runtime bytecode at a fixed offset → runtime bytecode differs per checkpoint → `keccak256(runtime bytecode)` differs → a receipt's `deploymentPin.runtimeCodeHash` already encodes which checkpoint the pinned verifier trusts, before `checkpointAddress` is read at all.
- **Disposition:** no change needed. The shipped documentation's claim is now CONFIRMED rather than merely plausible; `checkpointAddress` stays as a human-readability field, correctly described as non-load-bearing for the trust check.

### L3-02 — Re-checkpoint after a reorg: confirmed fail-closed, not a silent-acceptance hole

**Severity:** None as implemented (behavior is the safe one); this closes part of the explicitly-flagged "conflicting roots" gap from the Level 3 completion note.  **Epistemic level:** CONFIRMED BY INDUCTION.  **Bucket:** none (confirms designed/claimed behavior under execution rather than inspection).

- **Surprise / expectation violated:** `checkpoint()` has no guard against overwriting an already-stored hash with a *different* one — it only special-cases the *identical* case (no re-emit). The prior session's documentation asserted, from code-reading alone, that this is safe because any proof built against the now-stale hash would fail closed on replay. That assertion was never executed either.
- **Rival hypotheses:** (1) overwrite is safe — old proofs fail closed, new proofs succeed, no window where both validate; (2) overwrite creates a race where a proof built against the old hash still validates for some period (e.g. if the verifier cached or the check order let a stale comparison slip through); (3) overwrite lets an attacker *force* an arbitrary rewrite by calling `checkpoint()` with no real reorg, griefing legitimate receipts.
- **Deduction:** under (1), after re-checkpointing, a replay of the exact bytes that succeeded against the original hash reverts `HeaderHashMismatch`, and a freshly-built proof against the new hash succeeds. Under (2), the stale replay would still return `true`. Under (3), `checkpoint()`'s signature would need to accept a caller-supplied hash value, which it structurally does not (checked separately below).
- **Induction:** `forge test --match-test test_H1_reCheckpointAfterReorgInvalidatesTheStaleProofNotSilently -vv`. Checkpointed block 1 at hash A (3 confirmations), confirmed a valid proof against A; simulated a reorg via `vm.setBlockhash(1, B)` and re-ran `checkpoint(1)`, which overwrote the stored hash to B and emitted `Checkpointed(1, B)` again; replayed the *original* proof (still asserting hash A) and observed `HeaderHashMismatch(A, B)`, exactly as predicted; built and submitted a new proof over the same transaction/receipt roots but header-hashing to B, which returned `true`. (1) holds; (2) is falsified.
- **Causal chain:** real reorg changes `blockhash(1)` → `checkpoint(1)` re-reads it live via `anchor()` (never from a caller argument) → stored hash is overwritten → a verifier call supplying the old hash as `expectedBlockHash` is compared against the new `checkpointedHash(1)` → mismatch → revert, before any trie data is even parsed.
- **Rival (3) is also checked, separately, as CODE FACT:** `checkpoint(uint256 blockNumber)`'s selector matches `keccak256("checkpoint(uint256)")` — there is no parameter through which a caller could supply a hash. The only way the stored value changes is a real change in what `blockhash(blockNumber)` returns, i.e. an actual reorg, not an attacker's choice. (3) is falsified by inspection; no execution needed for a pure interface-shape claim.
- **Disposition:** no code change. This is the safe failure mode this round set out to check, now backed by a reproducible test rather than an un-run claim. It does **not** close the full "conflicting roots" gap from `TECHNICAL_README.md`'s Level 3 honesty note — see Discarded vectors and Still open, below.

### L3-03 — `MIN_CONFIRMATION_DEPTH` boundary pinned exactly at 3

**Severity:** Low — hygiene; the deployed behavior was already correct, this closes a gap in test coverage, not in the contract.  **Epistemic level:** CONFIRMED BY INDUCTION.  **Bucket:** hygiene.

- **Surprise / expectation violated:** the existing suite's `test_revertsForABlockBelowTheMinimumConfirmationDepth` only exercises 1 confirmation (clearly below 3); nothing pinned the boundary at exactly 2 (should still fail) vs. exactly 3 (should succeed), leaving an off-by-one theoretically possible without a failing test to catch it.
- **Deduction:** at `block.number - blockNumber == 2`, `checkpoint()` should revert `BlockNotYetFinal`; at `== 3`, it should succeed and return the live hash.
- **Induction:** `forge test --match-test test_H4_confirmationDepthBoundaryIsExactlyThree -vv`. Both predictions held exactly.
- **Disposition:** test added; no code change needed.

## Discarded (non-exploitable) vectors

| Vector | Result | Why it failed |
|---|---|---|
| Caller-forced re-checkpoint griefing (rival to L3-02) | FALSIFIED by inspection | `checkpoint(uint256)` accepts no hash argument; only a real `blockhash` change can alter the stored value. |
| `bytes32(0)` collision bypassing `BlockNotCheckpointed` | Not executed — infeasible to construct | Would require finding a real block whose canonical hash is exactly zero; cryptographically unreachable, not a design gap. |
| Reentrancy between `checkpoint()` and `verifyHistoricalInclusion()` | Not executed — architecturally unreachable | `verifyHistoricalInclusion` is `view`; it cannot call back into `checkpoint()`'s state-mutating path. |
| Two simultaneously-valid checkpointed hashes for one block (true "conflicting roots") | Not reproducible by construction | `checkpointedHash` is a single storage slot per block number; the mapping cannot hold two values for one key at once. The only conflict that *can* occur is sequential overwrite, which L3-02 covers. |

## Still open (not closed by this round)

- **Historical coverage is not comprehensive.** Nothing recovers a block nobody checkpointed before it left the 256-block window; this is a stated liveness assumption, not a bug this round could falsify or confirm either way — there is nothing to execute against an absence.
- **A genuinely adversarial "conflicting roots" scenario in the sense the Level 3 gap note meant** — e.g. two *different, independently operated* checkpoint deployments disagreeing about the same block, with a consumer that trusts the wrong one — was not modeled here. This round only exercised the single-checkpoint, sequential-overwrite case. If a product surface ever lets a consumer choose *which* checkpoint deployment to trust without a strong pin, that would be a new round's threat model, not a re-run of this one.
