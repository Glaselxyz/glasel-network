//! Chain-driven MPC session orchestrator.
//!
//! On a `ComputationRequested` event this node joins the cluster as one BGW
//! party over the authenticated, encrypted Noise mesh (`SecureTcpNet`): it
//! handshakes every peer against the on-chain-registered roster, obtains its
//! secret shares of the inputs (the dealer recovers + shares the plaintext; peers
//! receive only their shares over the encrypted mesh), evaluates the circuit over
//! shares, opens the result, and re-seals it to the recipient — producing the
//! same `encResult` bytes the single-process engine would, so the submit path is
//! unchanged. No peer ever sees a plaintext input.
//!
//! Simulation boundary (documented, unchanged from `engine.rs`): the dealer
//! recovers the plaintext by decrypting with the cluster key. In production that
//! decryption is itself an MPC step (MP-SPDZ), so not even the dealer sees the
//! plaintext. Everything else here — transport, authentication, share-based
//! evaluation, opening — is real.
use crate::config::Mpc;
use glasel_circuit::deserialize as deserialize_circuit;
use glasel_crypto::{decrypt, deserialize_payload, field_pair_to_pubkey, seal, serialize_payload};
use glasel_mpc::net::SecureTcpNet;
use glasel_mpc::session::{distribute_inputs, receive_inputs};
use glasel_mpc::{run_party, Fe};

pub struct MpcSession {
    cfg: Mpc,
    /// Used only by the dealer to recover the plaintext inputs.
    cluster_key: [u8; 32],
    recipient_key: [u8; 32],
}

impl MpcSession {
    pub fn new(cfg: Mpc, cluster_key: [u8; 32], recipient_key: [u8; 32]) -> Self {
        Self {
            cfg,
            cluster_key,
            recipient_key,
        }
    }

