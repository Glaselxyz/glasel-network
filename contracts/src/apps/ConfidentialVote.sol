// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConfidentialBase} from "../ConfidentialBase.sol";

/// @title ConfidentialVote
/// @notice Reference confidential application: private ballots with a public
///         result. Voters submit X25519-encrypted votes; no individual vote is
///         ever revealed. Anyone can then request a tally, which the MXE computes
///         over all ciphertexts and returns as a **public** (yes, no) count that
///         the contract decodes and finalizes on-chain.
contract ConfidentialVote is ConfidentialBase {
    bytes32 public immutable mxeId;
    bytes32 public immutable compDefId;
    uint256 public constant CALLBACK_GAS = 150_000;

    bytes[] private _encryptedVotes;
    bytes32 public tallyComputation;
    uint256 public yesVotes;
    uint256 public noVotes;
    bool public finalized;

    event VoteCast(uint256 indexed index, address indexed voter);
    event TallyRequested(bytes32 indexed computationId, uint256 ballots);
    event TallyFinalized(uint256 yes, uint256 no);

    error AlreadyFinalized();
    error NoVotes();
    error NotTallyComputation();

    constructor(address coordinator, address feeOracle, address glaselToken, bytes32 mxeId_, bytes32 compDefId_)
        ConfidentialBase(coordinator, feeOracle, glaselToken)
    {
        mxeId = mxeId_;
        compDefId = compDefId_;
    }

    function castVote(bytes calldata encVote) external {
        if (finalized) revert AlreadyFinalized();
        _encryptedVotes.push(encVote);
        emit VoteCast(_encryptedVotes.length - 1, msg.sender);
    }

    function voteCount() external view returns (uint256) {
        return _encryptedVotes.length;
    }

    /// @notice Commission the tally over all collected encrypted votes.
    function requestTally() external returns (bytes32 computationId) {
        if (finalized) revert AlreadyFinalized();
        uint256 n = _encryptedVotes.length;
        if (n == 0) revert NoVotes();

        bytes memory blob;
        for (uint256 i; i < n; ++i) {
            blob = bytes.concat(blob, _encryptedVotes[i]);
        }
        computationId = _invokeConfidential(mxeId, compDefId, blob, CALLBACK_GAS);
        tallyComputation = computationId;
        emit TallyRequested(computationId, n);
    }

    /// @notice Callback delivering the PUBLIC tally result, abi.encode(yes, no).
    function onComputationComplete(bytes32 computationId, bytes calldata encResult) external override onlyCoordinator {
        if (computationId != tallyComputation) revert NotTallyComputation();
        (uint256 yes, uint256 no) = abi.decode(encResult, (uint256, uint256));
        yesVotes = yes;
        noVotes = no;
        finalized = true;
        delete _pendingComputations[computationId];
        emit TallyFinalized(yes, no);
    }

    function passed() external view returns (bool) {
        return finalized && yesVotes > noVotes;
    }
}
