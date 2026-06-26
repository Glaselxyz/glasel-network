//! Local circuit simulator: evaluate a circuit over F_p in the clear. Used by
//! `glaselvm simulate` and by the node engine to compute results.
use crate::ir::{Circuit, Gate};
use glasel_crypto::field;
use num_bigint::BigUint;

#[derive(Debug)]
pub enum EvalError {
    InputCountMismatch { expected: u32, got: usize },
    WireOutOfRange(u32),
}

impl std::fmt::Display for EvalError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            EvalError::InputCountMismatch { expected, got } => {
                write!(f, "expected {expected} inputs, got {got}")
            }
            EvalError::WireOutOfRange(w) => write!(f, "wire {w} out of range"),
        }
    }
}
impl std::error::Error for EvalError {}

fn bit(b: bool) -> BigUint {
    BigUint::from(b as u32)
}

pub fn evaluate(circuit: &Circuit, inputs: &[BigUint]) -> Result<Vec<BigUint>, EvalError> {
    if inputs.len() != circuit.input_count as usize {
        return Err(EvalError::InputCountMismatch {
            expected: circuit.input_count,
            got: inputs.len(),
        });
    }

    let mut wires: Vec<BigUint> = inputs.iter().map(field::fe).collect();
    let get = |wires: &Vec<BigUint>, w: u32| -> Result<BigUint, EvalError> {
        wires
            .get(w as usize)
            .cloned()
            .ok_or(EvalError::WireOutOfRange(w))
    };

    for g in &circuit.gates {
        let v = match g {
            Gate::Add { a, b } => field::add(&get(&wires, *a)?, &get(&wires, *b)?),
            Gate::Mul { a, b } => field::mul(&get(&wires, *a)?, &get(&wires, *b)?),
            Gate::AddConst { a, c } => field::add(&get(&wires, *a)?, c),
            Gate::MulConst { a, c } => field::mul(&get(&wires, *a)?, c),
            Gate::Const { c } => field::fe(c),
            // Comparisons treat field elements as integers in [0, p); result is 0/1.
            Gate::Lt { a, b } => bit(get(&wires, *a)? < get(&wires, *b)?),
            Gate::Eq { a, b } => bit(get(&wires, *a)? == get(&wires, *b)?),
            Gate::Select { cond, a, b } => {
                if get(&wires, *cond)? != BigUint::from(0u32) {
                    get(&wires, *a)?
                } else {
                    get(&wires, *b)?
                }
            }
        };
        wires.push(v);
    }

    circuit.outputs.iter().map(|w| get(&wires, *w)).collect()
}
