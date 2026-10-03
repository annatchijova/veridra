# Veridra — architecture fracture

**Status:** D-002 records the selected staged evidence-authentication progression; implementation details remain open.
**Purpose:** record what “verified” can honestly mean before defining a Solidity interface.

## The problem being tested

The product hypothesis is that a merchant or marketplace sometimes receives a transaction hash or screenshot and must decide whether a specific payment claim is supported. The useful output is not merely “this transaction exists”; it is which asserted facts the evidence supports, contradicts, or cannot establish.

This is a hypothesis about a customer workflow, not a validated market finding. The nearest alternative is a block explorer or payment indexer. Veridra must show that claim-level interpretation and a scoped, shareable receipt remove meaningful work for a named operator. A screenshot-checking hook alone does not establish that difference.

## Evidence boundary

**Documented platform fact:** EVM contracts cannot read historical event logs after they are emitted; the Solidity documentation says logs are efficiently accessed from outside the blockchain. An ordinary contract call with a transaction hash therefore cannot independently retrieve that transaction's prior receipt or logs. [Solidity: Events](https://docs.soliditylang.org/en/latest/contracts.html#events)

**Security consequence:** a hash, RPC response, indexer result, or contract event is not self-authenticating merely because it is formatted as a receipt. Any historical-verification design needs an explicit authority for the transaction body, receipt, and canonical/finalized block root.

There is a second boundary at token semantics. A receipt log can establish that a contract emitted a `Transfer`-shaped event. It does not, by itself, establish that an arbitrary token contract moved balances according to the expected ERC-20 semantics. Veridra must define whether it supports an allowlist, a stronger balance-state proof, or a weaker issuer/contract assertion. No token should be labeled “USDC” from an untrusted address or display symbol alone.

## Threat model for the first design

**Attacker can:** submit arbitrary transaction hashes and claims; choose a token address; replay a receipt; provide malformed or oversized evidence; exploit stale or reorganized RPC data; and choose a token contract that emits misleading logs.

**Attacker cannot, under the intended chain trust model:** rewrite a finalized Monad block or forge a valid hash preimage. This does not authenticate a third-party RPC response, prove token behavior, or prove a wallet belongs to a named person.

**Trust boundaries:** Monad consensus/finality → block-root source → transaction/receipt proof or RPC response → token semantics → deterministic claim comparison → receipt consumer. Each boundary needs a named authority and a failure result before implementation.

## Candidate architectures

| Candidate | What it can establish | Trust / cost | Assessment |
|---|---|---|---|
| **A. One RPC source + deterministic offchain core** | Reproducible comparison of facts returned by the configured RPC for supported transaction types, attributed to its provider/source and observation time. | Trusts the RPC/operator and its historical data. A deterministic parser does not authenticate its input, and `RPC_ATTESTED` does not mean the provider cryptographically signed the response. | Selected for Level 1 because it is honest about its trust boundary and supports the initial claim-checking product. |
| **B. Quorum of RPC providers + offchain core** | Agreement between configured sources on transaction and receipt fields. | Trusts the quorum configuration and the assumption that providers are sufficiently independent. Matching answers detect some faults; they do not prove independence or consensus inclusion. | Better availability/fault detection than A; the “independent providers” claim needs evidence and a defined quorum. |
| **C. Inclusion proofs + authenticated finalized block roots** | Cryptographic inclusion of a transaction and/or receipt under an authenticated block root. | Requires proof parsing/verification. A recent root may be anchorable through standard EVM `BLOCKHASH`; older roots require a durable authenticated history mechanism. | Strong candidate for trust-minimized historical verification, but the recent-only window may be too short for a shareable product. Validate a narrow proof path before choosing it. |
| **D. Veridra-mediated payment flow** | Facts the payment contract enforces while the payment executes, with a receipt emitted by that same flow. | Trusts the contract code and supported token semantics; avoids historical RPC for those payments. Does not verify arbitrary prior transfers. | Strongest way to make a narrow Solidity verifier self-contained, but changes the product from “check any submitted tx hash” to “use Veridra's payment path.” |
| **E. ZK proof over payment facts** | A narrowly defined statement can be proven without revealing some witness fields. | ZK does not authenticate a prover-selected transaction, finalize a Monad block, or conceal ledger facts already public. It still needs authenticated payment evidence. | Orthogonal privacy capability for a later level; not a substitute for A–D's evidence source. |

## Monad-specific evidence findings (checked 2026-10-01)

