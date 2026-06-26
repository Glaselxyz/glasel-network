//! Semi-honest BGW protocol over Shamir shares.
//!
//! Each party holds one share of every wire. Linear gates are local; a
//! multiplication runs one communication round: every party locally multiplies
//! its two input shares (a share on a degree-`2t` polynomial), re-shares that
//! product with a fresh degree-`t` polynomial, and the parties combine the
//! re-shares with Lagrange coefficients to obtain a fresh degree-`t` sharing of
//! the product. With `n ≥ 2t + 1` this is correct and (against ≤ t passive
//! corruptions) private.
use crate::net::Net;
use crate::shamir::{self, Fe};
use glasel_circuit::ir::{Circuit, Gate};
use glasel_crypto::field as F;
use num_bigint::BigUint;
use rand::RngCore;

/// Evaluate `circuit` over this party's `input_shares`, returning this party's
/// shares of the output wires. `t` is the sharing threshold.
pub fn run_circuit<N: Net, R: RngCore>(
    circuit: &Circuit,
    input_shares: &[Fe],
    net: &N,
    t: usize,
    rng: &mut R,
) -> Vec<Fe> {
    assert_eq!(input_shares.len(), circuit.input_count as usize);
    let mut wires: Vec<Fe> = input_shares.to_vec();
    let mut round: u64 = 0;

    for g in &circuit.gates {
        let v = match g {
            Gate::Add { a, b } => F::add(&wires[*a as usize], &wires[*b as usize]),
            Gate::AddConst { a, c } => F::add(&wires[*a as usize], &F::fe(c)),
            Gate::MulConst { a, c } => F::mul(&wires[*a as usize], &F::fe(c)),
            // A public constant is shared as the degree-0 polynomial ≡ c: every
            // party simply holds c.
            Gate::Const { c } => F::fe(c),
            Gate::Mul { a, b } => {
                let r = mul_gate(&wires[*a as usize], &wires[*b as usize], net, t, round, rng);
                round += 1;
                r
            }
            // BGW is arithmetic-only; comparison/select need bit-decomposition,
            // which only the malicious-secure MASCOT backend provides.
            Gate::Lt { .. } | Gate::Eq { .. } | Gate::Select { .. } => {
                panic!(
                    "comparison/select gates require the MASCOT backend ([malicious] config); \
                     the semi-honest BGW engine is arithmetic-only"
                )
            }
        };
        wires.push(v);
    }

    circuit
        .outputs
        .iter()
        .map(|w| wires[*w as usize].clone())
        .collect()
}

/// One BGW multiplication round, returning this party's share of `a * b`.
fn mul_gate<N: Net, R: RngCore>(
    sa: &Fe,
    sb: &Fe,
    net: &N,
    t: usize,
    round: u64,
    rng: &mut R,
) -> Fe {
    let n = net.n();
    let me = net.id();

    // Local product: a share of a*b on a (non-random) degree-2t polynomial.
    let d = F::mul(sa, sb);

    // Re-share d with a fresh degree-t polynomial; q[j-1] = q(j).
    let q = shamir::share(&d, n, t, rng);

    // Distribute q(j) to party j (keep our own).
    for j in 1..=n {
        if j != me {
            net.send(j, round, q[j - 1].clone());
        }
    }

    // new_share(me) = Σ_m λ_m · q_m(me), where λ_m reduces the degree-2t product
    // polynomial back to a*b at x = 0 using all n evaluation points.
    let xs = shamir::party_xs(n);
    let mut acc = BigUint::from(0u64);
    for m in 1..=n {
        let qm_me = if m == me {
            q[me - 1].clone()
        } else {
            net.recv(m, round)
        };
        let lambda = shamir::lagrange_at_zero(&xs, m - 1);
        acc = F::add(&acc, &F::mul(&lambda, &qm_me));
    }
    acc
}

