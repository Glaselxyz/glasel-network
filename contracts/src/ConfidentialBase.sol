// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IComputationCoordinator} from "./interfaces/IComputationCoordinator.sol";
import {IFeeOracle} from "./interfaces/IFeeOracle.sol";

/// @title ConfidentialBase
/// @notice Inherit this to build a confidential application. It hides all
///         interaction with the ComputationCoordinator: commissioning, fee
///         pulling, and the result callback. Override `onComputationComplete`.
abstract contract ConfidentialBase {
    IComputationCoordinator internal immutable _coordinator;
    IFeeOracle internal immutable _feeOracle;
    IERC20 internal immutable _glasel;

    /// @dev compDefId by computationId for in-flight requests.
    mapping(bytes32 computationId => bytes32 compDefId) internal _pendingComputations;

    error NotCoordinator();
    error UnknownComputation(bytes32 computationId);

    modifier onlyCoordinator() {
        if (msg.sender != address(_coordinator)) revert NotCoordinator();
        _;
    }

    constructor(address coordinator, address feeOracle, address glaselToken) {
        _coordinator = IComputationCoordinator(coordinator);
        _feeOracle = IFeeOracle(feeOracle);
        _glasel = IERC20(glaselToken);
        // Infinite approval so the coordinator can pull fees during commission().
        _glasel.approve(coordinator, type(uint256).max);
    }

    // ─── Internal helpers ──────────────────────────────────────────────────────

    function _invokeConfidential(bytes32 mxeId, bytes32 compDefId, bytes memory encInputs, uint256 callbackGasLimit)
        internal
        returns (bytes32 computationId)
    {
        return _invokeConfidentialWithPriority(mxeId, compDefId, encInputs, callbackGasLimit, 0);
    }

    function _invokeConfidentialWithPriority(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes memory encInputs,
        uint256 callbackGasLimit,
        uint256 priorityFee
    ) internal returns (bytes32 computationId) {
        uint256 totalFee = _feeOracle.estimateFee(compDefId, callbackGasLimit) + priorityFee;

        // Ensure this contract holds enough $GLASEL; otherwise pull from caller.
        if (_glasel.balanceOf(address(this)) < totalFee) {
            _glasel.transferFrom(msg.sender, address(this), totalFee - _glasel.balanceOf(address(this)));
        }

        computationId = _coordinator.commission(
            mxeId,
            compDefId,
            encInputs,
            "",
            address(this),
            this.onComputationComplete.selector,
            callbackGasLimit,
            priorityFee
        );

        _pendingComputations[computationId] = compDefId;
    }

    // ─── Override in your contract ──────────────────────────────────────────────

    function onComputationComplete(bytes32 computationId, bytes calldata encResult) external virtual onlyCoordinator {
        revert UnknownComputation(computationId);
    }
}
