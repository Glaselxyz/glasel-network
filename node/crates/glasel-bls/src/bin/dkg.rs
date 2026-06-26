//! bls-dkg — run the Feldman-VSS DKG (no trusted dealer) and print the group
//! key + a threshold-combined signature, as ABI-friendly bytes for Foundry FFI.
//!
//!   bls-dkg <seed> <n> <t> <message_hex>
//!
//! Deterministic in `seed` so two invocations (one to register the group key,
//! one to sign a message) reproduce the SAME group key. Output: 0x-prefixed
//! concatenation of six 32-byte big-endian words
//!   [pk.x.c1, pk.x.c0, pk.y.c1, pk.y.c0, sig.x, sig.y]
use glasel_bls::bls::{combine, fq_to_biguint, hash_to_g1, partial_sign};
use glasel_bls::dkg::run_local;
use num_bigint::BigUint;
use rand::rngs::StdRng;
use rand::SeedableRng;

fn be32(x: &BigUint) -> [u8; 32] {
    let b = x.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - b.len()..].copy_from_slice(&b);
    out
}

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let seed: u64 = a.get(1).expect("seed").parse().expect("seed u64");
    let n: usize = a.get(2).expect("n").parse().expect("n");
    let t: usize = a.get(3).expect("t").parse().expect("t");
    let msg = hex::decode(a.get(4).expect("message_hex").trim_start_matches("0x")).expect("hex");

    let mut rng = StdRng::seed_from_u64(seed);
    // Trustless DKG → group public key + one secret share per party.
    let (pk, shares) = run_local(n, t, &mut rng);

    // Threshold-sign with the first t+1 parties' shares and combine.
    let h = hash_to_g1(&msg);
    let ids: Vec<u64> = (1..=(t as u64 + 1)).collect();
    let partials: Vec<_> = ids
        .iter()
        .map(|&i| partial_sign(shares[i as usize - 1], h))
        .collect();
    let sig = combine(&ids, &partials);

    let words: [BigUint; 6] = [
        fq_to_biguint(&pk.x.c1),
        fq_to_biguint(&pk.x.c0),
        fq_to_biguint(&pk.y.c1),
        fq_to_biguint(&pk.y.c0),
        fq_to_biguint(&sig.x),
        fq_to_biguint(&sig.y),
    ];
    let mut out = Vec::with_capacity(192);
    for w in &words {
        out.extend_from_slice(&be32(w));
    }
    println!("0x{}", hex::encode(out));
}
