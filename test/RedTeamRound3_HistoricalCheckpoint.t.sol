// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {RecentBlockhashAnchor} from "../src/RecentBlockhashAnchor.sol";
import {HistoricalRootCheckpoint} from "../src/HistoricalRootCheckpoint.sol";
import {HistoricalInclusionVerifier} from "../src/HistoricalInclusionVerifier.sol";
import {MerklePatriciaProof} from "../src/MerklePatriciaProof.sol";

/// @title Red Team Round 3 — HistoricalRootCheckpoint / HistoricalInclusionVerifier
/// @notice Each test states its prediction in a comment BEFORE the assertion,
///         per the red-team-auditing skill's reproducibility contract: the
///         prediction must precede the observation, not be written post-hoc.
contract RedTeamRound3HistoricalCheckpointTest is Test {
    bytes32 private constant TX_ROOT = 0xac92bc8d02906a87a573c32c72bb427036f0e43d7a7375c5c491ebba064add15;
    bytes32 private constant RECEIPT_ROOT = 0x0c6c0e36f63e44856ee063dbf497da186454b1a857b286686461207698a894c5;

    // ------------------------------------------------------------------
    // H6 — "checkpointAddress in the portable receipt is redundant with
    // the verifier's runtimeCodeHash pin, because Solidity embeds an
    // immutable address directly in runtime bytecode." This claim shipped
    // in TECHNICAL_README.md and portableHistoricalReceipt.ts's docstring
    // WITHOUT ever being empirically checked -- it was asserted from
    // Solidity-semantics reasoning only (PLAUSIBLE HYPOTHESIS at best).
    //
    // PREDICTION: two HistoricalInclusionVerifier instances, deployed with
    // identical constructor bytecode but pointed at two DIFFERENT
    // HistoricalRootCheckpoint addresses, will have DIFFERENT
    // `codehash` values. If this holds, runtimeCodeHash really does
    // authenticate which checkpoint a pinned verifier trusts, and
    // checkpointAddress is correctly documented as informational only.
    // If it is FALSIFIED (same codehash despite different checkpoints),
    // the documentation is wrong and checkpointAddress would need to
    // become a real, separately-checked trust pin.
    // ------------------------------------------------------------------
    function test_H6_differentPinnedCheckpointsProduceDifferentRuntimeCodeHash() public {
        HistoricalRootCheckpoint checkpointA = new HistoricalRootCheckpoint();
        HistoricalRootCheckpoint checkpointB = new HistoricalRootCheckpoint();
        assertTrue(address(checkpointA) != address(checkpointB), "test fixture sanity: checkpoints must differ");

        HistoricalInclusionVerifier verifierA = new HistoricalInclusionVerifier(checkpointA);
        HistoricalInclusionVerifier verifierB = new HistoricalInclusionVerifier(checkpointB);

        bytes32 codehashA = address(verifierA).codehash;
        bytes32 codehashB = address(verifierB).codehash;

        assertTrue(codehashA != codehashB, "H6 FALSIFIED: runtime code hash does not encode the pinned checkpoint");
        assertEq(address(verifierA.checkpoint()), address(checkpointA));
        assertEq(address(verifierB.checkpoint()), address(checkpointB));
    }

    // ------------------------------------------------------------------
    // H1 — "conflicting roots after a re-checkpointed reorg": the flagged
    // open gap. checkpoint() has no guard against overwriting an existing
    // entry with a DIFFERENT hash -- it only short-circuits (no re-emit)
    // when the new read is IDENTICAL to the stored one. My prior reasoning
    // (never executed) was that this is safe because any already-issued
    // proof built against the stale hash would fail HeaderHashMismatch on
    // reverification, not silently keep validating.
    //
    // PREDICTION: after checkpoint(N) stores H1, then a simulated reorg
    // changes the live blockhash(N) to H2, and checkpoint(N) is called
    // again: (a) checkpointedHash(N) becomes H2; (b) a proof built against
    // the ORIGINAL H1 (correct header/MPT data, but now a stale anchor)
    // reverts HeaderHashMismatch when replayed against the verifier; (c) a
    // proof built against H2 succeeds. No state lets both proofs validate
    // at once (single-slot storage), and no caller-supplied value can force
    // the overwrite -- only a real change in blockhash(N) can.
    // ------------------------------------------------------------------
    function test_H1_reCheckpointAfterReorgInvalidatesTheStaleProofNotSilently() public {
        HistoricalRootCheckpoint checkpoint = new HistoricalRootCheckpoint();
        HistoricalInclusionVerifier verifier = new HistoricalInclusionVerifier(checkpoint);

        bytes memory rawTransaction = hex"01";
        bytes memory rawReceipt = hex"02";
        bytes[] memory transactionProof = new bytes[](1);
        transactionProof[0] = hex"c482208001";
        bytes[] memory receiptProof = new bytes[](1);
        receiptProof[0] = hex"c482208002";

        bytes memory headerA = _header(TX_ROOT, RECEIPT_ROOT, 1);
        bytes32 hashA = keccak256(headerA);

        // --- Step 1: honest checkpoint of the canonical (pre-reorg) block ---
        vm.roll(1);
        vm.setBlockhash(1, hashA);
        vm.roll(1 + checkpoint.MIN_CONFIRMATION_DEPTH());
        checkpoint.checkpoint(1);
        assertEq(checkpoint.checkpointedHash(1), hashA);

        // Sanity: the proof against the honestly-checkpointed hash verifies.
        assertTrue(
            verifier.verifyHistoricalInclusion(
                1, hashA, headerA, 0, keccak256(rawTransaction), rawTransaction, transactionProof,
                rawReceipt, receiptProof
            )
        );

        // --- Step 2: simulate a reorg -- block 1's canonical hash changes ---
        // Same transaction/receipt roots (the reorg swaps an unrelated header
        // field -- e.g. the extraData/mixHash-standing-in bytes32 -- not the
        // payment data itself), still valid RLP, still a different hash.
        bytes memory headerB = _headerWithSalt(TX_ROOT, RECEIPT_ROOT, 1, bytes32(uint256(0x77)));
        bytes32 hashB = keccak256(headerB);
        assertTrue(hashA != hashB, "test fixture sanity: reorg must change the hash");
        vm.setBlockhash(1, hashB);

        // --- Step 3: re-checkpoint picks up the new canonical hash ---
        vm.expectEmit(true, true, true, true);
        emit HistoricalRootCheckpoint.Checkpointed(1, hashB);
        bytes32 stored = checkpoint.checkpoint(1);
        assertEq(stored, hashB);
        assertEq(checkpoint.checkpointedHash(1), hashB);

        // --- Step 4: the STALE proof (built against hashA) must now fail ---
        vm.expectRevert(
            abi.encodeWithSelector(HistoricalInclusionVerifier.HeaderHashMismatch.selector, hashA, hashB)
        );
        verifier.verifyHistoricalInclusion(
            1, hashA, headerA, 0, keccak256(rawTransaction), rawTransaction, transactionProof,
            rawReceipt, receiptProof
        );

        // --- Step 5: a proof built against the NEW canonical hash succeeds ---
        assertTrue(
            verifier.verifyHistoricalInclusion(
                1, hashB, headerB, 0, keccak256(rawTransaction), rawTransaction, transactionProof,
                rawReceipt, receiptProof
            )
        );
    }

    /// Rival to H1: can a caller force the overwrite with an arbitrary value
    /// (not an actual chain reorg)? PREDICTION: no -- checkpoint() has no
    /// parameter for a caller-supplied hash; only `anchor()`'s own BLOCKHASH
    /// read determines what gets stored, so this is architecturally
    /// unreachable, not merely untested. Confirmed by inspection of the
    /// function signature (CODE FACT, no execution needed): `checkpoint(uint256 blockNumber)`
    /// takes no hash argument.
    function test_H1_rival_checkpointSignatureAcceptsNoCallerSuppliedHash() public pure {
        bytes4 selector = HistoricalRootCheckpoint.checkpoint.selector;
        assertEq(selector, bytes4(keccak256("checkpoint(uint256)")));
    }

    // ------------------------------------------------------------------
    // H4 — exact MIN_CONFIRMATION_DEPTH boundary. The existing test suite
    // only pins diff=1 (fails). PREDICTION: diff=2 (one short of the
    // 3-block requirement) must still revert BlockNotYetFinal; diff=3
    // (exactly at the requirement) must succeed. If diff=2 unexpectedly
    // succeeds, there is an off-by-one letting a block be checkpointed one
    // confirmation early.
    // ------------------------------------------------------------------
    function test_H4_confirmationDepthBoundaryIsExactlyThree() public {
        HistoricalRootCheckpoint checkpoint = new HistoricalRootCheckpoint();
        bytes32 hash = keccak256("block-1");

        vm.roll(2);
        vm.setBlockhash(1, hash);
        vm.roll(1 + 2); // diff == 2: one short of MIN_CONFIRMATION_DEPTH (3)
        vm.expectRevert(abi.encodeWithSelector(HistoricalRootCheckpoint.BlockNotYetFinal.selector, 1, 1 + 2));
        checkpoint.checkpoint(1);

        vm.roll(1 + 3); // diff == 3: exactly MIN_CONFIRMATION_DEPTH
        bytes32 stored = checkpoint.checkpoint(1);
        assertEq(stored, hash);
    }

    function _header(bytes32 transactionsRoot, bytes32 receiptsRoot, uint8 number)
        private
        pure
        returns (bytes memory)
    {
        return _headerWithSalt(transactionsRoot, receiptsRoot, number, bytes32(uint256(0x66)));
    }

    /// Same shape as `_header`, with field[13] (a dummy mixHash-standing-in
    /// value, otherwise unused by the verifier) parameterized so two headers
    /// over the same tx/receipt roots can hash differently -- modeling a
    /// reorg that replaces the block without changing which payment and
    /// trie structure are under test.
    function _headerWithSalt(bytes32 transactionsRoot, bytes32 receiptsRoot, uint8 number, bytes32 salt)
        private
        pure
        returns (bytes memory)
    {
        bytes[] memory fields = new bytes[](15);
        fields[0] = _rlpBytes(abi.encodePacked(bytes32(uint256(0x11))));
        fields[1] = _rlpBytes(abi.encodePacked(bytes32(uint256(0x22))));
        fields[2] = _rlpBytes(abi.encodePacked(bytes20(uint160(0x33))));
        fields[3] = _rlpBytes(abi.encodePacked(bytes32(uint256(0x44))));
        fields[4] = _rlpBytes(abi.encodePacked(transactionsRoot));
        fields[5] = _rlpBytes(abi.encodePacked(receiptsRoot));
        fields[6] = _rlpBytes(new bytes(256));
        fields[7] = _rlpBytes(bytes(""));
        fields[8] = _rlpBytes(abi.encodePacked(number));
        fields[9] = _rlpBytes(hex"5208");
        fields[10] = _rlpBytes(hex"01");
        fields[11] = _rlpBytes(hex"01");
        fields[12] = _rlpBytes(bytes(""));
        fields[13] = _rlpBytes(abi.encodePacked(salt));
        fields[14] = _rlpBytes(new bytes(8));

        bytes memory payload;
        for (uint256 i; i < fields.length; ++i) payload = bytes.concat(payload, fields[i]);
        return _rlpList(payload);
    }

    function _rlpBytes(bytes memory value) private pure returns (bytes memory) {
        if (value.length == 1 && uint8(value[0]) < 0x80) return value;
        if (value.length <= 55) return bytes.concat(bytes1(uint8(0x80 + value.length)), value);
        (bytes memory lengthBytes, uint256 lengthOfLength) = _lengthBytes(value.length);
        return bytes.concat(bytes1(uint8(0xb7 + lengthOfLength)), lengthBytes, value);
    }

    function _rlpList(bytes memory payload) private pure returns (bytes memory) {
        if (payload.length <= 55) return bytes.concat(bytes1(uint8(0xc0 + payload.length)), payload);
        (bytes memory lengthBytes, uint256 lengthOfLength) = _lengthBytes(payload.length);
        return bytes.concat(bytes1(uint8(0xf7 + lengthOfLength)), lengthBytes, payload);
    }

    function _lengthBytes(uint256 value) private pure returns (bytes memory encoded, uint256 length) {
        uint256 remaining = value;
        while (remaining != 0) {
            ++length;
            remaining >>= 8;
        }
        encoded = new bytes(length);
        for (uint256 i; i < length; ++i) encoded[length - i - 1] = bytes1(uint8(value >> (i * 8)));
    }
}
