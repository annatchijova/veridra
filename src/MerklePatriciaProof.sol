// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Bounded inclusion verifier for Ethereum-style hexary Merkle Patricia tries.
/// @dev Proof values are the trie value payloads (not RLP-wrapped a second time).
///      The caller must authenticate the supplied root independently.
library MerklePatriciaProof {
    uint256 internal constant MAX_PROOF_NODES = 20;
    uint256 internal constant MAX_NODE_BYTES = 8_256;
    uint256 internal constant MAX_PROOF_BYTES = 40_000;
    uint256 internal constant MAX_VALUE_BYTES = 8_192;
    uint256 internal constant MAX_HEADER_BYTES = 4_096;

    error InvalidProof();
    error ProofExceedsBounds();

    struct Item {
        uint256 startOffset;
        uint256 payloadOffset;
        uint256 payloadLength;
        uint256 nextOffset;
        bool isList;
    }

    /// @notice Verify that `value` is committed at `index` under `root`.
    /// @dev Ethereum transaction and receipt tries use `RLP(index)` as the key.
    ///      The encoded trie node list is bounded before parsing; malformed,
    ///      non-canonical, incomplete, or inconsistent proofs revert.
    function verifyIndexedValue(
        bytes32 root,
        uint64 index,
        bytes calldata value,
        bytes[] calldata proof
    ) internal pure {
        if (value.length == 0 || value.length > MAX_VALUE_BYTES || proof.length == 0 || proof.length > MAX_PROOF_NODES) {
            revert ProofExceedsBounds();
        }

        uint256 totalBytes = 0;
        for (uint256 i; i < proof.length; ++i) {
            uint256 nodeLength = proof[i].length;
            if (nodeLength == 0 || nodeLength > MAX_NODE_BYTES) revert ProofExceedsBounds();
            totalBytes += nodeLength;
            if (totalBytes > MAX_PROOF_BYTES) revert ProofExceedsBounds();
        }

        bytes memory key = _rlpIndex(index);
        bytes memory nibbles = _nibbles(key);
        bytes32 expectedHash = root;
        uint256 keyOffset = 0;
        uint256 proofIndex = 0;
        bytes memory encodedNode = proof[0];
        bool nodeFromProof = true;

        while (true) {
            if (nodeFromProof && keccak256(encodedNode) != expectedHash) revert InvalidProof();

            Item memory nodeItem = _item(encodedNode, 0);
            if (!nodeItem.isList || nodeItem.nextOffset != encodedNode.length) revert InvalidProof();
            uint256 itemCount = _countItems(encodedNode, nodeItem);

            if (itemCount == 17) {
                if (keyOffset == nibbles.length) {
                    Item memory branchValue = _itemAt(encodedNode, nodeItem, 16);
                    if (branchValue.isList || !_matches(encodedNode, branchValue, value)) revert InvalidProof();
                    if (proofIndex + 1 != proof.length) revert InvalidProof();
                    return;
                }

                uint8 nibble = uint8(nibbles[keyOffset]);
                Item memory child = _itemAt(encodedNode, nodeItem, nibble);
                ++keyOffset;
                if (child.isList) {
                    encodedNode = _slice(encodedNode, child.startOffset, child.nextOffset - child.startOffset);
                    if (encodedNode.length >= 32) revert InvalidProof();
                    nodeFromProof = false;
                } else if (child.payloadLength == 32) {
                    expectedHash = _payloadHash(encodedNode, child);
                    if (++proofIndex >= proof.length) revert InvalidProof();
                    encodedNode = proof[proofIndex];
                    nodeFromProof = true;
                } else {
                    revert InvalidProof();
                }
            } else if (itemCount == 2) {
                Item memory compactPath = _itemAt(encodedNode, nodeItem, 0);
                Item memory second = _itemAt(encodedNode, nodeItem, 1);
                if (compactPath.isList || compactPath.payloadLength == 0) revert InvalidProof();
                (bool isLeaf, uint256 pathLength, uint256 compactStart) = _compactPath(encodedNode, compactPath);
                bool oddPath = ((uint8(encodedNode[compactStart]) >> 4) & 1) == 1;
                if (keyOffset + pathLength > nibbles.length) revert InvalidProof();
                for (uint256 j; j < pathLength; ++j) {
                    if (_compactNibble(encodedNode, compactStart, j, oddPath) != uint8(nibbles[keyOffset + j])) {
                        revert InvalidProof();
                    }
                }
                keyOffset += pathLength;

                if (isLeaf) {
                    if (keyOffset != nibbles.length || second.isList || !_matches(encodedNode, second, value)) {
                        revert InvalidProof();
                    }
                    if (proofIndex + 1 != proof.length) revert InvalidProof();
                    return;
                }

                if (pathLength == 0) revert InvalidProof();
                if (second.isList) {
                    encodedNode = _slice(encodedNode, second.startOffset, second.nextOffset - second.startOffset);
                    if (encodedNode.length >= 32) revert InvalidProof();
                    nodeFromProof = false;
                } else if (second.payloadLength == 32) {
                    expectedHash = _payloadHash(encodedNode, second);
                    if (++proofIndex >= proof.length) revert InvalidProof();
                    encodedNode = proof[proofIndex];
                    nodeFromProof = true;
                } else {
                    revert InvalidProof();
                }
            } else {
                revert InvalidProof();
            }
        }
    }

    /// @notice Extract transaction and receipt roots from a raw EVM block header.
    /// @dev The caller must authenticate `keccak256(header)` against BLOCKHASH.
    function headerRoots(bytes calldata rawHeader)
        internal
        pure
        returns (uint64 number, bytes32 transactionsRoot, bytes32 receiptsRoot)
    {
        if (rawHeader.length == 0 || rawHeader.length > MAX_HEADER_BYTES) revert ProofExceedsBounds();
        number = 0;
        bytes memory encoded = rawHeader;
        Item memory header = _item(encoded, 0);
        if (!header.isList || header.nextOffset != encoded.length) revert InvalidProof();
        uint256 fieldCount = _countItems(encoded, header);
        if (fieldCount < 15 || fieldCount > 32) revert InvalidProof();

        transactionsRoot = _readBytes32(encoded, _itemAt(encoded, header, 4));
        receiptsRoot = _readBytes32(encoded, _itemAt(encoded, header, 5));
        Item memory numberItem = _itemAt(encoded, header, 8);
        if (numberItem.isList || numberItem.payloadLength > 8) revert InvalidProof();
        if (numberItem.payloadLength != 0 && encoded[numberItem.payloadOffset] == bytes1(0)) revert InvalidProof();
        for (uint256 i; i < numberItem.payloadLength; ++i) {
            number = (number << 8) | uint8(encoded[numberItem.payloadOffset + i]);
        }
    }

    function _rlpIndex(uint64 index) private pure returns (bytes memory encoded) {
        if (index == 0) return hex"80";
        if (index < 0x80) {
            encoded = new bytes(1);
            encoded[0] = bytes1(uint8(index));
            return encoded;
        }

        uint256 length = 0;
        uint64 remaining = index;
        while (remaining != 0) {
            ++length;
            remaining >>= 8;
        }
        encoded = new bytes(length + 1);
        encoded[0] = bytes1(uint8(0x80 + length));
        for (uint256 i; i < length; ++i) {
            encoded[length - i] = bytes1(uint8(index >> (i * 8)));
        }
    }

    function _nibbles(bytes memory value) private pure returns (bytes memory result) {
        result = new bytes(value.length * 2);
        for (uint256 i; i < value.length; ++i) {
            uint8 b = uint8(value[i]);
            result[i * 2] = bytes1(b >> 4);
            result[i * 2 + 1] = bytes1(b & 0x0f);
        }
    }

    function _compactPath(bytes memory encoded, Item memory item)
        private
        pure
        returns (bool isLeaf, uint256 pathLength, uint256 pathStart)
    {
        uint8 first = uint8(encoded[item.payloadOffset]);
        uint8 flag = first >> 4;
        if (flag > 3) revert InvalidProof();
        isLeaf = flag >= 2;
        bool odd = (flag & 1) == 1;
        if (!odd && (first & 0x0f) != 0) revert InvalidProof();
        pathLength = item.payloadLength * 2 - (odd ? 1 : 2);
        pathStart = item.payloadOffset;
    }

    function _compactNibble(bytes memory encoded, uint256 start, uint256 index, bool odd)
        private
        pure
        returns (uint8)
    {
        uint256 packedIndex = index + (odd ? 1 : 2);
        uint8 b = uint8(encoded[start + packedIndex / 2]);
        return (packedIndex & 1) == 0 ? b >> 4 : b & 0x0f;
    }

    function _countItems(bytes memory encoded, Item memory list) private pure returns (uint256 count) {
        uint256 cursor = list.payloadOffset;
        uint256 end = list.payloadOffset + list.payloadLength;
        while (cursor < end) {
            Item memory child = _item(encoded, cursor);
            if (child.nextOffset <= cursor || child.nextOffset > end) revert InvalidProof();
            cursor = child.nextOffset;
            ++count;
            if (count > 32) revert InvalidProof();
        }
        if (cursor != end) revert InvalidProof();
    }

    function _itemAt(bytes memory encoded, Item memory list, uint256 wanted)
        private
        pure
        returns (Item memory item)
    {
        uint256 cursor = list.payloadOffset;
        uint256 end = list.payloadOffset + list.payloadLength;
        for (uint256 i; i <= wanted; ++i) {
            if (cursor >= end) revert InvalidProof();
            item = _item(encoded, cursor);
            if (item.nextOffset <= cursor || item.nextOffset > end) revert InvalidProof();
            cursor = item.nextOffset;
        }
    }

    function _item(bytes memory encoded, uint256 offset) private pure returns (Item memory result) {
        if (offset >= encoded.length) revert InvalidProof();
        uint8 prefix = uint8(encoded[offset]);
        uint256 length = 0;
        uint256 payloadOffset;

        if (prefix <= 0x7f) {
            return Item(offset, offset, 1, offset + 1, false);
        } else if (prefix <= 0xb7) {
            length = prefix - 0x80;
            payloadOffset = offset + 1;
            if (payloadOffset + length > encoded.length) revert InvalidProof();
            if (length == 1 && uint8(encoded[payloadOffset]) < 0x80) revert InvalidProof();
        } else if (prefix <= 0xbf) {
            uint256 lengthOfLength = prefix - 0xb7;
            (length, payloadOffset) = _longLength(encoded, offset, lengthOfLength);
            if (length < 56 || payloadOffset + length > encoded.length) revert InvalidProof();
        } else if (prefix <= 0xf7) {
            length = prefix - 0xc0;
            payloadOffset = offset + 1;
            if (payloadOffset + length > encoded.length) revert InvalidProof();
            return Item(offset, payloadOffset, length, payloadOffset + length, true);
        } else {
            uint256 lengthOfLength = prefix - 0xf7;
            (length, payloadOffset) = _longLength(encoded, offset, lengthOfLength);
            if (length < 56 || payloadOffset + length > encoded.length) revert InvalidProof();
            return Item(offset, payloadOffset, length, payloadOffset + length, true);
        }

        return Item(offset, payloadOffset, length, payloadOffset + length, false);
    }

    function _longLength(bytes memory encoded, uint256 offset, uint256 lengthOfLength)
        private
        pure
        returns (uint256 length, uint256 payloadOffset)
    {
        if (lengthOfLength == 0 || lengthOfLength > 8 || offset + 1 + lengthOfLength > encoded.length) {
            revert InvalidProof();
        }
        if (encoded[offset + 1] == bytes1(0)) revert InvalidProof();
        for (uint256 i; i < lengthOfLength; ++i) {
            length = (length << 8) | uint8(encoded[offset + 1 + i]);
        }
        payloadOffset = offset + 1 + lengthOfLength;
    }

    function _matches(bytes memory encoded, Item memory item, bytes calldata expected)
        private
        pure
        returns (bool)
    {
        if (item.payloadLength != expected.length) return false;
        for (uint256 i; i < expected.length; ++i) {
            if (encoded[item.payloadOffset + i] != expected[i]) return false;
        }
        return true;
    }

    function _readBytes32(bytes memory encoded, Item memory item) private pure returns (bytes32 value) {
        if (item.isList || item.payloadLength != 32) revert InvalidProof();
        assembly ("memory-safe") {
            value := mload(add(add(encoded, 0x20), mload(add(item, 0x20))))
        }
    }

    function _payloadHash(bytes memory encoded, Item memory item) private pure returns (bytes32 result) {
        assembly ("memory-safe") {
            result := mload(add(add(encoded, 0x20), mload(add(item, 0x20))))
        }
    }

    function _slice(bytes memory source, uint256 start, uint256 length) private pure returns (bytes memory result) {
        if (start + length > source.length) revert InvalidProof();
        result = new bytes(length);
        for (uint256 i; i < length; ++i) result[i] = source[start + i];
    }

}
