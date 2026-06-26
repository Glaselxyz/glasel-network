//! Simulated MPC engine.
//!
//! PHASE-3 NOTE. A real cluster runs Cerberus/Manticore so that no single node
//! ever holds the cluster key or sees plaintext. This engine *models* the
//! cluster as one process holding the (DKG-combined) X25519 key: it decrypts the
//! inputs, evaluates a circuit, and re-seals the result to the recipient — using
//! the real Glasel encryption stack, so the on-chain + SDK flow is genuinely
//! end-to-end. Swapping in true MPC replaces only this module.
use glasel_circuit::{deserialize as deserialize_circuit, evaluate};
use glasel_crypto::{decrypt, deserialize_payload, seal, serialize_payload};

pub struct Engine {
    cluster_private_key: [u8; 32],
    recipient_public_key: [u8; 32],
}

impl Engine {
    pub fn new(cluster_private_key: [u8; 32], recipient_public_key: [u8; 32]) -> Self {
        Self {
            cluster_private_key,
            recipient_public_key,
        }
    }

    /// Decrypt inputs, evaluate the compiled circuit over them, and re-seal the
    /// result to the recipient. Returns the `encResult` bytes for submitResult().
    /// `circuit_bytecode` is the serialized arithmetic circuit fetched from the
    /// ComputationRegistry; if empty, falls back to the identity ("echo").
    pub fn run(&self, circuit_bytecode: &[u8], enc_inputs: &[u8]) -> anyhow::Result<Vec<u8>> {
        let payload = deserialize_payload(enc_inputs).map_err(|e| anyhow::anyhow!(e))?;
        let inputs = decrypt(&payload, &self.cluster_private_key);

        let outputs = if circuit_bytecode.is_empty() {
            inputs // echo fallback
        } else {
            let circuit = deserialize_circuit(circuit_bytecode).map_err(|e| anyhow::anyhow!(e))?;
            evaluate(&circuit, &inputs).map_err(|e| anyhow::anyhow!(e))?
        };

        let sealed = seal(&outputs, &self.recipient_public_key);
        Ok(serialize_payload(&sealed))
    }
}
