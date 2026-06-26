//! Field arithmetic over F_p with p = 2^255 - 19 (mirrors the TS SDK `field.ts`).
use num_bigint::{BigInt, BigUint, Sign};
use num_traits::{One, Zero};
use std::sync::OnceLock;

pub const FIELD_BYTES: usize = 32;

/// p = 2^255 - 19
pub fn p() -> &'static BigUint {
    static P: OnceLock<BigUint> = OnceLock::new();
    P.get_or_init(|| (BigUint::one() << 255) - BigUint::from(19u32))
}

/// Reduce into the field.
pub fn fe(x: &BigUint) -> BigUint {
    x % p()
}

pub fn add(a: &BigUint, b: &BigUint) -> BigUint {
    (a + b) % p()
}

pub fn sub(a: &BigUint, b: &BigUint) -> BigUint {
    // (a - b) mod p, keeping non-negative
    let pp = p();
    let a = a % pp;
    let b = b % pp;
    if a >= b {
        (a - b) % pp
    } else {
        (pp - (b - a)) % pp
    }
}

pub fn mul(a: &BigUint, b: &BigUint) -> BigUint {
    (a * b) % p()
}

pub fn pow(a: &BigUint, e: &BigUint) -> BigUint {
    a.modpow(e, p())
}

/// Multiplicative inverse via Fermat (p is prime): a^(p-2) mod p.
pub fn inv(a: &BigUint) -> BigUint {
    let exp = p() - BigUint::from(2u32);
    a.modpow(&exp, p())
}

/// Modular inverse mod a general modulus (used for the S-box inverse exponent
/// over p-1). Extended Euclidean algorithm.
pub fn modinv_general(a: &BigUint, modulus: &BigUint) -> BigUint {
    let m = BigInt::from_biguint(Sign::Plus, modulus.clone());
    let a = BigInt::from_biguint(Sign::Plus, a.clone()) % &m;
    let (mut old_r, mut r) = (a, m.clone());
    let (mut old_s, mut s) = (BigInt::one(), BigInt::zero());
    while !r.is_zero() {
        let q = &old_r / &r;
        let new_r = &old_r - &q * &r;
        old_r = std::mem::replace(&mut r, new_r);
        let new_s = &old_s - &q * &s;
        old_s = std::mem::replace(&mut s, new_s);
    }
    // old_s mod m, normalized to [0, m)
    let res = ((old_s % &m) + &m) % &m;
    res.to_biguint().expect("non-negative")
}

/// Big-endian 32-byte serialization (left-padded).
pub fn fe_to_bytes_be(x: &BigUint) -> [u8; 32] {
    let raw = (x % p()).to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - raw.len()..].copy_from_slice(&raw);
    out
}

/// Big-endian deserialization, reduced mod p.
pub fn fe_from_bytes_be(b: &[u8]) -> BigUint {
    BigUint::from_bytes_be(b) % p()
}

/// Left-padded 32-byte big-endian of an arbitrary BigUint WITHOUT reduction.
/// (Reduction would turn the modulus itself into zero.)
pub fn biguint_to_bytes_be(x: &BigUint) -> [u8; 32] {
    let raw = x.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - raw.len()..].copy_from_slice(&raw);
    out
}
