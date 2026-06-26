//! Rescue-Prime permutation, sponge KDF and CTR cipher (mirrors `rescue.ts`).
//!
//! Self-consistent instantiation: MDS = Cauchy matrix, round constants from a
//! domain-separated keccak stream — byte-for-byte identical to the TS SDK so the
//! node and client interoperate.
use crate::field;
use num_bigint::BigUint;
use sha3::{Digest, Keccak256};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

const ROUNDS: usize = 10;

fn alpha() -> &'static BigUint {
    static A: OnceLock<BigUint> = OnceLock::new();
    A.get_or_init(|| BigUint::from(5u32))
}

fn alpha_inv() -> &'static BigUint {
    static AI: OnceLock<BigUint> = OnceLock::new();
    AI.get_or_init(|| field::modinv_general(alpha(), &(field::p() - BigUint::from(1u32))))
}

#[derive(Clone)]
struct Params {
    mds: Vec<Vec<BigUint>>,
    rc: Vec<Vec<BigUint>>,
}

fn params(m: usize) -> Params {
    static CACHE: OnceLock<Mutex<HashMap<usize, Params>>> = OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    let mut guard = cache.lock().unwrap();
    guard
        .entry(m)
        .or_insert_with(|| Params {
            mds: cauchy_mds(m),
            rc: round_constants(m, ROUNDS),
        })
        .clone()
}

/// Rescue-Prime permutation on a state of width `m`.
pub fn permute(state: &[BigUint]) -> Vec<BigUint> {
    let m = state.len();
    let Params { mds, rc } = params(m);
    let mut s: Vec<BigUint> = state.iter().map(field::fe).collect();
    let a = alpha();
    let ai = alpha_inv();

    for r in 0..ROUNDS {
        s = s.iter().map(|x| field::pow(x, a)).collect();
        s = mat_mul(&mds, &s);
        s = add_vec(&s, &rc[2 * r]);

        s = s.iter().map(|x| field::pow(x, ai)).collect();
        s = mat_mul(&mds, &s);
        s = add_vec(&s, &rc[2 * r + 1]);
    }
    s
}

/// Rescue-Prime sponge hash (rate=7, capacity=5 by default).
pub fn rescue_hash(
    inputs: &[BigUint],
    out_len: usize,
    rate: usize,
    capacity: usize,
) -> Vec<BigUint> {
    let m = rate + capacity;
    let mut state = vec![BigUint::from(0u32); m];

    let mut padded = inputs.to_vec();
    while padded.len() % rate != 0 {
        padded.push(BigUint::from(0u32));
    }
    let mut off = 0;
    while off < padded.len() {
        for i in 0..rate {
            state[i] = field::add(&state[i], &padded[off + i]);
        }
        state = permute(&state);
        off += rate;
    }

    let mut out = Vec::new();
    loop {
        for i in 0..rate {
            if out.len() == out_len {
                break;
            }
            out.push(state[i].clone());
        }
        if out.len() == out_len {
            break;
        }
        state = permute(&state);
    }
    out
}

/// Derive a 5-element Rescue cipher key from an ECDH shared secret.
pub fn derive_key(shared_secret: &BigUint) -> Vec<BigUint> {
    rescue_hash(&[field::fe(shared_secret)], 5, 7, 5)
}

const CIPHER_M: usize = 5;

fn keystream(key: &[BigUint], nonce_fe: &BigUint, i: usize) -> Vec<BigUint> {
    let state = vec![
        field::add(&key[0], nonce_fe),
        field::add(&key[1], &BigUint::from(i as u64)),
        key[2].clone(),
        key[3].clone(),
        key[4].clone(),
    ];
    permute(&state)
}

pub fn ctr_encrypt(plaintext: &[BigUint], key: &[BigUint], nonce_fe: &BigUint) -> Vec<BigUint> {
    assert_eq!(key.len(), CIPHER_M, "key must be 5 field elements");
    let mut out = Vec::with_capacity(plaintext.len());
    for (i, pt) in plaintext.iter().enumerate() {
        let ks = keystream(key, nonce_fe, i / CIPHER_M);
        out.push(field::add(pt, &ks[i % CIPHER_M]));
    }
    out
}

pub fn ctr_decrypt(ciphertext: &[BigUint], key: &[BigUint], nonce_fe: &BigUint) -> Vec<BigUint> {
    assert_eq!(key.len(), CIPHER_M, "key must be 5 field elements");
    let mut out = Vec::with_capacity(ciphertext.len());
    for (i, ct) in ciphertext.iter().enumerate() {
        let ks = keystream(key, nonce_fe, i / CIPHER_M);
        out.push(field::sub(ct, &ks[i % CIPHER_M]));
    }
    out
}

fn cauchy_mds(m: usize) -> Vec<Vec<BigUint>> {
    let mut a = Vec::with_capacity(m);
    for i in 0..m {
        let mut row = Vec::with_capacity(m);
        for j in 0..m {
            row.push(field::inv(&BigUint::from((i + m + j + 1) as u64)));
        }
        a.push(row);
    }
    a
}

fn round_constants(m: usize, rounds: usize) -> Vec<Vec<BigUint>> {
    let total = 2 * rounds * m;
    // FROZEN PROTOCOL CONSTANT — do NOT rebrand. This domain-separation tag seeds
    // the Rescue-Prime round constants; it must stay byte-identical to the TS SDK
    // (sdk/src/rescue.ts) and the committed cross-language vectors. Changing it
    // alters every hash/cipher output and breaks interop with already-encrypted
    // data. Kept as "confide/..." across the Glasel rebrand intentionally.
    let seed = format!("confide/rescue-prime/rc/m={}", m).into_bytes();
    let mut vals: Vec<BigUint> = Vec::with_capacity(total);
    let mut counter: u32 = 0;
    while vals.len() < total {
        let mut buf = seed.clone();
        buf.extend_from_slice(&counter.to_be_bytes());
        let mut hasher = Keccak256::new();
        hasher.update(&buf);
        let h = hasher.finalize();
        vals.push(field::fe_from_bytes_be(&h));
        counter += 1;
    }
    (0..2 * rounds)
        .map(|r| vals[r * m..r * m + m].to_vec())
        .collect()
}

fn mat_mul(mat: &[Vec<BigUint>], vec: &[BigUint]) -> Vec<BigUint> {
    mat.iter()
        .map(|row| {
            let mut acc = BigUint::from(0u32);
            for (j, v) in vec.iter().enumerate() {
                acc = field::add(&acc, &field::mul(&row[j], v));
            }
            acc
        })
        .collect()
}

fn add_vec(a: &[BigUint], b: &[BigUint]) -> Vec<BigUint> {
    a.iter().zip(b).map(|(x, y)| field::add(x, y)).collect()
}
