# Veridra — Technical README

This document records the design at repository inception. Proposed behavior is labeled as intent; it is not evidence of an implementation.

## Product boundary

The intended input is a Monad transaction hash plus explicit payment assertions such as asset, amount, sender, and recipient. The intended output is a set of per-assertion outcomes (`PASS`, `FAIL`, `ABSTAIN`) and an overall verdict:

| Verdict | Intended meaning |
|---|---|
| `VERIFIED` | Every applicable assertion in the declared scope matches the acquired and normalized evidence. This is scoped to the evidence assurance reported alongside it. |
| `NOT_VERIFIED` | Usable evidence contradicts at least one applicable assertion. |
| `INSUFFICIENT_EVIDENCE` | Required evidence could not be acquired, reconstructed, interpreted, or authenticated under the selected path. |

`verdict` and `evidence_assurance` are orthogonal. For example, `VERIFIED / RPC_ATTESTED` means the claim matches evidence returned by the declared RPC source; it does not mean the provider cryptographically signed the response or that consensus inclusion was independently proven. The planned assurance progression is `RPC_ATTESTED`, `RECENT_BLOCKHASH_PROOF`, then `PERSISTENT_ROOT_PROOF`. Exact enum names and encoding remain implementation decisions. An example in the product brief also uses `PARTIALLY_VERIFIED`; whether that is an overall verdict or whether partiality remains visible only in per-assertion outcomes is unresolved. The product does not claim to establish wallet ownership, legal settlement of an obligation, or offchain delivery.

Every persistent receipt must carry an explicit `schema_version`. A reader selects the parser/verifier for that version and rejects unknown versions or assurance variants explicitly; it must not silently map an unknown variant to a weaker or stronger known value. A change that old consumers cannot safely interpret requires a new schema version, and supported old versions retain their readers/verifiers for the declared compatibility period. This is a design requirement, not a finalized ABI.

Conceptually, a receipt contains distinct sections rather than one overloaded “verified” flag:

```text
schema_version
claim + scope
verdict + per_assertion_results
evidence_assurance
evidence_provenance { chain_id, provider/source, observed_at, block_number, block_hash }
evidence_reference { transaction, receipt, relevant_logs }
deterministic_checks
```

The exact encoding, canonicalization, and retention policy are open. For Level 1, `provider/source` names the configured source; it must not imply a cryptographic provider signature.

## Destination and levels

**Destination:** a payment-verification service for merchants, marketplaces, and automated agents. A client supplies a bounded payment claim; Veridra returns evidence, per-assertion outcomes, and a receipt that can be independently checked. The service must make its evidence source and trust assumptions visible. It must not turn a ledger fact into a claim about identity, contract performance, or legal discharge.

Each level below is a coherent product state. None is a disposable prototype, and the later levels must extend earlier ones without bypassing their evidence or authorization rules. All levels are proposed; none is implemented.

The intended product has a normal public-evidence path and may have a separate selective-disclosure path. This diagram is conceptual; the privacy path exists only if Level 7 passes its entry conditions. Claim semantics remain stable as the authentication path improves.

```mermaid
flowchart TD
    L[Monad public ledger] --> E[Acquired payment evidence]
    E --> A[Evidence authentication: RPC → recent proof → persistent root]
    A --> C[Deterministic claim adjudication]
    C --> R[Versioned receipt: verdict + evidence assurance]
    R --> V[Standard receipt verifier]

    E --> Z[Optional private-policy proof]
    P[Private agreement or policy] --> Z
    Z --> Q[Private receipt: proves a scoped relation]
    Q --> ZV[ZK verifier]
```

The private path must preserve the link between evidence authenticated under its declared assurance level and the proved statement. A proof over prover-selected payment facts alone is insufficient. The standard receipt remains available whether or not the optional path is built.

### Level 1 — RPC-attested single-payment evidence

