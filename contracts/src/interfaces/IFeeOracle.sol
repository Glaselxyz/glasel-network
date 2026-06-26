// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IFeeOracle {
    function estimateFee(bytes32 compDefId, uint256 callbackGasLimit) external view returns (uint256 fee);
    function deadlineForCircuit(bytes32 compDefId) external view returns (uint64);
}
