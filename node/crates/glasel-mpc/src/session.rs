//! Input distribution for a chain-driven MPC session.
//!
//! Before the parties can evaluate a circuit over shares, each needs its share
//! of the inputs. In this dealer model one node — the only one able to recover
//! the plaintext (in production an MPC decryption of the on-chain ciphertext;
//! today the holder of the cluster key) — secret-shares the inputs and sends
//! each peer its share over the authenticated, encrypted mesh. Peers receive
//! only their shares; no peer ever sees the plaintext. Everyone then runs BGW.
use crate::deal;
use crate::net::Net;
use crate::shamir::Fe;
use rand::RngCore;

/// Reserved round range for input dealing, far above any circuit's gate rounds
/// (which run `0..mul_count`), so dealing never collides with the computation.
const DEAL_ROUND_BASE: u64 = 1 << 40;

/// Dealer side: secret-share `inputs` among `n` parties at threshold `t`, send
/// party `j` its shares over `net`, and return this party's own shares.
pub fn distribute_inputs<N: Net, R: RngCore>(
    net: &N,
    inputs: &[Fe],
    n: usize,
    t: usize,
    rng: &mut R,
) -> Vec<Fe> {
    let me = net.id();
    let per_party = deal(inputs, n, t, rng);
    for j in 1..=n {
        if j == me {
            continue;
        }
        for (k, share) in per_party[j - 1].iter().enumerate() {
            net.send(j, DEAL_ROUND_BASE + k as u64, share.clone());
        }
    }
    per_party[me - 1].clone()
}

/// Peer side: receive this party's `input_count` shares from `dealer`.
pub fn receive_inputs<N: Net>(net: &N, dealer: usize, input_count: usize) -> Vec<Fe> {
    (0..input_count as u64)
        .map(|k| net.recv(dealer, DEAL_ROUND_BASE + k))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::InMemoryNet;
    use crate::run_party;
    use glasel_circuit::ir::{Circuit, Gate};
    use num_bigint::BigUint;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::sync::Arc;
    use std::thread;

    #[test]
    fn dealer_distributes_then_parties_compute() {
        // price * quantity, dealt by party 1, computed by all three over shares.
        let circuit = Arc::new(Circuit {
            input_count: 2,
            gates: vec![Gate::Mul { a: 0, b: 1 }],
            outputs: vec![2],
        });
        let inputs = Arc::new(vec![BigUint::from(1000u64), BigUint::from(7u64)]);
        let nets = InMemoryNet::mesh(3);

        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                let (id, circuit, inputs) = (i + 1, Arc::clone(&circuit), Arc::clone(&inputs));
                thread::spawn(move || {
                    let my_shares = if id == 1 {
                        let mut rng = StdRng::seed_from_u64(7);
                        distribute_inputs(&net, &inputs, 3, 1, &mut rng)
                    } else {
                        receive_inputs(&net, 1, 2)
                    };
                    let mut rng = StdRng::seed_from_u64(100 + id as u64);
                    run_party(&circuit, &my_shares, &net, 1, &mut rng)
                })
            })
            .collect();

        for out in handles.into_iter().map(|h| h.join().unwrap()) {
            assert_eq!(
                out,
                vec![BigUint::from(7000u64)],
                "dealer-distributed MPC must yield price*quantity"
            );
        }
    }
}
