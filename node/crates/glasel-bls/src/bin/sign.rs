//! bls-sign — sign a message with a (group) secret key and print the group key
//! + signature as ABI-friendly bytes for Foundry FFI.
//!
//!   bls-sign <sk_decimal> <message_hex>
//!
//! Output: 0x-prefixed concatenation of six 32-byte big-endian words
//!   [pk.x.c1, pk.x.c0, pk.y.c1, pk.y.c0, sig.x, sig.y]
//! which `abi.decode(out, (uint256,uint256,uint256,uint256,uint256,uint256))`
//! reads directly. `sig = sk·H(message)` equals the threshold-combined signature.
use ark_bn254::Fr;
use ark_ff::PrimeField;
use glasel_bls::bls::{fq_to_biguint, group_pk, hash_to_g1, partial_sign};
use num_bigint::BigUint;
use num_traits::Num;

fn be32(x: &BigUint) -> [u8; 32] {
    let b = x.to_bytes_be();
    let mut out = [0u8; 32];
    out[32 - b.len()..].copy_from_slice(&b);
    out
}

fn main() {
    let sk_dec = std::env::args()
        .nth(1)
        .expect("usage: bls-sign <sk_decimal> <message_hex>");
    let msg_hex = std::env::args()
        .nth(2)
        .expect("usage: bls-sign <sk_decimal> <message_hex>");

    let sk_big = BigUint::from_str_radix(&sk_dec, 10).expect("sk decimal");
    let sk = Fr::from_le_bytes_mod_order(&sk_big.to_bytes_le());

    let msg = hex::decode(msg_hex.trim_start_matches("0x")).expect("message hex");
    let h = hash_to_g1(&msg);
    let sig = partial_sign(sk, h); // sk·H(m) == threshold-combined σ
    let pk = group_pk(sk);

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
