// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {StakingManager} from "../../src/core/StakingManager.sol";
import {ComputationCoordinator} from "../../src/core/ComputationCoordinator.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {GlaselGovernor} from "../../src/governance/GlaselGovernor.sol";
import {
    TimelockControllerUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";

contract DeployTest is Test {
    function test_deployWiresEverything() public {
        Deploy dep = new Deploy();
        // address(this) is admin; wire as the admin (this contract).
        Deploy.Deployed memory d = dep.deploy(address(this), makeAddr("treasury"));
        StakingManager(d.staking).setCoordinator(d.coordinator);

        assertTrue(d.token != address(0));
        assertTrue(d.coordinator != address(0));

        // Coordinator holds COORDINATOR_ROLE on staking.
        StakingManager staking = StakingManager(d.staking);
        assertTrue(staking.hasRole(staking.COORDINATOR_ROLE(), d.coordinator));

        // Coordinator points at the right dependencies.
        ComputationCoordinator coord = ComputationCoordinator(d.coordinator);
        assertEq(address(coord.glaselToken()), d.token);
        assertEq(address(coord.stakingManager()), d.staking);
        assertEq(address(coord.feeOracle()), d.feeOracle);

        // Admin holds DEFAULT_ADMIN_ROLE on the token.
        GlaselToken token = GlaselToken(d.token);
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), address(this)));
    }

    function test_deployGovernance_wiresTimelock() public {
        Deploy dep = new Deploy();
        Deploy.Deployed memory d = dep.deploy(address(this), makeAddr("treasury"));
        Deploy.Governance memory g = dep.deployGovernance(address(this), d.token);

        assertTrue(g.timelock != address(0) && g.governor != address(0));
        TimelockControllerUpgradeable tl = TimelockControllerUpgradeable(payable(g.timelock));
        // Governor is the timelock's proposer + canceller; anyone executes.
        assertTrue(tl.hasRole(tl.PROPOSER_ROLE(), g.governor));
        assertTrue(tl.hasRole(tl.CANCELLER_ROLE(), g.governor));
        assertTrue(tl.hasRole(tl.EXECUTOR_ROLE(), address(0)));
        // Governor's timelock + token are wired; proposal fee is set.
        GlaselGovernor gov = GlaselGovernor(payable(g.governor));
        assertEq(gov.timelock(), g.timelock);
        assertEq(gov.proposalFee(), 1000 ether);
    }
}
