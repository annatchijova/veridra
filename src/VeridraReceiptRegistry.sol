pragma solidity ^0.8.24;

import {PaymentAdjudicator} from "./PaymentAdjudicator.sol";

/// @title VeridraReceiptRegistry
/// @notice Immutable onchain record of a named publisher's RPC-based payment
///         adjudication. The contract compares normalized facts and anchors the
///         result; it does not fetch RPC data or prove that the publisher told
///         the truth about its RPC source.
/// @dev The immutable publisher is the Level 1 trust authority. Receipts use
///      assurance code 1 (RPC_ATTESTED) only. Stronger evidence mechanisms need
///      their own verifier and a new receipt schema version.
contract VeridraReceiptRegistry {
    uint16 public constant RECEIPT_SCHEMA_VERSION = 1;
    uint8 public constant RPC_ATTESTED = 1;

    address public immutable publisher;

    struct Receipt {
        uint16 schemaVersion;
        uint8 evidenceAssurance;
        PaymentAdjudicator.Verdict verdict;
        PaymentAdjudicator.CheckStatus[7] checks;
        bytes32 transactionHash;
        uint256 chainId;
        uint256 blockNumber;
        bytes32 blockHash;
        bytes32 providerId;
        uint64 observedAt;
        uint64 recordedAt;
        bytes32 claimDigest;
        bytes32 evidenceDigest;
        PaymentAdjudicator.Claim claim;
        PaymentAdjudicator.Evidence evidence;
    }

    mapping(bytes32 receiptId => Receipt receipt) private receipts;

    error UnauthorizedPublisher(address caller);
    error InvalidPublisher();
    error InvalidClaim();
    error InvalidEvidence();
    error InvalidProvenance();
    error FutureObservation(uint64 observedAt, uint256 currentTimestamp);

    event ReceiptPublished(
        bytes32 indexed receiptId,
        bytes32 indexed transactionHash,
        uint256 indexed chainId,
        address publisher,
        uint16 schemaVersion,
        uint8 evidenceAssurance,
        PaymentAdjudicator.Verdict verdict,
        bytes32 providerId,
        uint64 observedAt,
        uint64 recordedAt,
        bytes32 claimDigest,
        bytes32 evidenceDigest,
        PaymentAdjudicator.CheckStatus[7] checks
    );

    /// @param publisher_ Sole address allowed to submit RPC-derived evidence.
    constructor(address publisher_) {
        if (publisher_ == address(0)) revert InvalidPublisher();
        publisher = publisher_;
    }

    /// @notice Record the immutable result of comparing a claim with evidence
    ///         acquired from a named RPC source.
    /// @param claim Bounded payment assertions. Optional fields use explicit
    ///              `asserts*` flags so address(0) remains native MON.
    /// @param evidence Normalized transaction and receipt facts from the RPC.
    /// @param providerId Stable identifier for the configured RPC/provider;
    ///                   do not pass an endpoint containing credentials.
    /// @param observedAt Publisher host's Unix observation time, not a chain
    ///                   timestamp and not signed by the provider.
    /// @return receiptId Stable digest; repeating the same publication is
    ///                   idempotent and returns the existing identifier.
    function publish(
        PaymentAdjudicator.Claim calldata claim,
        PaymentAdjudicator.Evidence calldata evidence,
        bytes32 providerId,
        uint64 observedAt
    ) external returns (bytes32 receiptId) {
        if (msg.sender != publisher) revert UnauthorizedPublisher(msg.sender);
        if (claim.transactionHash == bytes32(0) || claim.chainId == 0) {
            revert InvalidClaim();
        }
        if (providerId == bytes32(0) || observedAt == 0) {
            revert InvalidProvenance();
        }
        if (observedAt > block.timestamp) {
            revert FutureObservation(observedAt, block.timestamp);
        }
        if (block.timestamp > type(uint64).max) revert InvalidProvenance();

        if (evidence.available) {
            if (
                evidence.transactionHash == bytes32(0) || evidence.chainId == 0
                    || evidence.blockHash == bytes32(0)
                    || evidence.transactionPayloadDigest == bytes32(0)
                    || evidence.receiptPayloadDigest == bytes32(0)
                    || evidence.logsDigest == bytes32(0)
            ) revert InvalidEvidence();
        }

        PaymentAdjudicator.Evaluation memory evaluation =
            PaymentAdjudicator.evaluate(claim, evidence, block.chainid);
        bytes32 claimDigest = keccak256(abi.encode(claim));
        bytes32 evidenceDigest = keccak256(abi.encode(evidence));
        uint64 recordedAt = uint64(block.timestamp);

        receiptId = keccak256(
            abi.encode(
                RECEIPT_SCHEMA_VERSION,
                RPC_ATTESTED,
                block.chainid,
                address(this),
                claimDigest,
                evidenceDigest,
                providerId,
                observedAt,
                evaluation.verdict,
                evaluation.checks
            )
        );

        if (receipts[receiptId].schemaVersion != 0) return receiptId;

        Receipt storage stored = receipts[receiptId];
        stored.schemaVersion = RECEIPT_SCHEMA_VERSION;
        stored.evidenceAssurance = RPC_ATTESTED;
        stored.verdict = evaluation.verdict;
        stored.checks = evaluation.checks;
        stored.transactionHash = claim.transactionHash;
        stored.chainId = block.chainid;
        stored.providerId = providerId;
        stored.observedAt = observedAt;
        stored.recordedAt = recordedAt;
        stored.claimDigest = claimDigest;
        stored.evidenceDigest = evidenceDigest;
        stored.claim = claim;
        stored.evidence = evidence;

        if (evidence.available) {
            stored.blockNumber = evidence.blockNumber;
            stored.blockHash = evidence.blockHash;
        }

        emit ReceiptPublished(
            receiptId,
            claim.transactionHash,
            block.chainid,
            msg.sender,
            RECEIPT_SCHEMA_VERSION,
            RPC_ATTESTED,
            evaluation.verdict,
            providerId,
            observedAt,
            recordedAt,
            claimDigest,
            evidenceDigest,
            evaluation.checks
        );
    }

    /// @notice Return the stored immutable receipt. A zero schema version means
    ///         no receipt exists for the supplied id.
    function getReceipt(bytes32 receiptId) external view returns (Receipt memory) {
        return receipts[receiptId];
    }
}
