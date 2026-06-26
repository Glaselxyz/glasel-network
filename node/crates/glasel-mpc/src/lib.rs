//! glasel-mpc — a real (semi-honest, honest-majority) multi-party computation
//! engine for Glasel. Inputs are Shamir-shared across `n` parties; the parties
//! evaluate a compiled arithmetic circuit over the shares with the BGW protocol
//! and open only the output. No single party ever sees a plaintext input or the
//! result.
//!
//! Security model: passive (semi-honest) security against up to `t` colluding
//! parties, with `n ≥ 2t + 1`. This is a genuine distributed MPC — not a
//! single-process simulation — but it is not yet maliciously secure (no cheater
//! detection / authenticated shares). That hardening is the next milestone.
pub mod bgw;
pub mod dkg;
pub mod net;
pub mod secure;
pub mod session;
pub mod shamir;

pub use bgw::MpcError;
pub use net::Net;
pub use shamir::Fe;

use rand::RngCore;

/// Secret-share a list of cleartext inputs for `n` parties at threshold `t`.
/// Returns `per_party[i]` = party `i+1`'s share of each input, in order.
pub fn deal<R: RngCore>(inputs: &[Fe], n: usize, t: usize, rng: &mut R) -> Vec<Vec<Fe>> {
    let mut per_party = vec![Vec::with_capacity(inputs.len()); n];
    for input in inputs {
        let shares = shamir::share(input, n, t, rng);
        for (i, s) in shares.into_iter().enumerate() {
            per_party[i].push(s);
        }
    }
    per_party
}

/// Run the full protocol for one party: evaluate the circuit over shares, then
/// open the outputs. Returns the cleartext outputs (revealed to all parties).
pub fn run_party<N: Net, R: RngCore>(
    circuit: &glasel_circuit::ir::Circuit,
    input_shares: &[Fe],
    net: &N,
    t: usize,
    rng: &mut R,
) -> Vec<Fe> {
    let out_shares = bgw::run_circuit(circuit, input_shares, net, t, rng);
    // Multiplication gates consumed rounds 0..mul_count; open outputs after.
    let base_round = circuit.mul_count() as u64;
    bgw::open_outputs(&out_shares, net, base_round)
}

/// Like [`run_party`] but opens the result with cheating detection
/// (security with abort): aborts if any party's share is inconsistent with the
/// honest-majority polynomial.
pub fn run_party_checked<N: Net, R: RngCore>(
    circuit: &glasel_circuit::ir::Circuit,
    input_shares: &[Fe],
    net: &N,
    t: usize,
    rng: &mut R,
) -> Result<Vec<Fe>, MpcError> {
    let out_shares = bgw::run_circuit(circuit, input_shares, net, t, rng);
    let base_round = circuit.mul_count() as u64;
    bgw::open_outputs_checked(&out_shares, net, base_round, t)
}
