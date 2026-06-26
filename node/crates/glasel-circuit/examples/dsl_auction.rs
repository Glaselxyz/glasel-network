//! Author a confidential circuit in plain Rust with the Arcis-style DSL, then
//! optimize + serialize it to the binary the GlaselOS node executes.
//!
//!   cargo run -p glasel-circuit --example dsl_auction
//!
//! This is the Rust authoring path (vs. the JSON format `glaselvm new` scaffolds):
//! you write the confidential function with ordinary operators and comparisons,
//! and `build()` hands back the same `Circuit` IR everything else consumes.
use glasel_circuit::{evaluate, optimize, serialize, Program};
use num_bigint::BigUint;

fn main() {
    // Sealed-bid auction settlement, as a confidential function of two private
    // inputs: the bid (party 0) and the seller's reserve price (party 1).
    //
    //   payout = (bid < reserve) ? 0 : bid
    //
    // Below reserve the bid is rejected (pays 0); at/above reserve it stands.
    let (p, [bid, reserve]) = Program::new::<2>();
    let below_reserve = bid.lt(&reserve);
    let zero = p.constant(BigUint::from(0u32));
    let payout = below_reserve.select(&zero, &bid);
    let circuit = p.build([payout]);

    // The DSL produced ordinary circuit IR — optimize and serialize it exactly
    // like compiler output.
    let optimized = optimize(&circuit);
    let bytes = serialize(&optimized);

    println!("authored 'sealed-bid auction' via the Rust DSL");
    println!(
        "  gates: {} ({} multiply-equivalent), serialized: {} bytes",
        optimized.gates.len(),
        optimized.mul_count(),
        bytes.len()
    );

    // Run it in the clear over a few scenarios (the node does this under MPC).
    for (b, r) in [(150u64, 100u64), (90, 100), (100, 100)] {
        let out = evaluate(&circuit, &[BigUint::from(b), BigUint::from(r)]).unwrap();
        println!("  bid={b:<4} reserve={r:<4} → payout {}", out[0]);
    }
}
