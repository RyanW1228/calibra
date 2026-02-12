// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CalibraPools {
    uint256 public nextPoolId;

    struct Pool {
        address operator;
        uint256 bounty;
        uint64 commitDeadline;
        uint64 revealDeadline;
        bytes32 flightListHash;
        bool finalized;
        mapping(address => bytes32) commits;
        mapping(address => bool) revealed;
        mapping(address => uint256) payoutWei;
        mapping(address => bool) claimed;
    }

    mapping(uint256 => Pool) private pools;

    event PoolCreated(uint256 poolId, address operator, uint256 bounty);
    event Committed(uint256 poolId, address provider, bytes32 commitHash);
    event Revealed(uint256 poolId, address provider, bytes32 predictionsHash);
    event Finalized(uint256 poolId);
    event Claimed(uint256 poolId, address provider, uint256 amount);

    modifier onlyOperator(uint256 poolId) {
        require(msg.sender == pools[poolId].operator, "Not operator");
        _;
    }

    function createPool(
        uint64 commitDeadline,
        uint64 revealDeadline,
        bytes32 flightListHash
    ) external payable returns (uint256 poolId) {
        require(msg.value > 0, "Bounty required");
        require(commitDeadline < revealDeadline, "Bad deadlines");

        poolId = nextPoolId++;

        Pool storage pool = pools[poolId];
        pool.operator = msg.sender;
        pool.bounty = msg.value;
        pool.commitDeadline = commitDeadline;
        pool.revealDeadline = revealDeadline;
        pool.flightListHash = flightListHash;
        pool.finalized = false;

        emit PoolCreated(poolId, msg.sender, msg.value);
    }

    function commit(uint256 poolId, bytes32 commitHash) external {
        Pool storage pool = pools[poolId];

        require(block.timestamp <= pool.commitDeadline, "Commit phase over");
        require(pool.commits[msg.sender] == bytes32(0), "Already committed");

        pool.commits[msg.sender] = commitHash;
        emit Committed(poolId, msg.sender, commitHash);
    }

    function finalize(
        uint256 poolId,
        address[] calldata providers,
        uint256[] calldata scoreE6
    ) external onlyOperator(poolId) {
        Pool storage pool = pools[poolId];

        require(!pool.finalized, "Already finalized");
        require(block.timestamp > pool.revealDeadline, "Too early");
        require(providers.length == scoreE6.length, "Length mismatch");
        require(providers.length > 0, "No providers");

        uint256 sumWeights = 0;

        // record payouts weights = scoreE6 (MVP)
        for (uint256 i = 0; i < providers.length; i++) {
            address provider = providers[i];
            require(pool.revealed[provider], "Provider not revealed");
            sumWeights += scoreE6[i];
        }

        require(sumWeights > 0, "Zero weights");

        for (uint256 i = 0; i < providers.length; i++) {
            address provider = providers[i];
            uint256 amt = (pool.bounty * scoreE6[i]) / sumWeights;
            pool.payoutWei[provider] = amt;
        }

        pool.finalized = true;
        emit Finalized(poolId);
    }

    function claim(uint256 poolId) external {
        Pool storage pool = pools[poolId];

        require(pool.finalized, "Not finalized");
        require(!pool.claimed[msg.sender], "Already claimed");

        uint256 amt = pool.payoutWei[msg.sender];
        require(amt > 0, "No payout");

        pool.claimed[msg.sender] = true;

        (bool ok, ) = msg.sender.call{value: amt}("");
        require(ok, "Transfer failed");

        emit Claimed(poolId, msg.sender, amt);
    }

    function reveal(
        uint256 poolId,
        bytes32 predictionsHash,
        bytes32 salt
    ) external {
        Pool storage pool = pools[poolId];

        require(block.timestamp > pool.commitDeadline, "Reveal not started");
        require(block.timestamp <= pool.revealDeadline, "Reveal phase over");

        bytes32 commitHash = pool.commits[msg.sender];
        require(commitHash != bytes32(0), "No commit");
        require(!pool.revealed[msg.sender], "Already revealed");

        // Bind reveal to this pool, this provider, and this pool's flightListHash
        bytes32 expected = keccak256(
            abi.encodePacked(
                poolId,
                msg.sender,
                pool.flightListHash,
                predictionsHash,
                salt
            )
        );
        require(expected == commitHash, "Bad reveal");

        pool.revealed[msg.sender] = true;

        emit Revealed(poolId, msg.sender, predictionsHash);
    }

    function getPool(
        uint256 poolId
    )
        external
        view
        returns (
            address operator,
            uint256 bounty,
            uint64 commitDeadline,
            uint64 revealDeadline,
            bytes32 flightListHash,
            bool finalized
        )
    {
        Pool storage pool = pools[poolId];
        return (
            pool.operator,
            pool.bounty,
            pool.commitDeadline,
            pool.revealDeadline,
            pool.flightListHash,
            pool.finalized
        );
    }

    function getProvider(
        uint256 poolId,
        address provider
    ) external view returns (bool revealed, uint256 payoutWei, bool claimed) {
        Pool storage pool = pools[poolId];
        return (
            pool.revealed[provider],
            pool.payoutWei[provider],
            pool.claimed[provider]
        );
    }
}
