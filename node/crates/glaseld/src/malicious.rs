//! Malicious-secure compute backend (MP-SPDZ MASCOT).
//!
//! The semi-honest [`crate::engine::Engine`] evaluates the circuit in cleartext;
//! the BGW [`crate::mpc_session::MpcSession`] evaluates over shares but is only
//! passively secure. This backend routes the computation through **MASCOT**
//! (authenticated triples + MAC-checked opens) via `glasel_circuit::mpspdz`, so
//! a cheating party is caught (security with abort) — the production-grade path.
//!
//! It returns the same `encResult` bytes as the other backends, so the daemon's
//! submit path is unchanged. In a real cluster each node runs one MASCOT party;
//! this models the cluster locally (all parties on one host) — the same
//! simulation boundary `engine.rs` documents for the cluster key. Requires a
//! built MP-SPDZ (`node/scripts/setup-mpspdz.sh`); selected via `[malicious]` config.
use glasel_circuit::deserialize as deserialize_circuit;
use glasel_circuit::mpspdz::{run_mascot_distributed, MascotRun};
use glasel_crypto::{decrypt, deserialize_payload, seal, serialize_payload};
use std::path::PathBuf;

pub struct MaliciousBackend {
    mpspdz_dir: PathBuf,
    cluster_key: [u8; 32],
    recipient_key: [u8; 32],
    parties: usize,
    host: String,
    port: u16,
}

impl MaliciousBackend {
    pub fn new(
        mpspdz_dir: PathBuf,
        cluster_key: [u8; 32],
        recipient_key: [u8; 32],
        parties: usize,
        host: String,
        port: u16,
    ) -> Self {
        Self {
            mpspdz_dir,
            cluster_key,
            recipient_key,
            parties: parties.max(2),
            host,
            port,
        }
    }

    /// Decrypt inputs, evaluate the circuit under MASCOT, and re-seal the result.
    pub fn run(&self, circuit_bytecode: &[u8], enc_inputs: &[u8]) -> anyhow::Result<Vec<u8>> {
        let circuit = deserialize_circuit(circuit_bytecode).map_err(|e| anyhow::anyhow!(e))?;
        let payload = deserialize_payload(enc_inputs).map_err(|e| anyhow::anyhow!(e))?;
        let inputs = decrypt(&payload, &self.cluster_key);

        // POC: the dealer recovers the inputs and assigns them round-robin across
        // the MASCOT parties. (Production: inputs enter MPC without a single
        // decryptor — the same MP-SPDZ-decryption boundary noted for MpcSession.)
        let input_owner: Vec<usize> = (0..inputs.len()).map(|i| i % self.parties).collect();

        // Distributed: launch one independent MASCOT party process per node
        // (here on `host`, a single-host POC; real per-node IPs in production).
        let outputs = run_mascot_distributed(
            &MascotRun {
                mpspdz_dir: &self.mpspdz_dir,
                program: "glasel_session",
                circuit: &circuit,
                inputs: &inputs,
                input_owner: &input_owner,
                parties: self.parties,
            },
            &self.host,
            self.port,
        )
        .map_err(|e| anyhow::anyhow!("MASCOT backend: {e}"))?;

        Ok(serialize_payload(&seal(&outputs, &self.recipient_key)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use glasel_circuit::ir::{Circuit, Gate};
    use glasel_circuit::serialize as serialize_circuit;
    use glasel_crypto::generate_keypair;
    use num_bigint::BigUint;

    fn mpspdz_dir() -> Option<PathBuf> {
        let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vendor/MP-SPDZ");
        p.join("mascot-party.x").exists().then_some(p)
    }

    #[test]
    fn backend_runs_circuit_under_mascot_and_seals() {
        let Some(dir) = mpspdz_dir() else {
            eprintln!("SKIP: MP-SPDZ not built (node/scripts/setup-mpspdz.sh)");
            return;
        };
        // price * quantity
        let circuit = Circuit {
            input_count: 2,
            gates: vec![Gate::Mul { a: 0, b: 1 }],
            outputs: vec![2],
        };
        let bytecode = serialize_circuit(&circuit);
        let (cluster_priv, cluster_pub) = generate_keypair();
        let (recipient_priv, recipient_pub) = generate_keypair();

        // The on-chain encInputs: inputs sealed to the cluster key.
        let enc_inputs = serialize_payload(&seal(
            &[BigUint::from(1000u64), BigUint::from(7u64)],
            &cluster_pub,
        ));

        let backend = MaliciousBackend::new(
            dir,
            cluster_priv,
            recipient_pub,
            2,
            "localhost".to_string(),
            15600,
        );
        let enc_result = backend
            .run(&bytecode, &enc_inputs)
            .expect("malicious backend run");

        // The sealed result decrypts to price*quantity.
        let outputs = decrypt(&deserialize_payload(&enc_result).unwrap(), &recipient_priv);
        assert_eq!(
            outputs,
            vec![BigUint::from(7000u64)],
            "MASCOT-backed result must seal price*quantity"
        );
    }
}
