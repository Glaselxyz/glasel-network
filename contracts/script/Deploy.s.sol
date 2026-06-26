// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {GlaselToken} from "../src/token/GlaselToken.sol";
import {NodeRegistry} from "../src/core/NodeRegistry.sol";
import {StakingManager} from "../src/core/StakingManager.sol";
import {ClusterManager} from "../src/core/ClusterManager.sol";
import {MXEFactory} from "../src/core/MXEFactory.sol";
import {ComputationRegistry} from "../src/core/ComputationRegistry.sol";
import {FeeOracle} from "../src/core/FeeOracle.sol";
import {ComputationCoordinator} from "../src/core/ComputationCoordinator.sol";
import {GlaselGovernor} from "../src/governance/GlaselGovernor.sol";
import {
    TimelockControllerUpgradeable
} from "@openzeppelin/contracts-upgradeable/governance/TimelockControllerUpgradeable.sol";
import {IVotes} from "@openzeppelin/contracts/governance/utils/IVotes.sol";

/// @title Deploy
/// @notice Deploys the full Glasel core protocol in dependency order, each
///         contract behind an ERC1967 (UUPS) proxy, then wires inter-contract
///         roles. Mirrors the deployment sequence in §12.2 of the architecture.
///
/// Usage (Base Sepolia):
///   forge script script/Deploy.s.sol --rpc-url $RPC --broadcast --verify
contract Deploy is Script {
    struct Deployed {
        address token;
        address registry;
        address staking;
        address clusterManager;
        address mxeFactory;
        address compRegistry;
        address feeOracle;
        address coordinator;
    }

    function run() external returns (Deployed memory d) {
        address admin = vm.envOr("ADMIN", msg.sender);
        address treasury = vm.envOr("TREASURY", admin);

        vm.startBroadcast();
        d = deploy(admin, treasury);
        if (admin == msg.sender) wire(d);
        vm.stopBroadcast();

        console2.log("GlaselToken          ", d.token);
        console2.log("NodeRegistry          ", d.registry);
        console2.log("StakingManager        ", d.staking);
        console2.log("ClusterManager        ", d.clusterManager);
        console2.log("MXEFactory            ", d.mxeFactory);
        console2.log("ComputationRegistry   ", d.compRegistry);
        console2.log("FeeOracle             ", d.feeOracle);
        console2.log("ComputationCoordinator", d.coordinator);
    }

    /// @dev Pure deployment + wiring; callable from tests without broadcasting.
    function deploy(address admin, address treasury) public returns (Deployed memory d) {
        // 1. Token (no deps)
        d.token = _proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin)));
        // 2. NodeRegistry
        d.registry = _proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin)));
        // 3. StakingManager (token, registry)
        d.staking = _proxy(
            address(new StakingManager()),
            abi.encodeCall(StakingManager.initialize, (admin, d.token, d.registry, treasury))
        );
        // 4. ClusterManager (registry, staking)
        d.clusterManager = _proxy(
            address(new ClusterManager()), abi.encodeCall(ClusterManager.initialize, (admin, d.registry, d.staking))
        );
        // 5. MXEFactory (clusterManager)
        d.mxeFactory =
            _proxy(address(new MXEFactory()), abi.encodeCall(MXEFactory.initialize, (admin, d.clusterManager)));
        // 6. ComputationRegistry (no deps)
        d.compRegistry =
            _proxy(address(new ComputationRegistry()), abi.encodeCall(ComputationRegistry.initialize, (admin)));
        // 7. FeeOracle (computationRegistry)
        d.feeOracle = _proxy(address(new FeeOracle()), abi.encodeCall(FeeOracle.initialize, (admin, d.compRegistry)));
        // 8. ComputationCoordinator (all above)
        d.coordinator = _proxy(
            address(new ComputationCoordinator()),
            abi.encodeCall(
                ComputationCoordinator.initialize,
                (ComputationCoordinator.Wiring({
                        admin: admin,
                        mxeFactory: d.mxeFactory,
                        registry: d.compRegistry,
                        clusterManager: d.clusterManager,
                        feeOracle: d.feeOracle,
                        stakingManager: d.staking,
                        glaselToken: d.token
                    }))
            )
        );

        return d;
    }

    /// @notice Post-deploy wiring that must be executed BY the admin: grants the
    ///         coordinator the COORDINATOR_ROLE on staking (fees/slashing). Under
    ///         `forge script --broadcast` with `admin == msg.sender` this is a
    ///         broadcast tx from the admin EOA. With a multisig admin, execute
    ///         the equivalent `StakingManager.setCoordinator` from the multisig.
    function wire(Deployed memory d) public {
        StakingManager(d.staking).setCoordinator(d.coordinator);
    }

    struct Governance {
        address timelock;
        address governor;
    }

    /// @notice Deploy + wire $GLASEL governance: a TimelockController and the
    ///         GlaselGovernor (4% quorum, 1000-GLASEL proposal fee). The
    ///         governor is the timelock's sole proposer/canceller; anyone may
    ///         execute a queued, delayed proposal.
    ///
    ///         For mainnet, additionally transfer each core contract's
    ///         UPGRADER_ROLE/DEFAULT_ADMIN_ROLE to `timelock` and renounce the
    ///         admin EOA. Left to the operator so a testnet admin can keep direct
    ///         control (e.g. for the live test harness).
    function deployGovernance(address admin, address token) public returns (Governance memory g) {
        address[] memory none = new address[](0);
        // This contract is the temporary timelock admin so it can wire roles in
        // the same call; the real `admin` is granted control at the end.
        g.timelock = _proxy(
            address(new TimelockControllerUpgradeable()),
            abi.encodeCall(TimelockControllerUpgradeable.initialize, (2 days, none, none, address(this)))
        );
        g.governor = _proxy(
            address(new GlaselGovernor()),
            abi.encodeCall(
                GlaselGovernor.initialize,
                (
                    IVotes(token),
                    TimelockControllerUpgradeable(payable(g.timelock)),
                    7200, // votingDelay  (~1 day at 12s blocks)
                    50400, // votingPeriod (~1 week)
                    0, // proposalThreshold
                    4, // quorum %
                    1000 ether // proposal fee
                )
            )
        );

        TimelockControllerUpgradeable tl = TimelockControllerUpgradeable(payable(g.timelock));
        tl.grantRole(tl.PROPOSER_ROLE(), g.governor);
        tl.grantRole(tl.CANCELLER_ROLE(), g.governor);
        tl.grantRole(tl.EXECUTOR_ROLE(), address(0)); // anyone can execute a passed proposal
        // Hand timelock admin to the real admin (deployer keeps none).
        tl.grantRole(tl.DEFAULT_ADMIN_ROLE(), admin);
        tl.renounceRole(tl.DEFAULT_ADMIN_ROLE(), address(this));
    }

    function _proxy(address impl, bytes memory init) internal returns (address) {
        return address(new ERC1967Proxy(impl, init));
    }
}
