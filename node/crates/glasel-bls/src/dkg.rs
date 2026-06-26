//! Distributed Key Generation (Feldman VSS) for threshold BLS on BN254.
//!
//! Produces a shared group secret with **no trusted dealer**: every party deals
//! a fresh, *verifiable* Shamir sharing of a random contribution, and the group
//! key is the sum of all contributions. Each recipient checks its share against
//! the dealer's public commitments (`share·G2 == Σ Cₖ·jᵏ`), so a malicious dealer
//! that sends an inconsistent share is detected and can be disqualified. This is
//! the standard Feldman-VSS DKG underpinning threshold signatures.
//!
//! Security: secure against a minority of malicious parties (verifiable shares +
//! commitment binding). Note the well-known Gennaro et al. caveat — a rushing
//! adversary can bias the last bit of the key's distribution; a Pedersen-DKG
//! hardening (add hiding commitments + a complaint round) closes that and is the
//! production follow-up (`dkg_pedersen` below). Group *correctness* and share
//! verifiability hold here.
use crate::bls::{
    fr_from_biguint, fr_to_be32, fr_to_biguint, g2_from_words, g2_to_words, hash_to_g1,
};
use ark_bn254::{Fr, G1Affine, G1Projective, G2Affine, G2Projective};
use ark_ec::{CurveGroup, Group};
use ark_ff::Zero;
use ark_std::UniformRand;
use num_bigint::BigUint;
use rand::RngCore;

/// One party's verifiable contribution: G2 commitments to its degree-`t`
/// polynomial coefficients, plus the share dealt to each of the `n` parties.
pub struct Dealing {
    pub commitments: Vec<G2Affine>, // Cₖ = aₖ·G2, k = 0..=t
    pub shares: Vec<Fr>,            // shares[j-1] = f(j), j = 1..=n
}

fn eval_poly(coeffs: &[Fr], x: Fr) -> Fr {
    let mut acc = Fr::zero();
    for c in coeffs.iter().rev() {
        acc = acc * x + c;
    }
    acc
}

/// Deal a fresh random degree-`t` sharing with Feldman commitments.
pub fn deal<R: RngCore>(n: usize, t: usize, rng: &mut R) -> Dealing {
    let coeffs: Vec<Fr> = (0..=t).map(|_| Fr::rand(rng)).collect();
    let commitments = coeffs
        .iter()
        .map(|a| (G2Projective::generator() * *a).into_affine())
        .collect();
    let shares = (1..=n)
        .map(|j| eval_poly(&coeffs, Fr::from(j as u64)))
        .collect();
    Dealing {
        commitments,
        shares,
    }
}

/// Feldman verification of party `j`'s share against a dealer's commitments:
/// `share·G2 == Σₖ Cₖ·jᵏ`. Returns false for an inconsistent (malicious) share.
pub fn verify_share(commitments: &[G2Affine], j: u64, share: Fr) -> bool {
    let lhs = (G2Projective::generator() * share).into_affine();
    let mut rhs = G2Projective::zero();
    let mut jpow = Fr::from(1u64);
    let xj = Fr::from(j);
    for c in commitments {
        rhs += G2Projective::from(*c) * jpow;
        jpow *= xj;
    }
    lhs == rhs.into_affine()
}

/// Party `j`'s group secret share = Σ over dealers of the shares it received.
/// (An evaluation at `j` of the summed degree-`t` polynomial whose constant term
/// is the group secret.)
pub fn aggregate_share(received_shares: &[Fr]) -> Fr {
    received_shares
        .iter()
        .copied()
        .fold(Fr::zero(), |a, b| a + b)
}

/// Group public key PK = Σ over dealers of their constant-term commitment C₀
/// = (Σ contributions)·G2 = sk·G2.
pub fn group_public_key(dealings: &[Dealing]) -> G2Affine {
    let mut acc = G2Projective::zero();
    for d in dealings {
        acc += G2Projective::from(d.commitments[0]);
    }
    acc.into_affine()
}

