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
    }

    mapping(uint256 => Pool) public pools;

    event PoolCreated(uint256 poolId, address operator, uint256 bounty);

    function createPool(
        uint64 commitDeadline,
        uint64 revealDeadline,
        bytes32 flightListHash
    ) external payable returns (uint256 poolId) {
        require(msg.value > 0, "Bounty required");
        require(commitDeadline < revealDeadline, "Bad deadlines");

        poolId = nextPoolId++;

        pools[poolId] = Pool({
            operator: msg.sender,
            bounty: msg.value,
            commitDeadline: commitDeadline,
            revealDeadline: revealDeadline,
            flightListHash: flightListHash,
            finalized: false
        });

        emit PoolCreated(poolId, msg.sender, msg.value);
    }
}
