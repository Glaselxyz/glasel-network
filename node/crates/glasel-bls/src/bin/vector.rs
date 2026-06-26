//! Generate a cross-language BLS test vector: a threshold signature + group key
//! the Solidity `BLS.sol` verifier (and Foundry test) consume. G2 is emitted in
//! the ecPairing precompile coordinate order [x.c1, x.c0, y.c1, y.c0].
use ark_bn254::Fr;
use ark_std::UniformRand;
use glasel_bls::bls::{
    combine, fq_to_biguint, group_pk, hash_to_g1, partial_sign, share_sk, verify,
};
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::fs;

fn main() {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "bls_vector.json".to_string());

    let mut rng = StdRng::seed_from_u64(2026);
    let sk = Fr::rand(&mut rng);
    let pk = group_pk(sk);
    let (n, t) = (3usize, 1usize);
    let shares = share_sk(sk, n, t, &mut rng);

    let message: &[u8] = b"confide:threshold-bls|computationId|encResult";
    let h = hash_to_g1(message);

    // Threshold subset {1, 2} (t + 1 = 2 signers).
    let ids = [1u64, 2];
    let partials: Vec<_> = ids
        .iter()
        .map(|&i| partial_sign(shares[i as usize - 1], h))
        .collect();
    let sig = combine(&ids, &partials);
    assert!(verify(message, sig, pk), "vector self-check failed");

    let hx = |b: num_bigint::BigUint| format!("0x{}", b.to_str_radix(16));
    let doc = serde_json::json!({
        "message": format!("0x{}", hex::encode(message)),
        "sig": {
            "x": hx(fq_to_biguint(&sig.x)),
            "y": hx(fq_to_biguint(&sig.y)),
        },
        // ecPairing G2 order: [x.c1, x.c0, y.c1, y.c0]
        "pk": [
            hx(fq_to_biguint(&pk.x.c1)),
            hx(fq_to_biguint(&pk.x.c0)),
            hx(fq_to_biguint(&pk.y.c1)),
            hx(fq_to_biguint(&pk.y.c0)),
        ],
        "note": "threshold BLS on BN254; verify e(sig,G2)==e(H(message),pk)"
    });

    fs::write(&out, serde_json::to_vec_pretty(&doc).unwrap()).expect("write vector");
    println!("wrote BLS vector → {out}");
    println!("{}", serde_json::to_string_pretty(&doc).unwrap());
}
