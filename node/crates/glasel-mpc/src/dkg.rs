//! Live per-session Distributed Key Generation over the MPC mesh.
//!
//! At the start of a session the cluster runs a Feldman-VSS DKG (no trusted
//! dealer) across the authenticated, encrypted `Net`: each node deals a fresh
//! verifiable sharing, **broadcasts its G2 commitments** and **privately sends
//! each peer its share**, then verifies every received share against the dealer's
//! commitments (`share·G2 == Σ Cₖ·jᵏ`). Each node ends with its own secret share
//! `sk_i` of the group key — no node ever holds the whole key — and everyone
//! agrees on the same group public key `PK` (registered on-chain via
//! `setBlsGroupKey`). Any `t+1` nodes' partial signatures then combine to a valid
//! group signature.
//!
//! Transport-agnostic: the BN254 scalars/points cross the wire as plain bigints
//! (`Fe`) through the existing `Net`, so this needs no `ark` types here — the
//! serialization + curve math live in `glasel-bls`.
use crate::net::Net;
use crate::shamir::Fe;
use glasel_bls::dkg::{
    aggregate_shares_words, deal_words, sum_group_pk_words, verify_share_words,
};
use rand::RngCore;

/// Reserved round base for DKG, above input dealing (`1<<40`) and far above any
/// circuit's gate rounds, so DKG never collides with later phases on the same net.
const DKG_BASE: u64 = 1 << 41;

/// This node's output of the DKG.
pub struct DkgOutput {
    /// This node's secret-key share `sk_i` (32-byte big-endian) — feed to
    /// `glasel_bls::bls::group_sign` to produce a partial signature.
    pub secret_share: [u8; 32],
    /// The group public key `[x.c1, x.c0, y.c1, y.c0]` (same for every node).
    pub group_pk: [Fe; 4],
}

#[derive(Debug)]
pub enum DkgError {
    /// Dealer `dealer` sent a share inconsistent with its commitments.
    InvalidShare { dealer: usize },
    /// A commitment did not decode to a valid curve point.
    BadCommitment,
}

impl std::fmt::Display for DkgError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            DkgError::InvalidShare { dealer } => {
                write!(f, "DKG: invalid share from dealer {dealer}")
            }
            DkgError::BadCommitment => write!(f, "DKG: invalid commitment point"),
        }
    }
}
impl std::error::Error for DkgError {}

const SHARE_TAG: u64 = 0; // share round offset
fn commit_round(k: usize, w: usize) -> u64 {
    DKG_BASE + 1 + (k * 4 + w) as u64 // +1 leaves DKG_BASE for the share round
}
fn share_round() -> u64 {
    DKG_BASE + SHARE_TAG
}

/// Run the Feldman-VSS DKG as party `net.id()` of `n` at threshold `t`.
/// Returns this node's secret share and the shared group public key.
pub fn run_dkg<N: Net, R: RngCore>(
    net: &N,
    n: usize,
    t: usize,
    rng: &mut R,
) -> Result<DkgOutput, DkgError> {
    let me = net.id();
    let d = deal_words(n, t, rng); // commitments: t+1 × [Fe;4], shares: n × Fe

    // 1. Broadcast commitments + privately send each peer its share.
    for peer in 1..=n {
        if peer == me {
            continue;
        }
        for (k, commitment) in d.commitments.iter().enumerate() {
            for (w, word) in commitment.iter().enumerate() {
                net.send(peer, commit_round(k, w), word.clone());
            }
        }
        net.send(peer, share_round(), d.shares[peer - 1].clone());
    }

    // 2. Collect every dealer's commitments + our share, verifying as we go.
    let mut my_shares: Vec<Fe> = Vec::with_capacity(n);
    let mut c0s: Vec<[Fe; 4]> = Vec::with_capacity(n);
    for dealer in 1..=n {
        let commitments: Vec<[Fe; 4]> = (0..=t)
            .map(|k| {
                if dealer == me {
                    d.commitments[k].clone()
                } else {
                    [
                        net.recv(dealer, commit_round(k, 0)),
                        net.recv(dealer, commit_round(k, 1)),
                        net.recv(dealer, commit_round(k, 2)),
                        net.recv(dealer, commit_round(k, 3)),
                    ]
                }
            })
            .collect();
        let share = if dealer == me {
            d.shares[me - 1].clone()
        } else {
            net.recv(dealer, share_round())
        };

        if !verify_share_words(&commitments, me as u64, &share) {
            return Err(DkgError::InvalidShare { dealer });
        }
        my_shares.push(share);
        c0s.push(commitments[0].clone());
    }

    let group_pk = sum_group_pk_words(&c0s).ok_or(DkgError::BadCommitment)?;
    let secret_share = aggregate_shares_words(&my_shares);
    Ok(DkgOutput {
        secret_share,
        group_pk,
    })
}