Accept one Monad transaction hash and explicit assertions about one supported direct native MON transfer or direct ERC-20 transfer. Obtain the transaction, receipt, relevant logs, block number/hash, and chain ID from a declared RPC/provider; record when the evidence was observed and which facts were deterministically checked. Compare every asserted field and return a bounded, versioned receipt. `RPC_ATTESTED` means provider-attributed acquisition under this design; it is not a provider signature and does not claim trustless or consensus-authenticated history.

**Complete when:** the provider/source identity and observation timestamp are in the receipt; the receipt records chain ID, transaction/receipt/log evidence, block number/hash, and the exact deterministic checks; both supported transfer forms have explicit extraction rules; unsupported forms fail closed; and amount units, token identity, reorganization/finality policy, verdict semantics, and RPC trust limits are specified. This level does not infer invoice references, contract-internal transfer semantics, identity, or delivery.

### Level 2 — Recent inclusion-proof receipt

Upgrade the same receipt's evidence assurance by verifying transaction and receipt inclusion against a block header whose hash is anchored with EVM `BLOCKHASH`. The header must remain in the 256 most recent completed-block window when checked. The 256-block bound is the protocol constraint; any wall-clock duration is derived from actual network cadence and is not a fixed receipt guarantee. The adjudication semantics and claim evidence shape do not change.

**Complete when:** the proof binds transaction, receipt, index, block header, chain, and selected transfer facts; the target Monad network's behavior is confirmed; malformed or mutated proofs fail closed; and the timing/availability limit is stated in blocks. A proof against a caller-supplied root without an authenticated anchor is insufficient.

### Level 3 — Persistent historical-root receipts

Preserve independent verification beyond the recent `BLOCKHASH` window using an authenticated persistent root mechanism, such as a maintained light client, oracle, or checkpointing system. The mechanism and its trust assumptions are explicit; “persistent” describes the retained authenticated history, not an unspecified trustless property.

**Complete when:** root authority, update/finality rules, censorship and liveness assumptions, historical coverage, and recovery behavior are specified; old receipts remain verifiable under the declared mechanism; and adversarial review tests conflicting roots and authority failures.

### Level 4 — Prior payment expectations

Allow a payer or recipient to register an authorized expectation before settlement. A later verified transfer can be compared with that prior expectation to establish whether the stated sender, recipient, asset, amount, reference, and deadline match. The registration mechanism may use Solidity only if its authority and temporal-order properties are defined and actually enforced.

**Complete when:** registration authority, duplicate handling, privacy of public-chain data, temporal ordering, and expiry are specified; every state has a terminal path; and no value is held unless every reachable terminal state has an explicit disposition. A commitment registry that only stores a hash must not be described as verifying the committed terms.

### Level 5 — Merchant or marketplace integration

Expose the completed receipt flow through a user-facing path and an API or SDK for one named first customer type. A client can request verification and consume the result without reimplementing EVM transaction semantics. The integration handles retries, duplicate requests, stale reads, and chain reorganizations according to a declared finality policy.

**Complete when:** the first user and the workflow being replaced are named; integrations receive the same scoped evidence result as the verifier; repeated requests are safe; and no external action is triggered by a result whose required evidence is unavailable or unauthenticated.

### Level 6 — Bounded complex payments and claim disputes

Add transaction shapes such as multiple transfers, router-mediated payments, or internal calls only one at a time, with an explicit reconstruction rule for each. Compare contradictory claims against the same authenticated evidence and report consistency without deciding who is truthful in a human or legal sense.

**Complete when:** every added shape has an independent evidence rule, unsupported shapes remain distinguishable, resource bounds are explicit, and adversarial review confirms that all earlier level invariants still hold. An unbounded “supports any EVM transaction” claim is outside this level.

### Level 7 — Private receipt (optional, gated)

Add a ZK-backed receipt only for a user who needs to prove a statement about private commercial terms or an undisclosed policy—for example, that an amount is within an authorized range or a recipient belongs to an allowed set—without revealing the full terms. This is an optional capability alongside the ordinary receipt; users who do not need selective disclosure must not pay its proof-generation or verification complexity.

