// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {RecentInclusionVerifier} from "../src/RecentInclusionVerifier.sol";

/// @notice Deploys only the read-only recent inclusion verifier to Monad testnet.
/// @dev This script deliberately refuses to broadcast from any other chain.
contract DeployRecentInclusionVerifier is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10_143;

    error WrongDeploymentChain(uint256 expected, uint256 actual);

    function run() external returns (RecentInclusionVerifier verifier) {
        uint256 actualChainId = block.chainid;
        if (actualChainId != MONAD_TESTNET_CHAIN_ID) {
            revert WrongDeploymentChain(MONAD_TESTNET_CHAIN_ID, actualChainId);
        }

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        verifier = new RecentInclusionVerifier();
        vm.stopBroadcast();

        console.log("RecentInclusionVerifier deployed at:", address(verifier));
        console.log("Deployer:", deployer);
        console.log("Runtime code hash:");
        console.logBytes32(address(verifier).codehash);
    }
}
