//! Three parties, three threads, one in-memory mesh — a real BGW computation
//! where no thread ever holds a plaintext input or the result.
use glasel_circuit::ir::{Circuit, Gate};
use glasel_mpc::{deal, net::InMemoryNet, run_party};
use num_bigint::BigUint;
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::sync::Arc;
use std::thread;

fn fe(x: u64) -> BigUint {
    BigUint::from(x)
}

/// Run `circuit` over secret-shared `inputs` with `n` parties / threshold `t`.
/// Returns each party's reconstructed outputs.
fn run(circuit: Circuit, inputs: Vec<BigUint>, t: usize, n: usize) -> Vec<Vec<BigUint>> {
    let mut rng = StdRng::seed_from_u64(42);
    let per_party = deal(&inputs, n, t, &mut rng);
    let nets = InMemoryNet::mesh(n);
    let circ = Arc::new(circuit);

    let handles: Vec<_> = nets
        .into_iter()
        .enumerate()
        .map(|(i, net)| {
            let shares = per_party[i].clone();
            let c = Arc::clone(&circ);
            thread::spawn(move || {
                let mut r = StdRng::seed_from_u64(1000 + i as u64);
                run_party(&c, &shares, &net, t, &mut r)
            })
        })
        .collect();

    handles.into_iter().map(|h| h.join().unwrap()).collect()
}

#[test]
fn computes_order_notional() {
    // price * quantity
    let circuit = Circuit {
        input_count: 2,
        gates: vec![Gate::Mul { a: 0, b: 1 }],
        outputs: vec![2],
    };
    let outs = run(circuit, vec![fe(1000), fe(7)], 1, 3);
    assert_eq!(outs.len(), 3);
    for o in &outs {
        assert_eq!(
            o,
            &vec![fe(7000)],
            "every party reconstructs the same correct result"
        );
    }
}

#[test]
fn computes_linear_and_mul_mix() {
    // out = (a + b) * c + 5  with a=3, b=4, c=5  ->  35 + 5 = 40
    // wires: 0=a 1=b 2=c ; w3=Add(0,1) ; w4=Mul(3,2) ; w5=AddConst(4,5)
    let circuit = Circuit {
        input_count: 3,
        gates: vec![
            Gate::Add { a: 0, b: 1 },
            Gate::Mul { a: 3, b: 2 },
            Gate::AddConst { a: 4, c: fe(5) },
        ],
        outputs: vec![5],
    };
    let outs = run(circuit, vec![fe(3), fe(4), fe(5)], 1, 3);
    for o in &outs {
        assert_eq!(o, &vec![fe(40)]);
    }
}

#[test]
fn two_multiplications_chain() {
    // out = a * b * c  with 6 * 7 * 8 = 336
    let circuit = Circuit {
        input_count: 3,
        gates: vec![Gate::Mul { a: 0, b: 1 }, Gate::Mul { a: 3, b: 2 }],
        outputs: vec![4],
    };
    let outs = run(circuit, vec![fe(6), fe(7), fe(8)], 1, 3);
    for o in &outs {
        assert_eq!(o, &vec![fe(336)]);
    }
}

#[test]
fn no_party_holds_plaintext() {
    let mut rng = StdRng::seed_from_u64(9);
    let inputs = vec![fe(1000), fe(7)];
    let per_party = deal(&inputs, 3, 1, &mut rng);
    for shares in &per_party {
        assert_ne!(
            shares[0],
            fe(1000),
            "a share must not equal the plaintext input"
        );
        assert_ne!(shares[1], fe(7));
    }
}
