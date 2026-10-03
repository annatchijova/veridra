[English](README.md) · [Español](README_ES.md) · **[Technical README](TECHNICAL_README.md)**

# Veridra

Someone can show you a transaction hash or a convincing payment screenshot. That still leaves the useful question unanswered: **does the onchain evidence support the payment they claim happened?**

Veridra is a payment-claim verifier for Monad: compare a structured claim with evidence about a transaction and report what the evidence supports, what it contradicts, and what could not be established. The first Solidity contracts implement deterministic adjudication and an immutable receipt registry for one authorized publisher. RPC acquisition and transaction extraction remain offchain work; the contracts do not authenticate the publisher's RPC response.

## A concrete example

The example below is illustrative (a token payment Level 1 does not yet have live evidence for); a real example, run live against Monad testnet with a native MON transfer, is in "Live on Monad testnet" below.

```text
Claim: 100 USDC was transferred from Alice to Bob
Evidence: transaction succeeded; a matching token transfer was found
Result: VERIFIED for those stated ledger facts
```

If the transfer went to a different address, the result should be `NOT_VERIFIED`. If the transaction or relevant transfer evidence cannot be obtained or interpreted, the result should be `INSUFFICIENT_EVIDENCE`. A successful transaction by itself does not establish every payment claim.

## What a result is meant to say

Veridra is scoped to facts that can be tied to the selected chain evidence. A ledger result does not by itself establish who controlled a wallet, whether an invoice was legally satisfied, or whether goods or services were delivered. A claim can only be checked to the extent that the transaction data and the chosen evidence source support it.

The Level 1 Solidity contract core and TypeScript RPC acquisition/publication library are implemented. The contracts compile with Solidity 0.8.24 using the repository's `via_ir` setting. 41 Foundry tests (`forge test`) exercise the adjudicator, registry, recent-inclusion verifier, and guarded verifier deploy script; 53 Node.js tests (`npm test` in `offchain/`) exercise claim parsing, RPC evidence acquisition, proof construction and bounds, raw payment-fact extraction, portable receipt export/reverification, inclusion-client boundaries, and independent receipt verification. A minimal CLI (`node dist/cli.js verify <receiptId> ...` / `publish ...`) wraps the acquisition, publication, and independent-verification library, and has been run live against Monad testnet — see "Live on Monad testnet" below. See the [technical design and open decisions](TECHNICAL_README.md).

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
├── test/                 # Foundry tests for the Solidity contracts
├── script/               # Deploy.s.sol — run live against Monad testnet
├── offchain/src/         # RPC evidence acquisition, publication, independent
│                         # verification, and a minimal CLI
├── foundry.toml          # Solidity 0.8.24 / Monad Testnet RPC profile
├── README.md             # English project overview
├── README_ES.md          # Spanish adaptation
└── TECHNICAL_README.md   # Design, trust boundaries, and unresolved choices
```

The offchain package build and trust boundary are documented in [`offchain/README.md`](offchain/README.md).

Amounts use exact integers in the asset's smallest unit. No floating-point arithmetic is used.

## Deploying to Monad testnet

```bash
cp .env.example .env   # fill in PRIVATE_KEY (a funded Monad testnet account)
source .env

forge script script/Deploy.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

The Level 2 inclusion verifier is a separate, read-only deployment. Its script
refuses to broadcast unless the connected chain ID is Monad testnet (`10143`):

```bash
forge script script/DeployRecentInclusionVerifier.s.sol \
  --rpc-url monad_testnet \
  --broadcast \
  --verify --verifier sourcify --verifier-url https://sourcify-api-monad.blockvision.org/
```

Record the emitted address and runtime code hash as the caller-maintained
`VerifierDeploymentPin`; neither is authenticated by the script's output alone.

