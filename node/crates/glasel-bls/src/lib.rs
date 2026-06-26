//! glasel-bls — real threshold BLS signatures on BN254, verifiable on-chain via
//! the `ecPairing` precompile. Replaces the Phase-1 ECDSA threshold stand-in.
pub mod bls;
pub mod dkg;

pub use bls::{combine, group_pk, hash_to_g1, partial_sign, share_sk, verify};
pub use dkg::{aggregate_share, deal, group_public_key, run_local, verify_share, Dealing};
pub use dkg::{
    deal_pedersen, group_public_key_pedersen, run_local_pedersen, verify_feldman_reveal,
    verify_pedersen_share, PedersenDealing,
};
