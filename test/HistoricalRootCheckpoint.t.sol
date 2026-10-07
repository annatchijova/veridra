// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RecentBlockhashAnchor} from "../src/RecentBlockhashAnchor.sol";
import {HistoricalRootCheckpoint} from "../src/HistoricalRootCheckpoint.sol";

contract HistoricalRootCheckpointTest is Test {
    HistoricalRootCheckpoint private checkpoint;

    function setUp() public {
        checkpoint = new HistoricalRootCheckpoint();
    }

    function test_checkpointsHashObservedThroughBlockhash() public {
        bytes32 hash = keccak256("block-1");
        _anchor(1, hash);

        vm.expectEmit(true, true, true, true);
        emit HistoricalRootCheckpoint.Checkpointed(1, hash);
        bytes32 stored = checkpoint.checkpoint(1);

        assertEq(stored, hash);
        assertEq(checkpoint.checkpointedHash(1), hash);
    }

    function test_anyCallerCanCheckpoint() public {
        bytes32 hash = keccak256("block-1");
        _anchor(1, hash);

        vm.prank(address(0xBEEF));
        checkpoint.checkpoint(1);

        assertEq(checkpoint.checkpointedHash(1), hash);
    }

    function test_resubmittingTheSameBlockIsIdempotentAndDoesNotReemit() public {
        bytes32 hash = keccak256("block-1");
        _anchor(1, hash);
        checkpoint.checkpoint(1);

        vm.recordLogs();
        bytes32 stored = checkpoint.checkpoint(1);
        assertEq(stored, hash);
        assertEq(vm.getRecordedLogs().length, 0);
    }

    function test_revertsForABlockStillBeingMined() public {
        vm.roll(5);
        vm.expectRevert(abi.encodeWithSelector(RecentBlockhashAnchor.BlockNotCompleted.selector, 5, 5));
        checkpoint.checkpoint(5);
    }

    function test_revertsForABlockOutsideTheWindow() public {
        bytes32 hash = keccak256("block-1");
        vm.roll(2);
        vm.setBlockhash(1, hash);
        vm.roll(1 + checkpoint.BLOCKHASH_WINDOW() + 2);

        vm.expectRevert(
            abi.encodeWithSelector(
                RecentBlockhashAnchor.BlockOutsideWindow.selector, 1, 1 + checkpoint.BLOCKHASH_WINDOW() + 2
            )
        );
        checkpoint.checkpoint(1);
    }

    function test_checkpointingDoesNotAcceptACallerSuppliedHash() public view {
        // Structural guarantee: the ABI only exposes `checkpoint(uint256 blockNumber)`;
        // the stored hash can only come from this contract's own BLOCKHASH read.
        bytes4 selector = HistoricalRootCheckpoint.checkpoint.selector;
        assertEq(selector, bytes4(keccak256("checkpoint(uint256)")));
    }

    function _anchor(uint256 blockNumber, bytes32 blockHash) private {
        vm.roll(blockNumber + 1);
        vm.setBlockhash(blockNumber, blockHash);
    }
}
