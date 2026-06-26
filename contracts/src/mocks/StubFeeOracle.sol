// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IFeeOracle} from "../interfaces/IFeeOracle.sol";

/// @title StubFeeOracle
/// @notice Fixed-fee oracle for application tests, so an app can be tested
///         against MockCoordinator without deploying the full protocol.
contract StubFeeOracle is IFeeOracle {
    uint256 public fee;
    uint64 public deadline;

    constructor(uint256 fee_, uint64 deadline_) {
        fee = fee_;
        deadline = deadline_;
    }

    function estimateFee(bytes32, uint256) external view returns (uint256) {
        return fee;
    }

    function deadlineForCircuit(bytes32) external view returns (uint64) {
        return deadline;
    }
}
