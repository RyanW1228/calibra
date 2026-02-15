// contracts/script/DeployCalibraBatches.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {CalibraBatches} from "../src/CalibraBatches.sol";

contract DeployCalibraBatches is Script {
    function run() external {
        uint256 pk = vm.envUint("ADI_TESTNET_PRIVATE_KEY");

        address usdc = 0x4fA65A338618FA771bA11eb37892641cBD055f98;

        vm.startBroadcast(pk);

        new CalibraBatches(usdc);

        vm.stopBroadcast();
    }
}
