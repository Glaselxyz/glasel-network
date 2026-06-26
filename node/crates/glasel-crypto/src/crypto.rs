//! X25519 ECDH + high-level encrypt/decrypt/seal and the `encInputs`/`encResult`
//! wire format (mirrors `x25519.ts`, `crypto.ts`, `codec.ts`).
use crate::{field, rescue};
use num_bigint::BigUint;
use rand::rngs::OsRng;
use x25519_dalek::{PublicKey, StaticSecret};

/// Decoded encrypted payload (ephemeral pubkey + nonce + ciphertext field elems).
#[derive(Clone, Debug)]
pub struct Payload {
    pub ephemeral_public_key: [u8; 32],
    pub nonce: [u8; 16],
    pub ciphertext: Vec<BigUint>,
}

/// ECDH shared secret reduced into F_p (big-endian interpretation, matching the SDK).
pub fn shared_secret_fe(private_key: &[u8; 32], peer_public: &[u8; 32]) -> BigUint {
    let secret = StaticSecret::from(*private_key);
    let peer = PublicKey::from(*peer_public);
    let ss = secret.diffie_hellman(&peer);
    BigUint::from_bytes_be(ss.as_bytes()) % field::p()
}

pub fn public_key_from_private(private_key: &[u8; 32]) -> [u8; 32] {
    let secret = StaticSecret::from(*private_key);
    PublicKey::from(&secret).to_bytes()
}

pub fn generate_keypair() -> ([u8; 32], [u8; 32]) {
    let secret = StaticSecret::random_from_rng(OsRng);
    let public = PublicKey::from(&secret);
    (secret.to_bytes(), public.to_bytes())
}

/// Encrypt plaintext field elements to a recipient public key (random ephemeral).
pub fn encrypt(plaintext: &[BigUint], recipient_public: &[u8; 32]) -> Payload {
    let mut nonce = [0u8; 16];
    rand::Rng::fill(&mut OsRng, &mut nonce);
    encrypt_with_nonce(plaintext, recipient_public, nonce)
}

pub fn encrypt_with_nonce(
    plaintext: &[BigUint],
    recipient_public: &[u8; 32],
    nonce: [u8; 16],
) -> Payload {
    let eph_secret = StaticSecret::random_from_rng(OsRng);
    let eph_public = PublicKey::from(&eph_secret).to_bytes();
    let secret = shared_secret_fe(&eph_secret.to_bytes(), recipient_public);
    let key = rescue::derive_key(&secret);
    let nonce_fe = BigUint::from_bytes_be(&nonce);
    let ciphertext = rescue::ctr_encrypt(plaintext, &key, &nonce_fe);
    Payload {
        ephemeral_public_key: eph_public,
        nonce,
        ciphertext,
    }
}

/// `seal` is `encrypt`, named for the re-encryption intent (§6.4).
pub use self::encrypt as seal;

/// Decrypt a payload with the recipient's private key.
pub fn decrypt(payload: &Payload, recipient_private: &[u8; 32]) -> Vec<BigUint> {
    let secret = shared_secret_fe(recipient_private, &payload.ephemeral_public_key);
    let key = rescue::derive_key(&secret);
    let nonce_fe = BigUint::from_bytes_be(&payload.nonce);
    rescue::ctr_decrypt(&payload.ciphertext, &key, &nonce_fe)
}

// ─── wire format: [ ephemeralPub(32) | nonce(16) | ciphertext(32*n) ] ──────────

pub fn serialize_payload(p: &Payload) -> Vec<u8> {
    let mut out = Vec::with_capacity(48 + p.ciphertext.len() * 32);
    out.extend_from_slice(&p.ephemeral_public_key);
    out.extend_from_slice(&p.nonce);
    for fe in &p.ciphertext {
        out.extend_from_slice(&field::fe_to_bytes_be(fe));
    }
    out
}

pub fn deserialize_payload(bytes: &[u8]) -> Result<Payload, String> {
    if bytes.len() < 48 || (bytes.len() - 48) % 32 != 0 {
        return Err(format!("malformed payload: {} bytes", bytes.len()));
    }
    let mut ephemeral_public_key = [0u8; 32];
    ephemeral_public_key.copy_from_slice(&bytes[0..32]);
    let mut nonce = [0u8; 16];
    nonce.copy_from_slice(&bytes[32..48]);
    let ciphertext = bytes[48..]
        .chunks_exact(32)
        .map(field::fe_from_bytes_be)
        .collect();
    Ok(Payload {
        ephemeral_public_key,
        nonce,
        ciphertext,
    })
}
