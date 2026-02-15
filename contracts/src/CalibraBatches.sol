// contracts/src/CalibraBatches.sol
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

contract CalibraBatches {
    IERC20 public immutable usdc;

    struct Batch {
        address operator;
        uint256 bounty;
        uint64 windowStart;
        uint64 windowEnd;
        bytes32 seedHash;
        bytes32 seed;
        bool seedRevealed;
        uint64 mixBlockNumber;
        bytes32 specHash;
        bool funded;
        bool finalized;
        mapping(address => uint256) payout;
        mapping(address => bool) claimed;
    }

    mapping(bytes32 => Batch) private batches;

    event BatchFunded(
        bytes32 indexed batchIdHash,
        address indexed operator,
        uint256 bounty,
        uint64 windowStart,
        uint64 windowEnd,
        bytes32 seedHash,
        bytes32 specHash
    );

    event RandomnessLocked(bytes32 indexed batchIdHash, uint64 mixBlockNumber);
    event SeedRevealed(
        bytes32 indexed batchIdHash,
        bytes32 seed,
        bytes32 randomness
    );
    event Finalized(bytes32 indexed batchIdHash);
    event Claimed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint256 amount
    );

    modifier onlyOperator(bytes32 batchIdHash) {
        require(msg.sender == batches[batchIdHash].operator, "Not operator");
        _;
    }

    constructor(address usdc_) {
        require(usdc_ != address(0), "USDC required");
        usdc = IERC20(usdc_);
    }

    function fundBatch(
        bytes32 batchIdHash,
        uint64 windowStart,
        uint64 windowEnd,
        bytes32 seedHash,
        bytes32 specHash,
        uint256 bountyAmount
    ) external {
        require(batchIdHash != bytes32(0), "Bad batchIdHash");
        require(bountyAmount > 0, "Bounty required");
        require(windowStart < windowEnd, "Bad window");
        require(seedHash != bytes32(0), "Bad seedHash");

        Batch storage b = batches[batchIdHash];
        require(!b.funded, "Already funded");

        b.operator = msg.sender;
        b.bounty = bountyAmount;
        b.windowStart = windowStart;
        b.windowEnd = windowEnd;
        b.seedHash = seedHash;
        b.specHash = specHash;
        b.funded = true;

        bool ok = usdc.transferFrom(msg.sender, address(this), bountyAmount);
        require(ok, "USDC transferFrom failed");

        emit BatchFunded(
            batchIdHash,
            msg.sender,
            bountyAmount,
            windowStart,
            windowEnd,
            seedHash,
            specHash
        );
    }

    function lockRandomness(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];
        require(b.funded, "Not funded");
        require(!b.seedRevealed, "Seed revealed");
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
        require(b.funded, "Not funded");
        require(!b.seedRevealed, "Already revealed");
        require(b.mixBlockNumber != 0, "Randomness not locked");
        require(block.number > b.mixBlockNumber, "Wait for mix block");
        require(keccak256(abi.encodePacked(seed)) == b.seedHash, "Bad seed");

        bytes32 bh = blockhash(uint256(b.mixBlockNumber));
        require(bh != bytes32(0), "Mix blockhash unavailable");

        b.seed = seed;
        b.seedRevealed = true;

        bytes32 randomness = keccak256(abi.encodePacked(seed, bh));

        emit SeedRevealed(batchIdHash, seed, randomness);
    }

    function finalize(
        bytes32 batchIdHash,
        address[] calldata providers,
        uint256[] calldata scoreE6
    ) external onlyOperator(batchIdHash) {
        Batch storage b = batches[batchIdHash];

        require(b.funded, "Not funded");
        require(!b.finalized, "Already finalized");
        require(block.timestamp >= b.windowEnd, "Too early");
        require(b.seedRevealed, "Seed not revealed");
        require(providers.length == scoreE6.length, "Length mismatch");
        require(providers.length > 0, "No providers");

        uint256 sumWeights = 0;

        for (uint256 i = 0; i < providers.length; i++) {
            sumWeights += scoreE6[i];
        }

        require(sumWeights > 0, "Zero weights");

        for (uint256 i = 0; i < providers.length; i++) {
            address p = providers[i];
            uint256 amt = (b.bounty * scoreE6[i]) / sumWeights;
            b.payout[p] = amt;
        }

        b.finalized = true;
        emit Finalized(batchIdHash);
    }

    function claim(bytes32 batchIdHash) external {
        Batch storage b = batches[batchIdHash];

        require(b.finalized, "Not finalized");
        require(!b.claimed[msg.sender], "Already claimed");

        uint256 amt = b.payout[msg.sender];
        require(amt > 0, "No payout");

        b.claimed[msg.sender] = true;

        bool ok = usdc.transfer(msg.sender, amt);
        require(ok, "USDC transfer failed");

        emit Claimed(batchIdHash, msg.sender, amt);
    }

    function getBatch(
        bytes32 batchIdHash
    )
        external
        view
        returns (
            address operator,
            uint256 bounty,
            uint64 windowStart,
            uint64 windowEnd,
            bytes32 seedHash,
            bool seedRevealed,
            uint64 mixBlockNumber,
            bytes32 specHash,
            bool funded,
            bool finalized
        )
    {
        Batch storage b = batches[batchIdHash];
        return (
            b.operator,
            b.bounty,
            b.windowStart,
            b.windowEnd,
            b.seedHash,
            b.seedRevealed,
            b.mixBlockNumber,
            b.specHash,
            b.funded,
            b.finalized
        );
    }

    function getProvider(
        bytes32 batchIdHash,
        address provider
    ) external view returns (uint256 payout, bool claimed) {
        Batch storage b = batches[batchIdHash];
        return (b.payout[provider], b.claimed[provider]);
    }
}
