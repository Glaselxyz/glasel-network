// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract GlaselTokenTest is Test {
    GlaselToken token;
    address admin = makeAddr("admin");
    address minter = makeAddr("minter");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        GlaselToken impl = new GlaselToken();
        token = GlaselToken(address(new ERC1967Proxy(address(impl), abi.encodeCall(GlaselToken.initialize, (admin)))));
        vm.startPrank(admin);
        token.grantRole(token.MINTER_ROLE(), minter);
        vm.stopPrank();
    }

    function test_metadata() public view {
        assertEq(token.name(), "Glasel");
        assertEq(token.symbol(), "GLASEL");
        assertEq(token.MAX_SUPPLY(), 1_000_000_000 ether);
    }

    function test_mint_byMinter() public {
        vm.prank(minter);
        token.mint(alice, 1000 ether);
        assertEq(token.balanceOf(alice), 1000 ether);
        assertEq(token.totalSupply(), 1000 ether);
    }

    function test_mint_revertsForNonMinter() public {
        vm.prank(alice);
        vm.expectRevert();
        token.mint(alice, 1 ether);
    }

    function test_mint_revertsOverMaxSupply() public {
        vm.prank(minter);
        vm.expectRevert(GlaselToken.ExceedsMaxSupply.selector);
        token.mint(alice, 1_000_000_001 ether);
    }

    function test_burn_byBurner() public {
        vm.prank(minter);
        token.mint(alice, 1000 ether);
        bytes32 burnerRole = token.BURNER_ROLE();
        vm.startPrank(admin);
        token.grantRole(burnerRole, admin);
        token.burn(alice, 400 ether);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), 600 ether);
    }

    function test_votes_afterDelegation() public {
        vm.prank(minter);
        token.mint(alice, 1000 ether);
        vm.prank(alice);
        token.delegate(alice);
        assertEq(token.getVotes(alice), 1000 ether);
    }

    function test_votes_zeroWithoutDelegation() public {
        vm.prank(minter);
        token.mint(alice, 1000 ether);
        // ERC20Votes only counts delegated voting units.
        assertEq(token.getVotes(alice), 0);
    }

    function test_permit_setsAllowance() public {
        uint256 pk = 0xA11CE;
        address owner = vm.addr(pk);
        uint256 value = 500 ether;
        uint256 deadline = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)"),
                owner,
                bob,
                value,
                token.nonces(owner),
                deadline
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", token.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        token.permit(owner, bob, value, deadline, v, r, s);
        assertEq(token.allowance(owner, bob), value);
    }
}
