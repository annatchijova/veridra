// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @title RecentBlockhashAnchor
/// @notice Reads a completed block hash from the EVM's bounded BLOCKHASH window.
/// @dev This authenticates only the supplied block number/hash pair against
///      BLOCKHASH. It does not parse headers or verify transaction/receipt proofs.
contract RecentBlockhashAnchor {
    uint256 public constant BLOCKHASH_WINDOW = 256;

    error BlockNotCompleted(uint256 blockNumber, uint256 currentBlock);
    error BlockOutsideWindow(uint256 blockNumber, uint256 currentBlock);
    error BlockHashUnavailable(uint256 blockNumber);
    error BlockHashMismatch(bytes32 expected, bytes32 actual);

    /// @notice Return the canonical hash for a recently completed block.
    /// @dev The current block is excluded; at most the preceding 256 blocks
    ///      are available. A zero result is treated as unavailable.
    function anchor(uint256 blockNumber) public view returns (bytes32 actual) {
        if (blockNumber >= block.number) {
            revert BlockNotCompleted(blockNumber, block.number);
        }
        if (block.number - blockNumber > BLOCKHASH_WINDOW) {
            revert BlockOutsideWindow(blockNumber, block.number);
        }

        actual = blockhash(blockNumber);
        if (actual == bytes32(0)) revert BlockHashUnavailable(blockNumber);
    }

    /// @notice Check a caller-supplied hash against the canonical recent hash.
    function verify(uint256 blockNumber, bytes32 expectedHash) external view returns (bool) {
        bytes32 actual = anchor(blockNumber);
        if (actual != expectedHash) revert BlockHashMismatch(expectedHash, actual);
        return true;
    }
}
