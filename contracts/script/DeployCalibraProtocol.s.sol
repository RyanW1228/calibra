// contracts/script/DeployCalibraProtocol.s.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import "../src/CalibraProtocol.sol";

contract DeployCalibraProtocol is Script {
    function run() external returns (CalibraProtocol deployed) {
        address usdc = vm.envAddress("USDC");
        require(usdc != address(0), "USDC env var missing/zero");

        uint256 pk = vm.envUint("ADI_TESTNET_PRIVATE_KEY");

        vm.startBroadcast(pk);
        deployed = new CalibraProtocol(usdc);
        vm.stopBroadcast();

        console2.log("CalibraProtocol deployed at:", address(deployed));
    }
}
