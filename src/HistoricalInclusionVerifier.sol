// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {MerklePatriciaProof} from "./MerklePatriciaProof.sol";
import {HistoricalRootCheckpoint} from "./HistoricalRootCheckpoint.sol";

/// @title HistoricalInclusionVerifier
/// @notice Verifies a transaction and its receipt under a block header whose
///         hash was persisted by a pinned HistoricalRootCheckpoint deployment,
///         extending RecentInclusionVerifier's proof path beyond the
///         256-block BLOCKHASH window.
/// @dev Trust assumption: the pinned checkpoint contract's stored hash for
///      `blockNumber` was itself derived from a genuine BLOCKHASH read at
///      checkpoint time (see HistoricalRootCheckpoint); this verifier does
///      not re-derive it and trusts the pin the caller configured. It proves
///      same-index inclusion and transaction-hash identity only; it does not
///      decode payment semantics or adjudicate a payment claim.
contract HistoricalInclusionVerifier {
    HistoricalRootCheckpoint public immutable checkpoint;

    error BlockNotCheckpointed(uint256 blockNumber);
    error HeaderHashMismatch(bytes32 expected, bytes32 actual);
    error HeaderNumberMismatch(uint64 expected, uint64 actual);
    error TransactionHashMismatch(bytes32 expected, bytes32 actual);

    constructor(HistoricalRootCheckpoint checkpoint_) {
        checkpoint = checkpoint_;
    }

    /// @notice Check transaction and receipt inclusion against a checkpointed block.
    /// @param blockNumber Number of the checkpointed block being proven.
    /// @param expectedBlockHash Claimed block hash; checked against the checkpoint.
    /// @param rawHeader Canonical RLP header bytes from the proof producer.
    /// @param transactionIndex Shared index in both block tries.
    /// @param expectedTransactionHash Hash from the payment claim.
    /// @param rawTransaction Exact EIP-2718 transaction bytes committed in the trie.
    /// @param transactionProof MPT nodes proving the transaction trie value.
    /// @param rawReceipt Exact EIP-2718 receipt bytes committed in the trie.
    /// @param receiptProof MPT nodes proving the receipt trie value.
    function verifyHistoricalInclusion(
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
        bytes32 actualBlockHash = checkpoint.checkpointedHash(blockNumber);
        if (actualBlockHash == bytes32(0)) revert BlockNotCheckpointed(blockNumber);
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
