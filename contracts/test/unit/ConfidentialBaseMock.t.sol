// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {ComputationRegistry} from "../../src/core/ComputationRegistry.sol";
import {FeeOracle} from "../../src/core/FeeOracle.sol";
import {MockCoordinator} from "../../src/mocks/MockCoordinator.sol";
import {ConfidentialBase} from "../../src/ConfidentialBase.sol";

/// @dev Minimal confidential app for exercising ConfidentialBase against the mock.
contract SampleApp is ConfidentialBase {
    bytes public lastResult;
    bytes32 public lastId;

    constructor(address c, address f, address t) ConfidentialBase(c, f, t) {}

    function run(bytes32 mxeId, bytes32 compDefId, bytes calldata enc) external returns (bytes32) {
        return _invokeConfidential(mxeId, compDefId, enc, 100_000);
    }

    function onComputationComplete(bytes32 id, bytes calldata r) external override onlyCoordinator {
        lastId = id;
        lastResult = r;
    }
}

contract ConfidentialBaseMockTest is Test {
    GlaselToken token;
    ComputationRegistry reg;
    FeeOracle fee;
    MockCoordinator mock;
    SampleApp app;
    address admin = makeAddr("admin");

    bytes32 compDefId;

    function setUp() public {
        token = GlaselToken(
            address(new ERC1967Proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))))
        );
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
        mock = new MockCoordinator();
        app = new SampleApp(address(mock), address(fee), address(token));

        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), admin);
        token.mint(address(this), 1000 ether);
        vm.stopPrank();

        compDefId = reg.deployComputationDefinition(hex"abcd", "", 1000, 1, 1);
        token.approve(address(app), type(uint256).max);
        vm.fee(0);
    }

    function test_invokeAndComplete() public {
        bytes32 id = app.run(keccak256("mxe"), compDefId, hex"1122");
        assertEq(app.lastResult().length, 0);

        // App pulled the 0.5 GLASEL fee from this contract.
        assertEq(token.balanceOf(address(app)), 0.5 ether);

        bytes memory result = hex"99aa";
        mock.mockComplete(id, result);

        assertEq(app.lastId(), id);
        assertEq(app.lastResult(), result);
    }

    function test_onComputationComplete_onlyCoordinator() public {
        vm.expectRevert(ConfidentialBase.NotCoordinator.selector);
        app.onComputationComplete(bytes32(0), hex"00");
    }
}
