pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {PaymentAdjudicator} from "../src/PaymentAdjudicator.sol";

contract PaymentAdjudicatorTest is Test {
    uint256 constant CHAIN_ID = 10143;

    function _claim() internal pure returns (PaymentAdjudicator.Claim memory) {
        return PaymentAdjudicator.Claim({
            transactionHash: keccak256("tx-1"),
            chainId: CHAIN_ID,
            assertsSender: false,
            sender: address(0),
            assertsRecipient: false,
            recipient: address(0),
            assertsAsset: false,
            asset: address(0),
            assertsAmount: false,
            amount: 0
        });
    }

    function _availableEvidence(bytes32 transactionHash) internal pure returns (PaymentAdjudicator.Evidence memory) {
        return PaymentAdjudicator.Evidence({
            available: true,
            transactionHash: transactionHash,
            chainId: CHAIN_ID,
            blockNumber: 100,
            blockHash: keccak256("block-100"),
            successful: true,
            sender: address(0xA11CE),
            recipient: address(0xB0B),
            asset: address(0xA55E7),
            amount: 100,
            transactionPayloadDigest: keccak256("tx-payload"),
            receiptPayloadDigest: keccak256("receipt-payload"),
            logsDigest: keccak256("logs"),
            finalityPolicyId: keccak256("finality-v1"),
            requiredConfirmations: 1,
            observedConfirmations: 1
        });
    }

    /// @dev Unavailable evidence must dominate every other field, regardless of
    ///      how plausible the claim looks.
    function test_unavailableEvidenceYieldsInsufficient() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        evidence.available = false;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.INSUFFICIENT_EVIDENCE));
    }

    function test_missingFinalityPolicyYieldsInsufficient() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        evidence.finalityPolicyId = bytes32(0);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.INSUFFICIENT_EVIDENCE));
    }

    function test_zeroRequiredConfirmationsYieldsInsufficient() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        evidence.requiredConfirmations = 0;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.INSUFFICIENT_EVIDENCE));
    }

    function test_belowRequiredConfirmationsYieldsInsufficient() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        evidence.requiredConfirmations = 5;
        evidence.observedConfirmations = 4;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.INSUFFICIENT_EVIDENCE));
    }

    /// @dev A claim that asserts nothing beyond the transaction hash and chain
    ///      must still verify against matching, confirmed evidence — unasserted
    ///      fields are ABSTAIN, not a reason to withhold VERIFIED.
    function test_unassertedFieldsAbstainAndStillVerify() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.VERIFIED));
        assertEq(uint8(result.checks[PaymentAdjudicator.SENDER_CHECK]), uint8(PaymentAdjudicator.CheckStatus.ABSTAIN));
        assertEq(uint8(result.checks[PaymentAdjudicator.RECIPIENT_CHECK]), uint8(PaymentAdjudicator.CheckStatus.ABSTAIN));
        assertEq(uint8(result.checks[PaymentAdjudicator.ASSET_CHECK]), uint8(PaymentAdjudicator.CheckStatus.ABSTAIN));
        assertEq(uint8(result.checks[PaymentAdjudicator.AMOUNT_CHECK]), uint8(PaymentAdjudicator.CheckStatus.ABSTAIN));
    }

    function test_matchingAssertedFieldsPass() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        claim.assertsSender = true;
        claim.sender = evidence.sender;
        claim.assertsRecipient = true;
        claim.recipient = evidence.recipient;
        claim.assertsAsset = true;
        claim.asset = evidence.asset;
        claim.assertsAmount = true;
        claim.amount = evidence.amount;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.VERIFIED));
        assertEq(uint8(result.checks[PaymentAdjudicator.SENDER_CHECK]), uint8(PaymentAdjudicator.CheckStatus.PASS));
        assertEq(uint8(result.checks[PaymentAdjudicator.RECIPIENT_CHECK]), uint8(PaymentAdjudicator.CheckStatus.PASS));
        assertEq(uint8(result.checks[PaymentAdjudicator.ASSET_CHECK]), uint8(PaymentAdjudicator.CheckStatus.PASS));
        assertEq(uint8(result.checks[PaymentAdjudicator.AMOUNT_CHECK]), uint8(PaymentAdjudicator.CheckStatus.PASS));
    }

    function test_mismatchedSenderFailsAndDominatesVerdict() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        claim.assertsSender = true;
        claim.sender = address(0xDEAD);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
        assertEq(uint8(result.checks[PaymentAdjudicator.SENDER_CHECK]), uint8(PaymentAdjudicator.CheckStatus.FAIL));
    }

    function test_mismatchedRecipientFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        claim.assertsRecipient = true;
        claim.recipient = address(0xDEAD);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
    }

    function test_mismatchedAssetFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        claim.assertsAsset = true;
        claim.asset = address(0xDEAD);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
    }

    function test_mismatchedAmountFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        claim.assertsAmount = true;
        claim.amount = evidence.amount + 1;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
    }

    function test_unsuccessfulExecutionFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);
        evidence.successful = false;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
        assertEq(uint8(result.checks[PaymentAdjudicator.EXECUTION_CHECK]), uint8(PaymentAdjudicator.CheckStatus.FAIL));
    }

    function test_transactionHashMismatchFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(keccak256("different-tx"));

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
        assertEq(uint8(result.checks[PaymentAdjudicator.TRANSACTION_HASH_CHECK]), uint8(PaymentAdjudicator.CheckStatus.FAIL));
    }

    /// @dev A claim submitted against the wrong chain must not verify even if
    ///      every other field matches — this is the dominant cross-chain check.
    function test_wrongExpectedChainIdFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID + 1);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
        assertEq(uint8(result.checks[PaymentAdjudicator.CHAIN_ID_CHECK]), uint8(PaymentAdjudicator.CheckStatus.FAIL));
    }

    function test_claimChainIdDivergingFromEvidenceFails() public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.chainId = CHAIN_ID + 1;
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
    }

    /// @dev Fuzz: whenever evidence is available and sufficiently confirmed,
    ///      any single FAIL anywhere in the checks must dominate to
    ///      NOT_VERIFIED, and the absence of any FAIL must yield VERIFIED.
    ///      This locks the dominance rule independent of which field diverges.
    function testFuzz_failDominatesVerdictWheneverEvidenceIsUsable(
        bool senderAsserted,
        address senderClaim,
        bool recipientAsserted,
        address recipientClaim,
        bool assetAsserted,
        address assetClaim,
        bool amountAsserted,
        uint256 amountClaim
    ) public pure {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _availableEvidence(claim.transactionHash);

        claim.assertsSender = senderAsserted;
        claim.sender = senderAsserted ? senderClaim : address(0);
        claim.assertsRecipient = recipientAsserted;
        claim.recipient = recipientAsserted ? recipientClaim : address(0);
        claim.assertsAsset = assetAsserted;
        claim.asset = assetAsserted ? assetClaim : address(0);
        claim.assertsAmount = amountAsserted;
        claim.amount = amountAsserted ? amountClaim : 0;

        PaymentAdjudicator.Evaluation memory result = PaymentAdjudicator.evaluate(claim, evidence, CHAIN_ID);

        bool anyFail = (senderAsserted && senderClaim != evidence.sender)
            || (recipientAsserted && recipientClaim != evidence.recipient)
            || (assetAsserted && assetClaim != evidence.asset)
            || (amountAsserted && amountClaim != evidence.amount);

        if (anyFail) {
            assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
        } else {
            assertEq(uint8(result.verdict), uint8(PaymentAdjudicator.Verdict.VERIFIED));
        }
    }
}
