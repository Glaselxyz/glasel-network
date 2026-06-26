// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {MockCoordinator} from "../../src/mocks/MockCoordinator.sol";
import {StubFeeOracle} from "../../src/mocks/StubFeeOracle.sol";
import {DarkPool} from "../../src/apps/DarkPool.sol";

contract DarkPoolTest is Test {
    GlaselToken token;
    MockCoordinator coordinator;
    StubFeeOracle feeOracle;
    DarkPool pool;

    address admin = makeAddr("admin");
    address trader = makeAddr("trader");
    bytes32 mxeId = keccak256("mxe");
    bytes32 compDefId = keccak256("dark-pool-match");

    function setUp() public {
        token = GlaselToken(
            address(new ERC1967Proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))))
        );
        coordinator = new MockCoordinator();
        feeOracle = new StubFeeOracle(0, 60);
        pool = new DarkPool(address(coordinator), address(feeOracle), address(token), mxeId, compDefId);
    }

    function test_submitOrder_recordsComputation() public {
        vm.prank(trader);
        bytes32 cid = pool.submitOrder(hex"c1ab23ef");
        assertEq(pool.orderCount(), 1);
        assertEq(pool.orderComputation(0), cid);
    }

    function test_matchedTrade_storedOnCompletion() public {
        bytes32 cid = pool.submitOrder(hex"1122");
        bytes memory sealedTrade = hex"deadbeefcafe";
        coordinator.mockComplete(cid, sealedTrade);
        assertEq(pool.matchedTrade(cid), sealedTrade);
    }

    function test_callback_onlyCoordinator() public {
        bytes32 cid = pool.submitOrder(hex"1122");
        vm.expectRevert(); // NotCoordinator
        pool.onComputationComplete(cid, hex"00");
    }

    function test_callback_unknownComputation() public {
        // Coordinator calls back with an id this pool never commissioned.
        vm.prank(address(coordinator));
        vm.expectRevert(DarkPool.UnknownComputationId.selector);
        pool.onComputationComplete(keccak256("nope"), hex"00");
    }

    function test_multipleOrders_distinctComputations() public {
        bytes32 c1 = pool.submitOrder(hex"aa");
        bytes32 c2 = pool.submitOrder(hex"bb");
        assertTrue(c1 != c2);
        assertEq(pool.orderCount(), 2);
        assertEq(pool.orderComputation(1), c2);
    }
}
