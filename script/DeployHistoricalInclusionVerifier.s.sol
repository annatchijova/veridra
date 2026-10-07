// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {HistoricalRootCheckpoint} from "../src/HistoricalRootCheckpoint.sol";
import {HistoricalInclusionVerifier} from "../src/HistoricalInclusionVerifier.sol";

/// @notice Deploys the historical root checkpoint and the inclusion verifier
///         pinned to it, to Monad testnet.
/// @dev This script deliberately refuses to broadcast from any other chain.
contract DeployHistoricalInclusionVerifier is Script {
    uint256 internal constant MONAD_TESTNET_CHAIN_ID = 10_143;

    error WrongDeploymentChain(uint256 expected, uint256 actual);

    function run()
        external
        returns (HistoricalRootCheckpoint checkpoint, HistoricalInclusionVerifier verifier)
    {
        uint256 actualChainId = block.chainid;
        if (actualChainId != MONAD_TESTNET_CHAIN_ID) {
            revert WrongDeploymentChain(MONAD_TESTNET_CHAIN_ID, actualChainId);
        }

        uint256 deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPrivateKey);

        vm.startBroadcast(deployerPrivateKey);
        checkpoint = new HistoricalRootCheckpoint();
        verifier = new HistoricalInclusionVerifier(checkpoint);
        vm.stopBroadcast();

        console.log("HistoricalRootCheckpoint deployed at:", address(checkpoint));
        console.log("HistoricalInclusionVerifier deployed at:", address(verifier));
        console.log("Deployer:", deployer);
        console.log("Checkpoint runtime code hash:");
        console.logBytes32(address(checkpoint).codehash);
        console.log("Verifier runtime code hash:");
        console.logBytes32(address(verifier).codehash);
    }
}