/// Convenience: run the DKG locally for `n`/`t` and return `(group_pk, shares)`
/// after verifying every dealing. Used in tests and the single-host demo; in
/// production each party runs `deal` + `verify_share` over the network.
pub fn run_local<R: RngCore>(n: usize, t: usize, rng: &mut R) -> (G2Affine, Vec<Fr>) {
    let dealings: Vec<Dealing> = (0..n).map(|_| deal(n, t, rng)).collect();
    for d in &dealings {
        for j in 1..=n {
            assert!(
                verify_share(&d.commitments, j as u64, d.shares[j - 1]),
                "honest dealing must verify"
            );
        }
    }
    let shares: Vec<Fr> = (1..=n)
        .map(|j| aggregate_share(&dealings.iter().map(|d| d.shares[j - 1]).collect::<Vec<_>>()))
        .collect();
    (group_public_key(&dealings), shares)
}

// ── Word (BigUint) interface for the networked DKG ──────────────────────────
// `glasel-mpc` drives the DKG over its `Net` (which carries bigints) without
// depending on `ark`: it exchanges these words and calls the helpers below.

/// A dealing serialized to transport words: each commitment is 4 G2 words, each
/// share one scalar word.
pub struct DealWords {
    pub commitments: Vec<[BigUint; 4]>, // t+1 commitments (Cₖ as G2 words)
    pub shares: Vec<BigUint>,           // n shares (f(j))
}

/// Deal (Feldman) and serialize to words for sending over the mesh.
pub fn deal_words<R: RngCore>(n: usize, t: usize, rng: &mut R) -> DealWords {
    let d = deal(n, t, rng);
    DealWords {
        commitments: d.commitments.iter().map(g2_to_words).collect(),
        shares: d.shares.iter().map(fr_to_biguint).collect(),
    }
}

/// Feldman-verify party `j`'s received `share` against a dealer's commitment
/// words. Rejects an inconsistent share or any invalid commitment point.
pub fn verify_share_words(commitments: &[[BigUint; 4]], j: u64, share: &BigUint) -> bool {
    let comms: Option<Vec<G2Affine>> = commitments.iter().map(g2_from_words).collect();
    match comms {
        Some(c) => verify_share(&c, j, fr_from_biguint(share)),
        None => false,
    }
}

/// Sum a party's received share words into its group secret-key share `sk_i`
/// (32-byte big-endian), ready for `bls::group_sign` (partial signing).
pub fn aggregate_shares_words(shares: &[BigUint]) -> [u8; 32] {
    let s = shares
        .iter()
        .fold(Fr::zero(), |a, b| a + fr_from_biguint(b));
    fr_to_be32(&s)
}

/// Group public key = Σ of dealers' constant-term commitments C₀, as G2 words.
/// `None` if any commitment is an invalid point.
pub fn sum_group_pk_words(c0s: &[[BigUint; 4]]) -> Option<[BigUint; 4]> {
    let mut acc = G2Projective::zero();
    for w in c0s {
        acc += G2Projective::from(g2_from_words(w)?);
    }
    Some(g2_to_words(&acc.into_affine()))
}

// ── Pedersen DKG (bias-resistant) ───────────────────────────────────────────
//
// Feldman commitments `aₖ·G2` are *binding but not hiding* — they reveal each
// dealer's public-key contribution during the share/complaint phase, which lets
// a rushing adversary bias the last bit of the group key (Gennaro et al.).
// Pedersen-DKG fixes this: shares are verified against *hiding* commitments
// `Cₖ = aₖ·G1 + bₖ·H1` (perfectly hiding, since H1 has unknown discrete log wrt
// G1), so nothing about the public key leaks until the qualified set is fixed.
// Only afterwards are the Feldman commitments `Aₖ = aₖ·G2` revealed to extract
// the key; their consistency with the dealt shares is checked, binding the two
// commitment systems to the same `aₖ`.
//
// We place the hiding commitments in G1 (where `hash_to_g1` gives a
// nothing-up-my-sleeve generator with unknown dlog) and the public key in G2.

