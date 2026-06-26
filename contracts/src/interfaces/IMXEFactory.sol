// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Types} from "../libraries/Types.sol";

interface IMXEFactory {
    function getMXE(bytes32 mxeId) external view returns (Types.MXE memory);
    function isActive(bytes32 mxeId) external view returns (bool);
    function isAllowed(bytes32 mxeId, bytes32 compDefId) external view returns (bool);
}
