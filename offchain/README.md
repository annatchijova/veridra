# Veridra Monad RPC package

This package acquires one bounded payment fact from a configured JSON-RPC endpoint and can publish a version-1 receipt through the Solidity registry. It does not prove that the RPC provider is honest; the receipt assurance remains `RPC_ATTESTED`.

## Build

Requires Node.js 22 or newer.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
npm test
```

`npm ci` uses the committed lockfile. Install scripts are disabled because the dependency tree does not require them. `npm test` builds and runs the Node.js built-in test runner (`node --test`) against the compiled output in `dist/`; no additional test framework dependency is installed.

After changing the Solidity registry ABI, run `forge build` from the repository root and then `python3 scripts/export_abi.py` to refresh the viem ABI from the Foundry artifact.

## Library boundary

- `acquirePaymentEvidence()` checks the configured chain ID and cross-consistency among the transaction, receipt, and containing block. It bounds each HTTP response, times out RPC calls, and extracts one supported payment fact.
- `parsePaymentClaim()` turns JSON input into the Solidity claim tuple. Optional fields become explicit abstentions encoded with zero values; chain IDs and token amounts must be decimal strings, never JSON numbers. The publisher and registry reject noncanonical values for abstained fields.
- `publishReceipt()` checks the public and wallet client chains, registry schema and assurance, and immutable publisher address; simulates the write; submits it with the caller-provided wallet client; and resolves both first-time and idempotent publications.
- The caller creates and protects the wallet client. This package never reads or writes private keys.

Amounts and chain/block/time values are `bigint`. Pass observation time as a canonical decimal string (Unix seconds); do not convert token amounts through JavaScript `number`, decimal display values, symbols, or token decimals.

Native MON evidence uses the transaction's top-level `from`, `to`, and `value`, requires empty calldata and successful execution, and says nothing about net recipient balance. ERC-20 evidence requires one standard `Transfer` log, a configured token address, and that token to be the transaction's direct target. This allowlist narrows accepted inputs; it does not establish token correctness or balance semantics.

RPC failures, inconsistent data, unsupported transaction shapes, and ambiguous transfers throw `InsufficientEvidenceError`. The caller should map that error to an `INSUFFICIENT_EVIDENCE` receipt or return it without attempting publication. Do not catch it and convert it into `VERIFIED`.

- `verifyReceipt()` is a read-only, independent consumer of a published receipt: it reads the stored claim and evidence and recomputes the verdict from a TypeScript re-implementation of `PaymentAdjudicator.evaluate()`, written without reusing the Solidity control flow. It rejects a schema version or evidence-assurance variant it was not written to understand, rejects a receipt recorded under an unexpected chain, and throws `ReceiptIntegrityError` if its own recomputation ever disagrees with what the contract stored — this should never happen for a correctly behaving registry, and the error exists so a divergence is reported loudly rather than silently trusted.

## CLI

```sh
npm run build
node dist/cli.js verify <receiptId> --registry <address> [--rpc-url <url>] [--chain-id <id>]
node dist/cli.js publish <transactionHash> --registry <address> [--sender <addr>] [--recipient <addr>]
  [--asset <addr>] [--amount <baseUnits>] [--rpc-url <url>] [--chain-id <id>]
  [--required-confirmations <n>] [--supported-tokens <addr,addr,...>]
```

`--rpc-url` defaults to `MONAD_TESTNET_RPC_URL` or, failing that, viem's bundled Monad Testnet default RPC. `--registry` can also be set via `VERIDRA_REGISTRY_ADDRESS`. `verify` prints the independently checked registry receipt as JSON, or exits non-zero on a missing receipt, unsupported variant, or integrity mismatch. `publish` acquires transaction evidence, adjudicates the supplied assertions, and submits through the registry. It reads `PRIVATE_KEY` only from the environment (never a CLI flag); the signer must be funded for gas and authorized as the registry publisher. The CLI does not print the key. `--asset`, `--amount`, and the supported-token allowlist use the package's direct-transfer semantics; amounts are integer base units, not display decimals. These commands implement the Level 1 RPC-attested path; recent inclusion-proof acquisition and portable receipts are library APIs, not CLI subcommands.