**Entry conditions:** name the first user and the exact disclosure they cannot accept; inventory each input as already public on Monad or genuinely private; state the public statement and private witness precisely; show that the proof binds the relevant policy/commitment to authenticated payment evidence rather than accepting prover-chosen facts; and compare simpler alternatives such as a scoped public receipt or a signed selective-disclosure statement. If the proof does not reduce a named disclosure, do not add it.

**Complete when:** the verifier checks the exact statement and all public inputs, including chain, verifier/circuit version, policy commitment, and freshness or replay domain; an independent implementation can reject altered or mismatched witnesses; the ordinary receipt path remains available unchanged; and adversarial review checks both proof soundness boundaries and the information the public transcript still reveals. No cryptographic security claim is made until the exact construction, dependencies, setup assumptions, and verification evidence are reviewed.

**Privacy boundary:** Monad's public ledger remains public. ZK cannot hide a transfer amount, address, token, or timing that an observer can already read from the ledger. A potential gain is hiding an additional private agreement, reference mapping, authorization policy, or relation between public ledger facts and private terms. The privacy claim is falsified if the supposedly hidden fact can be reconstructed from the public chain and available context, or if the proof does not disclose less than the non-ZK alternative.

ZK is not a required milestone and does not define the product's trust model. Its inclusion must be earned by a measurable selective-disclosure requirement. If no such requirement survives user research and adversarial analysis, Level 7 is omitted.

## Construction rule: destination-driven, never MVP-shaped

This repository follows the `destination-driven-construction` skill. Levels are product states, not technical phases such as “security now, persistence later.” Security, evidence provenance, bounded work, explicit authority, and honest failure states are properties of every level that needs them from its first implementation.

**Reduce depth, not integrity.** Under a deadline, attempt fewer complete levels. Do not propose a disposable MVP, demo-only contract, or thin implementation that postpones a load-bearing property. A level is complete only when its own acceptance conditions and inherited invariants hold; unreached levels remain unbuilt.

Each new level receives an adversarial review for its own behavior and preservation of earlier invariants. At the chosen stopping level, perform an integrated adversarial review across all completed levels before integrated verification. This cadence does not delay local evidence or checks required by other skills, and it does not create a new TDD mandate. See the `destination-driven-construction` skill for the full method.

## Intended evidence path

```mermaid
flowchart LR
    C[Payment claim] --> A[Evidence acquisition from declared RPC]
    A --> N[Normalize transaction facts]
    N --> H[Authenticate/label evidence assurance]
    H --> J[Compare each asserted fact]
    J --> V{Scoped verdict}
    V -->|supported relative to evidence| P[VERIFIED]
    V -->|contradicted| F[NOT_VERIFIED]
    V -->|missing, unsupported, or invalid evidence| I[INSUFFICIENT_EVIDENCE]
    H --> R[Receipt records evidence assurance]
    J --> R
```

This is a conceptual flow, not an implemented architecture. The intended onchain component will be written in Solidity. It is not yet decided whether a contract will verify a proof, accept an attestation, record a receipt, or be unnecessary for the first verification flow.

## Trust boundary: historical EVM evidence

