// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {StakingManager} from "../src/core/StakingManager.sol";
import {ComputationCoordinator} from "../src/core/ComputationCoordinator.sol";
import {ClusterManager} from "../src/core/ClusterManager.sol";

/// @title RedeployToken
/// @notice Model B token cutover. Redeploys ONLY the two token-holding core
///         contracts — StakingManager and ComputationCoordinator — pointed at a
///         new public token ($GLS), reusing every token-independent contract
///         already live on chain (NodeRegistry, ClusterManager, MXEFactory,
///         ComputationRegistry, FeeOracle) and the existing cluster / MXE /
///         circuit unchanged.
///
///         After deploying it rewires two references, both callable by the admin
///         EOA (== msg.sender under `--broadcast`):
///           1. StakingManager(new).setCoordinator(coordinator(new)) — grants the
///              new Coordinator COORDINATOR_ROLE on the new Staking.
///           2. ClusterManager(existing).setStaking(staking(new)) — repoints the
///              optional economic-eligibility gate at the new Staking.
///
///         Re-staking the node operators in $GLS is intentionally NOT done here:
///         the happy-path completion (`recordCompletion`) does not require staked
///         nodes and fees are free, so the live cluster keeps serving jobs
///         immediately. Stake migration is a separate, fundable follow-up.
///
/// Required env:
///   GLS_TOKEN        new token (e.g. 0x17c0…1d67)
///   NODE_REGISTRY    existing NodeRegistry   (StakingManager dep)
///   CLUSTER_MANAGER  existing ClusterManager (repointed here)
///   MXE_FACTORY      existing MXEFactory     (Coordinator dep)
///   COMP_REGISTRY    existing ComputationRegistry (Coordinator dep)
///   FEE_ORACLE       existing FeeOracle      (Coordinator dep)
///   ADMIN (opt)      defaults to msg.sender
///   TREASURY (opt)   defaults to admin
///
/// Usage:
///   forge script script/RedeployToken.s.sol --rpc-url $RPC --broadcast
contract RedeployToken is Script {
    function run() external returns (address staking, address coordinator) {
        address admin = vm.envOr("ADMIN", msg.sender);
        address treasury = vm.envOr("TREASURY", admin);
        address gls = vm.envAddress("GLS_TOKEN");
        address nodeRegistry = vm.envAddress("NODE_REGISTRY");
        address clusterManager = vm.envAddress("CLUSTER_MANAGER");
        address mxeFactory = vm.envAddress("MXE_FACTORY");
        address compRegistry = vm.envAddress("COMP_REGISTRY");
        address feeOracle = vm.envAddress("FEE_ORACLE");

        vm.startBroadcast();

        // 1. New StakingManager denominated in $GLS (reuses the live NodeRegistry).
        staking = _proxy(
            address(new StakingManager()),
            abi.encodeCall(StakingManager.initialize, (admin, gls, nodeRegistry, treasury))
        );

        // 2. New ComputationCoordinator: $GLS + new Staking, every other
        //    dependency reused from the live deployment.
        coordinator = _proxy(
            address(new ComputationCoordinator()),
            abi.encodeCall(
                ComputationCoordinator.initialize,
                (
                    ComputationCoordinator.Wiring({
                        admin: admin,
                        mxeFactory: mxeFactory,
                        registry: compRegistry,
                        clusterManager: clusterManager,
                        feeOracle: feeOracle,
                        stakingManager: staking,
                        glaselToken: gls
                    })
                )
            )
        );

        // 3. Rewire (admin EOA).
        StakingManager(staking).setCoordinator(coordinator); // grants COORDINATOR_ROLE
        ClusterManager(clusterManager).setStaking(staking); // repoint economic gate

        vm.stopBroadcast();

        console2.log("GLS token             ", gls);
        console2.log("StakingManager  (new) ", staking);
        console2.log("Coordinator     (new) ", coordinator);
        console2.log("ClusterManager repointed + Coordinator role granted.");
    }

    function _proxy(address impl, bytes memory init) internal returns (address) {
        return address(new ERC1967Proxy(impl, init));
    }
}
