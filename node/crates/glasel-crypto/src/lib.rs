//! glasel-crypto — the Glasel encryption stack (F_p arithmetic, Rescue-Prime
//! cipher/KDF, X25519 ECDH, encrypt/seal) reimplemented in Rust to byte-for-byte
//! match the `@glasel/client` TypeScript SDK, so the GlaselOS node and clients
//! interoperate.

pub mod crypto;
pub mod field;
pub mod rescue;

pub use crypto::{
    decrypt, deserialize_payload, encrypt, generate_keypair, public_key_from_private, seal,
    serialize_payload, shared_secret_fe, Payload,
};