    /// Run one computation as this node's party. Returns the `encResult` bytes
    /// for `submitResult`. Blocks until the whole cluster's mesh is up.
    pub fn run(&self, circuit_bytecode: &[u8], enc_inputs: &[u8]) -> anyhow::Result<Vec<u8>> {
        let circuit = deserialize_circuit(circuit_bytecode).map_err(|e| anyhow::anyhow!(e))?;
        let n = self.cfg.parties.len();
        let t = self.cfg.threshold;

        // Stand up the authenticated, encrypted mesh against the roster.
        let addrs: Vec<String> = self.cfg.parties.iter().map(|p| p.addr.clone()).collect();
        let peer_pks: Vec<Vec<u8>> = self
            .cfg
            .parties
            .iter()
            .map(|p| hex::decode(p.pubkey.trim_start_matches("0x")))
            .collect::<Result<_, _>>()?;
        let id_priv = hex::decode(self.cfg.identity_private_key.trim_start_matches("0x"))?;
        let net = SecureTcpNet::connect(self.cfg.party_id, n, addrs, &id_priv, &peer_pks)
            .map_err(|e| anyhow::anyhow!("secure mesh connect: {e}"))?;

        let mut rng = rand::thread_rng();

        // Obtain this party's input shares over the encrypted mesh. The dealer
        // decrypts the on-chain ciphertext, peels the requester's X25519 recipient
        // key (carried as the first two field elements, like the single-process
        // engine), and secret-shares only the circuit inputs.
        let mut recipient: Option<[u8; 32]> = None;
        let my_shares: Vec<Fe> = if self.cfg.party_id == self.cfg.dealer_id {
            let payload = deserialize_payload(enc_inputs).map_err(|e| anyhow::anyhow!(e))?;
            let decrypted = decrypt(&payload, &self.cluster_key);
            if decrypted.len() < 2 {
                anyhow::bail!(
                    "sealed inputs missing recipient-key prefix (need >= 2 field elements, got {})",
                    decrypted.len()
                );
            }
            recipient = Some(field_pair_to_pubkey(&decrypted[0], &decrypted[1]));
            distribute_inputs(&net, &decrypted[2..], n, t, &mut rng)
        } else {
            receive_inputs(&net, self.cfg.dealer_id, circuit.input_count as usize)
        };

        // Evaluate the circuit over shares and open the result. Seal to the per-job
        // recipient: the submitter is the dealer (it decrypted the inputs), so the
        // submitted result is sealed to the requester and only they can decrypt it.
        // Non-dealer parties don't submit, so their config fallback is unused.
        let outputs: Vec<Fe> = run_party(&circuit, &my_shares, &net, t, &mut rng);
        let recipient_key = recipient.unwrap_or(self.recipient_key);
        let sealed = seal(&outputs, &recipient_key);
        Ok(serialize_payload(&sealed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{Mpc, Party};
    use glasel_circuit::ir::{Circuit, Gate};
    use glasel_circuit::serialize as serialize_circuit;
    use glasel_crypto::{generate_keypair, pubkey_to_field_pair};
    use glasel_mpc::secure::generate_static_keypair;
    use num_bigint::BigUint;
    use std::sync::Arc;
    use std::thread;

    /// End-to-end: an on-chain `encInputs` ciphertext drives a real 3-party BGW
    /// computation over the authenticated, encrypted mesh. The dealer recovers +
    /// shares the inputs; peers (handed a zero cluster key to prove they never
    /// decrypt) compute on shares received over the mesh. The sealed result must
    /// decrypt to price*quantity.
    #[test]
    fn chain_task_runs_over_secure_mesh_and_seals() {
        let ids: Vec<(Vec<u8>, Vec<u8>)> = (0..3).map(|_| generate_static_keypair()).collect();
        let parties: Vec<Party> = (0..3)
            .map(|i| Party {
                addr: format!("127.0.0.1:{}", 18200 + i),
                pubkey: hex::encode(&ids[i].1),
            })
            .collect();

        let (cluster_priv, cluster_pub) = generate_keypair();
        let (recipient_priv, recipient_pub) = generate_keypair();

        // The on-chain encInputs: the requester's recipient key (2 field elements)
        // prepended to the circuit inputs, all sealed to the cluster key — exactly
        // what the SDK's client.encrypt produces with recipientPublicKey.
        let [hi, lo] = pubkey_to_field_pair(&recipient_pub);
        let inputs = vec![hi, lo, BigUint::from(1000u64), BigUint::from(7u64)];
        let enc_inputs = Arc::new(serialize_payload(&seal(&inputs, &cluster_pub)));

        let circuit = Circuit {
            input_count: 2,
            gates: vec![Gate::Mul { a: 0, b: 1 }],
            outputs: vec![2],
        };
        let bytecode = Arc::new(serialize_circuit(&circuit));
        let parties = Arc::new(parties);

        let handles: Vec<_> = (1..=3usize)
            .map(|id| {
                let cfg = Mpc {
                    party_id: id,
                    dealer_id: 1,
                    threshold: 1,
                    identity_private_key: hex::encode(&ids[id - 1].0),
                    parties: (*parties).clone(),
                    submitter: id == 1,
                };
                // Only the dealer holds the cluster key; peers get a zero key.
                let cluster_key = if id == 1 { cluster_priv } else { [0u8; 32] };
                let session = MpcSession::new(cfg, cluster_key, recipient_pub);
                let (bytecode, enc_inputs) = (Arc::clone(&bytecode), Arc::clone(&enc_inputs));
                thread::spawn(move || session.run(&bytecode, &enc_inputs).unwrap())
            })
            .collect();

        let results: Vec<Vec<u8>> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        // Every node opens the same result; decrypt the submitter's with the key.
        let payload = deserialize_payload(&results[0]).unwrap();
        let outputs = decrypt(&payload, &recipient_priv);
        assert_eq!(
            outputs,
            vec![BigUint::from(7000u64)],
            "chain-driven secure MPC must seal price*quantity"
        );
    }
}
