// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {ComputationRegistry} from "../../src/core/ComputationRegistry.sol";
import {FeeOracle} from "../../src/core/FeeOracle.sol";
import {Types} from "../../src/libraries/Types.sol";

contract ComputationRegistryFeeTest is Test {
    ComputationRegistry reg;
    FeeOracle fee;
    address admin = makeAddr("admin");
    address dev = makeAddr("dev");

    function setUp() public {
        reg = ComputationRegistry(
            address(
                new ERC1967Proxy(
                    address(new ComputationRegistry()), abi.encodeCall(ComputationRegistry.initialize, (admin))
                )
            )
        );
        fee = FeeOracle(
            address(
                new ERC1967Proxy(address(new FeeOracle()), abi.encodeCall(FeeOracle.initialize, (admin, address(reg))))
            )
        );
    }

    function _deploy(uint32 gates) internal returns (bytes32 id) {
        vm.prank(dev);
        id = reg.deployComputationDefinition(hex"0102030405", "", gates, 2, 1);
    }

    function test_deployInline() public {
        bytes32 id = _deploy(50_000);
        Types.ComputationDefinition memory d = reg.getDefinition(id);
        assertEq(d.estimatedGates, 50_000);
        assertEq(d.deployer, dev);
        assertEq(d.bytecode, hex"0102030405");
        assertTrue(reg.exists(id));
    }

    function test_deploy_revertsEmpty() public {
        vm.prank(dev);
        vm.expectRevert(ComputationRegistry.EmptyDefinition.selector);
        reg.deployComputationDefinition("", "", 1, 0, 0);
    }

    function test_deprecate_byDeployer() public {
        bytes32 id = _deploy(1000);
        vm.prank(dev);
        reg.deprecate(id);
        assertTrue(reg.getDefinition(id).deprecated);
    }

    function test_deprecate_revertsNonDeployer() public {
        bytes32 id = _deploy(1000);
        vm.prank(makeAddr("stranger"));
        vm.expectRevert(ComputationRegistry.NotDeployer.selector);
        reg.deprecate(id);
    }

    function test_fee_minClamp() public {
        bytes32 id = _deploy(1000); // 1 kGate -> 0.1 ether circuit fee < minFee
        vm.fee(0); // basefee 0 -> no callback fee
        uint256 f = fee.estimateFee(id, 200_000);
        assertEq(f, 0.5 ether); // clamped to minFee
    }

    function test_fee_scalesWithGates() public {
        bytes32 id = _deploy(100_000); // 100 kGate * 0.1 = 10 ether
        vm.fee(0);
        uint256 f = fee.estimateFee(id, 0);
        assertEq(f, 10 ether);
    }

    function test_fee_maxClamp() public {
        bytes32 id = _deploy(2_000_000); // 2000 kGate * 0.1 = 200 ether (< max 10000)
        vm.fee(0);
        assertEq(fee.estimateFee(id, 0), 200 ether);

        bytes32 huge = _deploy(200_000_000); // 200000 kGate * 0.1 = 20000 -> clamp to 10000
        vm.fee(0);
        assertEq(fee.estimateFee(huge, 0), 10_000 ether);
    }

    function test_deadline_clamps() public {
        bytes32 small = _deploy(1000); // < 10K gates -> 0 -> min 60
        assertEq(fee.deadlineForCircuit(small), 60);

        bytes32 mid = _deploy(100_000); // 10 * 30 = 300s
        assertEq(fee.deadlineForCircuit(mid), 300);

        bytes32 big = _deploy(10_000_000); // 1000 * 30 = 30000 -> clamp 600
        assertEq(fee.deadlineForCircuit(big), 600);
    }

    function test_setFeeParams() public {
        vm.prank(admin);
        fee.setFeeParams(1 ether, 150, 1 ether, 5 ether, 2);
        assertEq(fee.feePerKGates(), 1 ether);
        assertEq(fee.minFee(), 1 ether);
    }
}
