# Veridra — project instructions

## Product destination

Build a payment-verification service for merchants, marketplaces, and automated agents. It accepts bounded claims about Monad payments and returns evidence-backed, scoped results. Monad is the first target network. The intended onchain component is Solidity; do not assume every verification function belongs onchain.

PROOF is a conceptual reference, not a source-code base. Veridra is a fresh implementation. Preserve useful principles—explicit claims, deterministic comparison, `PASS` / `FAIL` / `ABSTAIN`, distinct overall outcomes, evidence provenance, and stated scope—only after adapting them to EVM transaction semantics and a declared evidence-authentication model.

## Destination-driven construction

Follow the `destination-driven-construction` skill. The destination is the complete product described in `TECHNICAL_README.md`; the planned product levels are summarized in `README.md` and specified there.

- A level is a coherent, useful product state, not a technical phase or feature checklist.
- Build each attempted level with the integrity, authority, persistence, and failure properties it needs from its first implementation.
- **Reduce depth, not integrity.** Under time pressure, stop at fewer complete levels. Do not suggest an MVP, demo-only approximation, or deferral of a load-bearing property unless the maintainer explicitly asks for that trade-off.
- Do not start a level until its evidence model, authority, scope, and acceptance conditions are explicit.
- Review every new level adversarially for its own behavior and for preservation of previous level invariants. At the chosen stopping level, perform an integrated adversarial review before integrated verification.
- This cadence does not defer local verification required by other skills and does not impose TDD where no other instruction requires it.

## Invariants for every level

- A ledger fact is not proof of wallet ownership, legal settlement, invoice satisfaction, or offchain delivery.
- Missing, ambiguous, unauthenticated, or unsupported evidence cannot produce `VERIFIED`.
- An unspecified assertion is not a passing check. Keep `ABSTAIN` distinct from `FAIL` and from an acquisition/verification error.
- State exactly what evidence source authenticates a transaction fact. A transaction hash or a hash stored by a contract does not authenticate caller-supplied claims by itself.
- Use exact integer token units and explicit chain/token identity in consequential comparisons.
- Bound inputs, loops, arrays, and evidence size. Treat reorganization, retry, replay, duplicate submission, and failed external calls as ordinary states.
- Before any contract holds or routes value, trace every amount through every reachable state and name its payout or recovery path. Every terminal state has an explicit value disposition.
- Use Solidity contracts only where they enforce a named property. A registry is not a verifier unless it actually verifies evidence.
- Treat the ZK-backed private receipt as an optional capability, not a core dependency. Add it only after naming a real user's disclosure requirement, separating private agreement data from public ledger facts, binding the proof to authenticated evidence, and showing that simpler selective-disclosure approaches do not meet the requirement. Never claim ZK hides data already public on Monad. If the proof hides no additional, named information, omit the level.
- Do not claim a level is complete, a property works, or a deployment exists without checking the corresponding source and evidence.

## Documentation and licensing

Keep the public introduction in `README.md`, its Spanish adaptation in `README_ES.md`, and full design/invariants/decisions in `TECHNICAL_README.md`. Order the public README from problem to observable behavior to mechanism to evidence; scope every capability claim to what exists and has been checked.

Do not add a `LICENSE` file or SPDX license identifier until the maintainer explicitly decides the licensing terms. Do not copy PROOF's license or source files into this repository.
