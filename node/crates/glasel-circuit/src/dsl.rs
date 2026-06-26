//! Arcis-style embedded DSL for authoring confidential circuits in ordinary Rust.
//!
//! Where [`crate::builder::Builder`] makes you thread wire ids by hand
//! (`b.mul(price, qty)`), this frontend overloads Rust's arithmetic operators on a
//! [`Secret`] value, so a confidential program reads like the cleartext function
//! it mirrors:
//!
//! ```
//! use glasel_circuit::dsl::Program;
//! use glasel_circuit::evaluate;
//! use num_bigint::BigUint;
//!
//! // order notional = price * quantity  (Arcium's hello-world MXE)
//! let (p, [price, qty]) = Program::new::<2>();
//! let notional = price * qty;
//! let circuit = p.build([notional]);
//!
//! let out = evaluate(&circuit, &[BigUint::from(1000u32), BigUint::from(7u32)]).unwrap();
//! assert_eq!(out, vec![BigUint::from(7000u32)]);
//! ```
//!
//! Internally the program shares one `Builder` behind an `Rc<RefCell<_>>`; each
//! operator records a gate and returns a new `Secret` handle to its output wire.
//! Comparisons (`<`, `==`) can't be operator-overloaded in Rust (they must return
//! `bool`), so they are the methods [`Secret::lt`], [`Secret::eq`],
//! [`Secret::select`], [`Secret::max`], [`Secret::min`] — these require the
//! malicious-secure MASCOT backend, exactly like the gates they emit.
use crate::builder::Builder;
use crate::ir::{Circuit, Fe, Wire};
use glasel_crypto::field;
use num_bigint::BigUint;
use std::cell::RefCell;
use std::ops::{Add, Mul, Sub};
use std::rc::Rc;

type Ctx = Rc<RefCell<Builder>>;

/// A secret-shared value flowing through a [`Program`]. Cheap to [`Clone`] (it is
/// a wire id plus a handle to the shared circuit), so reuse a value by cloning it.
#[derive(Clone)]
pub struct Secret {
    wire: Wire,
    ctx: Ctx,
}

impl Secret {
    /// The underlying circuit wire id this value lives on.
    pub fn wire(&self) -> Wire {
        self.wire
    }

    fn with(&self, w: Wire) -> Secret {
        Secret {
            wire: w,
            ctx: self.ctx.clone(),
        }
    }

    /// `1` if `self < other` else `0` (values compared as integers in `[0, p)`).
    pub fn lt(&self, other: &Secret) -> Secret {
        let w = self.ctx.borrow_mut().lt(self.wire, other.wire);
        self.with(w)
    }

    /// `1` if `self == other` else `0`.
    pub fn eq(&self, other: &Secret) -> Secret {
        let w = self.ctx.borrow_mut().eq(self.wire, other.wire);
        self.with(w)
    }

    /// `self ? a : b` — `self` is a `0/1` selector (typically an [`Secret::lt`] /
    /// [`Secret::eq`] result): returns `a` when `self != 0`, else `b`.
    pub fn select(&self, a: &Secret, b: &Secret) -> Secret {
        let w = self.ctx.borrow_mut().select(self.wire, a.wire, b.wire);
        self.with(w)
    }

    /// `max(self, other)`.
    pub fn max(&self, other: &Secret) -> Secret {
        let w = self.ctx.borrow_mut().max(self.wire, other.wire);
        self.with(w)
    }

    /// `min(self, other)`.
    pub fn min(&self, other: &Secret) -> Secret {
        let w = self.ctx.borrow_mut().min(self.wire, other.wire);
        self.with(w)
    }
}

