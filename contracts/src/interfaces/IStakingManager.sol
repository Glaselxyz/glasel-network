// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";

interface IStakingManager {
    function slashNodes(address[] calldata nodesToSlash, Types.SlashReason reason, bytes32 compDefId) external;

    function distributeFees(address[] calldata nodes, uint256 totalFee) external;

    function recordCompletion(address[] calldata nodes) external;

    function getStakeInfo(address nodeId) external view returns (Types.NodeStakeInfo memory);
    function isEligible(address nodeId) external view returns (bool);
}
