#!/usr/bin/env python3
"""Export the receipt registry ABI as a TypeScript const for viem."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_ARTIFACT = ROOT / "out/VeridraReceiptRegistry.sol/VeridraReceiptRegistry.json"
DEFAULT_OUTPUT = ROOT / "offchain/src/abi/veridraReceiptRegistryAbi.ts"
REQUIRED_FUNCTIONS = {"publish", "getReceipt", "publisher", "RECEIPT_SCHEMA_VERSION", "RPC_ATTESTED"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--artifact", type=Path, default=DEFAULT_ARTIFACT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    artifact = json.loads(args.artifact.read_text(encoding="utf-8"))
    abi = artifact.get("abi")
    if not isinstance(abi, list):
        raise SystemExit(f"Artifact has no ABI array: {args.artifact}")
    functions = {
        item.get("name")
        for item in abi
        if isinstance(item, dict) and item.get("type") == "function"
    }
    missing = REQUIRED_FUNCTIONS - functions
    if missing:
        raise SystemExit(f"Artifact ABI is missing required functions: {', '.join(sorted(missing))}")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(abi, indent=2, ensure_ascii=False)
    args.output.write_text(
        f"export const veridraReceiptRegistryAbi = {serialized} as const;\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