// ── secret ⊕ secret ────────────────────────────────────────────────────────
// Implemented on `&Secret` (no move), with owned/mixed forms delegating, so all
// of `a + b`, `&a + &b`, `a + &b`, `&a + b` work.
macro_rules! secret_binop {
    ($trait:ident, $method:ident, $build:ident) => {
        impl $trait<&Secret> for &Secret {
            type Output = Secret;
            fn $method(self, rhs: &Secret) -> Secret {
                let w = self.ctx.borrow_mut().$build(self.wire, rhs.wire);
                self.with(w)
            }
        }
        impl $trait<Secret> for Secret {
            type Output = Secret;
            fn $method(self, rhs: Secret) -> Secret {
                <&Secret as $trait<&Secret>>::$method(&self, &rhs)
            }
        }
        impl $trait<&Secret> for Secret {
            type Output = Secret;
            fn $method(self, rhs: &Secret) -> Secret {
                <&Secret as $trait<&Secret>>::$method(&self, rhs)
            }
        }
        impl $trait<Secret> for &Secret {
            type Output = Secret;
            fn $method(self, rhs: Secret) -> Secret {
                <&Secret as $trait<&Secret>>::$method(self, &rhs)
            }
        }
    };
}
secret_binop!(Add, add, add);
secret_binop!(Mul, mul, mul);

// Subtraction has no native gate: a - b == a + (p-1)·b over F_p.
impl Sub<&Secret> for &Secret {
    type Output = Secret;
    fn sub(self, rhs: &Secret) -> Secret {
        let neg = self.ctx.borrow_mut().mul_const(rhs.wire, neg_one());
        let w = self.ctx.borrow_mut().add(self.wire, neg);
        self.with(w)
    }
}
impl Sub<Secret> for Secret {
    type Output = Secret;
    fn sub(self, rhs: Secret) -> Secret {
        <&Secret as Sub<&Secret>>::sub(&self, &rhs)
    }
}
impl Sub<&Secret> for Secret {
    type Output = Secret;
    fn sub(self, rhs: &Secret) -> Secret {
        <&Secret as Sub<&Secret>>::sub(&self, rhs)
    }
}
impl Sub<Secret> for &Secret {
    type Output = Secret;
    fn sub(self, rhs: Secret) -> Secret {
        <&Secret as Sub<&Secret>>::sub(self, &rhs)
    }
}

// ── secret ⊕ public constant ───────────────────────────────────────────────
// `secret + 5`, `secret * 3`, `secret - 1`. Constants are public (compiled into
// the circuit), so these are local (cheap) gates.
impl Add<u64> for &Secret {
    type Output = Secret;
    fn add(self, c: u64) -> Secret {
        let w = self.ctx.borrow_mut().add_const(self.wire, c);
        self.with(w)
    }
}
impl Mul<u64> for &Secret {
    type Output = Secret;
    fn mul(self, c: u64) -> Secret {
        let w = self.ctx.borrow_mut().mul_const(self.wire, c);
        self.with(w)
    }
}
impl Sub<u64> for &Secret {
    type Output = Secret;
    fn sub(self, c: u64) -> Secret {
        // a - c == a + (p - c)
        let w = self
            .ctx
            .borrow_mut()
            .add_const(self.wire, field::sub(field::p(), &BigUint::from(c)));
        self.with(w)
    }
}
// Owned-LHS forms for the constant operators.
impl Add<u64> for Secret {
    type Output = Secret;
    fn add(self, c: u64) -> Secret {
        <&Secret as Add<u64>>::add(&self, c)
    }
}
impl Mul<u64> for Secret {
    type Output = Secret;
    fn mul(self, c: u64) -> Secret {
        <&Secret as Mul<u64>>::mul(&self, c)
    }
}
impl Sub<u64> for Secret {
    type Output = Secret;
    fn sub(self, c: u64) -> Secret {
        <&Secret as Sub<u64>>::sub(&self, c)
    }
}

fn neg_one() -> Fe {
    field::sub(field::p(), &BigUint::from(1u32))
}

/// A confidential program under construction. Declare its private inputs with
/// [`Program::new`], compute over the returned [`Secret`]s with normal Rust
/// operators, then [`Program::build`] the resulting [`Circuit`].
pub struct Program {
    ctx: Ctx,
}

impl Program {
    /// Start a program with `N` private inputs, returning the program and a handle
    /// to each input wire in order (like a confidential function's parameters).
    pub fn new<const N: usize>() -> (Self, [Secret; N]) {
        let ctx: Ctx = Rc::new(RefCell::new(Builder::new(N as u32)));
        let inputs = std::array::from_fn(|i| Secret {
            wire: i as u32,
            ctx: ctx.clone(),
        });
        (Program { ctx }, inputs)
    }

