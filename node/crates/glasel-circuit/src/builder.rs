//! Programmatic circuit builder. Stands in for the Arcis proc-macro frontend
//! (Phase 6): you construct the arithmetic circuit directly, which the optimizer
//! and serializer then process identically to compiler output.
use crate::ir::{Circuit, Fe, Gate, Wire};
use num_bigint::BigUint;

pub struct Builder {
    input_count: u32,
    gates: Vec<Gate>,
}

impl Builder {
    pub fn new(input_count: u32) -> Self {
        Self {
            input_count,
            gates: Vec::new(),
        }
    }

    /// Wire id of input `i`.
    pub fn input(&self, i: u32) -> Wire {
        assert!(i < self.input_count, "input index out of range");
        i
    }

    fn push(&mut self, g: Gate) -> Wire {
        let w = self.input_count + self.gates.len() as u32;
        self.gates.push(g);
        w
    }

    pub fn add(&mut self, a: Wire, b: Wire) -> Wire {
        self.push(Gate::Add { a, b })
    }
    pub fn mul(&mut self, a: Wire, b: Wire) -> Wire {
        self.push(Gate::Mul { a, b })
    }
    pub fn add_const(&mut self, a: Wire, c: impl Into<Fe>) -> Wire {
        self.push(Gate::AddConst { a, c: c.into() })
    }
    pub fn mul_const(&mut self, a: Wire, c: impl Into<Fe>) -> Wire {
        self.push(Gate::MulConst { a, c: c.into() })
    }
    pub fn constant(&mut self, c: impl Into<Fe>) -> Wire {
        self.push(Gate::Const { c: c.into() })
    }

    /// 1 if `a < b` else 0 (MASCOT backend). Useful for auctions/sorting/matching.
    pub fn lt(&mut self, a: Wire, b: Wire) -> Wire {
        self.push(Gate::Lt { a, b })
    }
    /// 1 if `a == b` else 0 (MASCOT backend).
    pub fn eq(&mut self, a: Wire, b: Wire) -> Wire {
        self.push(Gate::Eq { a, b })
    }
    /// `cond ? a : b` where `cond` is a 0/1 selector (MASCOT backend).
    pub fn select(&mut self, cond: Wire, a: Wire, b: Wire) -> Wire {
        self.push(Gate::Select { cond, a, b })
    }
    /// max(a, b) = select(a < b, b, a).
    pub fn max(&mut self, a: Wire, b: Wire) -> Wire {
        let lt = self.lt(a, b);
        self.select(lt, b, a)
    }
    /// min(a, b) = select(a < b, a, b).
    pub fn min(&mut self, a: Wire, b: Wire) -> Wire {
        let lt = self.lt(a, b);
        self.select(lt, a, b)
    }

    pub fn finish(self, outputs: Vec<Wire>) -> Circuit {
        Circuit {
            input_count: self.input_count,
            gates: self.gates,
            outputs,
        }
    }

    /// Non-consuming snapshot into a [`Circuit`]. Used by the [`crate::dsl`]
    /// frontend, which shares one builder behind an `Rc<RefCell<_>>` so operator
    /// overloading can record gates, then snapshots it at `build` time.
    pub fn snapshot(&self, outputs: Vec<Wire>) -> Circuit {
        Circuit {
            input_count: self.input_count,
            gates: self.gates.clone(),
            outputs,
        }
    }
}

/// Helper: a u64 literal as a field element.
pub fn fe(x: u64) -> BigUint {
    BigUint::from(x)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eval::evaluate;

    #[test]
    fn builder_comparison_ops_evaluate() {
        // outputs: [max(x,y), min(x,y), x<y, x==y]
        let mut b = Builder::new(2);
        let (x, y) = (b.input(0), b.input(1));
        let mx = b.max(x, y);
        let mn = b.min(x, y);
        let lt = b.lt(x, y);
        let eq = b.eq(x, y);
        let c = b.finish(vec![mx, mn, lt, eq]);

        let r = evaluate(&c, &[fe(5), fe(7)]).unwrap();
        assert_eq!(r, vec![fe(7), fe(5), fe(1), fe(0)], "5<7");
        let r = evaluate(&c, &[fe(9), fe(9)]).unwrap();
        assert_eq!(r, vec![fe(9), fe(9), fe(0), fe(1)], "equal");
    }
}
