// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MerklePatriciaProof} from "../src/MerklePatriciaProof.sol";
import {RecentInclusionVerifier} from "../src/RecentInclusionVerifier.sol";

contract RecentInclusionVerifierTest is Test {
    RecentInclusionVerifier private verifier;

    bytes32 private constant TX_ROOT = 0xac92bc8d02906a87a573c32c72bb427036f0e43d7a7375c5c491ebba064add15;
    bytes32 private constant RECEIPT_ROOT = 0x0c6c0e36f63e44856ee063dbf497da186454b1a857b286686461207698a894c5;

    function setUp() public {
        verifier = new RecentInclusionVerifier();
    }

    function test_acceptsTransactionAndReceiptUnderRecentBlockhash() public {
        bytes memory rawTransaction = hex"01";
        bytes memory rawReceipt = hex"02";
        bytes memory rawHeader = _header(TX_ROOT, RECEIPT_ROOT, 1);
        bytes32 blockHash = keccak256(rawHeader);
        _anchor(1, blockHash);

        bytes[] memory transactionProof = new bytes[](1);
        transactionProof[0] = hex"c482208001";
        bytes[] memory receiptProof = new bytes[](1);
        receiptProof[0] = hex"c482208002";

        assertTrue(
            verifier.verifyRecentInclusion(
                1,
                blockHash,
                rawHeader,
                0,
                keccak256(rawTransaction),
                rawTransaction,
                transactionProof,
                rawReceipt,
                receiptProof
            )
        );
    }

    function test_rejectsReceiptValueThatDiffersFromTheProvenLeaf() public {
        bytes memory rawTransaction = hex"01";
        bytes memory rawReceipt = hex"03";
        bytes memory rawHeader = _header(TX_ROOT, RECEIPT_ROOT, 1);
        bytes32 blockHash = keccak256(rawHeader);
        _anchor(1, blockHash);

        bytes[] memory transactionProof = new bytes[](1);
        transactionProof[0] = hex"c482208001";
        bytes[] memory receiptProof = new bytes[](1);
        receiptProof[0] = hex"c482208002";

        vm.expectRevert(MerklePatriciaProof.InvalidProof.selector);
        verifier.verifyRecentInclusion(
            1,
            blockHash,
            rawHeader,
            0,
            keccak256(rawTransaction),
            rawTransaction,
            transactionProof,
            rawReceipt,
            receiptProof
        );
    }

    function test_rejectsHeaderHashThatDoesNotMatchRecentBlockhash() public {
        bytes memory rawHeader = _header(TX_ROOT, RECEIPT_ROOT, 1);
        bytes32 blockHash = keccak256(rawHeader);
        _anchor(1, blockHash);
        bytes[] memory emptyProof;

        vm.expectPartialRevert(RecentInclusionVerifier.HeaderHashMismatch.selector);
        verifier.verifyRecentInclusion(
            1,
            bytes32(uint256(blockHash) ^ 1),
            rawHeader,
            0,
            bytes32(0),
            hex"01",
            emptyProof,
            hex"02",
            emptyProof
        );
    }

    function test_rejectsHeaderNumberDifferentFromAnchoredBlock() public {
        bytes memory rawHeader = _header(TX_ROOT, RECEIPT_ROOT, 2);
        bytes32 blockHash = keccak256(rawHeader);
        _anchor(1, blockHash);
        bytes[] memory emptyProof;

        vm.expectPartialRevert(RecentInclusionVerifier.HeaderNumberMismatch.selector);
        verifier.verifyRecentInclusion(
            1,
            blockHash,
            rawHeader,
            0,
            bytes32(0),
            hex"01",
            emptyProof,
            hex"02",
            emptyProof
        );
    }

    function _anchor(uint256 blockNumber, bytes32 blockHash) private {
        vm.roll(blockNumber + 1);
        vm.setBlockhash(blockNumber, blockHash);
    }

    function _header(bytes32 transactionsRoot, bytes32 receiptsRoot, uint8 number)
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
        fields[13] = _rlpBytes(abi.encodePacked(bytes32(uint256(0x66))));
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