An EVM contract cannot query arbitrary historical transaction receipts or read past event logs. Solidity's documentation states that contracts cannot access log data after creation; logs are accessed from outside the chain. Therefore, passing a transaction hash to a contract does not let that contract independently reconstruct the transaction's past transfers. [Solidity documentation](https://docs.soliditylang.org/en/latest/contracts.html#events) · [Ethereum data storage strategies](https://ethereum.org/developers/docs/data-availability/blockchain-data-storage-strategies/)

Any design for historical payment verification must identify how offchain transaction data becomes authenticated. Level 1 intentionally uses a declared RPC/provider as the acquisition authority and labels that provenance `RPC_ATTESTED`; this label is not evidence that the provider signed its response. Later levels may add inclusion proofs or persistent authenticated roots. A contract that merely stores a caller-supplied hash would provide a record of that submission, not proof that the underlying payment claim is true.

Monad's current documentation says full nodes provide historical transactions, receipts, events, and traces, with older data served from archive nodes configured and operated by providers; arbitrary historical state is a separate, limited capability. This supports evidence acquisition through RPC, but not authentication of an RPC answer. Monad also documents transaction types 0, 1, 2, and 4 (EIP-7702), so any proof parser must explicitly scope supported envelopes. [Monad historical data](https://docs.monad.xyz/developer-essentials/historical-data) · [Monad transactions](https://docs.monad.xyz/developer-essentials/transactions)

Standard EVM `blockhash` exposes hashes for only the 256 most recent completed blocks. That 256-block bound is the protocol constraint. Any approximate wall-clock window depends on block cadence observed or documented for the target network and must not be frozen into the receipt protocol. A verifier could anchor a supplied block header to `blockhash`, then verify transaction and receipt inclusion under its roots. Whether this works on the selected Monad network must be checked directly. The reviewed Monad docs do not establish EIP-2935 history-storage support; do not assume it. [Solidity `blockhash`](https://docs.soliditylang.org/en/latest/units-and-global-variables.html#block-and-transaction-properties) · [Monad introduction](https://docs.monad.xyz/) · [EIP-2935](https://eips.ethereum.org/EIPS/eip-2935)

The alternatives, trust model, selected progression, and decision record are in [`docs/ARCHITECTURE_FRACTURE.md`](docs/ARCHITECTURE_FRACTURE.md).

## Security properties to preserve

These are design requirements, not implemented guarantees:

- **Fail closed:** fetch, decode, proof, or verification failures must not produce `VERIFIED`.
- **Scoped claims:** unspecified fields are `ABSTAIN`; they are not treated as successful checks.
- **No overreach:** ledger evidence must not be presented as proof of identity, legal discharge, or physical delivery.
- **Deterministic comparison:** use integer token units and explicit chain/token identifiers; avoid floating-point values and ambiguous display strings in consequential comparisons.
- **Bounded inputs and work:** define limits for dynamic arrays, calldata, supported token types, and evidence size before implementation.
- **Explicit authority:** document who can submit, attest, revoke, or challenge evidence before any contract holds value or creates a durable verdict.

## Decisions still open

1. **Evidence authentication details:** Level 1's RPC source identity, observation-time semantics, finality/reorg policy, and exact receipt fields; Level 2's proof format and supported transaction/receipt trie rules; Level 3's persistent-root authority and update rules. The level progression is decided, while these implementation details remain open. See [`docs/ARCHITECTURE_FRACTURE.md`](docs/ARCHITECTURE_FRACTURE.md).
2. **Transaction scope:** native MON and ERC-20 are the suggested first cases in the project brief. Internal calls, routers, multiple transfers, and non-standard tokens need explicit support decisions; they must not be implied by a generic “transaction verified” label.
3. **Onchain role:** identify a product property that requires a contract. Commitments and receipt registries are candidates only if they add a named property beyond an offchain signed or sealed result.
4. **User and distribution:** name the first user and test the claim workflow before expanding into invoice settlement or dispute adjudication.
5. **Network and finality:** define the confirmation/finality policy used before reporting a result, and how reorganization or unavailable RPC history affects it.

## Falsifiers and implementation evidence

The fail-closed requirement is falsified if missing, unsupported, malformed, or invalid evidence yields a non-insufficient verdict. The scoping requirement is falsified if an omitted claim field is represented as a passing check. The assurance label is falsified if a receipt claims a stronger authentication mechanism than the verifier actually checked. A `VERIFIED / RPC_ATTESTED` result is falsified when the claim does not match the evidence returned by its declared source; it does not independently attest that source's honesty.

No contracts, tests, demo, or deployment exist in this repository yet. Once implemented, this section must name the test cases and artifacts that support each claim; a green test suite will support only the cases it actually covers.

## Source context

PROOF is the conceptual reference: a local Python/Stellar project with claim validation, evidence extraction, per-field adjudication, three verdicts, and sealed bundles. Veridra is a new Solidity-oriented implementation for an EVM chain. No source code from PROOF is copied into this repository.
