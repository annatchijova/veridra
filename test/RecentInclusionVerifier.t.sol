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

    function test_acceptsOffchainGeneratedHashedBranchProof() public {
        (
            bytes memory rawTransaction,
            bytes memory rawReceipt,
            bytes32 transactionsRoot,
            bytes32 receiptsRoot,
            bytes[] memory transactionProof,
            bytes[] memory receiptProof
        ) = _hashedBranchVector();
        bytes memory rawHeader = _header(transactionsRoot, receiptsRoot, 1);
        bytes32 blockHash = keccak256(rawHeader);
        _anchor(1, blockHash);

        assertTrue(
            verifier.verifyRecentInclusion(
                1,
                blockHash,
                rawHeader,
                1,
                keccak256(rawTransaction),
                rawTransaction,
                transactionProof,
                rawReceipt,
                receiptProof
            )
        );
    }

    function test_rejectsMutatedValueAgainstOffchainGeneratedHashedBranchProof() public {
        (
            bytes memory rawTransaction,
            bytes memory rawReceipt,
            bytes32 transactionsRoot,
            bytes32 receiptsRoot,
            bytes[] memory transactionProof,
            bytes[] memory receiptProof
        ) = _hashedBranchVector();
        bytes memory rawHeader = _header(transactionsRoot, receiptsRoot, 1);
        bytes32 blockHash = keccak256(rawHeader);
        _anchor(1, blockHash);
        rawTransaction[0] = bytes1(uint8(rawTransaction[0]) ^ 1);

        vm.expectRevert(MerklePatriciaProof.InvalidProof.selector);
        verifier.verifyRecentInclusion(
            1,
            blockHash,
            rawHeader,
            1,
            keccak256(rawTransaction),
            rawTransaction,
            transactionProof,
            rawReceipt,
            receiptProof
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

    function _hashedBranchVector()
        private
        pure
        returns (
            bytes memory rawTransaction,
            bytes memory rawReceipt,
            bytes32 transactionsRoot,
            bytes32 receiptsRoot,
            bytes[] memory transactionProof,
            bytes[] memory receiptProof
        )
    {
        // Three-node tx/receipt proofs generated by buildTransactionAndReceiptProofs
        // for 16 indexed values (64 bytes each), targeting index 1.
        rawTransaction = hex"02030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303";
        rawReceipt = hex"02040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404";
        transactionsRoot = 0x73f85cd60cd3b617472f3ad33fb4a740789d2ce9905f049017843a4a913c1b47;
        receiptsRoot = 0x10fd7dfb8738377d964c8e9c4354e72c4236fb7856a7e9e45ae6263d78e972dd;

        transactionProof = new bytes[](3);
        transactionProof[0] = hex"f851a093371523351f0a7b7751ccfbc8268481c36a7c7a6f0131030be1d1d8e872b52f80808080808080a0d4a5bf729ea1cb8ade7e5704b067e8ba7dd857ea641c48c9428417c8f1733fd38080808080808080";
        transactionProof[1] = hex"f901f180a08e2f9326a7e5789f60da780e867067c3c14ac0557bb787287847db8c2036f1f0a0351cc4b2393e0afd1f62d77d63bce0166e0a787eecf53fd55052dce490e2f56ba0c4302e468e95b992df92008fcde1a01b451d9322f1a7b27fe1fd43daa0e06c6fa0a7c24bd238964b836386411b5eeac042f8bb3cd6afc0925eda29b4f9b0a945f5a0be902f7421dfe96fb0d7e512a6e05d35d3e97e24f9f2bebec72ea6a8abd7823da01d50b17bcc301dc83ee90dc3a94e5281bd606cbc121a57ca116d512fe7ad7df3a0edb6179f4fd04d005c19cec8742388936757f9d0a47f22ec568e02c5f52c24fba073c8cc6c604e0104810352a814c4ef3ad34061a5e9c488d75e44b71305cbb9f5a0a6fbb5bb9f729c69e995119a021cf248dc0fff5aeac7ce62cc5969f26004c669a004e59279739217f2554515e6aa5dda476319e066ce5c5489e5a6c1471c4604b6a01245b0447c7638eb214c59b134da6ab7b289ae5f72244e6ce06e9244f896a758a023c5d8444b317901dd0e558d56a4b4f432b7b3a19f1ab4e3d7e67b19a186a9c5a0030ca44ac4fab628aca10b8a7796ca21b3894f7046e60af4cb649c0fc10c2b66a08b1fb186fb24f2d5462da0dfc2129561cea723c0332abec9c5548ea736ae7453a0cf1f4f9afb232a73fc75df6552c66f9334ca9690fc1c0541c8f767df632a85a380";
        transactionProof[2] = hex"f84320b84002030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303030303";

        receiptProof = new bytes[](3);
        receiptProof[0] = hex"f851a0da93a91d97a9d97395fdd910822e77a89c956affa97fc8a09732a3fac8ff29a680808080808080a0b61ea730b822f69007d194cf21b8d9cfe6f60cba3b7216318b3f0187b6e7a70e8080808080808080";
        receiptProof[1] = hex"f901f180a0623fdf12b5ab3ae4ec53c5a8f79649c6fa9bd0d4d460caf4fd5bb26c575ca84ea0943a6a84312cc7fc289cb70854565e154bf646539f4d1f7cdd3d64f35b3206f4a0054f2946486a10d7a35efc7c60a4410eac57745b7b5926425282f569afca11dba067a06d18f58f594022a141c8b57ee24af1dd54ee290a169d8c5b72a27c5c0b62a0a16182c7f56c1eeb6bdb2d9eb3fb56963ab91cb358311dd6860346f80c971b8ca0c289145aa25e120fc35c858d0c60baae92750ad1d98d0498c16aa48320b7343ea06bc1299c2e0ba80a699ece2baca220d6d97ebd3a1a63862bb38b8b261cce3cf4a0e7b2e9feac6bef52c9ee597397d9cf790a643d5015734476ee004a5f2a24779da09b047298b400755a59c97568cfd075e51f291d3985c7b7bdacdd9000c09cbf6ea01d1bfc82f93044d9104199f059089eddd5e01555af086e3f6d370b32ffe9e75ba0f69c3a509150a920aa284989e8365c5e5678b8359755380979466606999d7d52a00f311a31b4eee52ec2ba8d4898cbbda754ded83a16a1cb4a648126151abbdcdca0af60eee06f1da998c73daa85bd943c87c33f79e862d3c090a9ab2e549620e9a3a0c2fd8a4326e3fc68635f331087fc872ae445ccd61d75c168a07e4cb84a3e0316a09ede92edd35927dc61506c9f3f2a08a24808f34b73b67bd15040a537fc110e7180";
        receiptProof[2] = hex"f84320b84002040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404040404";
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
