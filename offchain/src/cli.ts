#!/usr/bin/env node
import { createPublicClient, http, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";
import { verifyReceipt } from "./verifyReceipt.js";

function usageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    "Usage: veridra verify <receiptId> --registry <address> [--rpc-url <url>] [--chain-id <id>]",
  );
  process.exit(message ? 1 : 0);
}

function readFlag(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined) usageAndExit(`${flag} requires a value`);
  return value;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h") usageAndExit();
  if (command !== "verify") usageAndExit(`Unknown command '${command}'`);

  const receiptId = args[1];
  if (receiptId === undefined || !/^0x[0-9a-fA-F]{64}$/.test(receiptId)) {
    usageAndExit("a 32-byte receipt id is required as the first argument");
  }

  const registryFlag = readFlag(args, "--registry") ?? process.env.VERIDRA_REGISTRY_ADDRESS;
  if (registryFlag === undefined) usageAndExit("--registry or VERIDRA_REGISTRY_ADDRESS is required");

  const rpcUrl = readFlag(args, "--rpc-url") ?? process.env.MONAD_TESTNET_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
  const chainIdFlag = readFlag(args, "--chain-id") ?? process.env.MONAD_CHAIN_ID;
  const expectedChainId = chainIdFlag !== undefined ? BigInt(chainIdFlag) : BigInt(monadTestnet.id);

  const publicClient = createPublicClient({
    chain: { ...monadTestnet, id: Number(expectedChainId) },
    transport: http(rpcUrl),
  });

  const result = await verifyReceipt({
    publicClient,
    registryAddress: registryFlag as Address,
    receiptId: receiptId as Hex,
    expectedChainId,
  });

  console.log(
    JSON.stringify(
      result,
      (_key, value) => (typeof value === "bigint" ? value.toString(10) : value),
      2,
    ),
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
