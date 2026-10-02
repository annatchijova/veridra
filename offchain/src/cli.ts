#!/usr/bin/env node
import { createPublicClient, createWalletClient, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { monadTestnet } from "viem/chains";
import { parsePaymentClaim } from "./claim.js";
import { publishReceipt } from "./publishReceipt.js";
import { verifyReceipt } from "./verifyReceipt.js";

function usageAndExit(message?: string): never {
  if (message) console.error(`Error: ${message}\n`);
  console.error(
    [
      "Usage:",
      "  veridra verify <receiptId> --registry <address> [--rpc-url <url>] [--chain-id <id>]",
      "  veridra publish <transactionHash> --registry <address> [--sender <addr>] [--recipient <addr>]",
      "           [--asset <addr>] [--amount <baseUnits>] [--rpc-url <url>] [--chain-id <id>]",
      "           [--required-confirmations <n>] [--supported-tokens <addr,addr,...>]",
      "",
      "publish reads PRIVATE_KEY from the environment and never accepts it as a flag.",
    ].join("\n"),
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

function resolveChain(args: string[]) {
  const rpcUrl = readFlag(args, "--rpc-url") ?? process.env.MONAD_TESTNET_RPC_URL ?? monadTestnet.rpcUrls.default.http[0];
  const chainIdFlag = readFlag(args, "--chain-id") ?? process.env.MONAD_CHAIN_ID;
  const expectedChainId = chainIdFlag !== undefined ? BigInt(chainIdFlag) : BigInt(monadTestnet.id);
  return { rpcUrl, expectedChainId };
}

function requireRegistry(args: string[]): Address {
  const registryFlag = readFlag(args, "--registry") ?? process.env.VERIDRA_REGISTRY_ADDRESS;
  if (registryFlag === undefined) usageAndExit("--registry or VERIDRA_REGISTRY_ADDRESS is required");
  return registryFlag as Address;
}

function printJson(value: unknown) {
  console.log(JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString(10) : v), 2));
}

async function runVerify(args: string[]) {
  const receiptId = args[1];
  if (receiptId === undefined || !/^0x[0-9a-fA-F]{64}$/.test(receiptId)) {
    usageAndExit("a 32-byte receipt id is required as the first argument");
  }
  const registryAddress = requireRegistry(args);
  const { rpcUrl, expectedChainId } = resolveChain(args);

  const publicClient = createPublicClient({
    chain: { ...monadTestnet, id: Number(expectedChainId) },
    transport: http(rpcUrl),
  });

  const result = await verifyReceipt({ publicClient, registryAddress, receiptId: receiptId as Hex, expectedChainId });
  printJson(result);
}

async function runPublish(args: string[]) {
  const transactionHash = args[1];
  if (transactionHash === undefined || !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)) {
    usageAndExit("a 32-byte transaction hash is required as the first argument");
  }
  const registryAddress = requireRegistry(args);
  const { rpcUrl, expectedChainId } = resolveChain(args);

  const privateKey = process.env.PRIVATE_KEY;
  if (privateKey === undefined) usageAndExit("PRIVATE_KEY must be set in the environment to publish");

  const claimInput: Record<string, unknown> = { transactionHash, chainId: expectedChainId.toString(10) };
  const sender = readFlag(args, "--sender");
  const recipient = readFlag(args, "--recipient");
  const asset = readFlag(args, "--asset");
  const amount = readFlag(args, "--amount");
  if (sender !== undefined) claimInput.sender = sender;
  if (recipient !== undefined) claimInput.recipient = recipient;
  if (asset !== undefined) claimInput.asset = asset;
  if (amount !== undefined) claimInput.amountBaseUnits = amount;
  const claim = parsePaymentClaim(claimInput);

  const requiredConfirmationsFlag = readFlag(args, "--required-confirmations");
  const requiredConfirmations = requiredConfirmationsFlag !== undefined ? BigInt(requiredConfirmationsFlag) : 1n;
  const supportedTokensFlag = readFlag(args, "--supported-tokens");
  const supportedTokenAddresses = (supportedTokensFlag?.split(",").filter((s) => s.length > 0) ?? []) as Address[];

  const chain = { ...monadTestnet, id: Number(expectedChainId) };
  const publicClient = createPublicClient({ chain, transport: http(rpcUrl) });
  const account = privateKeyToAccount(privateKey as Hex);
  const walletClient = createWalletClient({ account, chain, transport: http(rpcUrl) });

  const published = await publishReceipt({
    claim,
    observedAtUnixSeconds: Math.floor(Date.now() / 1000).toString(10),
    registryAddress,
    rpc: {
      rpcUrl,
      expectedChainId,
      providerId: keccak256(stringToHex(`veridra/rpc/${rpcUrl}`)),
      requiredConfirmations,
      supportedTokenAddresses,
    },
    publicClient,
    walletClient,
  });

  printJson(published);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (command === undefined || command === "--help" || command === "-h") usageAndExit();
  if (command === "verify") return runVerify(args);
  if (command === "publish") return runPublish(args);
  usageAndExit(`Unknown command '${command}'`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : error);
  process.exitCode = 1;
});
