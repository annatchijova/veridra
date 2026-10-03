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

## Follow-up finding — 2026-10-03 (offchain proof availability)

### L2-02 — An unrelated large trie value prevented proof construction for the selected payment

**Severity:** Low (Level 2 proof availability for transactions in an affected block; no Level 1 failure or verifier-soundness bypass).  **Epistemic level:** CONFIRMED BY INDUCTION.  **Bucket:** software vulnerability (availability).

- **Base / scope:** branch `feat/level-2-inclusion-proofs` at `bad3333`, before the fix; offchain Node.js proof construction only. Solidity verifier behavior and Level 1 are unchanged.
- **Threat model:** an untrusted raw block contains the selected small payment transaction and another transaction/receipt value above 8 KiB. A network participant may submit a sufficiently large transaction that is included in the same block. The attacker cannot alter the canonical header roots, verifier code, or the selected transaction; the effect is failure to build a proof, not acceptance of false evidence.
- **Surprise:** the 8 KiB bound is needed for the selected values passed to the Solidity verifier, but `buildTransactionAndReceiptProofs` applied it to every transaction and receipt in the complete block before constructing the target path. Thus one unrelated value could make the producer reject an otherwise bounded target proof.
- **Rival hypotheses:** (1) all block entries intentionally share the onchain 8 KiB limit; (2) only selected values should share that limit while all entries remain within the existing 2 MB aggregate cap; (3) no valid target network block contains an unrelated value this large. The onchain verifier's bound applies to its supplied target values, while the offchain builder separately has a complete-block aggregate cap; this supports (2), not (1). Hypothesis (3) is falsified by the bounded raw-block acquisition attempt that surfaced `Entry 1 exceeds 8192 bytes`, though that failed command did not retain a transaction hash and is not used as the reproducible fixture.
- **Prediction (before the fix):** for index 0 with a three-byte target value, an unrelated index-1 value of 8,193 bytes, and header roots matching the independently constructed two-entry trie, the current builder rejects with `Entry 1 exceeds 8192 bytes`. After applying the limit only to the selected index, it returns the exact expected transaction root. Oversized selected transaction/receipt values and aggregate input above 2 MB must still reject.
- **Induction:** added `builds the small target proof when an unrelated transaction value exceeds 8 KiB` to `offchain/src/mptProof.test.ts`. On base `bad3333`, `npm run build && node dist/mptProof.test.js` failed at the fixture with `MptProofInputError: Entry 1 exceeds 8192 bytes`. After the fix, all seven tests in that file passed; the regression asserts transaction root `0x8b07b4dbc8c6f929c72b1ecf67b6c4f1ead8d82eedf74c4a10b8448ee3ffc446`, receipt root `0xae833f5f13bb80272f61f8d5ecaef29eb2077476f81cac03a365ebfce99c1d25`, and continued rejection of an oversized selected transaction or receipt. A separate test preserves the 2 MB combined bound across both arrays. Negative control: temporarily removing the target-index condition made the regression fail again with `Entry 1 exceeds 8192 bytes`.
- **Reproducible fixture:** deterministic raw block assembled in the test from target `0x03`, unrelated value `0xabab…` repeated 8,193 bytes, and receipts `0x02` / `0x04`; expected roots are asserted exactly. Runtime: Node.js 22, viem 2.57.2. Test source is the reproduction script; no network, credentials, or transaction is required.
- **Causal chain:** complete block values → unconditional per-entry 8 KiB parser rejection at unrelated index 1 → MPT root/proof construction aborts → `acquireRecentInclusionProof` cannot produce a proof for the selected transaction → that transaction's 256-block verification opportunity is lost.
- **Fix:** enforce 8 KiB on the selected transaction and receipt values only; retain the 4,096-entry, 2 MB aggregate, 2 MB raw-block, and 4 KiB header bounds. This does not relax the onchain verifier's target-value limit.

## Discarded vectors

| Vector | Result | Evidence |
|---|---|---|
| Wrong caller-supplied expected hash while raw header matches the canonical hash | FALSIFIED as a bypass; rejected by the existing `test_rejectsHeaderHashThatDoesNotMatchRecentBlockhash` | Foundry test |
| Mutated transaction value while keeping its claimed hash updated | FALSIFIED as a bypass; MPT path rejects the changed leaf | Existing hashed-branch mutation test |
| Remove the selected-index qualifier from the offchain 8 KiB check | Negative control reproduced L2-02 (`Entry 1 exceeds 8192 bytes`); regression test fails as predicted | One-character-code mutation, then restored |

## Limits of this review

The experiment establishes verifier behavior in Foundry, not Monad's live `BLOCKHASH`, RPC, gas, or deployment behavior. The offchain `eth_call` result remains RPC-reported; code-hash pinning does not authenticate a provider or make separate RPC reads atomic. The portable receipt is a transport format and must re-run verification; its stored payment fact, verdict, and source IDs are declarations, not attestations.
