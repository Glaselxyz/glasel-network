// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {ClusterManager} from "../../src/core/ClusterManager.sol";
import {MXEFactory} from "../../src/core/MXEFactory.sol";
import {Types} from "../../src/libraries/Types.sol";

contract MXEFactoryTest is Test {
    NodeRegistry registry;
    ClusterManager cm;
    MXEFactory factory;
    address admin = makeAddr("admin");

    uint256[3] pks = [uint256(0xA1), uint256(0xA2), uint256(0xA3)];
    address[3] nodes;

    function setUp() public {
        registry = NodeRegistry(
            address(new ERC1967Proxy(address(new NodeRegistry()), abi.encodeCall(NodeRegistry.initialize, (admin))))
        );
        cm = ClusterManager(
            address(
                new ERC1967Proxy(
                    address(new ClusterManager()),
                    abi.encodeCall(ClusterManager.initialize, (admin, address(registry), address(0)))
                )
            )
        );
        factory = MXEFactory(
            address(
                new ERC1967Proxy(address(new MXEFactory()), abi.encodeCall(MXEFactory.initialize, (admin, address(cm))))
            )
        );

        for (uint8 i; i < 3; ++i) {
            nodes[i] = vm.addr(pks[i]);
            bytes memory bls = new bytes(48);
            bls[0] = bytes1(uint8(i + 1));
            bls[47] = bytes1(uint8(i + 1));
            vm.prank(nodes[i]);
            registry.registerNode(bls, bytes32(0), bytes32(0), "US");
        }
    }

    function _activeCluster(Types.ClusterPermission perm) internal returns (bytes32 id) {
        address[] memory a = new address[](3);
        a[0] = nodes[0];
        a[1] = nodes[1];
        a[2] = nodes[2];
        vm.prank(nodes[0]);
        id = cm.proposeCluster(a, perm, 2, admin);

        bytes32 combinedKey = bytes32(uint256(0x1234));
        bytes32 message = keccak256(abi.encode(id, combinedKey));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));

        address[] memory signers = new address[](2);
        signers[0] = nodes[0];
        signers[1] = nodes[1];
        (uint8 v0, bytes32 r0, bytes32 s0) = vm.sign(pks[0], digest);
        (uint8 v1, bytes32 r1, bytes32 s1) = vm.sign(pks[1], digest);
        bytes memory sigs = abi.encodePacked(r0, s0, v0, r1, s1, v1);
        cm.activateCluster(id, combinedKey, sigs, signers);
    }

    function test_createMXE_cerberus() public {
        bytes32 clusterId = _activeCluster(Types.ClusterPermission.Permissionless);
        bytes32[] memory allowed = new bytes32[](0);
        bytes32 mxeId = factory.createMXE(clusterId, Types.Protocol.Cerberus, allowed, bytes32(0));

        Types.MXE memory m = factory.getMXE(mxeId);
        assertEq(m.clusterId, clusterId);
        assertEq(uint8(m.protocol), uint8(Types.Protocol.Cerberus));
        assertTrue(factory.isActive(mxeId));
        assertTrue(factory.isAllowed(mxeId, keccak256("anything"))); // empty allow-list
    }

    function test_createMXE_revertsClusterNotActive() public {
        bytes32[] memory allowed = new bytes32[](0);
        vm.expectRevert(MXEFactory.ClusterNotActive.selector);
        factory.createMXE(bytes32(uint256(0xDEAD)), Types.Protocol.Cerberus, allowed, bytes32(0));
    }

    function test_createMXE_manticoreRequiresPermissioned() public {
        bytes32 clusterId = _activeCluster(Types.ClusterPermission.Permissionless);
        bytes32[] memory allowed = new bytes32[](0);
        vm.expectRevert(MXEFactory.ManticoreRequiresPermissioned.selector);
        factory.createMXE(clusterId, Types.Protocol.Manticore, allowed, bytes32(0));
    }

    function test_createMXE_manticoreOnPermissioned() public {
        bytes32 clusterId = _activeCluster(Types.ClusterPermission.FullyPermissioned);
        bytes32[] memory allowed = new bytes32[](0);
        bytes32 mxeId = factory.createMXE(clusterId, Types.Protocol.Manticore, allowed, bytes32(0));
        assertTrue(factory.isActive(mxeId));
    }

    function test_isAllowed_withList() public {
        bytes32 clusterId = _activeCluster(Types.ClusterPermission.Permissionless);
        bytes32 allowedDef = keccak256("def-A");
        bytes32[] memory allowed = new bytes32[](1);
        allowed[0] = allowedDef;
        bytes32 mxeId = factory.createMXE(clusterId, Types.Protocol.Cerberus, allowed, bytes32(0));
        assertTrue(factory.isAllowed(mxeId, allowedDef));
        assertFalse(factory.isAllowed(mxeId, keccak256("def-B")));
    }

    function test_deactivateMXE() public {
        bytes32 clusterId = _activeCluster(Types.ClusterPermission.Permissionless);
        bytes32[] memory allowed = new bytes32[](0);
        bytes32 mxeId = factory.createMXE(clusterId, Types.Protocol.Cerberus, allowed, bytes32(0));
        factory.deactivateMXE(mxeId); // msg.sender is this test = owner
        assertFalse(factory.isActive(mxeId));
    }
}