/// Nothing-up-my-sleeve second generator H1 ∈ G1 (unknown dlog wrt G1).
fn pedersen_h() -> G1Affine {
    hash_to_g1(b"confide:pedersen-dkg:H:v1")
}

/// A Pedersen-DKG dealing.
pub struct PedersenDealing {
    pub hiding: Vec<G1Affine>,  // Cₖ = aₖ·G1 + bₖ·H1  (phase 1, hiding)
    pub feldman: Vec<G2Affine>, // Aₖ = aₖ·G2          (phase 2, revealed)
    pub shares: Vec<Fr>,        // f(j)  = secret-poly evaluations
    pub blinds: Vec<Fr>,        // f'(j) = blinding-poly evaluations
}

/// Deal a fresh Pedersen-committed sharing (secret poly `a`, blinding poly `b`).
pub fn deal_pedersen<R: RngCore>(n: usize, t: usize, rng: &mut R) -> PedersenDealing {
    let a: Vec<Fr> = (0..=t).map(|_| Fr::rand(rng)).collect();
    let b: Vec<Fr> = (0..=t).map(|_| Fr::rand(rng)).collect();
    let g1 = G1Projective::generator();
    let h1 = G1Projective::from(pedersen_h());
    let hiding = (0..=t)
        .map(|k| (g1 * a[k] + h1 * b[k]).into_affine())
        .collect();
    let feldman = a
        .iter()
        .map(|ak| (G2Projective::generator() * *ak).into_affine())
        .collect();
    let shares = (1..=n).map(|j| eval_poly(&a, Fr::from(j as u64))).collect();
    let blinds = (1..=n).map(|j| eval_poly(&b, Fr::from(j as u64))).collect();
    PedersenDealing {
        hiding,
        feldman,
        shares,
        blinds,
    }
}

/// Phase-1 hiding check: `f(j)·G1 + f'(j)·H1 == Σ Cₖ·jᵏ`.
pub fn verify_pedersen_share(hiding: &[G1Affine], j: u64, share: Fr, blind: Fr) -> bool {
    let lhs = (G1Projective::generator() * share + G1Projective::from(pedersen_h()) * blind)
        .into_affine();
    let mut rhs = G1Projective::zero();
    let mut jp = Fr::from(1u64);
    let xj = Fr::from(j);
    for c in hiding {
        rhs += G1Projective::from(*c) * jp;
        jp *= xj;
    }
    lhs == rhs.into_affine()
}

/// Phase-2 binding check: revealed Feldman commitments are consistent with the
/// dealt shares (`share·G2 == Σ Aₖ·jᵏ`) — same `aₖ` as the hiding commitments.
pub fn verify_feldman_reveal(feldman: &[G2Affine], j: u64, share: Fr) -> bool {
    verify_share(feldman, j, share)
}

/// Group public key = Σ over dealers of the revealed A₀.
pub fn group_public_key_pedersen(dealings: &[PedersenDealing]) -> G2Affine {
    let mut acc = G2Projective::zero();
    for d in dealings {
        acc += G2Projective::from(d.feldman[0]);
    }
    acc.into_affine()
}

