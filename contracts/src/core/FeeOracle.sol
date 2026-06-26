// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {IFeeOracle} from "../interfaces/IFeeOracle.sol";
import {IComputationRegistry} from "../interfaces/IComputationRegistry.sol";

/// @title FeeOracle
/// @notice Prices computations as a function of circuit complexity (gate count),
///         the current Base gas price and the callback gas limit, and derives a
///         per-circuit completion deadline.
contract FeeOracle is IFeeOracle, AccessControlUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");
    bytes32 public constant PARAM_ROLE = keccak256("PARAM_ROLE");

    IComputationRegistry public registry;

    // Fee parameters (GLASEL, 18 decimals)
    uint256 public feePerKGates;
    uint256 public callbackGasPremium; // percent
    uint256 public minFee;
    uint256 public maxFee;
    /// @notice GLASEL per wei of callback gas cost (oracle-set GLASEL/ETH rate proxy).
    uint256 public glaselPerGasWei;

    // Deadline parameters
    uint256 public secondsPer10KGates;
    uint256 public minDeadlineSeconds;
    uint256 public maxDeadlineSeconds;

    event ParamsUpdated();

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    function initialize(address admin, address registry_) external initializer {
        __AccessControl_init();
        __UUPSUpgradeable_init();
        registry = IComputationRegistry(registry_);

        feePerKGates = 0.1 ether;
        callbackGasPremium = 120;
        minFee = 0.5 ether;
        maxFee = 10_000 ether;
        glaselPerGasWei = 1; // 1 GLASEL-wei per wei of gas cost (configurable)

        secondsPer10KGates = 30;
        minDeadlineSeconds = 60;
        maxDeadlineSeconds = 600;

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(UPGRADER_ROLE, admin);
        _grantRole(PARAM_ROLE, admin);
    }

    function estimateFee(bytes32 compDefId, uint256 callbackGasLimit) external view returns (uint256 fee) {
        uint32 gates = registry.estimatedGates(compDefId);
        uint256 circuitFee = (uint256(gates) / 1000) * feePerKGates;
        uint256 callbackFee = (callbackGasLimit * block.basefee * callbackGasPremium * glaselPerGasWei) / 100;
        fee = _clamp(circuitFee + callbackFee, minFee, maxFee);
    }

    function deadlineForCircuit(bytes32 compDefId) external view returns (uint64) {
        uint32 gates = registry.estimatedGates(compDefId);
        uint256 deadline = (uint256(gates) / 10_000) * secondsPer10KGates;
        return uint64(_clamp(deadline, minDeadlineSeconds, maxDeadlineSeconds));
    }

    // ─── Param setters ─────────────────────────────────────────────────────────

    function setFeeParams(
        uint256 feePerKGates_,
        uint256 callbackGasPremium_,
        uint256 minFee_,
        uint256 maxFee_,
        uint256 glaselPerGasWei_
    ) external onlyRole(PARAM_ROLE) {
        require(minFee_ <= maxFee_, "min>max");
        feePerKGates = feePerKGates_;
        callbackGasPremium = callbackGasPremium_;
        minFee = minFee_;
        maxFee = maxFee_;
        glaselPerGasWei = glaselPerGasWei_;
        emit ParamsUpdated();
    }

    function setDeadlineParams(uint256 secondsPer10KGates_, uint256 minDeadlineSeconds_, uint256 maxDeadlineSeconds_)
        external
        onlyRole(PARAM_ROLE)
    {
        require(minDeadlineSeconds_ <= maxDeadlineSeconds_, "min>max");
        // A zero floor would let commission() set a deadline == block.timestamp,
        // making the job instantly un-submittable (audit M-3).
        require(minDeadlineSeconds_ > 0, "deadline floor=0");
        secondsPer10KGates = secondsPer10KGates_;
        minDeadlineSeconds = minDeadlineSeconds_;
        maxDeadlineSeconds = maxDeadlineSeconds_;
        emit ParamsUpdated();
    }

    function _clamp(uint256 x, uint256 lo, uint256 hi) private pure returns (uint256) {
        if (x < lo) return lo;
        if (x > hi) return hi;
        return x;
    }

    function _authorizeUpgrade(address) internal override onlyRole(UPGRADER_ROLE) {}
}
