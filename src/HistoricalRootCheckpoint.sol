// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {RecentBlockhashAnchor} from "./RecentBlockhashAnchor.sol";

/// @title HistoricalRootCheckpoint
/// @notice Permissionlessly persists a block hash read through BLOCKHASH
///         before that block leaves the 256-block window, so the hash
///         remains available for inclusion verification afterward.
/// @dev The stored hash is derived only from this contract's own BLOCKHASH
///      read via `anchor`; no function accepts a caller-supplied hash, so a
///      caller cannot checkpoint an arbitrary value. The only trust
///      assumption is liveness: a block nobody checkpoints before it leaves
///      the window is permanently unavailable through this contract.
contract HistoricalRootCheckpoint is RecentBlockhashAnchor {
    mapping(uint256 => bytes32) public checkpointedHash;

    event Checkpointed(uint256 indexed blockNumber, bytes32 blockHash);

    /// @notice Persist the canonical hash for `blockNumber` while it is still
    ///         reachable through BLOCKHASH.
    /// @dev Idempotent: resubmitting an already-checkpointed block returns
    ///      the stored hash without re-emitting the event, since `anchor` is
    ///      deterministic for a given completed block.
    function checkpoint(uint256 blockNumber) external returns (bytes32 blockHash) {
        blockHash = anchor(blockNumber);
        if (checkpointedHash[blockNumber] == blockHash) return blockHash;
        checkpointedHash[blockNumber] = blockHash;
        emit Checkpointed(blockNumber, blockHash);
    }
}
