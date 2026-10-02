pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {VeridraReceiptRegistry} from "../src/VeridraReceiptRegistry.sol";

/// @notice Deploys VeridraReceiptRegistry. The publisher is the broadcasting
/// deployer's own address unless PUBLISHER_ADDRESS is set in the
/// environment to a different, already-funded address — the immutable
/// publisher is the sole account later allowed to call `publish()`.
/// Run with `forge script script/Deploy.s.sol --rpc-url monad_testnet
/// --broadcast --verify --verifier sourcify --verifier-url
/// https://sourcify-api-monad.blockvision.org/` — see README "Deploying to
/// Monad testnet" for the full command and required environment variables.
contract Deploy is Script {
    function run() external returns (VeridraReceiptRegistry registry) {
        address publisher = vm.envOr("PUBLISHER_ADDRESS", address(0));

        vm.startBroadcast();

        if (publisher == address(0)) {
            publisher = msg.sender;
        }
        registry = new VeridraReceiptRegistry(publisher);

        vm.stopBroadcast();

        console.log("VeridraReceiptRegistry deployed at:", address(registry));
        console.log("Publisher (sole authorized caller of publish()):", publisher);
    }
}
