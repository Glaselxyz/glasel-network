//! End-to-end: compile the Glasel circuit IR to MP-SPDZ and run it under MASCOT
//! (malicious-secure), checking the output matches the in-process evaluator.
//!
//! Gated on a built MP-SPDZ: set `MPSPDZ_DIR` or have `node/vendor/MP-SPDZ`
//! present (see `node/scripts/setup-mpspdz.sh`). Skips cleanly otherwise so CI
//! without MP-SPDZ stays green.
use glasel_circuit::dsl::Program;
use glasel_circuit::evaluate;
use glasel_circuit::ir::{Circuit, Gate};
use glasel_circuit::mpspdz::{run_mascot, run_mascot_distributed, MascotRun};
use num_bigint::BigUint;
use std::path::PathBuf;

fn mpspdz_dir() -> Option<PathBuf> {
    if let Ok(d) = std::env::var("MPSPDZ_DIR") {
        let p = PathBuf::from(d);
        return p.join("mascot-party.x").exists().then_some(p);
    }
    // default: the vendored build relative to this crate
    let p = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vendor/MP-SPDZ");
    p.join("mascot-party.x").exists().then_some(p)
}

#[test]
fn mascot_matches_evaluator_on_order_notional() {
    let Some(dir) = mpspdz_dir() else {
        eprintln!("SKIP: MP-SPDZ not built (set MPSPDZ_DIR or run node/scripts/setup-mpspdz.sh)");
        return;
    };

    // price (party 0) * quantity (party 1)
    let circuit = Circuit {
        input_count: 2,
        gates: vec![Gate::Mul { a: 0, b: 1 }],
        outputs: vec![2],
    };
    let inputs = vec![BigUint::from(1000u64), BigUint::from(7u64)];

    let expected = evaluate(&circuit, &inputs).unwrap();
    let got = run_mascot(&MascotRun {
        mpspdz_dir: &dir,
        program: "glasel_e2e",
        circuit: &circuit,
        inputs: &inputs,
        input_owner: &[0, 1],
        parties: 2,
    })
    .expect("MASCOT run");

    assert_eq!(
        got, expected,
        "malicious-secure MASCOT output must match the evaluator"
    );
    assert_eq!(got, vec![BigUint::from(7000u64)], "price*quantity = 7000");
}

#[test]
fn mascot_matches_evaluator_on_multi_gate_circuit() {
    let Some(dir) = mpspdz_dir() else {
        eprintln!("SKIP: MP-SPDZ not built");
        return;
    };

    // w2 = w0 + w1 ; w3 = w2 * w0 ; w4 = w3 + 4 ; outputs [w4]
    // with w0=5 (party 0), w1=3 (party 1): (5+3)*5 + 4 = 44
    let circuit = Circuit {
        input_count: 2,
        gates: vec![
            Gate::Add { a: 0, b: 1 },
            Gate::Mul { a: 2, b: 0 },
            Gate::AddConst {
                a: 3,
                c: BigUint::from(4u32),
            },
        ],
        outputs: vec![4],
    };
    let inputs = vec![BigUint::from(5u64), BigUint::from(3u64)];

    let expected = evaluate(&circuit, &inputs).unwrap();
    let got = run_mascot(&MascotRun {
        mpspdz_dir: &dir,
        program: "glasel_e2e_multi",
        circuit: &circuit,
        inputs: &inputs,
        input_owner: &[0, 1],
        parties: 2,
    })
    .expect("MASCOT run");

    assert_eq!(
        got, expected,
        "MASCOT output must match the evaluator on a multi-gate circuit"
    );
    assert_eq!(got, vec![BigUint::from(44u64)]);
}

#[test]
fn mascot_comparison_and_select_match_evaluator() {
    let Some(dir) = mpspdz_dir() else {
        eprintln!("SKIP: MP-SPDZ not built");
        return;
    };
    // max(a, b) = select(a < b, b, a) — uses the new Lt + Select gates.
    let circuit = Circuit {
        input_count: 2,
        gates: vec![
            Gate::Lt { a: 0, b: 1 }, // wire2 = (a < b)
            Gate::Select {
                cond: 2,
                a: 1,
                b: 0,
            }, // wire3 = a<b ? b : a  = max(a,b)
        ],
        outputs: vec![3],
    };
    // a=5 (party 0), b=7 (party 1) → a<b true → max = 7
    let inputs = vec![BigUint::from(5u64), BigUint::from(7u64)];

    let expected = evaluate(&circuit, &inputs).unwrap();
    let got = run_mascot(&MascotRun {
        mpspdz_dir: &dir,
        program: "glasel_cmp",
        circuit: &circuit,
        inputs: &inputs,
        input_owner: &[0, 1],
        parties: 2,
    })
    .expect("MASCOT run");

    assert_eq!(
        got, expected,
        "MASCOT comparison/select must match the evaluator"
    );
    assert_eq!(
        got,
        vec![BigUint::from(7u64)],
        "max(5,7) = 7 via Lt + Select"
    );
}

