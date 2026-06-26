// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";

interface IComputationCoordinator {
    function commission(
        bytes32 mxeId,
        bytes32 compDefId,
        bytes calldata encInputs,
        string calldata inputIpfsCid,
        address callbackContract,
        bytes4 callbackSelector,
        uint256 callbackGasLimit,
        uint256 priorityFee
    ) external returns (bytes32 computationId);

    /// @notice Threshold-BLS result submission (the sole result path): one
    ///         aggregated BN254 signature over keccak256(abi.encode(id, encResult)),
    ///         verified against the cluster's group key.
    function submitResult(bytes32 computationId, bytes calldata encResult, uint256[2] calldata sig) external;

    function pullResult(bytes32 computationId) external returns (bytes memory encResult);

    function getComputation(bytes32 computationId) external view returns (Types.Computation memory);
}
