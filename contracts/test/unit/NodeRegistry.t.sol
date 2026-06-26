// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {Types} from "../../src/libraries/Types.sol";

contract NodeRegistryTest is Test {
    NodeRegistry registry;
    address admin = makeAddr("admin");
    address node1 = makeAddr("node1");
    address node2 = makeAddr("node2");

    function setUp() public {
        NodeRegistry impl = new NodeRegistry();
        registry =
            NodeRegistry(address(new ERC1967Proxy(address(impl), abi.encodeCall(NodeRegistry.initialize, (admin)))));
    }

    function _bls(uint8 seed) internal pure returns (bytes memory key) {
        key = new bytes(48);
        key[0] = bytes1(seed);
        key[47] = bytes1(seed);
    }

    function test_register() public {
        vm.prank(node1);
        registry.registerNode(_bls(1), bytes32(uint256(0xAB)), bytes32(uint256(0xCD)), "US");

        Types.ArxNode memory n = registry.getNode(node1);
        assertEq(n.operatorAddress, node1);
        assertEq(n.jurisdiction, "US");
        assertTrue(n.active);
        assertTrue(registry.isActive(node1));
        assertEq(registry.nodeCount(), 1);
        assertEq(registry.nodeByBls(keccak256(_bls(1))), node1);
    }

    function test_register_revertsInvalidLength() public {
        vm.prank(node1);
        vm.expectRevert(NodeRegistry.InvalidBlsKeyLength.selector);
        registry.registerNode(new bytes(47), bytes32(0), bytes32(0), "US");
    }

    function test_register_revertsZeroG1() public {
        vm.prank(node1);
        vm.expectRevert(NodeRegistry.InvalidG1Point.selector);
        registry.registerNode(new bytes(48), bytes32(0), bytes32(0), "US");
    }

    function test_register_revertsDuplicateOperator() public {
        vm.startPrank(node1);
        registry.registerNode(_bls(1), bytes32(0), bytes32(0), "US");
        vm.expectRevert(NodeRegistry.AlreadyRegistered.selector);
        registry.registerNode(_bls(2), bytes32(0), bytes32(0), "US");
        vm.stopPrank();
    }

    function test_register_revertsDuplicateBls() public {
        vm.prank(node1);
        registry.registerNode(_bls(1), bytes32(0), bytes32(0), "US");
        vm.prank(node2);
        vm.expectRevert(NodeRegistry.BlsKeyAlreadyRegistered.selector);
        registry.registerNode(_bls(1), bytes32(0), bytes32(0), "DE");
    }

    function test_rotateX25519() public {
        vm.startPrank(node1);
        registry.registerNode(_bls(1), bytes32(uint256(1)), bytes32(0), "US");
        registry.rotateX25519Key(bytes32(uint256(2)));
        vm.stopPrank();
        assertEq(registry.getNode(node1).x25519PubKey, bytes32(uint256(2)));
    }

    function test_deactivate_byOwner() public {
        vm.prank(node1);
        registry.registerNode(_bls(1), bytes32(0), bytes32(0), "US");
        vm.prank(node1);
        registry.deactivateNode(node1);
        assertFalse(registry.isActive(node1));
    }

    function test_deactivate_revertsUnauthorized() public {
        vm.prank(node1);
        registry.registerNode(_bls(1), bytes32(0), bytes32(0), "US");
        vm.prank(node2);
        vm.expectRevert(NodeRegistry.Unauthorized.selector);
        registry.deactivateNode(node1);
    }

    function test_slasherCanDeactivate() public {
        vm.prank(node1);
        registry.registerNode(_bls(1), bytes32(0), bytes32(0), "US");
        address slasher = makeAddr("slasher");
        bytes32 slasherRole = registry.SLASHER_ROLE();
        vm.prank(admin);
        registry.grantRole(slasherRole, slasher);
        vm.prank(slasher);
        registry.deactivateNode(node1);
        assertFalse(registry.isActive(node1));
    }
}
