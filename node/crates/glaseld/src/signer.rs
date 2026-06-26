//! Threshold-BLS result signing.
//!
//! The cluster's group key is established by a (Feldman/Pedersen) DKG so that no
//! node holds the whole key; any `t+1` nodes' partial signatures combine to one
//! aggregated BN254 signature `σ = sk·H(m)`. The coordinator's `submitResult`
//! verifies that single signature against the group public key with one pairing
//! check — the protocol's sole result path (the per-signer ECDSA path is gone).
//!
//! This simulated single-process daemon models the cluster as one holder of the
//! DKG-combined group secret (the same modelling the X25519 cluster key uses in
//! `engine.rs`): it signs with the combined key, which yields exactly the sig a
//! real `t+1` threshold would combine to. Swapping in true per-node partials +
//! `glasel_bls::bls::combine` replaces only this module.
use alloy::primitives::{keccak256, Bytes, B256, U256};
use alloy::sol_types::SolValue;

pub struct BlsSigner {
    /// Group secret key (big-endian bytes), `sk ∈ F_r`.
    group_sk: Vec<u8>,
}

fn be32(x: &num_bigint::BigUint) -> [u8; 32] {
    let b = x.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - b.len()..].copy_from_slice(&b);
    out
}

impl BlsSigner {
    pub fn new(group_secret_hex: &str) -> anyhow::Result<Self> {
        let group_sk = hex::decode(group_secret_hex.trim_start_matches("0x"))?;
        if group_sk.is_empty() {
            anyhow::bail!("empty BLS group secret");
        }
        Ok(Self { group_sk })
    }

    /// The group public key `[x.c1, x.c0, y.c1, y.c0]` for on-chain registration
    /// (`setBlsGroupKey`) / logging.
    pub fn group_pubkey(&self) -> [U256; 4] {
        let (_, pk) = glasel_bls::bls::group_sign(&self.group_sk, b"");
        [
            U256::from_be_bytes(be32(&pk[0])),
            U256::from_be_bytes(be32(&pk[1])),
            U256::from_be_bytes(be32(&pk[2])),
            U256::from_be_bytes(be32(&pk[3])),
        ]
    }

    /// Produce the aggregated BN254 signature `[σ.x, σ.y]` over the result
    /// commitment `keccak256(abi.encode(computationId, encResult))`.
    pub fn sign_result(&self, computation_id: B256, enc_result: &[u8]) -> [U256; 2] {
        // abi_encode_params matches Solidity abi.encode(bytes32, bytes).
        let message: B256 =
            keccak256((computation_id, Bytes::from(enc_result.to_vec())).abi_encode_params());
        let (sig, _) = glasel_bls::bls::group_sign(&self.group_sk, message.as_slice());
        [
            U256::from_be_bytes(be32(&sig[0])),
            U256::from_be_bytes(be32(&sig[1])),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signs_and_derives_group_key() {
        // Same fixed group secret the contract tests use (decimal 1234…29) in hex.
        let sk = num_bigint::BigUint::parse_bytes(b"12345678901234567890123456789", 10).unwrap();
        let signer = BlsSigner::new(&hex::encode(sk.to_bytes_be())).unwrap();
        let sig = signer.sign_result(B256::from([7u8; 32]), b"\xca\xfe");
        assert!(
            sig[0] != U256::ZERO && sig[1] != U256::ZERO,
            "signature must be non-trivial"
        );
        assert_eq!(
            signer.group_pubkey(),
            signer.group_pubkey(),
            "group key must be deterministic"
        );
    }
}
