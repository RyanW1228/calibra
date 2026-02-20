// contracts/src/CalibraBatches.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./CalibraMath.sol";
import "./CalibraVault.sol";
import "./CalibraCommitments.sol";

contract CalibraBatches {
    using CalibraMath for uint256;

    address public admin;

    CalibraVault public immutable vault;
    CalibraCommitments public immutable commitments;

    struct Batch {
        address operator;
        address funder;
        uint256 bounty;
        uint256 joinBond;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 revealDeadline;
        bytes32 seedHash;
        bytes32 seed;
        bool seedRevealed;
        uint64 mixBlockNumber;
        bytes32 specHash;
        bool funded;
        bool finalized;
        uint16 refundTopBP; // top X% get bond back
    }

    mapping(bytes32 => Batch) private batches;

    event BatchCreated(
        bytes32 indexed batchIdHash,
        address indexed operator,
        address indexed funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bytes32 seedHash,
        bytes32 specHash,
        uint16 refundTopBP
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

    event RandomnessLocked(bytes32 indexed batchIdHash, uint64 mixBlockNumber);
    event SeedRevealed(
        bytes32 indexed batchIdHash,
        bytes32 seed,
        bytes32 randomness
    );

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

    // ------------------------------------------------------------
    // Batch creation
    // ------------------------------------------------------------

    function createBatch(
        bytes32 batchIdHash,
        address funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bytes32 seedHash,
        bytes32 specHash,
        bytes calldata funderEncryptPubKey,
        uint16 refundTopBP,
        bool requireAllSegments,
        uint32 minTotalCommits,
        uint32 maxCommitsPerProvider
    ) external {
        require(batchIdHash != bytes32(0), "Bad batchId");
        require(funder != address(0), "Bad funder");
        require(windowStart < windowEnd, "Bad window");
        require(revealDeadline > windowEnd, "Bad revealDeadline");
        require(seedHash != bytes32(0), "Bad seedHash");
        require(specHash != bytes32(0), "Bad specHash");
        require(refundTopBP <= 10_000, "Bad refundTopBP");

        Batch storage b = batches[batchIdHash];
        require(b.operator == address(0), "Already created");

        b.operator = msg.sender;
        b.funder = funder;
        b.windowStart = windowStart;
        b.windowEnd = windowEnd;
        b.revealDeadline = revealDeadline;
        b.seedHash = seedHash;
        b.specHash = specHash;
        b.refundTopBP = refundTopBP;

        // Register batch in vault
        vault.registerBatch(batchIdHash, funder);

        // Configure commitments rules
        commitments.configureBatch(
            batchIdHash,
            msg.sender,
            funder,
            windowStart,
            windowEnd,
            revealDeadline,
            requireAllSegments,
            minTotalCommits,
            maxCommitsPerProvider,
            true // requireRevealAllCommits (Option B enforcement)
        );

        emit BatchCreated(
            batchIdHash,
            msg.sender,
            funder,
            windowStart,
            windowEnd,
            revealDeadline,
            seedHash,
            specHash,
            refundTopBP
        );
    }

    // ------------------------------------------------------------
    // Funding
    // ------------------------------------------------------------

    function fundBatch(bytes32 batchIdHash, uint256 bountyAmount) external {
        Batch storage b = batches[batchIdHash];
        require(b.operator != address(0), "Not created");
        require(!b.funded, "Already funded");
        require(msg.sender == b.funder, "Not funder");
        require(bountyAmount > 0, "Bad bounty");

        b.bounty = bountyAmount;
        b.joinBond = bountyAmount.isqrt();
        b.funded = true;

        vault.depositBounty(batchIdHash, bountyAmount);

        emit BatchFunded(batchIdHash, bountyAmount, b.joinBond);
    }

    // ------------------------------------------------------------
    // Join (locks sqrt(bounty) bond)
    // ------------------------------------------------------------

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

    // ------------------------------------------------------------
    // Randomness for sampling times
    // ------------------------------------------------------------

    function lockRandomness(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.funded, "Not funded");
        require(!b.seedRevealed, "Already revealed");
        require(b.mixBlockNumber == 0, "Already locked");
        require(block.timestamp >= b.windowEnd, "Too early");

        uint64 mixBlock = uint64(block.number + 1);
        b.mixBlockNumber = mixBlock;

        emit RandomnessLocked(batchIdHash, mixBlock);
    }

    function revealSeed(
        bytes32 batchIdHash,
        bytes32 seed
    ) external onlyOperator(batchIdHash) {
        Batch storage b = batches[batchIdHash];
        require(b.mixBlockNumber != 0, "Not locked");
        require(!b.seedRevealed, "Already revealed");
        require(block.number > b.mixBlockNumber, "Wait mix block");
        require(keccak256(abi.encodePacked(seed)) == b.seedHash, "Bad seed");

        bytes32 bh = blockhash(uint256(b.mixBlockNumber));
        require(bh != bytes32(0), "Blockhash unavailable");

        b.seed = seed;
        b.seedRevealed = true;

        bytes32 randomness = keccak256(abi.encodePacked(seed, bh));
        emit SeedRevealed(batchIdHash, seed, randomness);
    }

    // ------------------------------------------------------------
    // Finalization
    // ------------------------------------------------------------

    function finalize(
        bytes32 batchIdHash,
        address[] calldata providers,
        uint256[] calldata weightE6
    ) external onlyOperator(batchIdHash) {
        Batch storage b = batches[batchIdHash];

        require(b.funded, "Not funded");
        require(!b.finalized, "Already finalized");
        require(block.timestamp >= b.windowEnd, "Too early");
        require(b.seedRevealed, "Seed not revealed");
        require(providers.length == weightE6.length, "Len mismatch");
        require(providers.length > 0, "No providers");

        uint256 n = providers.length;
        uint256 sumWeights = 0;

        for (uint256 i = 0; i < n; i++) {
            require(
                commitments.isEligibleForFinalize(batchIdHash, providers[i]),
                "Provider not eligible"
            );
            sumWeights += weightE6[i];
        }

        require(sumWeights > 0, "Zero weights");

        uint256[] memory payouts = new uint256[](n);

        for (uint256 i = 0; i < n; i++) {
            payouts[i] = (b.bounty * weightE6[i]) / sumWeights;
        }

        vault.setPayouts(batchIdHash, providers, payouts);

        // Bond settlement: top X% get refund
        uint256 topCount = (n * b.refundTopBP) / 10_000;
        if (topCount == 0 && b.refundTopBP > 0) topCount = 1;
        if (topCount > n) topCount = n;

        for (uint256 i = 0; i < n; i++) {
            bool refund = (i < topCount);
            vault.settleBond(batchIdHash, providers[i], refund, b.funder);
        }

        vault.closeBatch(batchIdHash);

        b.finalized = true;
        emit Finalized(batchIdHash);
    }

    // ------------------------------------------------------------
    // Views
    // ------------------------------------------------------------

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
            bytes32 seedHash,
            bool seedRevealed,
            uint64 mixBlockNumber,
            bytes32 specHash,
            bool funded,
            bool finalized,
            uint16 refundTopBP
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
            b.seedHash,
            b.seedRevealed,
            b.mixBlockNumber,
            b.specHash,
            b.funded,
            b.finalized,
            b.refundTopBP
        );
    }
}
