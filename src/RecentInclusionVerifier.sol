// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MerklePatriciaProof} from "./MerklePatriciaProof.sol";
import {RecentBlockhashAnchor} from "./RecentBlockhashAnchor.sol";

/// @title RecentInclusionVerifier
/// @notice Verifies a transaction and its receipt under an EVM block header
///         whose hash is available through the current chain's BLOCKHASH.
/// @dev This proves same-index inclusion and transaction-hash identity only.
///      It does not decode payment semantics, recover the sender, or adjudicate
///      a payment claim; callers must not treat this as a verified payment.
contract RecentInclusionVerifier is RecentBlockhashAnchor {
    error HeaderHashMismatch(bytes32 expected, bytes32 actual);
    error HeaderNumberMismatch(uint64 expected, uint64 actual);
    error TransactionHashMismatch(bytes32 expected, bytes32 actual);

    /// @notice Check transaction and receipt inclusion against the recent block.
    /// @param blockNumber Number of the completed block being proven.
    /// @param expectedBlockHash Claimed block hash; checked against BLOCKHASH.
    /// @param rawHeader Canonical RLP header bytes from the proof producer.
    /// @param transactionIndex Shared index in both block tries.
    /// @param expectedTransactionHash Hash from the payment claim.
    /// @param rawTransaction Exact EIP-2718 transaction bytes committed in the trie.
    /// @param transactionProof MPT nodes proving the transaction trie value.
    /// @param rawReceipt Exact EIP-2718 receipt bytes committed in the trie.
    /// @param receiptProof MPT nodes proving the receipt trie value.
    function verifyRecentInclusion(
        uint64 blockNumber,
        bytes32 expectedBlockHash,
        bytes calldata rawHeader,
        uint64 transactionIndex,
        bytes32 expectedTransactionHash,
        bytes calldata rawTransaction,
        bytes[] calldata transactionProof,
        bytes calldata rawReceipt,
        bytes[] calldata receiptProof
    ) external view returns (bool) {
        bytes32 actualBlockHash = anchor(blockNumber);
        if (actualBlockHash != expectedBlockHash) {
            revert HeaderHashMismatch(expectedBlockHash, actualBlockHash);
        }
        // Parse first so the header-size bound is enforced before hashing calldata.
        (uint64 headerNumber, bytes32 transactionsRoot, bytes32 receiptsRoot) =
            MerklePatriciaProof.headerRoots(rawHeader);

        bytes32 actualHeaderHash = keccak256(rawHeader);
        if (actualHeaderHash != actualBlockHash) {
            revert HeaderHashMismatch(actualBlockHash, actualHeaderHash);
        }
        if (headerNumber != blockNumber) revert HeaderNumberMismatch(blockNumber, headerNumber);

        bytes32 actualTransactionHash = keccak256(rawTransaction);
        if (actualTransactionHash != expectedTransactionHash) {
            revert TransactionHashMismatch(expectedTransactionHash, actualTransactionHash);
        }

        MerklePatriciaProof.verifyIndexedValue(
            transactionsRoot, transactionIndex, rawTransaction, transactionProof
        );
        MerklePatriciaProof.verifyIndexedValue(
            receiptsRoot, transactionIndex, rawReceipt, receiptProof
        );
        return true;
    }
}
