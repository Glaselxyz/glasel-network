//! Generate N Noise static keypairs for the glaseld `[mpc]` mesh roster.
//!
//!   cargo run -p glasel-mpc --example noise_keygen -- 3
//!
//! Each party's `priv` goes in that node's `glaseld.toml` `[mpc].identity_private_key`;
//! every node's `[mpc].parties[*].pubkey` is the corresponding `pub` (same order on
//! all nodes). Keys are minted with snow's X25519 keygen, matching `SecureTcpNet`.
use glasel_mpc::secure::generate_static_keypair;

fn main() {
    let n: usize = std::env::args()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(3);
    for i in 1..=n {
        let (priv_k, pub_k) = generate_static_keypair();
        println!(
            "party{i}\tpriv={}\tpub={}",
            hex::encode(&priv_k),
            hex::encode(&pub_k)
        );
    }
}
