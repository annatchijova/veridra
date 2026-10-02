# Veridra Monad RPC package

This package acquires one bounded payment fact from a configured JSON-RPC endpoint and can publish a version-1 receipt through the Solidity registry. It does not prove that the RPC provider is honest; the receipt assurance remains `RPC_ATTESTED`.

## Build

Requires Node.js 22 or newer.

```sh
npm ci --ignore-scripts
npm run typecheck
npm run build
```

`npm ci` uses the committed lockfile. Install scripts are disabled because the dependency tree does not require them.

After changing the Solidity registry ABI, run `forge build` from the repository root and then `python3 scripts/export_abi.py` to refresh the viem ABI from the Foundry artifact.

## Library boundary

- `acquirePaymentEvidence()` checks the configured chain ID and cross-consistency among the transaction, receipt, and containing block. It bounds each HTTP response, times out RPC calls, and extracts one supported payment fact.
- `parsePaymentClaim()` turns JSON input into the Solidity claim tuple. Optional fields become explicit abstentions encoded with zero values; chain IDs and token amounts must be decimal strings, never JSON numbers. The publisher and registry reject noncanonical values for abstained fields.
- `publishReceipt()` checks the public and wallet client chains, registry schema and assurance, and immutable publisher address; simulates the write; submits it with the caller-provided wallet client; and resolves both first-time and idempotent publications.
- The caller creates and protects the wallet client. This package never reads or writes private keys.

Amounts and chain/block/time values are `bigint`. Pass observation time as a canonical decimal string (Unix seconds); do not convert token amounts through JavaScript `number`, decimal display values, symbols, or token decimals.

Native MON evidence uses the transaction's top-level `from`, `to`, and `value`, requires empty calldata and successful execution, and says nothing about net recipient balance. ERC-20 evidence requires one standard `Transfer` log, a configured token address, and that token to be the transaction's direct target. This allowlist narrows accepted inputs; it does not establish token correctness or balance semantics.

RPC failures, inconsistent data, unsupported transaction shapes, and ambiguous transfers throw `InsufficientEvidenceError`. The caller should map that error to an `INSUFFICIENT_EVIDENCE` receipt or return it without attempting publication. Do not catch it and convert it into `VERIFIED`.
