//! Built-in example circuits (stand-ins for compiled Arcis programs) used by the
//! `glaselvm` CLI and the node e2e.
use crate::builder::Builder;
use crate::ir::Circuit;

/// Identity over `n` inputs (the trivial "echo" circuit).
pub fn identity(n: u32) -> Circuit {
    let b = Builder::new(n);
    b.finish((0..n).collect())
}

/// Sum of `n` inputs → single output.
pub fn sum(n: u32) -> Circuit {
    assert!(n >= 1);
    let mut b = Builder::new(n);
    let mut acc = 0u32; // wire id of input 0
    for i in 1..n {
        acc = b.add(acc, i);
    }
    b.finish(vec![acc])
}

/// Dark-pool order transform over an ORDER_SCHEMA tuple
/// `[price, quantity, side, buyerKeyHi, buyerKeyLo]` (5 field elements).
/// Outputs `[notional = price*quantity, quantity, side, buyerKeyHi, buyerKeyLo]`,
/// so the result re-uses ORDER_SCHEMA with `price` carrying the notional value.
pub fn order_notional() -> Circuit {
    let mut b = Builder::new(5);
    let notional = b.mul(0, 1); // price * quantity
    b.finish(vec![notional, 1, 2, 3, 4])
}

/// Resolve a built-in circuit by name (used by the CLI).
pub fn by_name(name: &str) -> Option<Circuit> {
    match name {
        "identity5" => Some(identity(5)),
        "sum5" => Some(sum(5)),
        "order_notional" => Some(order_notional()),
        _ => None,
    }
}
