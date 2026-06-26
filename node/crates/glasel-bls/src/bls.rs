//! Threshold BLS signatures on BN254 (alt_bn128), verifiable on-chain via the
//! `ecPairing` precompile (0x08) that Base ships.
//!
//! Scheme: a group secret key `sk ∈ F_r` is Shamir-shared across the cluster
//! (degree `t`); the group public key `PK = sk·G2` is published. Each signer
//! `i` produces a partial `σ_i = sk_i · H(m)` over G1; any `t+1` partials
//! Lagrange-combine to `σ = sk · H(m)`. Verification is one pairing equation:
//! `e(σ, G2) == e(H(m), PK)`.
//!
//! `H(m)` (hash-to-G1) uses keccak256 + try-and-increment, implemented here with
//! plain bigints so it matches the Solidity verifier exactly (BN254's G1 has
//! cofactor 1, so any on-curve point is in the group).
use ark_bn254::{Bn254, Fq, Fq2, Fr, G1Affine, G1Projective, G2Affine, G2Projective};
use ark_ec::{pairing::Pairing, AffineRepr, CurveGroup, Group};
use ark_ff::{BigInteger, Field, One, PrimeField, Zero};
use ark_std::UniformRand;
use num_bigint::BigUint;
use num_traits::Num;
use rand::RngCore;
use sha3::{Digest, Keccak256};

/// BN254 base field modulus q.
pub fn q() -> BigUint {
    BigUint::from_str_radix(
        "21888242871839275222246405745257275088696311157297823662689037894645226208583",
        10,
    )
    .unwrap()
}

fn keccak(data: &[u8]) -> [u8; 32] {
    let mut h = Keccak256::new();
    h.update(data);
    h.finalize().into()
}

pub fn fq_to_biguint(f: &Fq) -> BigUint {
    BigUint::from_bytes_le(&f.into_bigint().to_bytes_le())
}

fn fq_from_biguint(x: &BigUint) -> Fq {
    Fq::from_le_bytes_mod_order(&x.to_bytes_le())
}

// ── Word (BigUint) serialization for transport over the MPC `Net` ───────────
// Lets `glasel-mpc` run the networked DKG without depending on `ark`: scalars
// and curve points cross the wire as plain bigints in the on-chain encoding.

/// Scalar `F_r` → BigUint and back (values are < r, so the round-trip is exact).
pub fn fr_to_biguint(f: &Fr) -> BigUint {
    BigUint::from_bytes_le(&f.into_bigint().to_bytes_le())
}
pub fn fr_from_biguint(x: &BigUint) -> Fr {
    Fr::from_le_bytes_mod_order(&x.to_bytes_le())
}
/// `F_r` element as a 32-byte big-endian array (e.g. a DKG secret share `sk_i`).
pub fn fr_to_be32(f: &Fr) -> [u8; 32] {
    let b = fr_to_biguint(f).to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - b.len()..].copy_from_slice(&b);
    out
}

/// G1 point ↔ `[x, y]` words.
pub fn g1_to_words(p: &G1Affine) -> [BigUint; 2] {
    [fq_to_biguint(&p.x), fq_to_biguint(&p.y)]
}
pub fn g1_from_words(w: &[BigUint; 2]) -> Option<G1Affine> {
    let p = G1Affine::new_unchecked(fq_from_biguint(&w[0]), fq_from_biguint(&w[1]));
    (p.is_on_curve() && p.is_in_correct_subgroup_assuming_on_curve()).then_some(p)
}

/// G2 point ↔ `[x.c1, x.c0, y.c1, y.c0]` words (the ecPairing / on-chain order).
pub fn g2_to_words(p: &G2Affine) -> [BigUint; 4] {
    [
        fq_to_biguint(&p.x.c1),
        fq_to_biguint(&p.x.c0),
        fq_to_biguint(&p.y.c1),
        fq_to_biguint(&p.y.c0),
    ]
}
pub fn g2_from_words(w: &[BigUint; 4]) -> Option<G2Affine> {
    let x = Fq2::new(fq_from_biguint(&w[1]), fq_from_biguint(&w[0])); // (c0, c1)
    let y = Fq2::new(fq_from_biguint(&w[3]), fq_from_biguint(&w[2]));
    let p = G2Affine::new_unchecked(x, y);
    (p.is_on_curve() && p.is_in_correct_subgroup_assuming_on_curve()).then_some(p)
}

/// Lagrange-combine partial signatures given as words into an aggregate sig
/// `[x, y]`; `None` if any partial is an invalid point.
pub fn combine_words(ids: &[u64], partials: &[[BigUint; 2]]) -> Option<[BigUint; 2]> {
    let ps: Option<Vec<G1Affine>> = partials.iter().map(g1_from_words).collect();
    Some(g1_to_words(&combine(ids, &ps?)))
}

/// Verify an aggregate signature (words) over `msg` against a group key (words).
pub fn verify_words(msg: &[u8], sig: &[BigUint; 2], pk: &[BigUint; 4]) -> bool {
    match (g1_from_words(sig), g2_from_words(pk)) {
        (Some(s), Some(p)) => verify(msg, s, p),
        _ => false,
    }
}

