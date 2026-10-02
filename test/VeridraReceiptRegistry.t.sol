// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {VeridraReceiptRegistry} from "../src/VeridraReceiptRegistry.sol";
import {PaymentAdjudicator} from "../src/PaymentAdjudicator.sol";

contract VeridraReceiptRegistryTest is Test {
    VeridraReceiptRegistry registry;
    address publisher = address(0xBEEF);
    address stranger = address(0xD00D);

    function setUp() public {
        registry = new VeridraReceiptRegistry(publisher);
        vm.warp(1_700_000_000);
    }

    function _claim() internal view returns (PaymentAdjudicator.Claim memory) {
        return PaymentAdjudicator.Claim({
            transactionHash: keccak256("tx-1"),
            chainId: block.chainid,
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

    function _evidence(bytes32 transactionHash) internal view returns (PaymentAdjudicator.Evidence memory) {
        return PaymentAdjudicator.Evidence({
            available: true,
            transactionHash: transactionHash,
            chainId: block.chainid,
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

    function test_constructorRejectsZeroPublisher() public {
        vm.expectRevert(VeridraReceiptRegistry.InvalidPublisher.selector);
        new VeridraReceiptRegistry(address(0));
    }

    function test_onlyPublisherCanPublish() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(VeridraReceiptRegistry.UnauthorizedPublisher.selector, stranger));
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsZeroTransactionHash() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.transactionHash = bytes32(0);
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsZeroChainId() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.chainId = 0;
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsUnassertedSenderWithNonzeroValue() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.sender = address(0xDEAD);
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsUnassertedRecipientWithNonzeroValue() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.recipient = address(0xDEAD);
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsUnassertedAssetWithNonzeroValue() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.asset = address(0xDEAD);
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsUnassertedAmountWithNonzeroValue() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.amount = 1;
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    function test_rejectsZeroProviderId() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidProvenance.selector);
        registry.publish(claim, evidence, bytes32(0), uint64(block.timestamp));
    }

    function test_rejectsZeroObservedAt() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidProvenance.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), 0);
    }

    function test_rejectsFutureObservation() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);
        uint64 future = uint64(block.timestamp) + 1;

        vm.prank(publisher);
        vm.expectRevert(abi.encodeWithSelector(VeridraReceiptRegistry.FutureObservation.selector, future, block.timestamp));
        registry.publish(claim, evidence, keccak256("provider-1"), future);
    }

    function test_rejectsAvailableEvidenceWithMissingDigests() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);
        evidence.transactionPayloadDigest = bytes32(0);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidEvidence.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));
    }

    /// @dev A reverted publish must not leave a partial receipt behind — the
    ///      registry's only state-changing path is all-or-nothing.
    function test_revertedPublishLeavesNoReceipt() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.chainId = 0;
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        vm.expectRevert(VeridraReceiptRegistry.InvalidClaim.selector);
        registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));

        bytes32 probableId = keccak256(abi.encode(claim));
        VeridraReceiptRegistry.Receipt memory stored = registry.getReceipt(probableId);
        assertEq(stored.schemaVersion, 0);
    }

    function test_publishStoresMatchingVerdictAndEmitsEvent() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.assertsAmount = true;
        claim.amount = 100;
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);
        bytes32 providerId = keccak256("provider-1");
        uint64 observedAt = uint64(block.timestamp);

        vm.expectEmit(false, true, true, false, address(registry));
        emit VeridraReceiptRegistry.ReceiptPublished(
            bytes32(0),
            claim.transactionHash,
            block.chainid,
            publisher,
            registry.RECEIPT_SCHEMA_VERSION(),
            registry.RPC_ATTESTED(),
            PaymentAdjudicator.Verdict.VERIFIED,
            providerId,
            observedAt,
            observedAt,
            bytes32(0),
            bytes32(0),
            [
                PaymentAdjudicator.CheckStatus.PASS,
                PaymentAdjudicator.CheckStatus.PASS,
                PaymentAdjudicator.CheckStatus.PASS,
                PaymentAdjudicator.CheckStatus.ABSTAIN,
                PaymentAdjudicator.CheckStatus.ABSTAIN,
                PaymentAdjudicator.CheckStatus.ABSTAIN,
                PaymentAdjudicator.CheckStatus.PASS
            ]
        );

        vm.prank(publisher);
        bytes32 receiptId = registry.publish(claim, evidence, providerId, observedAt);

        VeridraReceiptRegistry.Receipt memory stored = registry.getReceipt(receiptId);
        assertEq(stored.schemaVersion, registry.RECEIPT_SCHEMA_VERSION());
        assertEq(stored.evidenceAssurance, registry.RPC_ATTESTED());
        assertEq(uint8(stored.verdict), uint8(PaymentAdjudicator.Verdict.VERIFIED));
        assertEq(stored.transactionHash, claim.transactionHash);
        assertEq(stored.chainId, block.chainid);
        assertEq(stored.providerId, providerId);
        assertEq(stored.observedAt, observedAt);
        assertEq(stored.blockNumber, evidence.blockNumber);
        assertEq(stored.blockHash, evidence.blockHash);
    }

    /// @dev The registry stores block.chainid, not claim.chainId — a claim
    ///      targeting the wrong chain still gets recorded (as NOT_VERIFIED),
    ///      tagged under the chain it was actually submitted to.
    function test_storedChainIdIsBlockChainIdNotClaimChainId() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        claim.chainId = block.chainid + 1;
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);

        vm.prank(publisher);
        bytes32 receiptId = registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));

        VeridraReceiptRegistry.Receipt memory stored = registry.getReceipt(receiptId);
        assertEq(stored.chainId, block.chainid);
        assertEq(uint8(stored.verdict), uint8(PaymentAdjudicator.Verdict.NOT_VERIFIED));
    }

    /// @dev When evidence.available is false, blockNumber/blockHash must stay
    ///      at their zero default — the registry must not surface stale or
    ///      fabricated block fields for a receipt with no usable evidence.
    function test_unavailableEvidenceLeavesBlockFieldsZero() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);
        evidence.available = false;
        evidence.blockNumber = 999;
        evidence.blockHash = keccak256("should-not-be-stored");

        vm.prank(publisher);
        bytes32 receiptId = registry.publish(claim, evidence, keccak256("provider-1"), uint64(block.timestamp));

        VeridraReceiptRegistry.Receipt memory stored = registry.getReceipt(receiptId);
        assertEq(uint8(stored.verdict), uint8(PaymentAdjudicator.Verdict.INSUFFICIENT_EVIDENCE));
        assertEq(stored.blockNumber, 0);
        assertEq(stored.blockHash, bytes32(0));
    }

    /// @dev Identical resubmission is idempotent: same receipt ID, no second
    ///      event, and the stored recordedAt is left untouched by the replay.
    function test_identicalResubmissionIsIdempotentAndDoesNotReemit() public {
        PaymentAdjudicator.Claim memory claim = _claim();
        PaymentAdjudicator.Evidence memory evidence = _evidence(claim.transactionHash);
        bytes32 providerId = keccak256("provider-1");
        uint64 observedAt = uint64(block.timestamp);

        vm.prank(publisher);
        bytes32 firstId = registry.publish(claim, evidence, providerId, observedAt);
        VeridraReceiptRegistry.Receipt memory firstStored = registry.getReceipt(firstId);

        vm.warp(block.timestamp + 1 hours);
        vm.recordLogs();
        vm.prank(publisher);
        bytes32 secondId = registry.publish(claim, evidence, providerId, observedAt);

        assertEq(secondId, firstId);
        assertEq(vm.getRecordedLogs().length, 0);

        VeridraReceiptRegistry.Receipt memory secondStored = registry.getReceipt(secondId);
        assertEq(secondStored.recordedAt, firstStored.recordedAt);
    }

    function test_getReceiptForUnknownIdReturnsZeroSchemaVersion() public view {
        VeridraReceiptRegistry.Receipt memory stored = registry.getReceipt(keccak256("never-published"));
        assertEq(stored.schemaVersion, 0);
    }
}
