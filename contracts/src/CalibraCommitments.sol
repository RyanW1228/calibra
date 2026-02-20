// contracts/src/CalibraCommitments.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CalibraCommitments {
    address public admin;
    mapping(address => bool) public controller;

    struct ProviderState {
        bool joined;
        uint64 joinedAt;
        bytes32 commitHash;
        uint64 committedAt;
        bool revealed;
        bytes32 root;
        bytes32 salt;
    }

    struct BatchCommitConfig {
        bool exists;
        address operator;
        address funder;
        uint64 windowStart;
        uint64 windowEnd;
        uint64 revealDeadline;
        bool requireReveal;
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
        bool requireReveal
    );

    event Joined(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint64 joinedAt
    );

    event Committed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        bytes32 commitHash,
        uint64 committedAt,
        bytes encryptedUriHash
    );

    event Revealed(
        bytes32 indexed batchIdHash,
        address indexed provider,
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

    function configureBatch(
        bytes32 batchIdHash,
        address operator,
        address funder,
        uint64 windowStart,
        uint64 windowEnd,
        uint64 revealDeadline,
        bool requireReveal
    ) external onlyController {
        require(batchIdHash != bytes32(0), "Bad batchIdHash");
        require(operator != address(0), "Bad operator");
        require(funder != address(0), "Bad funder");
        require(windowStart < windowEnd, "Bad window");
        require(revealDeadline > windowEnd, "Bad revealDeadline");

        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        require(!bc.exists, "Already configured");

        bc.exists = true;
        bc.operator = operator;
        bc.funder = funder;
        bc.windowStart = windowStart;
        bc.windowEnd = windowEnd;
        bc.revealDeadline = revealDeadline;
        bc.requireReveal = requireReveal;

        emit BatchConfigured(
            batchIdHash,
            operator,
            funder,
            windowStart,
            windowEnd,
            revealDeadline,
            requireReveal
        );
    }

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
        require(ps.commitHash == bytes32(0), "Already committed");

        uint64 t = uint64(block.timestamp);
        ps.commitHash = commitHash;
        ps.committedAt = t;

        emit Committed(
            batchIdHash,
            msg.sender,
            commitHash,
            t,
            encryptedUriHash
        );
    }

    function reveal(
        bytes32 batchIdHash,
        bytes32 root,
        bytes32 salt,
        bytes calldata publicUri
    ) external {
        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        require(bc.exists, "Not configured");
        require(block.timestamp >= bc.windowEnd, "Too early");
        require(block.timestamp <= bc.revealDeadline, "Reveal closed");

        ProviderState storage ps = providerState[batchIdHash][msg.sender];
        require(ps.joined, "Not joined");
        require(ps.commitHash != bytes32(0), "No commit");
        require(!ps.revealed, "Already revealed");

        bytes32 expected = keccak256(abi.encodePacked(batchIdHash, root, salt));
        require(expected == ps.commitHash, "Commit mismatch");

        ps.revealed = true;
        ps.root = root;
        ps.salt = salt;

        emit Revealed(
            batchIdHash,
            msg.sender,
            ps.commitHash,
            root,
            salt,
            publicUri
        );
    }

    function isEligibleForFinalize(
        bytes32 batchIdHash,
        address provider
    ) external view returns (bool) {
        BatchCommitConfig storage bc = batchConfig[batchIdHash];
        if (!bc.exists) return false;

        ProviderState storage ps = providerState[batchIdHash][provider];
        if (!ps.joined) return false;
        if (ps.commitHash == bytes32(0)) return false;

        if (bc.requireReveal && !ps.revealed) return false;

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
            bytes32 commitHash,
            uint64 committedAt,
            bool revealed
        )
    {
        ProviderState storage ps = providerState[batchIdHash][provider];
        return (
            ps.joined,
            ps.joinedAt,
            ps.commitHash,
            ps.committedAt,
            ps.revealed
        );
    }
}
