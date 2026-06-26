// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";

interface INodeRegistry {
    function getNode(address nodeId) external view returns (Types.ArxNode memory);
    function isActive(address nodeId) external view returns (bool);
    function operatorOf(address nodeId) external view returns (address);
    function deactivateNode(address nodeId) external;
}
