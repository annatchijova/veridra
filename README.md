[English](README.md) · [Español](README_ES.md) · **[Technical README](TECHNICAL_README.md)**

# Veridra

Someone can show you a transaction hash or a convincing payment screenshot. That still leaves the useful question unanswered: **does the onchain evidence support the payment they claim happened?**

Veridra is a payment-claim verifier for Monad: compare a structured claim with evidence about a transaction and report what the evidence supports, what it contradicts, and what could not be established. The first Solidity contracts implement deterministic adjudication and an immutable receipt registry for one authorized publisher. RPC acquisition and transaction extraction remain offchain work; the contracts do not authenticate the publisher's RPC response.

## A concrete example

The example below describes intended behavior; it is not a running demo.

```text
Claim: 100 USDC was transferred from Alice to Bob
Evidence: transaction succeeded; a matching token transfer was found
Result: VERIFIED for those stated ledger facts
```

If the transfer went to a different address, the result should be `NOT_VERIFIED`. If the transaction or relevant transfer evidence cannot be obtained or interpreted, the result should be `INSUFFICIENT_EVIDENCE`. A successful transaction by itself does not establish every payment claim.

## What a result is meant to say

Veridra is scoped to facts that can be tied to the selected chain evidence. A ledger result does not by itself establish who controlled a wallet, whether an invoice was legally satisfied, or whether goods or services were delivered. A claim can only be checked to the extent that the transaction data and the chosen evidence source support it.

The Level 1 contract core compiles with Solidity 0.8.24 using the repository's `via_ir` setting. An offchain TypeScript module now acquires bounded RPC evidence; the publisher CLI/transaction flow, tests, and deployment are still pending. See the [technical design and open decisions](TECHNICAL_README.md).

The first evidence path is deliberately scoped: Level 1 uses RPC-acquired evidence with explicit source attribution. Its receipt does not claim trustlessness. Later levels strengthen how the same evidence is authenticated, without changing what a payment claim means. The [architecture decision record](docs/ARCHITECTURE_FRACTURE.md) explains the progression and its limits.

## Destination and levels

The destination is a payment verification service that merchants, marketplaces, and automated agents can use to check a payment claim against Monad evidence with an explicit assurance level and receive a scoped, reproducible result. The project will build toward that destination in complete levels:

| Level | Product state |
|---|---|
| 1 | Verify a claim about one supported Monad payment using explicitly attributed RPC evidence. The receipt identifies the provider/source and observation context; it does not claim trustless historical authentication. |
| 2 | Produce a versioned, portable evidence receipt and independently check recent transaction/receipt inclusion against `BLOCKHASH`, while the block remains within the 256-block window. |
| 3 | Preserve historical verification with an authenticated persistent root source, such as a light client, oracle, or checkpoint mechanism whose trust assumptions are explicit. |
| 4 | Let a payer or recipient register an authorized payment expectation before settlement, so a reference or deadline is tied to prior evidence rather than inferred from a transfer. |
| 5 | Give a named merchant or marketplace an API and user flow to consume receipts safely, including duplicate requests and chain reorganization handling. |
| 6 | Extend supported transaction shapes and claim comparisons only where each transfer can be reconstructed and each result remains bounded to its evidence. |
| 7 (optional) | Offer a private receipt only if a real user needs to prove a policy about private commercial terms without disclosing those terms, and a ZK proof hides information beyond what the public ledger already reveals. |

Every level must be useful on its own and carry the integrity, authority, and failure-handling rules required by the destination. If hackathon time runs short, the project will stop at the highest complete level reached instead of shipping thinner versions of every level. The optional privacy level can be omitted without changing the standard receipt path. The [Technical README](TECHNICAL_README.md) records the level boundaries and shared invariants.

## Intended flow

1. A user supplies a Monad transaction hash and the payment facts they want checked.
2. Veridra obtains and normalizes transaction evidence.
3. Each asserted fact is compared with the evidence and receives `PASS`, `FAIL`, or `ABSTAIN`.
4. The result distinguishes a supported claim, a contradicted claim, and insufficient evidence.

The claim comparison stays stable as evidence authentication improves. Each receipt carries a scoped `verdict` separately from an `evidence_assurance` label: for example, `VERIFIED` relative to acquired evidence can coexist with `RPC_ATTESTED`. Smart contracts cannot read historical event logs directly; the authentication path and its limits are documented in the [Technical README](TECHNICAL_README.md).

## Repository

```text
veridra/
├── src/                  # Solidity adjudicator and immutable receipt registry
├── offchain/src/         # Bounded Monad JSON-RPC evidence acquisition
├── foundry.toml          # Solidity 0.8.24 / Monad Testnet RPC profile
├── README.md             # English project overview
├── README_ES.md          # Spanish adaptation
└── TECHNICAL_README.md   # Design, trust boundaries, and unresolved choices
```

There is no runnable end-to-end command yet, and no testnet or mainnet deployment is claimed. Amounts use exact integers in the asset's smallest unit. No floating-point arithmetic is used.

## Current evidence

The product direction adapts PROOF's useful semantics—explicit claims, `PASS` / `FAIL` / `ABSTAIN`, and distinct overall verdicts—to EVM transaction evidence. Veridra is a new Solidity and TypeScript implementation, not a source-code port. Solidity compilation and TypeScript type checking have been run; runtime behavior, RPC response handling, end-to-end submission, and deployment have not been verified.

For architecture, threat boundaries, design choices, and falsifiers, see the **[Technical README](TECHNICAL_README.md)**.