/// Run the bias-resistant Pedersen DKG locally: phase-1 hiding verification,
/// then phase-2 Feldman reveal + consistency, then aggregate. Returns
/// `(group_pk, shares)`.
pub fn run_local_pedersen<R: RngCore>(n: usize, t: usize, rng: &mut R) -> (G2Affine, Vec<Fr>) {
    let dealings: Vec<PedersenDealing> = (0..n).map(|_| deal_pedersen(n, t, rng)).collect();
    for d in &dealings {
        for j in 1..=n {
            assert!(
                verify_pedersen_share(&d.hiding, j as u64, d.shares[j - 1], d.blinds[j - 1]),
                "phase 1: hiding share must verify"
            );
        }
    }
    for d in &dealings {
        for j in 1..=n {
            assert!(
                verify_feldman_reveal(&d.feldman, j as u64, d.shares[j - 1]),
                "phase 2: reveal must be consistent"
            );
        }
    }
    let shares: Vec<Fr> = (1..=n)
        .map(|j| aggregate_share(&dealings.iter().map(|d| d.shares[j - 1]).collect::<Vec<_>>()))
        .collect();
    (group_public_key_pedersen(&dealings), shares)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::bls::{combine, hash_to_g1, partial_sign, verify};
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn dkg_produces_a_working_threshold_key() {
        let mut rng = StdRng::seed_from_u64(7);
        let (n, t) = (3usize, 1usize);
        let (pk, shares) = run_local(n, t, &mut rng);

        let msg = b"confide:dkg|computationId|encResult";
        let h = hash_to_g1(msg);

        // Any t+1 = 2 of the DKG shares reconstruct a signature under the group pk.
        let ids = [1u64, 2];
        let partials: Vec<_> = ids
            .iter()
            .map(|&i| partial_sign(shares[i as usize - 1], h))
            .collect();
        let sig = combine(&ids, &partials);
        assert!(
            verify(msg, sig, pk),
            "DKG threshold signature must verify on the group key"
        );

        // A different subset yields the same signature (consistent group key).
        let ids2 = [2u64, 3];
        let p2: Vec<_> = ids2
            .iter()
            .map(|&i| partial_sign(shares[i as usize - 1], h))
            .collect();
        assert_eq!(
            sig,
            combine(&ids2, &p2),
            "any t+1 subset reconstructs the same group signature"
        );
    }

    #[test]
    fn dkg_detects_a_malicious_dealing() {
        let mut rng = StdRng::seed_from_u64(8);
        let mut d = deal(3, 1, &mut rng);
        assert!(
            verify_share(&d.commitments, 2, d.shares[1]),
            "honest share verifies"
        );
        // Dealer sends party 2 a corrupted share inconsistent with its commitments.
        d.shares[1] += Fr::from(1u64);
        assert!(
            !verify_share(&d.commitments, 2, d.shares[1]),
            "tampered share must be rejected"
        );
    }

    #[test]
    fn pedersen_dkg_produces_a_working_key() {
        let mut rng = StdRng::seed_from_u64(21);
        let (pk, shares) = run_local_pedersen(3, 1, &mut rng);
        let msg = b"confide:pedersen-dkg";
        let h = hash_to_g1(msg);
        let ids = [1u64, 2];
        let partials: Vec<_> = ids
            .iter()
            .map(|&i| partial_sign(shares[i as usize - 1], h))
            .collect();
        assert!(
            verify(msg, combine(&ids, &partials), pk),
            "Pedersen-DKG threshold key must verify"
        );
    }

    #[test]
    fn pedersen_hiding_check_catches_a_bad_share() {
        let mut rng = StdRng::seed_from_u64(22);
        let mut d = deal_pedersen(3, 1, &mut rng);
        assert!(
            verify_pedersen_share(&d.hiding, 2, d.shares[1], d.blinds[1]),
            "honest hiding share verifies"
        );
        d.shares[1] += Fr::from(1u64);
        assert!(
            !verify_pedersen_share(&d.hiding, 2, d.shares[1], d.blinds[1]),
            "tampered hiding share rejected"
        );
    }

    #[test]
    fn pedersen_feldman_reveal_catches_inconsistent_commitment() {
        use ark_ec::CurveGroup;
        let mut rng = StdRng::seed_from_u64(23);
        let mut d = deal_pedersen(3, 1, &mut rng);
        assert!(
            verify_feldman_reveal(&d.feldman, 1, d.shares[0]),
            "honest reveal is consistent"
        );
        // Dealer reveals a Feldman commitment that doesn't match its dealt shares.
        d.feldman[0] = (G2Projective::from(d.feldman[0]) + G2Projective::generator()).into_affine();
        assert!(
            !verify_feldman_reveal(&d.feldman, 1, d.shares[0]),
            "inconsistent reveal rejected"
        );
    }
}