/// Open output shares among all parties and reconstruct the cleartext outputs.
/// Each party broadcasts its output shares (on a dedicated round band) and
/// reconstructs from all `n`.
pub fn open_outputs<N: Net>(my_output_shares: &[Fe], net: &N, base_round: u64) -> Vec<Fe> {
    let n = net.n();
    let me = net.id();
    let xs = shamir::party_xs(n);

    let mut results = Vec::with_capacity(my_output_shares.len());
    for (k, share) in my_output_shares.iter().enumerate() {
        let round = base_round + k as u64;
        for j in 1..=n {
            if j != me {
                net.send(j, round, share.clone());
            }
        }
        let ys: Vec<Fe> = (1..=n)
            .map(|m| {
                if m == me {
                    share.clone()
                } else {
                    net.recv(m, round)
                }
            })
            .collect();
        results.push(shamir::reconstruct(&xs, &ys));
    }
    results
}

/// A detected protocol violation (a party sent shares inconsistent with the
/// honest majority's polynomial). The honest protocol aborts.
#[derive(Debug, PartialEq, Eq)]
pub enum MpcError {
    CheatingDetected,
}

impl std::fmt::Display for MpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "MPC abort: cheating detected during opening")
    }
}
impl std::error::Error for MpcError {}

/// Robust output opening (security with abort). Collects all `n` shares and
/// reconstructs each output with [`shamir::reconstruct_checked`]; if any party's
/// share is off the honest-majority polynomial the open aborts with
/// [`MpcError::CheatingDetected`] instead of returning a forged result.
pub fn open_outputs_checked<N: Net>(
    my_output_shares: &[Fe],
    net: &N,
    base_round: u64,
    t: usize,
) -> Result<Vec<Fe>, MpcError> {
    let n = net.n();
    let me = net.id();
    let xs = shamir::party_xs(n);

    let mut results = Vec::with_capacity(my_output_shares.len());
    for (k, share) in my_output_shares.iter().enumerate() {
        let round = base_round + k as u64;
        for j in 1..=n {
            if j != me {
                net.send(j, round, share.clone());
            }
        }
        let ys: Vec<Fe> = (1..=n)
            .map(|m| {
                if m == me {
                    share.clone()
                } else {
                    net.recv(m, round)
                }
            })
            .collect();
        let v = shamir::reconstruct_checked(&xs, &ys, t).ok_or(MpcError::CheatingDetected)?;
        results.push(v);
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::net::InMemoryNet;
    use glasel_crypto::field as F;
    use num_bigint::BigUint;
    use rand::rngs::StdRng;
    use rand::SeedableRng;
    use std::thread;

    #[test]
    fn checked_open_detects_a_lying_party() {
        // Shares of 7000 (degree 1, n = 3).
        let mut rng = StdRng::seed_from_u64(3);
        let shares = shamir::share(&BigUint::from(7000u64), 3, 1, &mut rng);
        let nets = InMemoryNet::mesh(3);

        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                let my = shares[i].clone();
                thread::spawn(move || -> Result<Vec<Fe>, MpcError> {
                    if net.id() == 3 {
                        // Malicious: broadcast a corrupted share, then bail.
                        let bad = F::add(&my, &BigUint::from(1u64));
                        for j in 1..=3 {
                            if j != 3 {
                                net.send(j, 0, bad.clone());
                            }
                        }
                        Ok(vec![])
                    } else {
                        open_outputs_checked(&[my], &net, 0, 1)
                    }
                })
            })
            .collect();
        let results: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();

        // Both honest parties must detect the cheat and abort.
        assert_eq!(results[0], Err(MpcError::CheatingDetected));
        assert_eq!(results[1], Err(MpcError::CheatingDetected));
    }

    #[test]
    fn checked_open_accepts_honest_shares() {
        let mut rng = StdRng::seed_from_u64(4);
        let shares = shamir::share(&BigUint::from(7000u64), 3, 1, &mut rng);
        let nets = InMemoryNet::mesh(3);

        let handles: Vec<_> = nets
            .into_iter()
            .enumerate()
            .map(|(i, net)| {
                let my = shares[i].clone();
                thread::spawn(move || open_outputs_checked(&[my], &net, 0, 1))
            })
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), Ok(vec![BigUint::from(7000u64)]));
        }
    }
}
