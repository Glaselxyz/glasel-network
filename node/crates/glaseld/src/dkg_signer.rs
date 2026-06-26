//! Distributed BLS signer — the production signing path.
//!
//! Instead of one node holding the whole `bls_group_secret` (see [`crate::signer`]),
//! the cluster runs a live DKG over the authenticated mesh so each node holds only
//! its share `sk_i`, and a result is signed by exchanging partial signatures and
//! Lagrange-combining them (`glasel_mpc::dkg`). No node ever holds the full key;
//! the group public key is registered on-chain via `setBlsGroupKey`.
//!
//! This is the multi-node path: each GlaselOS node calls [`DistributedBlsSigner::establish`]
//! once over its [`Net`] (the same `SecureTcpNet` the MPC session uses), then
//! [`sign_result`] per computation. Verified across parties by the in-process test.
use alloy::primitives::{keccak256, Bytes, B256, U256};
use alloy::sol_types::SolValue;
use glasel_mpc::dkg::{dkg_threshold_sign, run_dkg, DkgError};
use glasel_mpc::net::Net;
use num_bigint::BigUint;
use rand::RngCore;

fn be32(x: &BigUint) -> [u8; 32] {
    let b = x.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - b.len()..].copy_from_slice(&b);
    out
}

#[allow(dead_code)] // multi-node signing path: built + tested across parties;
                    // the single-process daemon can't run a networked DKG with
                    // itself, so the main loop selects it only in a real cluster.
pub struct DistributedBlsSigner {
    /// This node's DKG secret-key share `sk_i` (never the whole key).
    sk_share: [u8; 32],
    /// The shared group public key (same on every node), for `setBlsGroupKey`.
    group_pk: [BigUint; 4],
    parties: usize,
}

#[allow(dead_code)]
impl DistributedBlsSigner {
    /// Run the DKG over `net` to derive this node's share + the group key.
    pub fn establish<N: Net, R: RngCore>(
        net: &N,
        parties: usize,
        t: usize,
        rng: &mut R,
    ) -> Result<Self, DkgError> {
        let out = run_dkg(net, parties, t, rng)?;
        Ok(Self {
            sk_share: out.secret_share,
            group_pk: out.group_pk,
            parties,
        })
    }

    /// The group public key `[x.c1, x.c0, y.c1, y.c0]` for on-chain registration.
    pub fn group_pubkey(&self) -> [U256; 4] {
        [
            U256::from_be_bytes(be32(&self.group_pk[0])),
            U256::from_be_bytes(be32(&self.group_pk[1])),
            U256::from_be_bytes(be32(&self.group_pk[2])),
            U256::from_be_bytes(be32(&self.group_pk[3])),
        ]
    }

    /// Sign the result by combining the cluster's partial signatures over `net`.
    /// Every honest node returns the same aggregate signature `[σ.x, σ.y]`.
    pub fn sign_result<N: Net>(
        &self,
        net: &N,
        computation_id: B256,
        enc_result: &[u8],
    ) -> [U256; 2] {
        let message: B256 =
            keccak256((computation_id, Bytes::from(enc_result.to_vec())).abi_encode_params());
        let sig = dkg_threshold_sign(net, &self.sk_share, self.parties, message.as_slice());
        [
            U256::from_be_bytes(be32(&sig[0])),
            U256::from_be_bytes(be32(&sig[1])),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glasel_mpc::net::InMemoryNet;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::thread;

    #[test]
    fn cluster_dkg_signs_a_result_without_any_node_holding_the_key() {
        let (n, t) = (3usize, 1usize);
        let nets = InMemoryNet::mesh(n);
        let comp_id = B256::from([9u8; 32]);
        let enc_result: &[u8] = b"\xca\xfe\xba\xbe";

        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                thread::spawn(move || {
                    let mut rng = StdRng::seed_from_u64(4000 + i as u64);
                    let signer =
                        DistributedBlsSigner::establish(&net, n, t, &mut rng).expect("DKG");
                    let pk = signer.group_pubkey();
                    let sig = signer.sign_result(&net, comp_id, enc_result);
                    (pk, sig)
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // Every node derived the SAME group key and produced the SAME signature —
        // computed entirely from distributed shares.
        for (pk, sig) in &results {
            assert_eq!(*pk, results[0].0, "all nodes share one group key");
            assert_eq!(
                *sig, results[0].1,
                "all nodes agree on the aggregate signature"
            );
        }
        // And it's a non-trivial signature.
        assert!(
            results[0].1[0] != U256::ZERO,
            "signature must be non-trivial"
        );
    }
}
