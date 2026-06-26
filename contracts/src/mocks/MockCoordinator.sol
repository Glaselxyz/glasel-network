// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";
import {IComputationCoordinator} from "../interfaces/IComputationCoordinator.sol";

/// @title MockCoordinator
/// @notice Drop-in coordinator for testing confidential apps without a live MPC
///         network. `commission` records the request; tests then call
///         `mockComplete` / `mockFail` to simulate the network's response.
contract MockCoordinator is IComputationCoordinator {
    uint256 public nonce;
    mapping(bytes32 => Types.Computation) private _computations;
    mapping(bytes32 => bytes) public pendingPullResults;

    event ComputationRequested(bytes32 indexed computationId, address callbackContract);
    event ComputationCompleted(bytes32 indexed computationId, bool callbackSucceeded);
    event ComputationFailed(bytes32 indexed computationId, string reason);

    function commission(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes calldata encInputs,
        string calldata inputIpfsCid,
        address callbackContract,
        bytes4 callbackSelector,
        uint256 callbackGasLimit,
        uint256 priorityFee
    ) external returns (bytes32 computationId) {
        computationId = keccak256(abi.encode(msg.sender, block.timestamp, nonce++));
        Types.Computation storage c = _computations[computationId];
        c.mxeId = mxeId;
        c.compDefId = compDefId;
        c.encInputs = encInputs;
        c.inputIpfsCid = inputIpfsCid;
        c.callbackContract = callbackContract;
        c.callbackSelector = callbackSelector;
        c.callbackGasLimit = callbackGasLimit;
        c.priorityFee = priorityFee;
        c.requester = msg.sender;
        c.commissionedAt = uint64(block.timestamp);
        c.status = Types.ComputationStatus.Pending;
        emit ComputationRequested(computationId, callbackContract);
    }

    /// @notice Simulate the MPC network completing a computation with `result`.
    function mockComplete(bytes32 computationId, bytes calldata result) external {
        Types.Computation storage c = _computations[computationId];
        c.status = Types.ComputationStatus.Completed;
        c.encResult = result;
        c.resultCommitment = keccak256(abi.encode(computationId, result));

        bool ok;
        if (c.callbackContract != address(0)) {
            (ok,) = c.callbackContract.call{gas: c.callbackGasLimit == 0 ? gasleft() : c.callbackGasLimit}(
                abi.encodeWithSelector(c.callbackSelector, computationId, result)
            );
        }
        c.callbackSucceeded = ok;
        if (!ok) pendingPullResults[computationId] = result;
        emit ComputationCompleted(computationId, ok);
    }

    function mockFail(bytes32 computationId) external {
        _computations[computationId].status = Types.ComputationStatus.Failed;
        emit ComputationFailed(computationId, "mock failure");
    }

    function submitResult(bytes32, bytes calldata, uint256[2] calldata) external pure {
        revert("use mockComplete");
    }

    function pullResult(bytes32 computationId) external returns (bytes memory encResult) {
        Types.Computation storage c = _computations[computationId];
        require(msg.sender == c.callbackContract, "only callback");
        require(!c.callbackSucceeded, "push succeeded");
        encResult = pendingPullResults[computationId];
        delete pendingPullResults[computationId];
        c.callbackSucceeded = true;
    }

    function getComputation(bytes32 computationId) external view returns (Types.Computation memory) {
        return _computations[computationId];
    }
}