- **Historical transaction data is available from full nodes, with an archive caveat.** Monad's docs list blocks, transactions, receipts, events, and traces as historical transactional data. They also say older transactional data is stored in a separate archive node as configured and operated by the RPC provider. This helps the producer retrieve a transaction; it does not cryptographically authenticate the response. [Monad: Historical Data](https://docs.monad.xyz/developer-essentials/historical-data)
- **Historical state is a different service problem.** Monad documents that full nodes do not expose arbitrary historic state by default. Do not make Level 1 depend on arbitrary old `eth_call` or balance queries without naming the archive provider and its retention behavior. The direct-transfer path should be based on transaction/receipt evidence, with its own declared token semantics. [Monad: Historical Data](https://docs.monad.xyz/developer-essentials/historical-data)
- **The transaction format set matters.** Monad's current transaction docs list types 0, 1, 2, and 4 (EIP-7702) as supported. A proof parser must scope supported envelopes explicitly; “EVM transaction” is not a sufficient parser specification. [Monad: Transactions](https://docs.monad.xyz/developer-essentials/transactions)
- **A recent block-root anchor may avoid a third-party root signer.** Standard EVM `BLOCKHASH` exposes the hashes of the 256 most recent completed blocks, excluding the current block. The protocol constraint is 256 blocks. Wall-clock duration must be derived from block cadence observed or documented for the target network; it is not a fixed receipt property. A Solidity verifier could compare a supplied encoded header's hash against `blockhash(blockNumber)` and then check transaction/receipt inclusion paths against roots in that header. [Solidity: `blockhash`](https://docs.soliditylang.org/en/latest/units-and-global-variables.html#block-and-transaction-properties), [Monad: Introduction](https://docs.monad.xyz/), [EVM opcode reference](https://ethereum.org/developers/docs/evm/opcodes)
- **Durable historical roots remain unresolved.** EIP-2935 describes a longer history stored in a system contract, but the Monad pages reviewed do not establish that Monad implements it. Do not assume this extension exists; confirm through an authoritative Monad spec or a discriminating test before using it. [EIP-2935](https://eips.ethereum.org/EIPS/eip-2935), [Monad: Differences from Ethereum](https://docs.monad.xyz/developer-essentials/differences)

### Cheapest discriminating experiment for candidate C

1. On Monad Testnet, query `blockhash(n)` for a recent completed block and one outside the 256-block window; confirm the expected available/zero behavior before relying on this EVM property on Monad.
2. For one small test transaction, produce the encoded header, transaction-trie proof, and receipt-trie proof from node data. Independently check that the header anchor, transaction hash, receipt status, transaction index, and selected transfer log all bind to the same block and index.
3. Mutate the transaction index, one proof node, receipt status, log emitter, recipient topic, amount, block number, and chain ID; each mutation must be rejected. Record verifier gas and remaining block distance before the block leaves `BLOCKHASH`'s range; report observed cadence separately if useful.
4. Separately establish whether any Monad-supported persistent block-hash history or trust-minimized root feed exists. If not, candidate C only supports a short “verify soon after settlement” path unless a keeper or signer assumption is added.

This is a proposed experiment, not a test run or a claim that the proof path is implemented.

## Selected progression and remaining design work

Keep the deterministic claim comparison separate from evidence acquisition and authentication. Give each adapter an explicit provenance/trust label; never let “deterministic” describe the truth of unverified inputs. A Solidity component should be added only for an enforced property: authenticated proof checking, authorized prior commitments, or a Veridra-mediated payment flow.

Keep the adjudication result separate from evidence authentication. `verdict` says whether the claim matches the normalized evidence within the declared scope. `evidence_assurance` says how that evidence is authenticated. Thus `VERIFIED / RPC_ATTESTED` is valid language when the claim matches evidence acquired from the named source, while making no claim that the source is honest or that consensus inclusion was independently checked. Receipts should identify provider/source, observation time, chain ID, transaction, receipt, logs, block number/hash, and which facts were deterministically checked.

The selected progression is: Level 1 uses RPC-attributed evidence; Level 2 adds recent transaction/receipt inclusion proofs anchored to `BLOCKHASH`; Level 3 uses a persistent authenticated-root mechanism for historical verification. Claim meaning and evidence shape stay stable while provenance/authentication changes. Level 2's lifetime is constrained in blocks (256), not a fixed number of seconds. Candidates B, D, and E remain alternatives or orthogonal capabilities, not prerequisites for Level 1.

## Open contract questions

1. **Input scope:** must Level 1 accept arbitrary already-mined Monad transaction hashes, or may a user pay through a Veridra contract?
2. **Evidence authority:** what exact RPC/provider identity, observation-time semantics, reorganization/finality policy, and persistent-root authority are acceptable at each level?
3. **Token semantics:** which exact token addresses are supported, and what evidence is sufficient to call a log a payment rather than merely a log emitted by that contract?
4. **Verdict aggregation:** the product notes use both three overall outcomes and `PARTIALLY_VERIFIED`. Decide whether partiality is an overall verdict or is represented only by per-assertion `PASS` / `FAIL` / `ABSTAIN` plus scope notes.
5. **First customer:** name the operator, the current manual workflow, the decision they need to make, and the failure cost before broadening the API.

These choices alter the trust boundary. No Solidity verifier, registry, or token-flow contract should be designed around guessed answers.

## Decision record

### D-001 — Keep historical evidence authentication open; do not claim onchain verification yet (superseded by D-002)

- **Decision:** no architecture is selected for authenticating arbitrary historical transaction evidence. Keep the claim engine conceptually separate from its evidence source; do not implement a contract that accepts a hash or caller-supplied facts and labels them verified.
- **Forces:** the product brief starts from a transaction hash; the target chain is Monad/EVM; historical logs are not readable by contracts; the project wants Solidity where it enforces a real property; a receipt must distinguish observed facts from authenticated facts.
- **Alternatives considered:** A, B, C, D, and E above. A/B retain source trust; C has the strongest path for historical proof but needs a root-authentication design; D is enforceable but narrows supported payments; E addresses disclosure, not evidence authenticity.
- **Assumptions:** arbitrary historical Monad hashes remain a product requirement; there is no already-selected Monad light-client/root oracle in this repository; a transparent weaker source label is preferable to overstating RPC-backed evidence.
- **Reversibility:** this non-decision is reversible. Once a proof format or public contract ABI ships, changing evidence authority and verdict meaning becomes a migration and consumer-coordination problem.
- **Revisit trigger:** the maintainer selects arbitrary-history versus Veridra-mediated settlement, a named root authority becomes available and acceptable, or customer discovery shows which trust level the first consumer requires.
- **Falsifier:** evidence that a selected source can authenticate the transaction body, receipt, token semantics, and finality under the declared threat model—or that the first user only needs an explicitly source-attributed observation—reopens the decision.

**Status:** superseded by D-002. D-001 remains here as a record of the earlier open decision; its non-decision is no longer current.

### D-002 — Stage evidence assurance without changing adjudication semantics

- **Decision:** Level 1 uses explicitly attributed RPC evidence (`RPC_ATTESTED`). Level 2 investigates recent transaction/receipt inclusion proofs anchored to `BLOCKHASH`, limited by the 256-block window. Level 3 targets persistent authenticated roots for historical receipts. Keep `verdict` separate from `evidence_assurance`; do not change the claim's meaning as assurance improves.
- **Forces:** Level 1 must be achievable without overstating trust; `BLOCKHASH` only exposes recent block hashes; durable historical receipts require a persistent root source; RPC evidence can be deterministically interpreted without being consensus-authenticated; consumers need to distinguish “claim matches these acquired facts” from “these facts were authenticated by this mechanism.”
- **Alternatives considered:** start at Level 2 and make recent verification a product constraint; wait for a light client/root oracle before any product work; use an RPC quorum; mediate all payments through a Veridra contract. The staged path gives Level 1 an explicit weaker assurance and leaves stronger paths additive. Quorum agreement is not a consensus proof; D narrows the supported flow.
- **Assumptions:** arbitrary already-mined transactions remain useful; the first user accepts a provider-attributed result when clearly labeled; the same normalized evidence and adjudication model can be reused across authentication mechanisms; the target Monad network supports the expected `BLOCKHASH` behavior, pending direct verification.
- **Reversibility:** this level plan is reversible before schema/ABI consumers exist. Receipt versions make later assurance variants explicit; once a public schema or contract ABI ships, incompatible changes require a new version and retained readers for the declared support window.
- **Revisit trigger:** first-user research rejects RPC trust; the target network does not support the expected proof path; a persistent-root mechanism has unacceptable authority/liveness assumptions; or source data cannot be normalized consistently across paths.
- **Falsifier:** a concrete user requirement shows that the Level 1 result is misleading even with explicit provenance, or a proof experiment cannot bind transaction, receipt, and claim facts to the same authenticated block root. If a proposed ZK path hides no information unavailable from public chain/context, omit it.

### D-003 — Keep recent inclusion verification read-only and RPC-attributed

- **Decision:** the offchain client may submit an acquired proof to a configured `RecentInclusionVerifier` through a read-only call, but reports only `RPC_REPORTED_RECENT_INCLUSION_ACCEPTED`. The contract anchors `keccak256(rawHeader)` and checks transaction/receipt MPT paths at the same index. An `eth_call` response is still provider-controlled, so this alone is not authenticated consensus evidence. The producer may derive a bounded direct-transfer fact from the exact raw transaction and receipt trie values; this binds extracted fields to those bytes but does not establish arbitrary token balance semantics. Claim adjudication is carried as a separate, recomputable result in the portable artifact.
- **Forces:** raw RPC data and RPC execution results are untrusted; inclusion and payment semantics are distinct properties; the `BLOCKHASH` window is temporary; the existing registry persists only `RPC_ATTESTED` receipts and must not silently upgrade them.
- **Alternatives considered:** accept local root reconstruction as proof (rejected: the caller could choose roots); combine inclusion and payment decoding before the decoder's supported transaction/log semantics are agreed (rejected: would conflate facts); ask the registry to persist a new assurance immediately (deferred until receipt schema and fact binding are specified).
- **Assumptions:** callers maintain an explicit `(chainId, address, runtimeCodeHash)` pin for the reviewed verifier deployment; callers understand the label as an RPC report, not independent proof; the RPC's bytecode and `eth_call` responses correspond to the same canonical recent state. The client checks the pin but cannot authenticate the provider or make its reads atomic.
- **Reversibility:** this original decision kept publication out of scope. D-004 supersedes that boundary with an additive, separately versioned portable artifact; changing registry assurance remains deliberately out of scope.
- **Revisit trigger:** supported payment-fact policy is validated, a portable receipt schema is designed, or the deployment workflow can provide an authenticated source for the verifier pin.
- **Falsifier:** a caller can obtain the RPC-reported acceptance without the reviewed verifier accepting both MPT paths against that execution's `BLOCKHASH`, or consumers interpret it as independently authenticated consensus evidence or as a payment assertion.

### D-004 — Keep portable inclusion evidence additive and re-verifiable

- **Status:** accepted by maintainer on 2026-10-02.
- **Decision:** define a separate versioned JSON artifact (`veridra.portable-inclusion-receipt`, schema version 1) rather than changing the deployed Level 1 registry's schema or assurance enum. It carries the bounded raw header, transaction and receipt trie values/proofs, block and chain coordinates, normalized claim, derived payment fact, token policy used for decoding, caller-declared verifier deployment pin, declared proof/producer RPC source IDs, and recomputable claim verdict/checks. The artifact's stored fact/verdict/source fields are assertions: a consumer must rederive facts from raw values, recompute claim checks, and re-submit the proof through a locally configured pinned verifier before reporting `RPC_REPORTED_RECENT_INCLUSION_ACCEPTED`. The artifact and result do not independently authenticate RPC responses or claim `RECENT_BLOCKHASH` assurance. Unknown schemas/fields, malformed bounds, and mismatches reject. Verification is available only while the block is within the EVM `BLOCKHASH` window; this artifact does not promise durable historical verification.
- **Forces:** the existing registry is deployed and its version-1 schema means `RPC_ATTESTED`; silently changing it would mislabel existing receipts. The proof and fact extractor already produce a bounded proof bundle, but the wrapper result is only an RPC report. Consumers need an exportable artifact without inheriting the producer's claim that it was verified. The `BLOCKHASH` proof is ephemeral by design.
- **Alternatives considered:** migrate the deployed registry to store dynamic proof bytes (rejected: incompatible, higher storage/gas cost, and not required for portable verification); store only a proof digest (rejected: the evidence is not portable without the bytes); mark the artifact itself as authenticated when created (rejected: the producer RPC remains untrusted and verification is time/state dependent). Best argument for registry storage: an onchain reference can provide durable discoverability, but a reference is not the proof and requires a separate lifecycle/availability model.
- **Assumption this rests on:** consumers can obtain a trusted local deployment pin and a chain RPC they are willing to use for a read-only check; the portable proof package is useful within the short recent-block window. If consumers require later verification, Level 3 must supply durable authenticated roots rather than weakening this check.
- **Reversibility:** one-way-ish because exported files may persist outside this repository. Keep this format additive and versioned; never reinterpret schema version 1, and retain its verifier while version 1 remains supported.
- **Consequences:** Level 1 receipts and CLI remain unchanged; the new format can be distributed as JSON but does not prove the producer's original verification or remain verifiable after the window. Token policy in the file is declarative and does not prove arbitrary token semantics.
- **Revisit trigger:** a consumer requires verification after 256 blocks, real use shows this payload is too large, or an authenticated persistent root/deployment manifest becomes available.
- **Falsifier:** an independent consumer accepts a modified fact, claim, proof, chain, verifier pin, unknown schema, or out-of-bound payload; or the resulting package is treated as authenticated without a fresh verifier check. Source IDs are explicitly caller-declared labels, not authenticated assertions: changing one is expected to change only the displayed provenance label, not the recomputed verification result.
- **Anchored at:** `offchain/src/portableReceipt.ts` and its versioned parser/verifier; adversarial inclusion evidence is in [`RED_TEAM_LEVEL2.md`](RED_TEAM_LEVEL2.md).

## Naming check

**Veridra** is the selected working name in this repository. Public copy should describe “payment evidence” or “scoped verification” and name the applicable assurance; the name does not itself promise trustlessness, privacy, settlement finality, or legal proof.
