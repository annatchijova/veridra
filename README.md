[English](README.md) · [Español](README_ES.md) · **[Technical README](TECHNICAL_README.md)**

# Veridra

Someone can show you a transaction hash or a convincing payment screenshot. That still leaves the useful question unanswered: **does the onchain evidence support the payment they claim happened?**

Veridra is a hackathon project in its initial setup. Its intended product is a payment-claim verifier for Monad: compare a structured claim with evidence about a transaction and report what the evidence supports, what it contradicts, and what could not be established. The onchain component is intended to be written in Solidity. The evidence source and the boundary between onchain and offchain work are still design decisions.

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

The product is not implemented yet. This checkout has no Solidity contracts, executable demo, deployed endpoint, or test results to report. See the [technical design and open decisions](TECHNICAL_README.md).

## Destination and levels

The destination is a payment verification service that merchants, marketplaces, and automated agents can use to check a payment claim against authenticated Monad evidence and receive a scoped, reproducible result. The project will build toward that destination in complete levels:

| Level | Product state |
|---|---|
| 1 | Verify a claim about one supported Monad payment, initially a direct native MON transfer or a direct ERC-20 transfer. Unsupported transaction shapes return insufficient evidence. |
| 2 | Produce a versioned evidence receipt that another verifier can check independently, including the evidence source and the exact scope of the result. |
| 3 | Let a payer or recipient register an authorized payment expectation before settlement, so a reference or deadline is tied to prior evidence rather than inferred from a transfer. |
| 4 | Give a named merchant or marketplace an API and user flow to consume receipts safely, including duplicate requests and chain reorganization handling. |
| 5 | Extend the verified transaction shapes and dispute comparisons only where each supported transfer can be reconstructed and each result remains bounded to its evidence. |
| 6 (optional) | Offer a private receipt only if a real user needs to prove a policy about private commercial terms without disclosing those terms, and a ZK proof hides information beyond what the public ledger already reveals. |

Every level must be useful on its own and carry the integrity, authority, and failure-handling rules required by the destination. If hackathon time runs short, the project will stop at the highest complete level reached instead of shipping thinner versions of every level. The optional privacy level can be omitted without changing the standard receipt path. The [Technical README](TECHNICAL_README.md) records the level boundaries and shared invariants.

## Intended flow

1. A user supplies a Monad transaction hash and the payment facts they want checked.
2. Veridra obtains and normalizes transaction evidence.
3. Each asserted fact is compared with the evidence and receives `PASS`, `FAIL`, or `ABSTAIN`.
4. The result distinguishes a supported claim, a contradicted claim, and insufficient evidence.

The exact evidence acquisition and verification model has not been selected. Smart contracts cannot read historical event logs directly; a design that uses past transaction evidence must state how that evidence is authenticated. The alternatives and the consequence for the Solidity boundary are documented in the [Technical README](TECHNICAL_README.md).

## Repository

```text
veridra/
├── README.md             # English project overview
├── README_ES.md          # Spanish adaptation
└── TECHNICAL_README.md   # Design, trust boundaries, and unresolved choices
```

This repository is at project inception. There is no runnable setup command yet. The initial target is Monad, with the intended onchain component in Solidity; no testnet or mainnet deployment is claimed.

## Current evidence

The product direction is informed by the local PROOF project, whose existing implementation verifies Stellar payment claims in Python. Veridra is a new implementation direction, not a port of that source code. No behavior described above has yet been implemented or independently verified in this repository.

For architecture, threat boundaries, design choices, and falsifiers, see the **[Technical README](TECHNICAL_README.md)**.
