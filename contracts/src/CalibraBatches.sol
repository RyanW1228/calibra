// contracts/src/CalibraBatches.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CalibraVault.sol";
import "./CalibraCommitments.sol";
import "./CalibraMath.sol";

contract CalibraBatches {
    using CalibraMath for uint256;

    address public admin;

    CalibraVault public immutable vault;
    CalibraCommitments public immutable commitments;

    uint256 private constant USDC_DECIMALS = 1_000_000;

    struct Batch {
        address operator;
        address funder;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 revealDeadline;
        bytes32 specHash;
        bool funded;
        bool finalized;
        uint256 bounty;
        uint256 joinBond;
        uint16 refundTopBP;
        bytes32 funderEncryptPubKeyHash;
    }

    mapping(bytes32 => Batch) private batches;

    event BatchCreated(
        bytes32 indexed batchIdHash,
        address indexed operator,
        address indexed funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bytes32 specHash,
        uint16 refundTopBP,
        bytes32 funderEncryptPubKeyHash
    );

    event BatchFunded(
        bytes32 indexed batchIdHash,
        uint256 bounty,
        uint256 joinBond
    );

    event Joined(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint256 bond
    );

    event Judged(bytes32 indexed batchIdHash, bytes32 scoresHash);

    event Finalized(bytes32 indexed batchIdHash);

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyOperator(bytes32 batchIdHash) {
        require(msg.sender == batches[batchIdHash].operator, "Not operator");
        _;
    }

    constructor(address vault_, address commitments_) {
        require(vault_ != address(0), "Vault required");
        require(commitments_ != address(0), "Commitments required");

        vault = CalibraVault(vault_);
        commitments = CalibraCommitments(commitments_);
        admin = msg.sender;
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Bad admin");
        admin = newAdmin;
    }

    function createBatch(
        bytes32 batchIdHash,
        address funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bytes32 specHash,
        bytes calldata funderEncryptPubKey,
        uint16 refundTopBP,
        uint32 minCommitsPerProvider,
        uint32 maxCommitsPerProvider,
        bool requireRevealAllCommits
    ) external {
        require(batchIdHash != bytes32(0), "Bad batchId");
        require(funder != address(0), "Bad funder");
        require(windowStart < windowEnd, "Bad window");
        require(revealDeadline > windowEnd, "Bad revealDeadline");
        require(specHash != bytes32(0), "Bad specHash");
        require(refundTopBP <= 10_000, "Bad refundTopBP");
        require(funderEncryptPubKey.length > 0, "Bad pubkey");
        require(maxCommitsPerProvider > 0, "Bad maxCommits");

        Batch storage b = batches[batchIdHash];
        require(b.operator == address(0), "Already created");

        b.operator = msg.sender;
        b.funder = funder;
        b.windowStart = windowStart;
        b.windowEnd = windowEnd;
        b.revealDeadline = revealDeadline;
        b.specHash = specHash;
        b.refundTopBP = refundTopBP;
        b.funderEncryptPubKeyHash = keccak256(funderEncryptPubKey);

        vault.registerBatch(batchIdHash, funder);

        commitments.configureBatch(
            batchIdHash,
            msg.sender,
            funder,
            windowStart,
            windowEnd,
            revealDeadline,
            minCommitsPerProvider,
            maxCommitsPerProvider,
            requireRevealAllCommits
        );

        emit BatchCreated(
            batchIdHash,
            msg.sender,
            funder,
            windowStart,
            windowEnd,
            revealDeadline,
            specHash,
            refundTopBP,
            b.funderEncryptPubKeyHash
        );
    }

    // MVP-friendly: funder deposits bounty directly into Vault first,
    // then anyone can call this to sync Batch state + compute join bond.
    function markFunded(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.operator != address(0), "Not created");
        require(!b.funded, "Already funded");

        (address funder, uint256 bounty, bool bountyDeposited, , ) = vault
            .getBatchFunds(batchIdHash);
        require(funder == b.funder, "Vault funder mismatch");
        require(bountyDeposited, "Vault not funded");
        require(bounty > 0, "Bad bounty");

        uint256 bountyUsd = bounty / USDC_DECIMALS;
        require(bountyUsd > 0, "Bounty < 1 USDC");

        uint256 bondUsd = bountyUsd.isqrt();
        uint256 joinBond = bondUsd * USDC_DECIMALS;
        require(joinBond > 0, "Bond not set");

        b.bounty = bounty;
        b.joinBond = joinBond;
        b.funded = true;

        emit BatchFunded(batchIdHash, bounty, joinBond);
    }

    function join(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.funded, "Not funded");
        require(block.timestamp < b.windowEnd, "Window ended");

        uint256 bond = b.joinBond;
        require(bond > 0, "Bond not set");

        vault.lockBond(batchIdHash, msg.sender, bond);
        commitments.joinForProvider(batchIdHash, msg.sender);

        emit Joined(batchIdHash, msg.sender, bond);
    }

    // Operator supplies publicly-auditable settlement inputs:
    // - providers[] list
    // - payouts[] in USDC base units
    // - isLoser[] marks bottom X% (slash bond to funder)
    // - scoresHash commits to the scoring file (publicly checkable)
    function finalize(
        bytes32 batchIdHash,
        address[] calldata providers,
        uint256[] calldata payouts,
        bool[] calldata isLoser,
        bytes32 scoresHash
    ) external onlyOperator(batchIdHash) {
        Batch storage b = batches[batchIdHash];

        require(b.funded, "Not funded");
        require(!b.finalized, "Already finalized");
        require(block.timestamp > b.revealDeadline, "Reveal not closed");

        require(providers.length > 0, "No providers");
        require(providers.length == payouts.length, "Len mismatch");
        require(providers.length == isLoser.length, "Len mismatch");
        require(scoresHash != bytes32(0), "Bad scoresHash");

        for (uint256 i = 0; i < providers.length; i++) {
            require(providers[i] != address(0), "Bad provider");
            require(
                commitments.isEligibleForFinalize(batchIdHash, providers[i]),
                "Provider not eligible"
            );
        }

        vault.setPayouts(batchIdHash, providers, payouts);

        for (uint256 i = 0; i < providers.length; i++) {
            bool refund = !isLoser[i];
            vault.settleBond(batchIdHash, providers[i], refund, b.funder);
        }

        vault.closeBatch(batchIdHash);

        emit Judged(batchIdHash, scoresHash);

        b.finalized = true;
        emit Finalized(batchIdHash);
    }

    function getBatch(
        bytes32 batchIdHash
    )
        external
        view
        returns (
            address operator,
            address funder,
            uint256 bounty,
            uint256 joinBond,
            uint64 windowStart,
            uint64 windowEnd,
            uint64 revealDeadline,
            bytes32 specHash,
            bool funded,
            bool finalized,
            uint16 refundTopBP,
            bytes32 funderEncryptPubKeyHash
        )
    {
        Batch storage b = batches[batchIdHash];
        return (
            b.operator,
            b.funder,
            b.bounty,
            b.joinBond,
            b.windowStart,
            b.windowEnd,
            b.revealDeadline,
            b.specHash,
            b.funded,
            b.finalized,
            b.refundTopBP,
            b.funderEncryptPubKeyHash
        );
    }
}
