// contracts/src/CalibraCommitments.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CalibraCommitments {
    uint256 private constant BP_DENOM = 10_000;
    uint64 private constant SEGMENT_SECONDS = 12 hours;

    address public admin;
    mapping(address => bool) public controller;

    struct CommitInfo {
        bytes32 commitHash;
        uint64 committedAt;
        bool revealed;
    }

    struct ProviderState {
        bool joined;
        uint64 joinedAt;
        uint32 commitCount;
        uint32 revealedCount;
        uint64 lastCommitAt;
        // 12-hour segment bitmap since windowStart (up to 256 segments)
        uint256 segmentBitmap;
        CommitInfo[] commits;
    }

    struct BatchCommitConfig {
        bool exists;
        address operator;
        address funder;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 revealDeadline;
        // Continuous incentive parameters
        // Require >=1 commit in each segment that intersects [windowStart, windowEnd)
        bool requireAllSegments;
        // Optional: minimum total commits
        uint32 minTotalCommits;
        // Optional: cap commits per provider to prevent spam
        uint32 maxCommitsPerProvider;
        // reveal requirement:
        // - if true: must reveal ALL commits made (strong auditability)
        // - if false: operator can decide which commitIndices must be revealed (not implemented here; keep true for MVP)
        bool requireRevealAllCommits;
    }

    mapping(bytes32 => BatchCommitConfig) private batchConfig;
    mapping(bytes32 => mapping(address => ProviderState)) private providerState;

    event AdminChanged(address indexed newAdmin);
    event ControllerSet(address indexed c, bool enabled);

    event BatchConfigured(
        bytes32 indexed batchIdHash,
        address indexed operator,
        address indexed funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bool requireAllSegments,
        uint32 minTotalCommits,
        uint32 maxCommitsPerProvider,
        bool requireRevealAllCommits
    );

    event Joined(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint64 joinedAt
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

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyController() {
        require(controller[msg.sender], "Not controller");
        _;
    }

    modifier onlyBatchOperator(bytes32 batchIdHash) {
        require(
            msg.sender == batchConfig[batchIdHash].operator,
            "Not operator"
        );
        _;
    }

    constructor() {
        admin = msg.sender;
        controller[msg.sender] = true;
        emit AdminChanged(msg.sender);
        emit ControllerSet(msg.sender, true);
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "Bad admin");
        admin = newAdmin;
        emit AdminChanged(newAdmin);
    }

    function setController(address c, bool enabled) external onlyAdmin {
        require(c != address(0), "Bad controller");
        controller[c] = enabled;
        emit ControllerSet(c, enabled);
    }

    // Controller (CalibraBatches) configures batch commitment rules
    function configureBatch(
        bytes32 batchIdHash,
        address operator,
        address funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bool requireAllSegments,
        uint32 minTotalCommits,
        uint32 maxCommitsPerProvider,
        bool requireRevealAllCommits
    ) external onlyController {
        require(batchIdHash != bytes32(0), "Bad batchIdHash");
        require(operator != address(0), "Bad operator");
        require(funder != address(0), "Bad funder");
        require(windowStart < windowEnd, "Bad window");
        require(revealDeadline > windowEnd, "Bad revealDeadline");
        require(maxCommitsPerProvider > 0, "Bad maxCommits");

        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        require(!bc.exists, "Already configured");

        bc.exists = true;
        bc.operator = operator;
        bc.funder = funder;
        bc.windowStart = windowStart;
        bc.windowEnd = windowEnd;
        bc.revealDeadline = revealDeadline;
        bc.requireAllSegments = requireAllSegments;
        bc.minTotalCommits = minTotalCommits;
        bc.maxCommitsPerProvider = maxCommitsPerProvider;
        bc.requireRevealAllCommits = requireRevealAllCommits;

        emit BatchConfigured(
            batchIdHash,
            operator,
            funder,
            windowStart,
            windowEnd,
            revealDeadline,
            requireAllSegments,
            minTotalCommits,
            maxCommitsPerProvider,
            requireRevealAllCommits
        );
    }

    // CalibraBatches will call joinForProvider after it locks bond in the vault
    function joinForProvider(
        bytes32 batchIdHash,
        address provider
    ) external onlyController {
        require(provider != address(0), "Bad provider");
        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        require(bc.exists, "Not configured");
        require(block.timestamp < bc.windowEnd, "Window ended");

        ProviderState storage ps = providerState[batchIdHash][provider];
        require(!ps.joined, "Already joined");

        ps.joined = true;
        ps.joinedAt = uint64(block.timestamp);

        emit Joined(batchIdHash, provider, ps.joinedAt);
    }

    // Provider commits hash-only anchor + encrypted pointer hash
    // commitHash expected: keccak256(abi.encodePacked(batchIdHash, root, salt))
    function commit(
        bytes32 batchIdHash,
        bytes32 commitHash,
        bytes calldata encryptedUriHash
    ) external {
        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        require(bc.exists, "Not configured");
        require(block.timestamp >= bc.windowStart, "Too early");
        require(block.timestamp < bc.windowEnd, "Window ended");
        require(commitHash != bytes32(0), "Bad commitHash");

        ProviderState storage ps = providerState[batchIdHash][msg.sender];
        require(ps.joined, "Not joined");
        require(ps.commitCount < bc.maxCommitsPerProvider, "Commit cap");

        uint64 t = uint64(block.timestamp);

        ps.commits.push(
            CommitInfo({
                commitHash: commitHash,
                committedAt: t,
                revealed: false
            })
        );
        uint32 idx = ps.commitCount;
        ps.commitCount = idx + 1;
        ps.lastCommitAt = t;

        _markSegment(ps, bc.windowStart, t);

        emit Committed(
            batchIdHash,
            msg.sender,
            idx,
            commitHash,
            t,
            encryptedUriHash
        );
    }

    // Provider reveals commits publicly (Option B) to be eligible for payout/bond refund
    function revealCommits(
        bytes32 batchIdHash,
        uint32[] calldata commitIndices,
        bytes32[] calldata roots,
        bytes32[] calldata salts,
        bytes[] calldata publicUris
    ) external {
        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        require(bc.exists, "Not configured");
        require(block.timestamp >= bc.windowEnd, "Too early");
        require(block.timestamp <= bc.revealDeadline, "Reveal closed");

        ProviderState storage ps = providerState[batchIdHash][msg.sender];
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

    // ------------------------------------------------------------
    // Eligibility checks for CalibraBatches to enforce at finalize
    // ------------------------------------------------------------

    function isEligibleForFinalize(
        bytes32 batchIdHash,
        address provider
    ) external view returns (bool) {
        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        if (!bc.exists) return false;

        ProviderState storage ps = providerState[batchIdHash][provider];
        if (!ps.joined) return false;
        if (ps.commitCount == 0) return false;

        // Minimum commit count
        if (bc.minTotalCommits > 0 && ps.commitCount < bc.minTotalCommits)
            return false;

        // Reveal requirement
        if (bc.requireRevealAllCommits) {
            if (ps.revealedCount != ps.commitCount) return false;
        } else {
            // MVP: keep it strict; if you want selective reveals later, add a per-batch requiredIndicesRoot
            if (ps.revealedCount == 0) return false;
        }

        // Continuous incentive (segment coverage)
        if (bc.requireAllSegments) {
            uint256 requiredMask = _requiredSegmentMask(
                bc.windowStart,
                bc.windowEnd
            );
            if ((ps.segmentBitmap & requiredMask) != requiredMask) return false;
        }

        return true;
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
            uint256 segmentBitmap
        )
    {
        ProviderState storage ps = providerState[batchIdHash][provider];
        return (
            ps.joined,
            ps.joinedAt,
            ps.commitCount,
            ps.revealedCount,
            ps.lastCommitAt,
            ps.segmentBitmap
        );
    }

    function getCommitCount(
        bytes32 batchIdHash,
        address provider
    ) external view returns (uint32) {
        return providerState[batchIdHash][provider].commitCount;
    }

    function getCommit(
        bytes32 batchIdHash,
        address provider,
        uint32 commitIndex
    )
        external
        view
        returns (bytes32 commitHash, uint64 committedAt, bool revealed)
    {
        ProviderState storage ps = providerState[batchIdHash][provider];
        require(commitIndex < ps.commits.length, "Bad index");
        CommitInfo storage ci = ps.commits[commitIndex];
        return (ci.commitHash, ci.committedAt, ci.revealed);
    }

    // ------------------------------------------------------------
    // Internal helpers
    // ------------------------------------------------------------

    function _markSegment(
        ProviderState storage ps,
        uint64 windowStart,
        uint64 commitTime
    ) internal {
        if (commitTime < windowStart) return;
        uint256 idx = uint256(commitTime - windowStart) /
            uint256(SEGMENT_SECONDS);
        if (idx >= 256) return;
        ps.segmentBitmap |= (uint256(1) << idx);
    }

    function _requiredSegmentMask(
        uint64 windowStart,
        uint64 windowEnd
    ) internal pure returns (uint256) {
        if (windowEnd <= windowStart) return 0;
        uint256 dur = uint256(windowEnd - windowStart);
        uint256 segments = (dur + uint256(SEGMENT_SECONDS) - 1) /
            uint256(SEGMENT_SECONDS);
        if (segments >= 256) segments = 256;

        if (segments == 256) return type(uint256).max;
        return (uint256(1) << segments) - 1;
    }
}
