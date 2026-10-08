import { createPublicClient, http, keccak256, stringToHex, type Address, type Hex } from "viem";
import { monadTestnet } from "viem/chains";

export const MONAD_TESTNET_CHAIN_ID = 10_143n;
export const MONAD_TESTNET_RPC_URL = "https://testnet-rpc.monad.xyz";
export const EXPLORER_TX_URL = "https://testnet.monadexplorer.com/tx/";

/** Same derivation the offchain CLI uses, so a UI check and a CLI check name the same source. */
export const RPC_PROVIDER_ID: Hex = keccak256(stringToHex(`veridra/rpc/${MONAD_TESTNET_RPC_URL}`));

export const REQUIRED_CONFIRMATIONS = 1n;

/** The chain keeps only this many recent block hashes (RecentBlockhashAnchor.BLOCKHASH_WINDOW). */
export const BLOCKHASH_WINDOW = 256n;

/**
 * This UI is itself a caller of the verifier, so it keeps its own deployment pin
 * instead of trusting an address supplied by the RPC. Source of record: README.md,
 * "Live on Monad testnet" (RecentInclusionVerifier). The library re-checks the
 * deployed runtime code against this hash on every call.
 */
export const RECENT_INCLUSION_VERIFIER_PIN: { chainId: bigint; address: Address; runtimeCodeHash: Hex } = {
  chainId: MONAD_TESTNET_CHAIN_ID,
  address: "0x6f0512740A569a4EF2e3f148513866Df97D5E0a8",
  runtimeCodeHash: "0xa4d1836d69eedbf3f90b5ef986e583b35153487d9cf06983fd90a8695fd0d80e",
};

export const publicClient = createPublicClient({
  chain: { ...monadTestnet, id: Number(MONAD_TESTNET_CHAIN_ID) },
  transport: http(MONAD_TESTNET_RPC_URL),
});

/**
 * Pin for HistoricalInclusionVerifier. Its runtime code hash is NOT recorded in the
 * repo docs (the deploy script only prints it), so on 2026-10-08 it was derived as
 * keccak256 of the code at this address, then cross-checked: Sourcify (Monad
 * instance) reports `exact_match` for the address and its runtime bytecode hashes to
 * the same value, and `checkpoint()` equals HISTORICAL_CHECKPOINT_ADDRESS, which is
 * also embedded in the code. Awaiting confirmation against the deploy log.
 */
export const HISTORICAL_INCLUSION_VERIFIER_PIN: { chainId: bigint; address: Address; runtimeCodeHash: Hex } = {
  chainId: MONAD_TESTNET_CHAIN_ID,
  address: "0xCE18db8c3AE810169c09B34B445b155581D04375",
  runtimeCodeHash: "0xac66b1c1a30448fc8d1134b00718b62b0744c48af9974ee4bfdce54c2d800788",
};

/**
 * Used only to decide cheaply whether to attempt the heavy proof fetch. It carries no
 * trust: the verifier call itself decides, and the verifier's own pin authenticates
 * which checkpoint it reads.
 */
export const HISTORICAL_CHECKPOINT_ADDRESS: Address = "0x8A429148F498bc28Ec44b464f7e206975FCA9876";

export const checkpointedHashAbi = [
  {
    type: "function",
    name: "checkpointedHash",
    stateMutability: "view",
    inputs: [{ name: "", type: "uint256" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;
