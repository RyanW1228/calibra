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
    }
}
