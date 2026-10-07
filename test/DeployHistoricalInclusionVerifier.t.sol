// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {DeployHistoricalInclusionVerifier} from "../script/DeployHistoricalInclusionVerifier.s.sol";

contract DeployHistoricalInclusionVerifierTest is Test {
    function test_refusesToBroadcastOnAnyNonMonadTestnetChain() external {
        uint256 wrongChainId = 31_337;
        vm.chainId(wrongChainId);
        assertEq(block.chainid, wrongChainId);
        DeployHistoricalInclusionVerifier deployer = new DeployHistoricalInclusionVerifier();

        vm.expectRevert(
            abi.encodeWithSelector(
                DeployHistoricalInclusionVerifier.WrongDeploymentChain.selector,
                10_143,
                wrongChainId
            )
        );
        deployer.run();
    }
}
