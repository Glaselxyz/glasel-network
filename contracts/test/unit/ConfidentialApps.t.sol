// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC1967Proxy} from "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import {GlaselToken} from "../../src/token/GlaselToken.sol";
import {MockCoordinator} from "../../src/mocks/MockCoordinator.sol";
import {StubFeeOracle} from "../../src/mocks/StubFeeOracle.sol";
import {ConfidentialVote} from "../../src/apps/ConfidentialVote.sol";
import {SealedBidAuction} from "../../src/apps/SealedBidAuction.sol";

abstract contract AppBase is Test {
    GlaselToken token;
    MockCoordinator coordinator;
    StubFeeOracle feeOracle;
    address admin = makeAddr("admin");

    function _deployCommon() internal {
        token = GlaselToken(
            address(new ERC1967Proxy(address(new GlaselToken()), abi.encodeCall(GlaselToken.initialize, (admin))))
        );
        coordinator = new MockCoordinator();
        feeOracle = new StubFeeOracle(0, 60);
    }
}

contract ConfidentialVoteTest is AppBase {
    ConfidentialVote vote;

    function setUp() public {
        _deployCommon();
        vote = new ConfidentialVote(
            address(coordinator), address(feeOracle), address(token), keccak256("mxe"), keccak256("tally")
        );
    }

    function test_castAndTally() public {
        vote.castVote(hex"aa11");
        vote.castVote(hex"bb22");
        vote.castVote(hex"cc33");
        assertEq(vote.voteCount(), 3);

        bytes32 cid = vote.requestTally();
        assertEq(vote.tallyComputation(), cid);

        // MXE returns a public (yes, no) tally.
        coordinator.mockComplete(cid, abi.encode(uint256(2), uint256(1)));
        assertEq(vote.yesVotes(), 2);
        assertEq(vote.noVotes(), 1);
        assertTrue(vote.finalized());
        assertTrue(vote.passed());
    }

    function test_requestTally_revertsNoVotes() public {
        vm.expectRevert(ConfidentialVote.NoVotes.selector);
        vote.requestTally();
    }

    function test_castVote_revertsAfterFinalized() public {
        vote.castVote(hex"aa");
        bytes32 cid = vote.requestTally();
        coordinator.mockComplete(cid, abi.encode(uint256(1), uint256(0)));
        vm.expectRevert(ConfidentialVote.AlreadyFinalized.selector);
        vote.castVote(hex"bb");
    }

    function test_tally_failedProposal() public {
        vote.castVote(hex"aa");
        bytes32 cid = vote.requestTally();
        coordinator.mockComplete(cid, abi.encode(uint256(1), uint256(4)));
        assertFalse(vote.passed());
    }
}

contract SealedBidAuctionTest is AppBase {
    SealedBidAuction auction;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");

    function setUp() public {
        _deployCommon();
        auction = new SealedBidAuction(
            address(coordinator), address(feeOracle), address(token), keccak256("mxe"), keccak256("auction")
        );
    }

    function test_bidAndSettle() public {
        vm.prank(alice);
        auction.submitBid(hex"a1");
        vm.prank(bob);
        auction.submitBid(hex"b2");
        assertEq(auction.bidCount(), 2);

        bytes32 cid = auction.requestSettlement();
        // MXE returns winnerIndex=1 (bob), clearingPrice=500 (public).
        coordinator.mockComplete(cid, abi.encode(uint256(1), uint256(500)));

        assertTrue(auction.settled());
        assertEq(auction.winner(), bob);
        assertEq(auction.clearingPrice(), 500);
    }

    function test_settle_revertsNoBids() public {
        vm.expectRevert(SealedBidAuction.NoBids.selector);
        auction.requestSettlement();
    }

    function test_settle_outOfRangeWinner_doesNotSettle() public {
        vm.prank(alice);
        auction.submitBid(hex"a1");
        bytes32 cid = auction.requestSettlement();
        // The callback reverts (WinnerOutOfRange); MockCoordinator swallows it and
        // routes to the pull path, so the auction must remain unsettled.
        coordinator.mockComplete(cid, abi.encode(uint256(5), uint256(100)));
        assertFalse(auction.settled());
        assertEq(auction.winner(), address(0));
        assertEq(coordinator.pendingPullResults(cid), abi.encode(uint256(5), uint256(100)));
    }

    function test_callback_onlyCoordinator() public {
        vm.prank(alice);
        auction.submitBid(hex"a1");
        bytes32 cid = auction.requestSettlement();
        vm.expectRevert();
        auction.onComputationComplete(cid, abi.encode(uint256(0), uint256(1)));
    }
}
