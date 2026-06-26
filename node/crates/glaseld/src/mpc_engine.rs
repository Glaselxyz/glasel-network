//! Real-MPC compute backend (wires in `glasel-mpc`).
//!
//! The simulated [`crate::engine::Engine`] decrypts inputs and evaluates a
//! circuit in one process. This backend instead runs the node as a *party* in a
//! BGW computation: it holds only secret shares of the inputs, evaluates the
//! circuit over shares with its peers (`glasel-mpc`), opens the result, and
//! re-seals it to the recipient — so no node ever sees a plaintext input.
//!
//! Selected via config `engine.mode = "mpc"`. The daemon's multi-process
//! orchestration (peer dialing, input dealing) reuses `glasel-mpc`'s `TcpNet`;
//! the compute itself is this function.
use glasel_circuit::deserialize as deserialize_circuit;
use glasel_crypto::{seal, serialize_payload};
use glasel_mpc::{net::Net, run_party, Fe};

/// Run one MPC computation as a party: evaluate the circuit over `input_shares`
/// with `net`, open the outputs, and re-seal to the recipient. Returns the
/// `encResult` bytes for `submitResult` — identical in shape to the simulated
/// engine's output, so the on-chain path is unchanged.
#[allow(dead_code)] // wired + tested; daemon main loop selects it once MPC mode lands
pub fn run_mpc_party<N: Net>(
    circuit_bytecode: &[u8],
    input_shares: &[Fe],
    net: &N,
    threshold: usize,
    recipient_public_key: &[u8; 32],
) -> anyhow::Result<Vec<u8>> {
    let circuit = deserialize_circuit(circuit_bytecode).map_err(|e| anyhow::anyhow!(e))?;
    let mut rng = rand::thread_rng();
    let outputs: Vec<Fe> = run_party(&circuit, input_shares, net, threshold, &mut rng);
    let sealed = seal(&outputs, recipient_public_key);
    Ok(serialize_payload(&sealed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use glasel_circuit::ir::{Circuit, Gate};
    use glasel_circuit::serialize as serialize_circuit;
    use glasel_crypto::{decrypt, deserialize_payload, generate_keypair};
    use glasel_mpc::{deal, net::InMemoryNet};
    use num_bigint::BigUint;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn glaseld_mpc_backend_computes_and_seals() {
        // order_notional: price * quantity
        let circuit = Circuit {
            input_count: 2,
            gates: vec![Gate::Mul { a: 0, b: 1 }],
            outputs: vec![2],
        };
        let bytecode = serialize_circuit(&circuit);
        let (recipient_priv, recipient_pub) = generate_keypair();

        let mut rng = StdRng::seed_from_u64(5);
        let per_party = deal(
            &[BigUint::from(1000u64), BigUint::from(7u64)],
            3,
            1,
            &mut rng,
        );
        let nets = InMemoryNet::mesh(3);
        let bc = Arc::new(bytecode);

        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                let shares = per_party[i].clone();
                let bc = Arc::clone(&bc);
                thread::spawn(move || run_mpc_party(&bc, &shares, &net, 1, &recipient_pub).unwrap())
            })
            .collect();
        let sealed: Vec<Vec<u8>> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // Every party seals the same opened result; decrypt one with the key.
        let payload = deserialize_payload(&sealed[0]).unwrap();
        let outputs = decrypt(&payload, &recipient_priv);
        assert_eq!(
            outputs,
            vec![BigUint::from(7000u64)],
            "GlaselOS MPC backend must seal price*quantity"
        );
    }
}
