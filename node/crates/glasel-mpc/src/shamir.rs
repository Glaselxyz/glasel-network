//! Shamir secret sharing over the Glasel field F_p (p = 2^255 − 19).
//!
//! A secret `s` is shared as evaluations `f(1), …, f(n)` of a random degree-`t`
//! polynomial with `f(0) = s`. Any `t + 1` shares reconstruct `s` (Lagrange at
//! x = 0); any `t` or fewer reveal nothing about it.
use glasel_crypto::field as F;
use num_bigint::BigUint;
use rand::RngCore;

pub type Fe = BigUint;

/// A uniformly random field element.
pub fn rand_fe<R: RngCore>(rng: &mut R) -> Fe {
    // 64 random bytes reduced mod p — negligible modular bias for our purposes.
    let mut b = [0u8; 64];
    rng.fill_bytes(&mut b);
    F::fe(&BigUint::from_bytes_be(&b))
}

/// x-coordinates assigned to parties 1..=n.
pub fn party_xs(n: usize) -> Vec<Fe> {
    (1..=n).map(|i| BigUint::from(i as u64)).collect()
}

/// Horner evaluation of a polynomial (coeffs low→high) at `x`, all mod p.
pub fn eval_poly(coeffs: &[Fe], x: &Fe) -> Fe {
    let mut acc = BigUint::from(0u64);
    for c in coeffs.iter().rev() {
        acc = F::add(&F::mul(&acc, x), c);
    }
    acc
}

/// Share `secret` into `n` shares with threshold `t` (degree-`t` polynomial).
/// Returns `[f(1), …, f(n)]`.
pub fn share<R: RngCore>(secret: &Fe, n: usize, t: usize, rng: &mut R) -> Vec<Fe> {
    let mut coeffs = Vec::with_capacity(t + 1);
    coeffs.push(F::fe(secret));
    for _ in 0..t {
        coeffs.push(rand_fe(rng));
    }
    party_xs(n).iter().map(|x| eval_poly(&coeffs, x)).collect()
}

/// Lagrange basis coefficient for interpolating at x = 0 from points `xs`,
/// for the `i`-th point: λ_i = Π_{m≠i} (−x_m) / (x_i − x_m).
pub fn lagrange_at_zero(xs: &[Fe], i: usize) -> Fe {
    let zero = BigUint::from(0u64);
    let mut num = BigUint::from(1u64);
    let mut den = BigUint::from(1u64);
    let xi = &xs[i];
    for (j, xj) in xs.iter().enumerate() {
        if j == i {
            continue;
        }
        num = F::mul(&num, &F::sub(&zero, xj)); // (0 − x_j)
        den = F::mul(&den, &F::sub(xi, xj)); // (x_i − x_j)
    }
    F::mul(&num, &F::inv(&den))
}

/// Reconstruct the secret (value at x = 0) from `(xs, ys)` via Lagrange.
pub fn reconstruct(xs: &[Fe], ys: &[Fe]) -> Fe {
    assert_eq!(xs.len(), ys.len());
    let mut acc = BigUint::from(0u64);
    for i in 0..xs.len() {
        acc = F::add(&acc, &F::mul(&lagrange_at_zero(xs, i), &ys[i]));
    }
    acc
}

/// Lagrange interpolation of the polynomial value at an arbitrary `target` from
/// the points `(xs, ys)`.
pub fn interpolate_at(xs: &[Fe], ys: &[Fe], target: &Fe) -> Fe {
    let mut acc = BigUint::from(0u64);
    for i in 0..xs.len() {
        let mut num = BigUint::from(1u64);
        let mut den = BigUint::from(1u64);
        for (j, xj) in xs.iter().enumerate() {
            if j == i {
                continue;
            }
            num = F::mul(&num, &F::sub(target, xj));
            den = F::mul(&den, &F::sub(&xs[i], xj));
        }
        acc = F::add(&acc, &F::mul(&ys[i], &F::mul(&num, &F::inv(&den))));
    }
    acc
}

/// Robust reconstruction with cheating detection. Interpolates the degree-`t`
/// polynomial from the first `t+1` points and verifies every remaining share
/// lies on it. With `n ≥ 2t+1` the honest majority over-determines the
/// polynomial, so any corrupted share is detected. Returns `None` on
/// inconsistency (a cheating party) — i.e. security with abort.
pub fn reconstruct_checked(xs: &[Fe], ys: &[Fe], t: usize) -> Option<Fe> {
    assert_eq!(xs.len(), ys.len());
    if xs.len() < t + 1 {
        return None;
    }
    let base_xs = &xs[..=t];
    let base_ys = &ys[..=t];
    for k in (t + 1)..xs.len() {
        if interpolate_at(base_xs, base_ys, &xs[k]) != ys[k] {
            return None; // a share is off the polynomial → cheating detected
        }
    }
    Some(interpolate_at(base_xs, base_ys, &BigUint::from(0u64)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use glasel_crypto::field as F;
    use rand::rngs::StdRng;
    use rand::SeedableRng;

    #[test]
    fn share_then_reconstruct_roundtrips() {
        let mut rng = StdRng::seed_from_u64(7);
        let secret = BigUint::from(38178u64);
        let (n, t) = (3, 1);
        let shares = share(&secret, n, t, &mut rng);
        let xs = party_xs(n);
        // any t+1 = 2 shares reconstruct
        assert_eq!(reconstruct(&xs[..2], &shares[..2]), secret);
        assert_eq!(reconstruct(&xs[1..], &shares[1..]), secret);
        // all n
        assert_eq!(reconstruct(&xs, &shares), secret);
    }

    #[test]
    fn reconstruct_checked_detects_tampering() {
        let mut rng = StdRng::seed_from_u64(8);
        let secret = BigUint::from(7000u64);
        let shares = share(&secret, 3, 1, &mut rng);
        let xs = party_xs(3);
        // honest → recovers the secret
        assert_eq!(reconstruct_checked(&xs, &shares, 1), Some(secret.clone()));
        // tamper one share → detected (None)
        let mut bad = shares.clone();
        bad[2] = F::add(&bad[2], &BigUint::from(1u64));
        assert_eq!(reconstruct_checked(&xs, &bad, 1), None);
    }

    #[test]
    fn single_share_hides_secret() {
        let mut rng = StdRng::seed_from_u64(1);
        let secret = BigUint::from(1234u64);
        let a = share(&secret, 3, 1, &mut rng);
        let mut rng2 = StdRng::seed_from_u64(2);
        let b = share(&secret, 3, 1, &mut rng2);
        // A given share value differs across independent sharings — it carries
        // no information about the secret on its own.
        assert_ne!(a[0], b[0]);
    }
}
