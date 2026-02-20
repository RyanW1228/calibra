// contracts/src/CalibraVault.sol
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

contract CalibraVault {
    IERC20 public immutable usdc;

    address public admin;
    mapping(address => bool) public controller;

    struct BatchFunds {
        address funder;
        uint256 bounty;
        bool bountyDeposited;
        bool payoutsSet;
        bool closed;
    }

    mapping(bytes32 => BatchFunds) private batchFunds;

    mapping(bytes32 => mapping(address => uint256)) private bondOf;
    mapping(bytes32 => mapping(address => bool)) private bondClaimed;

    mapping(bytes32 => mapping(address => uint256)) private payoutOf;
    mapping(bytes32 => mapping(address => bool)) private payoutClaimed;

    event AdminChanged(address indexed newAdmin);
    event ControllerSet(address indexed c, bool enabled);

    event BatchRegistered(bytes32 indexed batchIdHash, address indexed funder);
    event BountyDeposited(
        bytes32 indexed batchIdHash,
        address indexed funder,
        uint256 amount
    );

    event BondLocked(
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

    event PayoutsSet(bytes32 indexed batchIdHash);
    event PayoutClaimed(
        bytes32 indexed batchIdHash,
        address indexed provider,
        uint256 amount
    );

    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier onlyController() {
        require(controller[msg.sender], "Not controller");
        _;
    }

    constructor(address usdc_) {
        require(usdc_ != address(0), "USDC required");
        usdc = IERC20(usdc_);
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

    // Controller (CalibraBatches) registers batch + funder
    function registerBatch(
        bytes32 batchIdHash,
        address funder
    ) external onlyController {
        require(batchIdHash != bytes32(0), "Bad batchIdHash");
        require(funder != address(0), "Bad funder");

        BatchFunds storage bf = batchFunds[batchIdHash];
        require(bf.funder == address(0), "Already registered");

        bf.funder = funder;

        emit BatchRegistered(batchIdHash, funder);
    }

    function depositBounty(bytes32 batchIdHash, uint256 amount) external {
        BatchFunds storage bf = batchFunds[batchIdHash];
        require(bf.funder != address(0), "Not registered");
        require(msg.sender == bf.funder, "Not funder");
        require(!bf.bountyDeposited, "Already deposited");
        require(amount > 0, "Bad amount");

        bf.bounty = amount;
        bf.bountyDeposited = true;

        bool ok = usdc.transferFrom(msg.sender, address(this), amount);
        require(ok, "USDC transferFrom failed");

        emit BountyDeposited(batchIdHash, msg.sender, amount);
    }

    // Controller locks a provider bond (sqrt(bounty) computed in controller)
    function lockBond(
        bytes32 batchIdHash,
        address provider,
        uint256 amount
    ) external onlyController {
        require(provider != address(0), "Bad provider");
        require(amount > 0, "Bad amount");

        BatchFunds storage bf = batchFunds[batchIdHash];
        require(bf.bountyDeposited, "Bounty not deposited");
        require(!bf.closed, "Closed");

        require(bondOf[batchIdHash][provider] == 0, "Bond already locked");
        bondOf[batchIdHash][provider] = amount;

        bool ok = usdc.transferFrom(provider, address(this), amount);
        require(ok, "USDC bond transferFrom failed");

        emit BondLocked(batchIdHash, provider, amount);
    }

    // Controller sets payouts once (pull-based claiming)
    function setPayouts(
        bytes32 batchIdHash,
        address[] calldata providers,
        uint256[] calldata payouts
    ) external onlyController {
        BatchFunds storage bf = batchFunds[batchIdHash];
        require(bf.bountyDeposited, "Bounty not deposited");
        require(!bf.payoutsSet, "Payouts already set");
        require(providers.length == payouts.length, "Len mismatch");
        require(providers.length > 0, "No providers");

        uint256 sum = 0;
        for (uint256 i = 0; i < payouts.length; i++) {
            sum += payouts[i];
        }
        require(sum <= bf.bounty, "Payouts exceed bounty");

        for (uint256 i = 0; i < providers.length; i++) {
            address p = providers[i];
            require(p != address(0), "Bad provider");
            payoutOf[batchIdHash][p] = payouts[i];
        }

        bf.payoutsSet = true;
        emit PayoutsSet(batchIdHash);
    }

    function claimPayout(bytes32 batchIdHash) external {
        BatchFunds storage bf = batchFunds[batchIdHash];
        require(bf.payoutsSet, "Payouts not set");

        require(!payoutClaimed[batchIdHash][msg.sender], "Already claimed");
        uint256 amt = payoutOf[batchIdHash][msg.sender];
        require(amt > 0, "No payout");

        payoutClaimed[batchIdHash][msg.sender] = true;

        bool ok = usdc.transfer(msg.sender, amt);
        require(ok, "USDC transfer failed");

        emit PayoutClaimed(batchIdHash, msg.sender, amt);
    }

    // Controller directs bond outcome after finalize:
    // - refundToProvider = true -> refund to provider
    // - refundToProvider = false -> slash to `to` (typically funder)
    function settleBond(
        bytes32 batchIdHash,
        address provider,
        bool refundToProvider,
        address to
    ) external onlyController {
        require(provider != address(0), "Bad provider");

        uint256 bond = bondOf[batchIdHash][provider];
        require(bond > 0, "No bond");
        require(!bondClaimed[batchIdHash][provider], "Bond already settled");

        bondClaimed[batchIdHash][provider] = true;

        if (refundToProvider) {
            bool ok = usdc.transfer(provider, bond);
            require(ok, "USDC transfer failed");
            emit BondRefunded(batchIdHash, provider, bond);
            return;
        }

        require(to != address(0), "Bad to");
        bool ok2 = usdc.transfer(to, bond);
        require(ok2, "USDC transfer failed");
        emit BondSlashed(batchIdHash, provider, to, bond);
    }

    // Optional: Controller can close batch in vault (no further bond locks)
    function closeBatch(bytes32 batchIdHash) external onlyController {
        BatchFunds storage bf = batchFunds[batchIdHash];
        require(bf.funder != address(0), "Not registered");
        bf.closed = true;
    }

    function getBatchFunds(
        bytes32 batchIdHash
    )
        external
        view
        returns (
            address funder,
            uint256 bounty,
            bool bountyDeposited,
            bool payoutsSet,
            bool closed
        )
    {
        BatchFunds storage bf = batchFunds[batchIdHash];
        return (
            bf.funder,
            bf.bounty,
            bf.bountyDeposited,
            bf.payoutsSet,
            bf.closed
        );
    }

    function getBond(
        bytes32 batchIdHash,
        address provider
    ) external view returns (uint256 bond, bool settled) {
        return (
            bondOf[batchIdHash][provider],
            bondClaimed[batchIdHash][provider]
        );
    }

    function getPayout(
        bytes32 batchIdHash,
        address provider
    ) external view returns (uint256 payout, bool claimed) {
        return (
            payoutOf[batchIdHash][provider],
            payoutClaimed[batchIdHash][provider]
        );
    }
}
