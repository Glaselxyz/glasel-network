// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {StakingManager} from "../../src/core/StakingManager.sol";
import {ClusterManager} from "../../src/core/ClusterManager.sol";
import {MXEFactory} from "../../src/core/MXEFactory.sol";
import {ComputationRegistry} from "../../src/core/ComputationRegistry.sol";
import {FeeOracle} from "../../src/core/FeeOracle.sol";
import {ComputationCoordinator} from "../../src/core/ComputationCoordinator.sol";
import {Types} from "../../src/libraries/Types.sol";

/// @notice Deploys and wires the full Glasel protocol behind proxies, registers
///         and stakes a 3-node cluster, and exposes helpers to activate a
///         cluster, deploy a circuit, create an MXE and sign results — so both
///         integration and invariant suites can build on the same ground truth.
abstract contract ProtocolFixture is Test {
    GlaselToken internal token;
    NodeRegistry internal registry;
    StakingManager internal staking;
    ClusterManager internal clusterManager;
    MXEFactory internal mxeFactory;
    ComputationRegistry internal compRegistry;
    FeeOracle internal feeOracle;
    ComputationCoordinator internal coordinator;

    address internal admin = makeAddr("admin");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant PK1 = 0xA11;
    uint256 internal constant PK2 = 0xB22;
    uint256 internal constant PK3 = 0xC33;
    uint256[3] internal nodePk = [PK1, PK2, PK3];
    address[3] internal node;

    uint256 internal constant MIN_STAKE = 10_000 ether;

    function _proxy(address impl, bytes memory init) private returns (address) {
        return address(new ERC1967Proxy(impl, init));
    }

    function _deployProtocol() internal {
        token = GlaselToken(_proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))));
        registry = NodeRegistry(_proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin))));
        staking = StakingManager(
            _proxy(
                address(new StakingManager()),
                abi.encodeCall(StakingManager.initialize, (admin, address(token), address(registry), treasury))
            )
        );
        clusterManager = ClusterManager(
            _proxy(
                address(new ClusterManager()),
                abi.encodeCall(ClusterManager.initialize, (admin, address(registry), address(staking)))
            )
        );
        mxeFactory = MXEFactory(
            _proxy(address(new MXEFactory()), abi.encodeCall(MXEFactory.initialize, (admin, address(clusterManager))))
        );
        compRegistry = ComputationRegistry(
            _proxy(address(new ComputationRegistry()), abi.encodeCall(ComputationRegistry.initialize, (admin)))
        );
        feeOracle = FeeOracle(
            _proxy(address(new FeeOracle()), abi.encodeCall(FeeOracle.initialize, (admin, address(compRegistry))))
        );
        coordinator = ComputationCoordinator(
            _proxy(
                address(new ComputationCoordinator()),
                abi.encodeCall(
                    ComputationCoordinator.initialize,
                    (ComputationCoordinator.Wiring({
                            admin: admin,
                            mxeFactory: address(mxeFactory),
                            registry: address(compRegistry),
                            clusterManager: address(clusterManager),
                            feeOracle: address(feeOracle),
                            stakingManager: address(staking),
                            glaselToken: address(token)
                        }))
                )
            )
        );

        // Wiring: grant coordinator role on staking; minter to admin.
        vm.startPrank(admin);
        staking.setCoordinator(address(coordinator));
        token.grantRole(token.MINTER_ROLE(), admin);
        vm.stopPrank();

        // Register + stake 3 nodes.
        for (uint8 i; i < 3; ++i) {
            node[i] = vm.addr(nodePk[i]);
            bytes memory bls = new bytes(48);
            bls[0] = bytes1(uint8(i + 1));
            bls[47] = bytes1(uint8(i + 1));
            vm.prank(node[i]);
            registry.registerNode(bls, bytes32(uint256(i + 100)), bytes32(0), "US");

            vm.prank(admin);
            token.mint(node[i], MIN_STAKE);
            vm.startPrank(node[i]);
            token.approve(address(staking), MIN_STAKE);
            staking.stake(node[i], MIN_STAKE);
            vm.stopPrank();
        }
    }

    function _nodeArray() internal view returns (address[] memory a) {
        a = new address[](3);
        a[0] = node[0];
        a[1] = node[1];
        a[2] = node[2];
    }

    function _activateCluster(Types.ClusterPermission perm) internal returns (bytes32 clusterId) {
        vm.prank(node[0]);
        clusterId = clusterManager.proposeCluster(_nodeArray(), perm, 2, admin);

        bytes32 combinedKey = bytes32(uint256(0xC0FFEE));
        bytes32 message = keccak256(abi.encode(clusterId, combinedKey));
        (bytes memory sigs, address[] memory signers) = _signTwo(message);
        clusterManager.activateCluster(clusterId, combinedKey, sigs, signers);
    }

    function _deployDef(uint32 gates) internal returns (bytes32 compDefId) {
        vm.prank(admin);
        compDefId = compRegistry.deployComputationDefinition(hex"abcdef", "", gates, 2, 1);
    }

    function _createMXE(bytes32 clusterId, bytes32 compDefId) internal returns (bytes32 mxeId) {
        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = compDefId;
        vm.prank(admin);
        mxeId = mxeFactory.createMXE(clusterId, Types.Protocol.Cerberus, allowed, bytes32(0));
    }

    /// @dev Sign `message` with nodes 0 and 1 (meets threshold 2).
    function _signTwo(bytes32 message) internal pure returns (bytes memory sigs, address[] memory signers) {
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
        signers = new address[](2);
        signers[0] = vm.addr(PK1);
        signers[1] = vm.addr(PK2);
        (uint8 v0, bytes32 r0, bytes32 s0) = vm.sign(PK1, digest);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(PK2, digest);
        sigs = abi.encodePacked(r0, s0, v0, r1, s1, v1);
    }

    /// @dev Build a result-submission signature set for a given computation.
    function _signResult(bytes32 computationId, bytes memory encResult)
        internal
        pure
        returns (bytes memory sigs, address[] memory signers)
    {
        bytes32 message = keccak256(abi.encode(computationId, encResult));
        return _signTwo(message);
    }
}
