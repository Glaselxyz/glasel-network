//! Arithmetic circuit IR (§7.3). A circuit is a list of gates over wires in
//! F_p. Wires 0..input_count are inputs; gate `i` produces wire `input_count+i`.
use num_bigint::BigUint;
use serde::{Deserialize, Serialize};

pub type Wire = u32;
pub type Fe = BigUint;

#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum Gate {
    /// out = wire[a] + wire[b]
    Add { a: Wire, b: Wire },
    /// out = wire[a] * wire[b]
    Mul { a: Wire, b: Wire },
    /// out = wire[a] + c
    AddConst { a: Wire, c: Fe },
    /// out = wire[a] * c
    MulConst { a: Wire, c: Fe },
    /// out = c
    Const { c: Fe },
    /// out = 1 if wire[a] < wire[b] (values compared as integers in [0,p)), else 0.
    /// Requires the malicious-secure MASCOT backend (bit-decomposition); the
    /// arithmetic-only BGW engine does not support it.
    Lt { a: Wire, b: Wire },
    /// out = 1 if wire[a] == wire[b], else 0. (MASCOT backend only.)
    Eq { a: Wire, b: Wire },
    /// out = wire[a] if wire[cond] != 0 else wire[b]. `cond` is a 0/1 selector
    /// (typically the result of an `Lt`/`Eq`). (MASCOT backend only.)
    Select { cond: Wire, a: Wire, b: Wire },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Circuit {
    pub input_count: u32,
    pub gates: Vec<Gate>,
    /// Wire ids designated as outputs (in order).
    pub outputs: Vec<Wire>,
}

impl Circuit {
    /// Wire id produced by gate index `i`.
    pub fn gate_wire(&self, i: usize) -> Wire {
        self.input_count + i as u32
    }

    pub fn output_count(&self) -> usize {
        self.outputs.len()
    }

    /// Approximate gate count for fee estimation. Only multiplications require
    /// MPC communication, so they are the cost driver; we weight them heavily.
    pub fn estimated_gates(&self) -> u32 {
        let mut total: u32 = 0;
        for g in &self.gates {
            total += match g {
                Gate::Mul { .. } => 100, // multiplication ≈ a round of comms
                Gate::Lt { .. } => 300,  // comparison ≈ bit-decomposition
                Gate::Eq { .. } => 200,
                Gate::Select { .. } => 150, // ≈ a multiplication + linear
                Gate::MulConst { .. } => 1, // local
                Gate::Add { .. } | Gate::AddConst { .. } | Gate::Const { .. } => 1,
            };
        }
        total
    }

    pub fn mul_count(&self) -> usize {
        self.gates
            .iter()
            .filter(|g| matches!(g, Gate::Mul { .. }))
            .count()
    }
}
