// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {RecentBlockhashAnchor} from "./RecentBlockhashAnchor.sol";

/// @title HistoricalRootCheckpoint
/// @notice Permissionlessly persists a block hash read through BLOCKHASH
///         before that block leaves the 256-block window, so the hash
///         remains available for inclusion verification afterward.
/// @dev The stored hash is derived only from this contract's own BLOCKHASH
///      read via `anchor`; no function accepts a caller-supplied hash, so a
///      caller cannot checkpoint an arbitrary value directly. Trust
///      assumptions: (1) liveness -- a block nobody checkpoints before it
///      leaves the window is permanently unavailable through this contract;
///      (2) reorg safety -- unlike a live BLOCKHASH read, a checkpointed hash
///      does not self-correct if the checkpointed block is later replaced by
///      a reorg. `MIN_CONFIRMATION_DEPTH` bounds that risk rather than
///      ignoring it: Monad's MonadBFT reaches deterministic finality after
///      two consensus rounds (~2 blocks, ~600ms at 300ms block time --
///      https://docs.monad.xyz/introduction/monad-for-developers), so
///      requiring 3 confirmed blocks checkpoints only blocks already past
///      Monad's own deterministic-finality boundary, with one block of
///      margin. A checkpoint is still only as reorg-safe as the chain's
///      actual finality guarantee; this is a bound, not a proof.
contract HistoricalRootCheckpoint is RecentBlockhashAnchor {
    /// @notice Minimum confirmations required before a block may be
    ///         checkpointed: Monad's 2-block deterministic finality plus one
    ///         block of margin.
    uint256 public constant MIN_CONFIRMATION_DEPTH = 3;

    mapping(uint256 => bytes32) public checkpointedHash;

    event Checkpointed(uint256 indexed blockNumber, bytes32 blockHash);

    error BlockNotYetFinal(uint256 blockNumber, uint256 currentBlock);

    /// @notice Persist the canonical hash for `blockNumber` once it is both
    ///         reachable through BLOCKHASH and past `MIN_CONFIRMATION_DEPTH`.
    /// @dev Idempotent: resubmitting an already-checkpointed block returns
    ///      the stored hash without re-emitting the event, since `anchor` is
    ///      deterministic for a given completed block.
    function checkpoint(uint256 blockNumber) external returns (bytes32 blockHash) {
        if (block.number < blockNumber + MIN_CONFIRMATION_DEPTH) {
            revert BlockNotYetFinal(blockNumber, block.number);
        }
        blockHash = anchor(blockNumber);
        if (checkpointedHash[blockNumber] == blockHash) return blockHash;
        checkpointedHash[blockNumber] = blockHash;
        emit Checkpointed(blockNumber, blockHash);
    }
}
