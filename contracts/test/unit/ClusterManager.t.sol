// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {NodeRegistry} from "../../src/core/NodeRegistry.sol";
import {ClusterManager} from "../../src/core/ClusterManager.sol";
import {Types} from "../../src/libraries/Types.sol";

contract ClusterManagerTest is Test {
    NodeRegistry registry;
    ClusterManager cm;
    address admin = makeAddr("admin");

    // node private keys → addresses
    uint256 pk1 = 0x1111;
    uint256 pk2 = 0x2222;
    uint256 pk3 = 0x3333;
    address n1;
    address n2;
    address n3;

    function setUp() public {
        n1 = vm.addr(pk1);
        n2 = vm.addr(pk2);
        n3 = vm.addr(pk3);

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

        _register(n1, 1);
        _register(n2, 2);
        _register(n3, 3);
    }

    function _register(address node, uint8 seed) internal {
        bytes memory bls = new bytes(48);
        bls[0] = bytes1(seed);
        bls[47] = bytes1(seed);
        vm.prank(node);
        registry.registerNode(bls, bytes32(0), bytes32(0), "US");
    }

    function _threeNodes() internal view returns (address[] memory a) {
        a = new address[](3);
        a[0] = n1;
        a[1] = n2;
        a[2] = n3;
    }

    function _ethSigned(bytes32 message) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", message));
    }

    function _sig(uint256 pk, bytes32 message) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, _ethSigned(message));
        return abi.encodePacked(r, s, v);
    }

    function test_propose() public {
        vm.prank(n1);
        bytes32 id = cm.proposeCluster(_threeNodes(), Types.ClusterPermission.Permissionless, 2, address(0));
        Types.Cluster memory c = cm.getCluster(id);
        assertEq(uint8(c.status), uint8(Types.ClusterStatus.Forming));
        assertEq(c.minThreshold, 2);
        assertEq(c.nodes.length, 3);
    }

    function test_propose_revertsTooFewNodes() public {
        address[] memory a = new address[](2);
        a[0] = n1;
        a[1] = n2;
        vm.expectRevert(ClusterManager.TooFewNodes.selector);
        cm.proposeCluster(a, Types.ClusterPermission.Permissionless, 2, address(0));
    }

    function test_propose_revertsThresholdTooLow() public {
        vm.expectRevert(ClusterManager.ThresholdTooLow.selector);
        cm.proposeCluster(_threeNodes(), Types.ClusterPermission.Permissionless, 1, address(0));
    }

    function test_propose_revertsOperatorTwice() public {
        address[] memory a = new address[](3);
        a[0] = n1;
        a[1] = n1; // same operator
        a[2] = n2;
        vm.expectRevert(ClusterManager.OperatorAppearsTwice.selector);
        cm.proposeCluster(a, Types.ClusterPermission.Permissionless, 2, address(0));
    }

    function test_activate() public {
        vm.prank(n1);
        bytes32 id = cm.proposeCluster(_threeNodes(), Types.ClusterPermission.Permissionless, 2, address(0));

        bytes32 combinedKey = bytes32(uint256(0xDEAD));
        bytes32 message = keccak256(abi.encode(id, combinedKey));

        address[] memory signers = new address[](2);
        signers[0] = n1;
        signers[1] = n2;
        bytes memory sigs = abi.encodePacked(_sig(pk1, message), _sig(pk2, message));

        cm.activateCluster(id, combinedKey, sigs, signers);

        assertTrue(cm.isActive(id));
        assertEq(cm.clusterPubKey(id), combinedKey);
        assertEq(cm.activeClusterCount(), 1);
    }

    function test_activate_revertsInsufficientSigners() public {
        vm.prank(n1);
        bytes32 id = cm.proposeCluster(_threeNodes(), Types.ClusterPermission.Permissionless, 2, address(0));
        bytes32 combinedKey = bytes32(uint256(0xBEEF));
        bytes32 message = keccak256(abi.encode(id, combinedKey));
        address[] memory signers = new address[](1);
        signers[0] = n1;
        bytes memory sigs = _sig(pk1, message);
        vm.expectRevert(ClusterManager.InsufficientSigners.selector);
        cm.activateCluster(id, combinedKey, sigs, signers);
    }

    function test_activate_revertsForgedSigner() public {
        vm.prank(n1);
        bytes32 id = cm.proposeCluster(_threeNodes(), Types.ClusterPermission.Permissionless, 2, address(0));
        bytes32 combinedKey = bytes32(uint256(0xCAFE));
        bytes32 message = keccak256(abi.encode(id, combinedKey));

        // signer n1 claims, but the second slot uses a non-member key signing
        address[] memory signers = new address[](2);
        signers[0] = n1;
        signers[1] = n2;
        // second signature actually from pk3 (n3) — recovers to n3, not n2
        bytes memory sigs = abi.encodePacked(_sig(pk1, message), _sig(pk3, message));
        vm.expectRevert(); // InvalidSignature
        cm.activateCluster(id, combinedKey, sigs, signers);
    }

    function test_dissolve() public {
        vm.prank(n1);
        bytes32 id = cm.proposeCluster(_threeNodes(), Types.ClusterPermission.Permissionless, 2, address(0));
        bytes32 combinedKey = bytes32(uint256(1));
        bytes32 message = keccak256(abi.encode(id, combinedKey));
        address[] memory signers = new address[](2);
        signers[0] = n1;
        signers[1] = n2;
        bytes memory sigs = abi.encodePacked(_sig(pk1, message), _sig(pk2, message));
        cm.activateCluster(id, combinedKey, sigs, signers);

        vm.prank(admin);
        cm.dissolveCluster(id);
        assertFalse(cm.isActive(id));
        assertEq(cm.activeClusterCount(), 0);
    }
}
