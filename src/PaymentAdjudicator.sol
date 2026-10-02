// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice Deterministic comparison of a bounded payment claim with normalized
///         evidence. This library does not authenticate the evidence source.
/// @dev Amounts are exact unsigned integers in the asset's base unit (wei for
///      native MON). No floating point values enter the decision path.
library PaymentAdjudicator {
    enum CheckStatus {
        ABSTAIN,
        PASS,
        FAIL
    }

    enum Verdict {
        VERIFIED,
        NOT_VERIFIED,
        INSUFFICIENT_EVIDENCE
    }

    uint8 internal constant TRANSACTION_HASH_CHECK = 0;
    uint8 internal constant CHAIN_ID_CHECK = 1;
    uint8 internal constant EXECUTION_CHECK = 2;
    uint8 internal constant SENDER_CHECK = 3;
    uint8 internal constant RECIPIENT_CHECK = 4;
    uint8 internal constant ASSET_CHECK = 5;
    uint8 internal constant AMOUNT_CHECK = 6;
    uint8 internal constant CHECK_COUNT = 7;

    struct Claim {
        bytes32 transactionHash;
        uint256 chainId;
        bool assertsSender;
        address sender;
        bool assertsRecipient;
        address recipient;
        bool assertsAsset;
        address asset;
        bool assertsAmount;
        uint256 amount;
    }

    struct Evidence {
        bool available;
        bytes32 transactionHash;
        uint256 chainId;
        uint256 blockNumber;
        bytes32 blockHash;
        bool successful;
        address sender;
        address recipient;
        address asset;
        uint256 amount;
        bytes32 transactionPayloadDigest;
        bytes32 receiptPayloadDigest;
        bytes32 logsDigest;
        bytes32 finalityPolicyId;
        uint64 requiredConfirmations;
        uint64 observedConfirmations;
    }

    struct Evaluation {
        Verdict verdict;
        CheckStatus[CHECK_COUNT] checks;
    }

    /// @notice Compare each asserted proposition independently.
    /// @dev A missing evidence acquisition yields INSUFFICIENT_EVIDENCE.
    ///      Once evidence is available, any contradicted proposition dominates
    ///      and yields NOT_VERIFIED. Unasserted fields remain ABSTAIN.
    function evaluate(Claim memory claim, Evidence memory evidence, uint256 expectedChainId)
        internal
        pure
        returns (Evaluation memory result)
    {
        if (
            !evidence.available || evidence.finalityPolicyId == bytes32(0)
                || evidence.requiredConfirmations == 0
                || evidence.observedConfirmations < evidence.requiredConfirmations
        ) {
            result.verdict = Verdict.INSUFFICIENT_EVIDENCE;
            return result;
        }

        result.checks[TRANSACTION_HASH_CHECK] = _same(
            claim.transactionHash == evidence.transactionHash
        );
        result.checks[CHAIN_ID_CHECK] = _same(
            claim.chainId == expectedChainId && evidence.chainId == expectedChainId
        );
        result.checks[EXECUTION_CHECK] = _same(evidence.successful);
        result.checks[SENDER_CHECK] = claim.assertsSender
            ? _same(claim.sender == evidence.sender)
            : CheckStatus.ABSTAIN;
        result.checks[RECIPIENT_CHECK] = claim.assertsRecipient
            ? _same(claim.recipient == evidence.recipient)
            : CheckStatus.ABSTAIN;
        result.checks[ASSET_CHECK] = claim.assertsAsset
            ? _same(claim.asset == evidence.asset)
            : CheckStatus.ABSTAIN;
        result.checks[AMOUNT_CHECK] = claim.assertsAmount
            ? _same(claim.amount == evidence.amount)
            : CheckStatus.ABSTAIN;

        for (uint256 i; i < CHECK_COUNT; ++i) {
            if (result.checks[i] == CheckStatus.FAIL) {
                result.verdict = Verdict.NOT_VERIFIED;
                return result;
            }
        }
        result.verdict = Verdict.VERIFIED;
    }

    function _same(bool matches) private pure returns (CheckStatus) {
        return matches ? CheckStatus.PASS : CheckStatus.FAIL;
    }
}
