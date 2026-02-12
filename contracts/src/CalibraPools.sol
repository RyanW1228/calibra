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
    }

    mapping(uint256 => Pool) private pools;

    event PoolCreated(uint256 poolId, address operator, uint256 bounty);
    event Committed(uint256 poolId, address provider, bytes32 commitHash);
    event Revealed(uint256 poolId, address provider, bytes32 predictionsHash);

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
}
