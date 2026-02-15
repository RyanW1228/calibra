// contracts/script/DeployMockUSDC.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {MockUSDC} from "../src/MockUSDC.sol";

contract DeployMockUSDC is Script {
    function run() external {
        uint256 pk = vm.envUint("ADI_TESTNET_PRIVATE_KEY");
        address deployer = vm.addr(pk);

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC();

        uint256 amount = 1_000_000 * 1e6;
        usdc.mint(deployer, amount);

        vm.stopBroadcast();
    }
}
