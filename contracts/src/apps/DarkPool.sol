// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConfidentialBase} from "../ConfidentialBase.sol";

/// @title DarkPool
/// @notice Reference confidential application (§14, Phase 3 of the roadmap): a
///         sealed-bid order book. Traders submit X25519-encrypted orders; the
///         MXE runs the matching circuit and returns trades **sealed to each
///         participant**, so the contract only ever stores ciphertext — order
///         contents and matches are never revealed on-chain. Participants
///         decrypt their own trades off-chain via the SDK.
contract DarkPool is ConfidentialBase {
    bytes32 public immutable mxeId;
    bytes32 public immutable compDefId;
    uint256 public constant CALLBACK_GAS = 200_000;

    uint256 public orderCount;
    /// orderId → the computation that processes it.
    mapping(uint256 orderId => bytes32 computationId) public orderComputation;
    /// computationId → sealed matched-trade result (ciphertext).
    mapping(bytes32 computationId => bytes sealedTrade) public matchedTrade;

    event OrderSubmitted(uint256 indexed orderId, bytes32 indexed computationId, address indexed trader);
    event OrdersMatched(bytes32 indexed computationId);

    error UnknownComputationId();

    constructor(address coordinator, address feeOracle, address glaselToken, bytes32 mxeId_, bytes32 compDefId_)
        ConfidentialBase(coordinator, feeOracle, glaselToken)
    {
        mxeId = mxeId_;
        compDefId = compDefId_;
    }

    /// @notice Submit an encrypted order; commissions the matching computation.
    function submitOrder(bytes calldata encOrder) external returns (bytes32 computationId) {
        computationId = _invokeConfidential(mxeId, compDefId, encOrder, CALLBACK_GAS);
        uint256 orderId = orderCount++;
        orderComputation[orderId] = computationId;
        emit OrderSubmitted(orderId, computationId, msg.sender);
    }

    /// @notice Callback from the coordinator with the sealed matched trade.
    function onComputationComplete(bytes32 computationId, bytes calldata encResult) external override onlyCoordinator {
        if (_pendingComputations[computationId] == bytes32(0)) revert UnknownComputationId();
        matchedTrade[computationId] = encResult;
        delete _pendingComputations[computationId];
        emit OrdersMatched(computationId);
    }
}
