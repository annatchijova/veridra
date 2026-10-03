# Red-team review — Level 2 recent inclusion

**Date:** 2026-10-02  **Round:** 2 (proof-binding invariant)  **Base:** `feat/level-2-inclusion-proofs` at `f3a26e0` with the adversarial test added in the working tree  **Runtime:** solc 0.8.24, Foundry

## Threat model

- **Attacker can:** choose the transaction/receipt bytes, trie nodes, raw header, index, and expected hash passed to the public view function.
- **Attacker cannot:** alter the canonical recent `BLOCKHASH` value or verifier code; the experiment models `BLOCKHASH` as fixed using Foundry's `vm.setBlockhash`.
- **Trust boundary:** untrusted proof bytes → `BLOCKHASH`-anchored header → transaction/receipt roots → inclusion result.

## Finding

### L2-01 — Supplied header roots were not bound to the anchored block hash

**Severity:** High for the verifier's inclusion-soundness guarantee; downstream impact depends on whether a consumer treats a successful read-only result as payment evidence.  **Epistemic level:** CONFIRMED BY INDUCTION.  **Bucket:** software vulnerability.

- **Surprise:** `verifyRecentInclusion` compared `expectedBlockHash` with `blockhash(blockNumber)`, then parsed transaction and receipt roots from caller-supplied `rawHeader`. The live code did not check `keccak256(rawHeader) == blockhash(blockNumber)`. The MPT proofs therefore authenticated values under roots from a header the chain had not committed to.
- **Rival hypotheses:** (1) the client wrapper binds the header strongly enough; (2) the MPT paths somehow bind their roots to the expected block hash; (3) the onchain verifier itself binds the supplied header. Cheapest discriminating experiment: call the verifier with the canonical expected hash but a different valid header whose roots match attacker-generated trie proofs.
- **Prediction:** before the fix, that call returns `true`; with a raw-header hash check, the same input reverts `HeaderHashMismatch`.
- **Induction:** `forge test --match-test test_rejectsProofHeaderThatDiffersFromTheAnchoredBlockHash -vv`. At base `f3a26e0`, the newly added test failed with `next call did not revert as expected` (the verifier accepted). After adding the hash binding, the same test passed. The fixture uses the existing deterministic 16-entry hashed-branch transaction/receipt proof vector; Foundry pins the canonical block hash to a header with different roots.
- **Causal chain:** caller chooses `rawHeader'` and proofs under its roots → verifier checks only caller's `expectedBlockHash` against canonical `BLOCKHASH` → verifier extracts roots from `rawHeader'` without hashing it → MPT paths pass → verifier returns `true` for data not committed by the canonical block.
- **Fix:** `RecentInclusionVerifier` now also requires `keccak256(rawHeader) == actualBlockHash` before parsing roots. The raw-header mismatch regression test remains in `test/RecentInclusionVerifier.t.sol`.

## Discarded vectors

| Vector | Result | Evidence |
|---|---|---|
| Wrong caller-supplied expected hash while raw header matches the canonical hash | FALSIFIED as a bypass; rejected by the existing `test_rejectsHeaderHashThatDoesNotMatchRecentBlockhash` | Foundry test |
| Mutated transaction value while keeping its claimed hash updated | FALSIFIED as a bypass; MPT path rejects the changed leaf | Existing hashed-branch mutation test |

## Limits of this review

The experiment establishes verifier behavior in Foundry, not Monad's live `BLOCKHASH`, RPC, gas, or deployment behavior. The offchain `eth_call` result remains RPC-reported; code-hash pinning does not authenticate a provider or make separate RPC reads atomic. The portable receipt is a transport format and must re-run verification; its stored payment fact, verdict, and source IDs are declarations, not attestations.