/// Deterministic hash-to-G1 (keccak256 + try-and-increment), matching `BLS.sol`.
pub fn hash_to_g1(msg: &[u8]) -> G1Affine {
    let q = q();
    let three = BigUint::from(3u32);
    let one = BigUint::from(1u32);
    let exp_legendre = (&q - 1u32) / 2u32;
    let exp_sqrt = (&q + 1u32) / 4u32;

    let mut x = BigUint::from_bytes_be(&keccak(msg)) % &q;
    loop {
        let x2 = (&x * &x) % &q;
        let x3 = (&x2 * &x) % &q;
        let rhs = (&x3 + &three) % &q;
        if rhs.modpow(&exp_legendre, &q) == one {
            let mut y = rhs.modpow(&exp_sqrt, &q);
            let qy = &q - &y;
            if y > qy {
                y = qy; // canonical: the smaller root
            }
            let pt = G1Affine::new_unchecked(fq_from_biguint(&x), fq_from_biguint(&y));
            assert!(pt.is_on_curve(), "hash-to-G1 produced off-curve point");
            return pt;
        }
        x = (&x + &one) % &q;
    }
}

// ── Shamir over the scalar field F_r ────────────────────────────────────────

fn eval_poly_fr(coeffs: &[Fr], x: Fr) -> Fr {
    let mut acc = Fr::zero();
    for c in coeffs.iter().rev() {
        acc = acc * x + c;
    }
    acc
}

/// Share `sk` into `n` shares with threshold `t` (degree-`t` polynomial).
pub fn share_sk<R: RngCore>(sk: Fr, n: usize, t: usize, rng: &mut R) -> Vec<Fr> {
    let mut coeffs = vec![sk];
    for _ in 0..t {
        coeffs.push(Fr::rand(rng));
    }
    (1..=n)
        .map(|i| eval_poly_fr(&coeffs, Fr::from(i as u64)))
        .collect()
}

/// Lagrange coefficient λ_i(0) for interpolating f(0) from points at `ids`.
fn lagrange_at_zero(ids: &[u64], i: usize) -> Fr {
    let xi = Fr::from(ids[i]);
    let mut num = Fr::one();
    let mut den = Fr::one();
    for (j, &idj) in ids.iter().enumerate() {
        if j == i {
            continue;
        }
        let xj = Fr::from(idj);
        num *= -xj;
        den *= xi - xj;
    }
    num * den.inverse().expect("distinct ids")
}

// ── Signing ─────────────────────────────────────────────────────────────────

/// Group public key PK = sk · G2.
pub fn group_pk(sk: Fr) -> G2Affine {
    (G2Projective::generator() * sk).into_affine()
}

/// Partial signature σ_i = sk_i · H(m).
pub fn partial_sign(sk_i: Fr, h: G1Affine) -> G1Affine {
    (G1Projective::from(h) * sk_i).into_affine()
}

/// Combine partials from `ids` into σ = sk · H(m) via Lagrange interpolation.
pub fn combine(ids: &[u64], partials: &[G1Affine]) -> G1Affine {
    let mut acc = G1Projective::zero();
    for (k, _) in ids.iter().enumerate() {
        acc += G1Projective::from(partials[k]) * lagrange_at_zero(ids, k);
    }
    acc.into_affine()
}

/// Sign `message` with a (group) secret key given as big-endian bytes, returning
/// the on-chain encodings: the G1 signature `[σ.x, σ.y]` and the G2 group public
/// key `[x.c1, x.c0, y.c1, y.c0]` — exactly the words `submitResult` /
/// `setBlsGroupKey` expect. `σ = sk·H(m)` equals the threshold-combined signature,
/// so a node holding the DKG-combined key produces a directly-verifiable sig.
/// (Mirrors the `bls-sign` binary; lets callers avoid depending on `ark`.)
pub fn group_sign(sk_be: &[u8], message: &[u8]) -> ([BigUint; 2], [BigUint; 4]) {
    let sk = Fr::from_le_bytes_mod_order(&BigUint::from_bytes_be(sk_be).to_bytes_le());
    let sig = partial_sign(sk, hash_to_g1(message));
    let pk = group_pk(sk);
    (
        [fq_to_biguint(&sig.x), fq_to_biguint(&sig.y)],
        [
            fq_to_biguint(&pk.x.c1),
            fq_to_biguint(&pk.x.c0),
            fq_to_biguint(&pk.y.c1),
            fq_to_biguint(&pk.y.c0),
        ],
    )
}

/// Verify `e(σ, G2) == e(H(m), PK)`.
pub fn verify(msg: &[u8], sig: G1Affine, pk: G2Affine) -> bool {
    let h = hash_to_g1(msg);
    Bn254::pairing(sig, G2Affine::generator()) == Bn254::pairing(h, pk)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn threshold_sign_and_verify() {
        let mut rng = StdRng::seed_from_u64(11);
        let sk = Fr::rand(&mut rng);
        let pk = group_pk(sk);
        let (n, t) = (3, 1);
        let shares = share_sk(sk, n, t, &mut rng);

        let msg = b"confide:computationId|encResult";
        let h = hash_to_g1(msg);

        // Any t+1 = 2 signers reconstruct a valid signature.
        let ids = [1u64, 2];
        let partials: Vec<_> = ids
            .iter()
            .map(|&i| partial_sign(shares[i as usize - 1], h))
            .collect();
        let sig = combine(&ids, &partials);
        assert!(verify(msg, sig, pk), "threshold signature must verify");

        // A different signer subset yields the same signature value.
        let ids2 = [2u64, 3];
        let partials2: Vec<_> = ids2
            .iter()
            .map(|&i| partial_sign(shares[i as usize - 1], h))
            .collect();
        let sig2 = combine(&ids2, &partials2);
        assert_eq!(sig, sig2, "any t+1 subset reconstructs the same signature");

        // Tampered message must fail.
        assert!(!verify(b"different message", sig, pk));
    }

    #[test]
    fn hash_to_g1_is_deterministic_and_on_curve() {
        let a = hash_to_g1(b"abc");
        let b = hash_to_g1(b"abc");
        assert_eq!(a, b);
        assert!(a.is_on_curve());
        assert_ne!(a, hash_to_g1(b"abd"));
    }
}
