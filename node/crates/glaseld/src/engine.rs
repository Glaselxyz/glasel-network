//! Simulated MPC engine.
//!
//! PHASE-3 NOTE. A real cluster runs Cerberus/Manticore so that no single node
//! ever holds the cluster key or sees plaintext. This engine *models* the
//! cluster as one process holding the (DKG-combined) X25519 key: it decrypts the
//! inputs, evaluates a circuit, and re-seals the result to the recipient — using
//! the real Glasel encryption stack, so the on-chain + SDK flow is genuinely
//! end-to-end. Swapping in true MPC replaces only this module.
use glasel_circuit::{deserialize as deserialize_circuit, evaluate};
use glasel_crypto::{decrypt, deserialize_payload, field_pair_to_pubkey, seal, serialize_payload};

pub struct Engine {
    cluster_private_key: [u8; 32],
}

impl Engine {
    pub fn new(cluster_private_key: [u8; 32]) -> Self {
        Self {
            cluster_private_key,
        }
    }

    /// Decrypt inputs, evaluate the compiled circuit, and re-seal the result to
    /// the requester. The sealed inputs carry the requester's X25519 recipient
    /// key as the first two field elements (see `glasel_crypto::pubkey_to_field_pair`),
    /// so each developer's result is sealed to *their* key and only they can
    /// decrypt it. The remaining field elements are the circuit inputs.
    /// `circuit_bytecode` is fetched from the ComputationRegistry; if empty, the
    /// circuit inputs are echoed back.
    pub fn run(&self, circuit_bytecode: &[u8], enc_inputs: &[u8]) -> anyhow::Result<Vec<u8>> {
        let payload = deserialize_payload(enc_inputs).map_err(|e| anyhow::anyhow!(e))?;
        let decrypted = decrypt(&payload, &self.cluster_private_key);
        if decrypted.len() < 2 {
            anyhow::bail!(
                "sealed inputs missing recipient-key prefix (need >= 2 field elements, got {})",
                decrypted.len()
            );
        }
        let recipient = field_pair_to_pubkey(&decrypted[0], &decrypted[1]);
        let circuit_inputs = &decrypted[2..];

        let outputs = if circuit_bytecode.is_empty() {
            circuit_inputs.to_vec() // echo fallback
        } else {
            let circuit = deserialize_circuit(circuit_bytecode).map_err(|e| anyhow::anyhow!(e))?;
            evaluate(&circuit, circuit_inputs).map_err(|e| anyhow::anyhow!(e))?
        };

        let sealed = seal(&outputs, &recipient);
        Ok(serialize_payload(&sealed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glasel_circuit::{serialize as serialize_circuit, Builder};
    use glasel_crypto::{
        decrypt as crypto_decrypt, deserialize_payload as de_payload, encrypt, generate_keypair,
        pubkey_to_field_pair,
    };
    use num_bigint::BigUint;

    #[test]
    fn result_is_sealed_to_the_per_job_requester_not_a_fixed_key() {
        // Cluster keypair (the node holds the private half).
        let (cluster_priv, cluster_pub) = generate_keypair();
        // The requester's own keypair — only they hold this private key.
        let (req_priv, req_pub) = generate_keypair();

        // Circuit: out = a * b  (order notional).
        let mut b = Builder::new(2);
        let (x, y) = (b.input(0), b.input(1));
        let m = b.mul(x, y);
        let circuit = b.finish(vec![m]);
        let bytecode = serialize_circuit(&circuit);

        // Inputs sealed to the cluster: [recip_hi, recip_lo, a, b].
        let [hi, lo] = pubkey_to_field_pair(&req_pub);
        let plaintext = vec![hi, lo, BigUint::from(1000u32), BigUint::from(7u32)];
        let enc_inputs =
            glasel_crypto::serialize_payload(&encrypt(&plaintext, &cluster_pub));

        let engine = Engine::new(cluster_priv);
        let enc_result = engine.run(&bytecode, &enc_inputs).unwrap();

        // The requester decrypts the result with THEIR private key.
        let out = crypto_decrypt(&de_payload(&enc_result).unwrap(), &req_priv);
        assert_eq!(out, vec![BigUint::from(7000u32)], "1000 * 7 = 7000");

        // A different key (e.g. the cluster's own) must NOT decrypt to the result.
        let wrong = crypto_decrypt(&de_payload(&enc_result).unwrap(), &cluster_priv);
        assert_ne!(wrong, vec![BigUint::from(7000u32)], "only the requester can read it");
    }
}