#[test]
fn mascot_comparison_covers_all_branches() {
    let Some(dir) = mpspdz_dir() else {
        eprintln!("SKIP: MP-SPDZ not built");
        return;
    };
    // max(a,b) and (a==b) over the three orderings a<b, a>b, a==b — exercises
    // every branch of the Lt/Eq/Select codegen (if_else true AND false paths),
    // each checked against the in-process evaluator under malicious security.
    let circuit = Circuit {
        input_count: 2,
        gates: vec![
            Gate::Lt { a: 0, b: 1 },
            Gate::Select {
                cond: 2,
                a: 1,
                b: 0,
            }, // wire3 = max(a,b)
            Gate::Eq { a: 0, b: 1 }, // wire4 = (a == b)
        ],
        outputs: vec![3, 4],
    };
    for (a, b) in [(5u64, 7u64), (7, 5), (6, 6)] {
        let inputs = vec![BigUint::from(a), BigUint::from(b)];
        let expected = evaluate(&circuit, &inputs).unwrap();
        let got = run_mascot(&MascotRun {
            mpspdz_dir: &dir,
            program: "glasel_cmp_branches",
            circuit: &circuit,
            inputs: &inputs,
            input_owner: &[0, 1],
            parties: 2,
        })
        .expect("MASCOT run");
        assert_eq!(got, expected, "evaluator vs MASCOT for ({a},{b})");
        assert_eq!(
            got,
            vec![BigUint::from(a.max(b)), BigUint::from((a == b) as u64)],
            "max + eq for ({a},{b})"
        );
    }
}

#[test]
fn dsl_authored_circuit_runs_under_mascot() {
    let Some(dir) = mpspdz_dir() else {
        eprintln!("SKIP: MP-SPDZ not built");
        return;
    };
    // A developer authors a sealed-bid auction settlement in plain Rust via the
    // DSL: payout = (bid < reserve) ? 0 : bid. This must run correctly end-to-end
    // through real malicious-secure MASCOT — not merely match the evaluator.
    let (p, [bid, reserve]) = Program::new::<2>(); // bid (party 0), reserve (party 1)
    let below = bid.lt(&reserve);
    let zero = p.constant(BigUint::from(0u32));
    let payout = below.select(&zero, &bid);
    let circuit = p.build([payout]);

    for (b, r, want) in [(150u64, 100u64, 150u64), (50, 100, 0)] {
        let inputs = vec![BigUint::from(b), BigUint::from(r)];
        let expected = evaluate(&circuit, &inputs).unwrap();
        let got = run_mascot(&MascotRun {
            mpspdz_dir: &dir,
            program: "glasel_dsl_auction",
            circuit: &circuit,
            inputs: &inputs,
            input_owner: &[0, 1],
            parties: 2,
        })
        .expect("MASCOT run");
        assert_eq!(got, expected, "DSL circuit: evaluator vs MASCOT (bid={b})");
        assert_eq!(
            got,
            vec![BigUint::from(want)],
            "payout for bid={b} reserve={r}"
        );
    }
}

#[test]
fn distributed_mascot_independent_party_processes() {
    let Some(dir) = mpspdz_dir() else {
        eprintln!("SKIP: MP-SPDZ not built");
        return;
    };
    // Same circuit, but each party runs as its OWN independent process connected
    // over the network (localhost here; real per-node IPs in production) — the
    // distributed deployment model, not co-launched on one host.
    let circuit = Circuit {
        input_count: 2,
        gates: vec![Gate::Mul { a: 0, b: 1 }],
        outputs: vec![2],
    };
    let inputs = vec![BigUint::from(1000u64), BigUint::from(7u64)];

    let expected = evaluate(&circuit, &inputs).unwrap();
    let got = run_mascot_distributed(
        &MascotRun {
            mpspdz_dir: &dir,
            program: "glasel_dist",
            circuit: &circuit,
            inputs: &inputs,
            input_owner: &[0, 1],
            parties: 2,
        },
        "localhost",
        15400,
    )
    .expect("distributed MASCOT run");

    assert_eq!(
        got, expected,
        "distributed (per-process) MASCOT must match the evaluator"
    );
    assert_eq!(
        got,
        vec![BigUint::from(7000u64)],
        "price*quantity = 7000 across independent party processes"
    );
}