Needs a Monad testnet account funded with MON from [faucet.monad.xyz](https://faucet.monad.xyz). `.env` is gitignored; never commit it.

## Live on Monad testnet

`VeridraReceiptRegistry` is deployed and Sourcify-verified (`exact_match`) at
[`0x2a78a4542CC70929DCd8e7a8dE096588F7607f61`](https://testnet.monadexplorer.com/address/0x2a78a4542CC70929DCd8e7a8dE096588F7607f61),
publisher `0x298b1699B81660B027aF05A70b3B10CCaCdd2063`.

Exercised live end-to-end against a real transaction — a 0.01 MON native
transfer, [`0x27d5f9bd45f4022cd87a343c29218e4d6671fbfad626aeafe56fd28f5142fba6`](https://testnet.monadexplorer.com/tx/0x27d5f9bd45f4022cd87a343c29218e4d6671fbfad626aeafe56fd28f5142fba6) — through both the happy and adversarial path:

| Claim asserted against the same real transaction | `verify` CLI result |
|---|---|
| Correct sender, recipient, and amount | `VERIFIED`, every asserted check `PASS` |
| Correct sender and amount, a deliberately wrong recipient | `NOT_VERIFIED`, `recipient` check `FAIL`, every other asserted check `PASS` |

Both receipts were independently re-checked with `node dist/cli.js verify <receiptId>` — a standalone TypeScript recomputation of the adjudication, not a second call into the same contract logic — and agreed with what the registry stored in both cases.

The separate Level 2 verifier is deployed at
[`0x6f0512740A569a4EF2e3f148513866Df97D5E0a8`](https://testnet.monadexplorer.com/address/0x6f0512740A569a4EF2e3f148513866Df97D5E0a8)
with runtime code hash `0xa4d1836d69eedbf3f90b5ef986e583b35153487d9cf06983fd90a8695fd0d80e`.
Its deployment transaction succeeded at block `67709091` and used 3,634,723 gas
(`0.374376469003634723 MON` paid).

Live proof/portable-receipt round trips include a 1-wei direct native transfer
at block `67710927` on 2026-10-02 and an EIP-1559 10-wei transfer at block
`67849839` on 2026-10-03
([second transaction](https://testnet.monadexplorer.com/tx/0x22b9176c5bc9bbbe2909163275788db04ab5b9fd87492a793a134c8eeb280753)).
On the second proof, the correct amount produced `VERIFIED`; deliberately
asserting 11 wei produced `NOT_VERIFIED` with only `amount` failing, while both
portable receipts passed the deployed inclusion verifier. A separate 1-wei
EIP-1559 self-transfer also passed end-to-end. Acquisition and consumer checks
used the same public RPC, so these runs do not establish independent-provider
behavior or authenticated RPC responses. ERC-20 live behavior remains
untested; Level 2 is not yet complete.

## Current evidence

The product direction adapts PROOF's useful semantics—explicit claims, `PASS` / `FAIL` / `ABSTAIN`, and distinct overall verdicts—to EVM transaction evidence. Veridra is a new Solidity and TypeScript implementation, not a source-code port. Solidity compilation, TypeScript type checking, 41 Foundry tests, and 53 Node.js tests have been run and pass. The full Level 1 pipeline — RPC evidence acquisition, onchain publication, and independent verification — has also been run live against a real Monad testnet transaction and the deployed registry above, on both the `VERIFIED` and `NOT_VERIFIED` paths. Level 2 now has multiple live native-transfer round trips, including EIP-1559, and a paired correct/incorrect amount claim over one proof. All used the same public RPC; this does not independently authenticate the provider. Live ERC-20 and second-provider behavior remain untested, so Level 2 is incomplete. The code pin and source IDs are caller-maintained labels; they do not authenticate the RPC supplying bytecode, proof data, or `eth_call` results. Levels 3–7 (persistent-root history, prior payment expectations, merchant integration, additional transaction shapes, and the optional private receipt) remain unbuilt.

For architecture, threat boundaries, design choices, and falsifiers, see the **[Technical README](TECHNICAL_README.md)**.

## License

Apache-2.0 — see [`LICENSE`](LICENSE). The Monad Hackathon rules require an OSI-approved license (MIT, Apache 2.0, GPL, or similar) kept publicly accessible on GitHub during and after the hackathon.
