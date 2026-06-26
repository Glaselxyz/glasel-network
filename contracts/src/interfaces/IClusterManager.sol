// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";

interface IClusterManager {
    function getCluster(bytes32 clusterId) external view returns (Types.Cluster memory);
    function clusterPubKey(bytes32 clusterId) external view returns (bytes32);
    function isActive(bytes32 clusterId) external view returns (bool);
}
