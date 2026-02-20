// contracts/src/CalibraProtocol.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);

    function transferFrom(
        address from,
        address to,
        uint256 amount
    ) external returns (bool);
}

contract CalibraProtocol {
    IERC20 public immutable usdc;
    address public admin;

    uint256 private constant USDC_DECIMALS = 1_000_000;

    struct CommitInfo {
        bytes32 commitHash;
        uint64 committedAt;
        bool revealed;
        bytes32 root;
        bytes32 salt;
        bytes32 publicUriHash;
    }

    struct ProviderState {
        bool joined;
        uint64 joinedAt;
        uint32 commitCount;
        uint32 revealedCount;
        uint64 lastCommitAt;
        CommitInfo[] commits;
        uint256 bond;
        bool bondSettled;
        uint256 payout;
        bool payoutClaimed;
    }

    struct Batch {
        bool exists;
        address operator;
        address funder;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 revealDeadline;
        bytes32 specHash;
        uint32 minCommitsPerProvider;
        uint32 maxCommitsPerProvider;
        bool requireRevealAllCommits;
        bytes32 seedHash;
        bool seedRevealed;
        bytes32 seed;
        uint64 mixBlockNumber;
        bytes32 randomness;
        bool funded;
        bool finalized;
        uint256 bounty;
        uint256 joinBond;
        uint16 refundTopBP;
        bytes32 funderEncryptPubKeyHash;
    }

    mapping(bytes32 => Batch) private batches;
    mapping(bytes32 => mapping(address => ProviderState)) private providers;

    event AdminChanged(address indexed newAdmin);

    event BatchCreated(
        bytes32 indexed batchIdHash,
        address indexed operator,
        address indexed funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bytes32 seedHash,
        bytes32 specHash,
        uint16 refundTopBP,
        bytes32 funderEncryptPubKeyHash,
        uint32 minCommitsPerProvider,
        uint32 maxCommitsPerProvider,
        bool requireRevealAllCommits
    );

    event BatchFunded(
        bytes32 indexed batchIdHash,
        uint256 bounty,
        uint256 joinBond
    );

    event Joined(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint64 joinedAt,
        uint256 bond
    );

    event Committed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint32 commitIndex,
        bytes32 commitHash,
        uint64 committedAt,
        bytes encryptedUriHash
    );

    event Revealed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint32 commitIndex,
        bytes32 commitHash,
        bytes32 root,
        bytes32 salt,
        bytes publicUri
    );

    event RandomnessLocked(bytes32 indexed batchIdHash, uint64 mixBlockNumber);

    event SeedRevealed(
        bytes32 indexed batchIdHash,
        bytes32 seed,
        bytes32 randomness
    );

    event CutoffComputed(bytes32 indexed batchIdHash, uint64 cutoff);

    event PayoutsSet(bytes32 indexed batchIdHash, bytes32 scoresHash);

    event PayoutClaimed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint256 amount
    );

    event BondRefunded(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint256 amount
    );

    event BondSlashed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        address indexed to,
        uint256 amount
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

    constructor(address usdc_) {
        require(usdc_ != address(0), "USDC required");
        usdc = IERC20(usdc_);
        admin = msg.sender;
        emit AdminChanged(msg.sender);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Bad admin");
        admin = newAdmin;
        emit AdminChanged(newAdmin);
    }

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
        uint32 minCommitsPerProvider,
        uint32 maxCommitsPerProvider,
        bool requireRevealAllCommits
    ) external {
        require(batchIdHash != bytes32(0), "Bad batchId");
        require(funder != address(0), "Bad funder");
        require(windowStart < windowEnd, "Bad window");
        require(revealDeadline > windowEnd, "Bad revealDeadline");
        require(seedHash != bytes32(0), "Bad seedHash");
        require(specHash != bytes32(0), "Bad specHash");
        require(refundTopBP <= 10_000, "Bad refundTopBP");
        require(funderEncryptPubKey.length > 0, "Bad pubkey");
        require(maxCommitsPerProvider > 0, "Bad maxCommits");

        Batch storage b = batches[batchIdHash];
        require(!b.exists, "Already created");

        b.exists = true;

        b.operator = msg.sender;
        b.funder = funder;

        b.windowStart = windowStart;
        b.windowEnd = windowEnd;
        b.revealDeadline = revealDeadline;

        b.specHash = specHash;

        b.minCommitsPerProvider = minCommitsPerProvider;
        b.maxCommitsPerProvider = maxCommitsPerProvider;
        b.requireRevealAllCommits = requireRevealAllCommits;

        b.seedHash = seedHash;

        b.refundTopBP = refundTopBP;
        b.funderEncryptPubKeyHash = keccak256(funderEncryptPubKey);

        emit BatchCreated(
            batchIdHash,
            b.operator,
            b.funder,
            windowStart,
            windowEnd,
            revealDeadline,
            seedHash,
            specHash,
            refundTopBP,
            b.funderEncryptPubKeyHash,
            minCommitsPerProvider,
            maxCommitsPerProvider,
            requireRevealAllCommits
        );
    }

    function fundBatch(bytes32 batchIdHash, uint256 bountyAmount) external {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(!b.funded, "Already funded");
        require(msg.sender == b.funder, "Not funder");
        require(bountyAmount > 0, "Bad bounty");

        uint256 bountyUsd = bountyAmount / USDC_DECIMALS;
        require(bountyUsd > 0, "Bounty < 1 USDC");

        uint256 bondUsd = _isqrt(bountyUsd);
        uint256 joinBond = bondUsd * USDC_DECIMALS;
        require(joinBond > 0, "Bond not set");

        b.bounty = bountyAmount;
        b.joinBond = joinBond;
        b.funded = true;

        bool ok = usdc.transferFrom(msg.sender, address(this), bountyAmount);
        require(ok, "USDC bounty transferFrom failed");

        emit BatchFunded(batchIdHash, bountyAmount, joinBond);
    }

    function join(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(b.funded, "Not funded");
        require(block.timestamp < b.windowEnd, "Window ended");

        ProviderState storage ps = providers[batchIdHash][msg.sender];
        require(!ps.joined, "Already joined");

        uint256 bond = b.joinBond;
        require(bond > 0, "Bond not set");

        ps.joined = true;
        ps.joinedAt = uint64(block.timestamp);
        ps.bond = bond;

        bool ok = usdc.transferFrom(msg.sender, address(this), bond);
        require(ok, "USDC bond transferFrom failed");

        emit Joined(batchIdHash, msg.sender, ps.joinedAt, bond);
    }

    function commit(
        bytes32 batchIdHash,
        bytes32 commitHash,
        bytes calldata encryptedUriHash
    ) external {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(b.funded, "Not funded");
        require(block.timestamp >= b.windowStart, "Too early");
        require(block.timestamp < b.windowEnd, "Window ended");
        require(commitHash != bytes32(0), "Bad commitHash");

        ProviderState storage ps = providers[batchIdHash][msg.sender];
        require(ps.joined, "Not joined");
        require(ps.commitCount < b.maxCommitsPerProvider, "Commit cap");

        uint64 t = uint64(block.timestamp);

        ps.commits.push(
            CommitInfo({
                commitHash: commitHash,
                committedAt: t,
                revealed: false,
                root: bytes32(0),
                salt: bytes32(0),
                publicUriHash: bytes32(0)
            })
        );

        uint32 idx = ps.commitCount;
        ps.commitCount = idx + 1;
        ps.lastCommitAt = t;

        emit Committed(
            batchIdHash,
            msg.sender,
            idx,
            commitHash,
            t,
            encryptedUriHash
        );
    }

    function revealCommits(
        bytes32 batchIdHash,
        uint32[] calldata commitIndices,
        bytes32[] calldata roots,
        bytes32[] calldata salts,
        bytes[] calldata publicUris
    ) external {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(block.timestamp >= b.windowEnd, "Too early");
        require(block.timestamp <= b.revealDeadline, "Reveal closed");

        ProviderState storage ps = providers[batchIdHash][msg.sender];
        require(ps.joined, "Not joined");

        require(commitIndices.length == roots.length, "Len mismatch");
        require(roots.length == salts.length, "Len mismatch");
        require(salts.length == publicUris.length, "Len mismatch");
        require(commitIndices.length > 0, "No reveals");

        for (uint256 i = 0; i < commitIndices.length; i++) {
            uint32 idx = commitIndices[i];
            require(idx < ps.commits.length, "Bad index");

            CommitInfo storage ci = ps.commits[idx];
            require(!ci.revealed, "Already revealed");

            bytes32 expected = keccak256(
                abi.encodePacked(batchIdHash, roots[i], salts[i])
            );
            require(expected == ci.commitHash, "Commit mismatch");

            ci.revealed = true;
            ci.root = roots[i];
            ci.salt = salts[i];
            ci.publicUriHash = keccak256(publicUris[i]);

            ps.revealedCount += 1;

            emit Revealed(
                batchIdHash,
                msg.sender,
                idx,
                ci.commitHash,
                roots[i],
                salts[i],
                publicUris[i]
            );
        }
    }

    function lockRandomness(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
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
        require(b.exists, "Not created");
        require(b.mixBlockNumber != 0, "Not locked");
        require(!b.seedRevealed, "Already revealed");
        require(block.number > b.mixBlockNumber, "Wait mix block");
        require(keccak256(abi.encodePacked(seed)) == b.seedHash, "Bad seed");

        bytes32 bh = blockhash(uint256(b.mixBlockNumber));
        require(bh != bytes32(0), "Blockhash unavailable");

        b.seed = seed;
        b.seedRevealed = true;

        b.randomness = keccak256(abi.encodePacked(seed, bh));
        emit SeedRevealed(batchIdHash, seed, b.randomness);

        emit CutoffComputed(batchIdHash, getCutoff(batchIdHash));
    }

    function getCutoff(bytes32 batchIdHash) public view returns (uint64) {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(b.seedRevealed, "Seed not revealed");

        uint64 span = b.windowEnd - b.windowStart;
        require(span > 0, "Bad span");

        uint256 r = uint256(b.randomness);
        uint64 offset = uint64(r % uint256(span));
        return b.windowStart + offset;
    }

    function getSelectedCommitIndex(
        bytes32 batchIdHash,
        address provider
    ) public view returns (uint32) {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(b.seedRevealed, "Seed not revealed");

        ProviderState storage ps = providers[batchIdHash][provider];
        require(ps.joined, "Not joined");
        require(ps.commitCount > 0, "No commits");

        uint64 cutoff = getCutoff(batchIdHash);

        bool found = false;
        uint32 bestIdx = 0;

        uint256 n = ps.commits.length;
        for (uint32 i = 0; i < n; i++) {
            uint64 t = ps.commits[i].committedAt;
            if (t <= cutoff) {
                found = true;
                bestIdx = i;
            } else {
                break;
            }
        }

        require(found, "No commit before cutoff");
        return bestIdx;
    }

    function finalize(
        bytes32 batchIdHash,
        address[] calldata providerList,
        uint256[] calldata payouts,
        uint32[] calldata selectedCommitIndices,
        bytes32 scoresHash
    ) external onlyOperator(batchIdHash) {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(b.funded, "Not funded");
        require(!b.finalized, "Already finalized");
        require(block.timestamp > b.revealDeadline, "Reveal not closed");
        require(b.seedRevealed, "Seed not revealed");

        require(providerList.length > 0, "No providers");
        require(providerList.length == payouts.length, "Len mismatch");
        require(
            providerList.length == selectedCommitIndices.length,
            "Len mismatch"
        );
        require(scoresHash != bytes32(0), "Bad scoresHash");

        uint256 n = providerList.length;

        uint256 sum = 0;
        for (uint256 i = 0; i < payouts.length; i++) sum += payouts[i];
        require(sum <= b.bounty, "Payouts exceed bounty");

        for (uint256 i = 0; i < n; i++) {
            address p = providerList[i];
            require(p != address(0), "Bad provider");

            ProviderState storage ps = providers[batchIdHash][p];
            require(ps.joined, "Not joined");
            require(ps.commitCount > 0, "No commits");

            if (b.minCommitsPerProvider > 0) {
                require(
                    ps.commitCount >= b.minCommitsPerProvider,
                    "Min commits not met"
                );
            }

            if (b.requireRevealAllCommits) {
                require(
                    ps.revealedCount == ps.commitCount,
                    "Not fully revealed"
                );
            } else {
                require(ps.revealedCount > 0, "No reveals");
            }

            uint32 expectedIdx = getSelectedCommitIndex(batchIdHash, p);
            require(
                selectedCommitIndices[i] == expectedIdx,
                "Wrong selected commit"
            );

            CommitInfo storage chosen = ps.commits[expectedIdx];
            require(chosen.revealed, "Selected not revealed");
            require(chosen.root != bytes32(0), "Missing root");
            require(chosen.salt != bytes32(0), "Missing salt");

            bytes32 expectedCommit = keccak256(
                abi.encodePacked(batchIdHash, chosen.root, chosen.salt)
            );
            require(
                expectedCommit == chosen.commitHash,
                "Selected commit mismatch"
            );

            require(ps.payout == 0, "Duplicate provider");
            ps.payout = payouts[i];
        }

        uint256 topCount = (n * b.refundTopBP) / 10_000;
        if (topCount == 0 && b.refundTopBP > 0) topCount = 1;
        if (topCount > n) topCount = n;

        for (uint256 i = 0; i < n; i++) {
            address p = providerList[i];
            ProviderState storage ps = providers[batchIdHash][p];

            if (!ps.bondSettled) {
                ps.bondSettled = true;

                if (i < topCount) {
                    bool okRefund = usdc.transfer(p, ps.bond);
                    require(okRefund, "USDC refund failed");
                    emit BondRefunded(batchIdHash, p, ps.bond);
                } else {
                    bool okSlash = usdc.transfer(b.funder, ps.bond);
                    require(okSlash, "USDC slash failed");
                    emit BondSlashed(batchIdHash, p, b.funder, ps.bond);
                }
            }
        }

        emit PayoutsSet(batchIdHash, scoresHash);

        b.finalized = true;
        emit Finalized(batchIdHash);
    }

    function claimPayout(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.exists, "Not created");
        require(b.finalized, "Not finalized");

        ProviderState storage ps = providers[batchIdHash][msg.sender];
        require(ps.joined, "Not joined");
        require(!ps.payoutClaimed, "Already claimed");

        uint256 amt = ps.payout;
        require(amt > 0, "No payout");

        ps.payoutClaimed = true;

        bool ok = usdc.transfer(msg.sender, amt);
        require(ok, "USDC payout failed");

        emit PayoutClaimed(batchIdHash, msg.sender, amt);
    }

    function getBatch(
        bytes32 batchIdHash
    )
        external
        view
        returns (
            bool exists,
            address operator,
            address funder,
            uint64 windowStart,
            uint64 windowEnd,
            uint64 revealDeadline,
            bytes32 seedHash,
            bool seedRevealed,
            uint64 mixBlockNumber,
            bytes32 randomness,
            bytes32 specHash,
            bool funded,
            bool finalized,
            uint256 bounty,
            uint256 joinBond,
            uint16 refundTopBP,
            bytes32 funderEncryptPubKeyHash,
            uint32 minCommitsPerProvider,
            uint32 maxCommitsPerProvider,
            bool requireRevealAllCommits
        )
    {
        Batch storage b = batches[batchIdHash];
        return (
            b.exists,
            b.operator,
            b.funder,
            b.windowStart,
            b.windowEnd,
            b.revealDeadline,
            b.seedHash,
            b.seedRevealed,
            b.mixBlockNumber,
            b.randomness,
            b.specHash,
            b.funded,
            b.finalized,
            b.bounty,
            b.joinBond,
            b.refundTopBP,
            b.funderEncryptPubKeyHash,
            b.minCommitsPerProvider,
            b.maxCommitsPerProvider,
            b.requireRevealAllCommits
        );
    }

    function getProviderSummary(
        bytes32 batchIdHash,
        address provider
    )
        external
        view
        returns (
            bool joined,
            uint64 joinedAt,
            uint32 commitCount,
            uint32 revealedCount,
            uint64 lastCommitAt,
            uint256 bond,
            bool bondSettled,
            uint256 payout,
            bool payoutClaimed
        )
    {
        ProviderState storage ps = providers[batchIdHash][provider];
        return (
            ps.joined,
            ps.joinedAt,
            ps.commitCount,
            ps.revealedCount,
            ps.lastCommitAt,
            ps.bond,
            ps.bondSettled,
            ps.payout,
            ps.payoutClaimed
        );
    }

    function getCommitCount(
        bytes32 batchIdHash,
        address provider
    ) external view returns (uint32) {
        return providers[batchIdHash][provider].commitCount;
    }

    function getCommit(
        bytes32 batchIdHash,
        address provider,
        uint32 commitIndex
    )
        external
        view
        returns (
            bytes32 commitHash,
            uint64 committedAt,
            bool revealed,
            bytes32 root,
            bytes32 salt,
            bytes32 publicUriHash
        )
    {
        ProviderState storage ps = providers[batchIdHash][provider];
        require(commitIndex < ps.commits.length, "Bad index");
        CommitInfo storage ci = ps.commits[commitIndex];
        return (
            ci.commitHash,
            ci.committedAt,
            ci.revealed,
            ci.root,
            ci.salt,
            ci.publicUriHash
        );
    }

    function _isqrt(uint256 x) internal pure returns (uint256) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        uint256 y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
        return y;
    }
}
