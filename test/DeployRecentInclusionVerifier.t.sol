// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployRecentInclusionVerifier} from "../script/DeployRecentInclusionVerifier.s.sol";

contract DeployRecentInclusionVerifierTest is Test {
    function test_refusesToBroadcastOnAnyNonMonadTestnetChain() external {
        uint256 wrongChainId = 31_337;
        vm.chainId(wrongChainId);
        assertEq(block.chainid, wrongChainId);
        DeployRecentInclusionVerifier deployer = new DeployRecentInclusionVerifier();

        vm.expectRevert(
            abi.encodeWithSelector(
                DeployRecentInclusionVerifier.WrongDeploymentChain.selector,
                10_143,
                wrongChainId
            )
        );
        deployer.run();
    }
}