    /// Introduce a public constant as a [`Secret`] handle (e.g. a fixed threshold).
    pub fn constant(&self, c: impl Into<Fe>) -> Secret {
        let w = self.ctx.borrow_mut().constant(c);
        Secret {
            wire: w,
            ctx: self.ctx.clone(),
        }
    }

    /// Finalize: the given secrets become the circuit's outputs, in order.
    pub fn build<const M: usize>(self, outputs: [Secret; M]) -> Circuit {
        self.build_outputs(&outputs)
    }

    /// Finalize from a slice of outputs (when the count isn't known at compile time).
    pub fn build_outputs(self, outputs: &[Secret]) -> Circuit {
        let outs: Vec<Wire> = outputs.iter().map(|s| s.wire).collect();
        self.ctx.borrow().snapshot(outs)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluate;

    fn ev(c: &Circuit, ins: &[u64]) -> Vec<u64> {
        let bigs: Vec<BigUint> = ins.iter().map(|&x| BigUint::from(x)).collect();
        evaluate(c, &bigs)
            .unwrap()
            .iter()
            .map(|b| b.try_into().unwrap())
            .collect()
    }

    #[test]
    fn hello_world_multiply() {
        let (p, [price, qty]) = Program::new::<2>();
        let circuit = p.build([price * qty]);
        assert_eq!(ev(&circuit, &[1000, 7]), vec![7000]);
    }

    #[test]
    fn arithmetic_expression_with_constants() {
        // (a + b) * a + 4  — mirrors the multi-gate MASCOT e2e (5,3 → 44).
        let (p, [a, b]) = Program::new::<2>();
        let out = (a.clone() + b) * a + 4;
        let circuit = p.build([out]);
        assert_eq!(ev(&circuit, &[5, 3]), vec![44]);
        assert_eq!(ev(&circuit, &[2, 10]), vec![(2 + 10) * 2 + 4]);
    }

    #[test]
    fn subtraction_in_the_field() {
        let (p, [a, b]) = Program::new::<2>();
        // a - b, and a - 3
        let circuit = p.build([a.clone() - b, a - 3]);
        assert_eq!(ev(&circuit, &[10, 4]), vec![6, 7]);
    }

    #[test]
    fn comparisons_and_select_build_max_and_min() {
        let (p, [a, b]) = Program::new::<2>();
        let mx = a.max(&b);
        let mn = a.min(&b);
        let lt = a.lt(&b);
        let eqv = a.eq(&b);
        let circuit = p.build([mx, mn, lt, eqv]);
        assert_eq!(ev(&circuit, &[5, 7]), vec![7, 5, 1, 0]);
        assert_eq!(ev(&circuit, &[9, 9]), vec![9, 9, 0, 1]);
        assert_eq!(ev(&circuit, &[8, 3]), vec![8, 3, 0, 0]);
    }

    #[test]
    fn manual_select_with_a_public_threshold() {
        // result = (bid < reserve) ? 0 : bid   — auction reserve price.
        let (p, [bid]) = Program::new::<1>();
        let reserve = p.constant(BigUint::from(100u32));
        let zero = p.constant(BigUint::from(0u32));
        let below = bid.lt(&reserve);
        let out = below.select(&zero, &bid);
        let circuit = p.build([out]);
        assert_eq!(
            ev(&circuit, &[150]),
            vec![150],
            "above reserve → bid stands"
        );
        assert_eq!(ev(&circuit, &[50]), vec![0], "below reserve → rejected");
    }

    #[test]
    fn dsl_matches_hand_built_builder_circuit() {
        // The DSL must produce the exact same IR as the equivalent Builder calls.
        use crate::builder::Builder;
        let (p, [a, b]) = Program::new::<2>();
        let dsl_circuit = p.build([a.clone() * b.clone() + a]);

        let mut bd = Builder::new(2);
        let (wa, wb) = (bd.input(0), bd.input(1));
        let m = bd.mul(wa, wb);
        let s = bd.add(m, wa);
        let hand = bd.finish(vec![s]);

        assert_eq!(dsl_circuit, hand, "DSL and Builder emit identical IR");
    }
}
