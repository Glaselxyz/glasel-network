// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConfidentialBase} from "../ConfidentialBase.sol";

/// @title SealedBidAuction
/// @notice Reference confidential application: a sealed-bid (first- or
///         second-price) auction. Bidders submit X25519-encrypted bids; bid
///         amounts stay private. On settlement the MXE determines the winner and
///         clearing price and returns them as a **public** result the contract
///         acts on. Losing bids are never revealed.
contract SealedBidAuction is ConfidentialBase {
    bytes32 public immutable mxeId;
    bytes32 public immutable compDefId;
    uint256 public constant CALLBACK_GAS = 150_000;

    address[] private _bidders;
    bytes[] private _encryptedBids;

    bytes32 public settleComputation;
    bool public settled;
    address public winner;
    uint256 public clearingPrice;

    event BidSubmitted(uint256 indexed index, address indexed bidder);
    event SettlementRequested(bytes32 indexed computationId, uint256 bids);
    event AuctionSettled(address indexed winner, uint256 clearingPrice);

    error AlreadySettled();
    error NoBids();
    error NotSettlementComputation();
    error WinnerOutOfRange();

    constructor(address coordinator, address feeOracle, address glaselToken, bytes32 mxeId_, bytes32 compDefId_)
        ConfidentialBase(coordinator, feeOracle, glaselToken)
    {
        mxeId = mxeId_;
        compDefId = compDefId_;
    }

    function submitBid(bytes calldata encBid) external {
        if (settled) revert AlreadySettled();
        _bidders.push(msg.sender);
        _encryptedBids.push(encBid);
        emit BidSubmitted(_encryptedBids.length - 1, msg.sender);
    }

    function bidCount() external view returns (uint256) {
        return _encryptedBids.length;
    }

    function requestSettlement() external returns (bytes32 computationId) {
        if (settled) revert AlreadySettled();
        uint256 n = _encryptedBids.length;
        if (n == 0) revert NoBids();

        bytes memory blob;
        for (uint256 i; i < n; ++i) {
            blob = bytes.concat(blob, _encryptedBids[i]);
        }
        computationId = _invokeConfidential(mxeId, compDefId, blob, CALLBACK_GAS);
        settleComputation = computationId;
        emit SettlementRequested(computationId, n);
    }

    /// @notice Callback delivering the PUBLIC result, abi.encode(winnerIndex, clearingPrice).
    function onComputationComplete(bytes32 computationId, bytes calldata encResult) external override onlyCoordinator {
        if (computationId != settleComputation) revert NotSettlementComputation();
        (uint256 winnerIndex, uint256 price) = abi.decode(encResult, (uint256, uint256));
        if (winnerIndex >= _bidders.length) revert WinnerOutOfRange();

        winner = _bidders[winnerIndex];
        clearingPrice = price;
        settled = true;
        delete _pendingComputations[computationId];
        emit AuctionSettled(winner, price);
    }
}
