// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title ThresholdSig
/// @notice Verifies that at least `threshold` distinct cluster nodes signed a
///         message.
/// @dev PHASE-1 IMPLEMENTATION NOTE. The architecture targets BLS12-381
///      threshold-signature aggregation (a single 48-byte signature verified
///      via the EIP-2537 precompiles) for gas efficiency. Until Base ships
///      EIP-2537, this library verifies a *set* of ECDSA signatures — one per
///      signer, each recovering to the signer's registered node address. This
///      is equally secure (it still proves threshold-many honest nodes
///      attested) but costs more gas. The on-chain interface (`message`,
///      `aggregatedSig`, `signers`) is identical to the BLS path, so swapping
///      in a real `BLS12_381` verifier later requires no calldata changes.
library ThresholdSig {
    error BelowThreshold();
    error BadSignatureLength();
    error SignerNotInCluster();
    error DuplicateSigner();
    error InvalidSignature();

    /// @param message       the raw 32-byte commitment that was signed
    /// @param sigs          concatenation of 65-byte ECDSA signatures, one per
    ///                      entry of `signers`, in the same order
    /// @param signers       node addresses claimed to have signed
    /// @param clusterNodes  the authoritative member set of the cluster
    /// @param threshold     minimum distinct valid signers required
    function verify(
        bytes32 message,
        bytes calldata sigs,
        address[] calldata signers,
        address[] memory clusterNodes,
        uint256 threshold
    ) internal pure {
        if (signers.length < threshold) revert BelowThreshold();
        if (sigs.length != signers.length * 65) revert BadSignatureLength();

        bytes32 digest = MessageHashUtils.toEthSignedMessageHash(message);

        for (uint256 i; i < signers.length; ++i) {
            address signer = signers[i];
            // Belt-and-suspenders: never count the zero address (audit L-1).
            if (signer == address(0)) revert SignerNotInCluster();

            // Uniqueness: reject the same signer counted twice.
            for (uint256 j; j < i; ++j) {
                if (signers[j] == signer) revert DuplicateSigner();
            }

            // Membership: signer must belong to the cluster.
            if (!_contains(clusterNodes, signer)) revert SignerNotInCluster();

            // Authenticity: signature must recover to the signer.
            bytes calldata sig = sigs[i * 65:i * 65 + 65];
            if (ECDSA.recover(digest, sig) != signer) revert InvalidSignature();
        }
    }

    function _contains(address[] memory set, address x) private pure returns (bool) {
        for (uint256 i; i < set.length; ++i) {
            if (set[i] == x) return true;
        }
        return false;
    }
}