/// Reserved round base for threshold signing (above DKG's `1<<41`).
const SIGN_BASE: u64 = 1 << 42;

/// Produce the group signature over `message` from the parties' DKG shares,
/// **without ever reconstructing the group secret**: each party partial-signs
/// with its share, broadcasts the partial over the mesh, and Lagrange-combines
/// all parties' partials. Every honest party outputs the same signature, which
/// verifies under the DKG group public key. This is how a cluster signs a result
/// when the key came from [`run_dkg`] — no node holds the whole key.
pub fn dkg_threshold_sign<N: Net>(
    net: &N,
    secret_share: &[u8; 32],
    n: usize,
    message: &[u8],
) -> [Fe; 2] {
    let me = net.id();
    // partial σ_me = sk_me · H(message)
    let mine = glasel_bls::bls::group_sign(secret_share, message).0;

    for peer in 1..=n {
        if peer == me {
            continue;
        }
        net.send(peer, SIGN_BASE, mine[0].clone());
        net.send(peer, SIGN_BASE + 1, mine[1].clone());
    }

    let mut ids = Vec::with_capacity(n);
    let mut partials = Vec::with_capacity(n);
    for party in 1..=n {
        let p = if party == me {
            mine.clone()
        } else {
            [net.recv(party, SIGN_BASE), net.recv(party, SIGN_BASE + 1)]
        };
        ids.push(party as u64);
        partials.push(p);
    }
    // n ≥ t+1 partials Lagrange-combine to σ = sk · H(message).
    glasel_bls::bls::combine_words(&ids, &partials).expect("DKG partials must combine")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::InMemoryNet;
    use glasel_bls::bls::{combine_words, group_sign, verify_words};
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::thread;

    #[test]
    fn networked_dkg_yields_a_working_threshold_key() {
        let (n, t) = (3usize, 1usize);
        let nets = InMemoryNet::mesh(n);

        // Each party runs the DKG with its own independent randomness.
        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                thread::spawn(move || {
                    let mut rng = StdRng::seed_from_u64(1000 + i as u64);
                    run_dkg(&net, n, t, &mut rng).expect("DKG must succeed for honest parties")
                })
            })
            .collect();
        let outs: Vec<DkgOutput> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // Everyone agrees on the same group public key.
        for o in &outs {
            assert_eq!(
                o.group_pk, outs[0].group_pk,
                "all nodes must derive the same group key"
            );
        }

        // Any t+1 = 2 nodes' partial signatures combine to a valid group signature.
        let msg = b"confide:per-session-dkg|computationId|encResult";
        let partial = |o: &DkgOutput| group_sign(&o.secret_share, msg).0; // sk_i·H(m) = σ_i
        let sig = combine_words(&[1, 2], &[partial(&outs[0]), partial(&outs[1])]).unwrap();
        assert!(
            verify_words(msg, &sig, &outs[0].group_pk),
            "DKG threshold signature must verify on the group key"
        );

        // A different t+1 subset reconstructs the SAME signature (consistent key).
        let sig2 = combine_words(&[2, 3], &[partial(&outs[1]), partial(&outs[2])]).unwrap();
        assert_eq!(
            sig, sig2,
            "any t+1 subset must reconstruct the same group signature"
        );
    }

    #[test]
    fn dkg_then_threshold_sign_over_the_mesh() {
        // Full per-session flow: parties DKG a group key, then sign a result by
        // exchanging partials over the mesh — no node ever holds the whole key.
        let (n, t) = (3usize, 1usize);
        let nets = InMemoryNet::mesh(n);
        let msg: &[u8] = b"confide:dkg-sign|computationId|encResult";

        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                thread::spawn(move || {
                    let mut rng = StdRng::seed_from_u64(3000 + i as u64);
                    let out = run_dkg(&net, n, t, &mut rng).expect("DKG");
                    let sig = super::dkg_threshold_sign(&net, &out.secret_share, n, msg);
                    (out.group_pk, sig)
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // Every node produced the SAME group key and the SAME group signature,
        // and it verifies — computed entirely from distributed shares.
        for (pk, sig) in &results {
            assert_eq!(*pk, results[0].0, "same group key");
            assert_eq!(*sig, results[0].1, "same group signature from the mesh");
            assert!(
                verify_words(msg, sig, pk),
                "mesh-signed DKG signature must verify"
            );
        }
    }
}
