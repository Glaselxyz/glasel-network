use glasel_circuit::{
    builder::Builder, deserialize, evaluate, examples, ir::Gate, optimize, serialize,
};
use num_bigint::BigUint;

fn bn(x: u64) -> BigUint {
    BigUint::from(x)
}

#[test]
fn evaluate_sum() {
    let c = examples::sum(5);
    let out = evaluate(&c, &[bn(1), bn(2), bn(3), bn(4), bn(5)]).unwrap();
    assert_eq!(out, vec![bn(15)]);
}

#[test]
fn evaluate_order_notional() {
    let c = examples::order_notional();
    // price=1000, qty=7 -> notional 7000; rest preserved
    let out = evaluate(&c, &[bn(1000), bn(7), bn(0), bn(42), bn(43)]).unwrap();
    assert_eq!(out, vec![bn(7000), bn(7), bn(0), bn(42), bn(43)]);
}

#[test]
fn evaluate_input_mismatch() {
    let c = examples::sum(5);
    assert!(evaluate(&c, &[bn(1)]).is_err());
}

#[test]
fn optimizer_constant_folds() {
    // (input0 + 0) * 1 + (2 * 3)  ->  input0 + 6
    let mut b = Builder::new(1);
    let x = b.input(0);
    let x0 = b.add_const(x, bn(0)); // identity add -> x
    let x1 = b.mul_const(x0, bn(1)); // identity mul -> x
    let two = b.constant(bn(2));
    let six = b.mul_const(two, bn(3)); // const 6
    let out = b.add(x1, six);
    let c = b.finish(vec![out]);

    let opt = optimize(&c);
    // Should collapse to a single AddConst{input0, 6}
    assert_eq!(opt.gates.len(), 1);
    assert!(matches!(opt.gates[0], Gate::AddConst { a: 0, .. }));
    // Behaviour preserved
    for v in [0u64, 5, 99] {
        assert_eq!(
            evaluate(&opt, &[bn(v)]).unwrap(),
            evaluate(&c, &[bn(v)]).unwrap()
        );
    }
}

#[test]
fn optimizer_cse_dedups() {
    // out = (a*b) + (a*b)  -> one Mul reused, then AddConst-free Add
    let mut b = Builder::new(2);
    let m1 = b.mul(0, 1);
    let m2 = b.mul(0, 1);
    let out = b.add(m1, m2);
    let c = b.finish(vec![out]);

    let opt = optimize(&c);
    assert_eq!(
        opt.mul_count(),
        1,
        "duplicate multiply should be eliminated"
    );
    assert_eq!(evaluate(&opt, &[bn(3), bn(4)]).unwrap(), vec![bn(24)]);
}

#[test]
fn optimizer_dead_gate_elim() {
    // Build a gate that is never referenced by outputs.
    let mut b = Builder::new(2);
    let _dead = b.mul(0, 1);
    let live = b.add(0, 1);
    let c = b.finish(vec![live]);
    let opt = optimize(&c);
    assert_eq!(opt.gates.len(), 1);
    assert_eq!(evaluate(&opt, &[bn(2), bn(5)]).unwrap(), vec![bn(7)]);
}

#[test]
fn serialize_roundtrip() {
    let c = examples::order_notional();
    let bytes = serialize(&c);
    let back = deserialize(&bytes).unwrap();
    assert_eq!(c, back);
    // and the deserialized circuit still computes correctly
    let out = evaluate(&back, &[bn(10), bn(3), bn(1), bn(7), bn(8)]).unwrap();
    assert_eq!(out, vec![bn(30), bn(3), bn(1), bn(7), bn(8)]);
}

#[test]
fn deserialize_rejects_garbage() {
    assert!(deserialize(b"not a circuit").is_err());
}

#[test]
fn estimated_gates_weights_multiplications() {
    let c = examples::order_notional(); // one Mul (=100) -> >= 100
    assert!(c.estimated_gates() >= 100);
}
