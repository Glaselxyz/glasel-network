// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";

interface IComputationRegistry {
    function getDefinition(bytes32 compDefId) external view returns (Types.ComputationDefinition memory);
    function estimatedGates(bytes32 compDefId) external view returns (uint32);
    function exists(bytes32 compDefId) external view returns (bool);
}
