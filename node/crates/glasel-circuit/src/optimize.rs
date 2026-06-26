//! Circuit optimizer (§7.2): constant propagation/folding, common-subexpression
//! elimination, and dead-gate elimination — then wire renumbering.
use crate::ir::{Circuit, Fe, Gate, Wire};
use glasel_crypto::field;
use num_bigint::BigUint;
use num_traits::{One, Zero};
use std::collections::HashMap;

#[derive(Clone)]
enum Ref {
    Const(Fe),
    Wire(Wire),
}

struct Opt {
    input_count: u32,
    gates: Vec<Gate>,
    cse: HashMap<Gate, Wire>,
}

impl Opt {
    fn emit(&mut self, g: Gate) -> Wire {
        if let Some(&w) = self.cse.get(&g) {
            return w;
        }
        let w = self.input_count + self.gates.len() as u32;
        self.cse.insert(g.clone(), w);
        self.gates.push(g);
        w
    }

    /// Resolve a ref to a concrete wire, materializing a constant as a Const gate.
    fn wire_of(&mut self, r: &Ref) -> Wire {
        match r {
            Ref::Wire(w) => *w,
            Ref::Const(c) => self.emit(Gate::Const { c: c.clone() }),
        }
    }

    fn add(&mut self, a: &Ref, b: &Ref) -> Ref {
        match (a, b) {
            (Ref::Const(x), Ref::Const(y)) => Ref::Const(field::add(x, y)),
            (Ref::Const(x), Ref::Wire(w)) | (Ref::Wire(w), Ref::Const(x)) => {
                if x.is_zero() {
                    Ref::Wire(*w)
                } else {
                    Ref::Wire(self.emit(Gate::AddConst {
                        a: *w,
                        c: x.clone(),
                    }))
                }
            }
            (Ref::Wire(wa), Ref::Wire(wb)) => Ref::Wire(self.emit(Gate::Add { a: *wa, b: *wb })),
        }
    }

    fn mul(&mut self, a: &Ref, b: &Ref) -> Ref {
        match (a, b) {
            (Ref::Const(x), Ref::Const(y)) => Ref::Const(field::mul(x, y)),
            (Ref::Const(x), Ref::Wire(w)) | (Ref::Wire(w), Ref::Const(x)) => {
                if x.is_zero() {
                    Ref::Const(BigUint::zero())
                } else if x.is_one() {
                    Ref::Wire(*w)
                } else {
                    Ref::Wire(self.emit(Gate::MulConst {
                        a: *w,
                        c: x.clone(),
                    }))
                }
            }
            (Ref::Wire(wa), Ref::Wire(wb)) => Ref::Wire(self.emit(Gate::Mul { a: *wa, b: *wb })),
        }
    }
}

pub fn optimize(circuit: &Circuit) -> Circuit {
    let mut opt = Opt {
        input_count: circuit.input_count,
        gates: Vec::new(),
        cse: HashMap::new(),
    };

    // refs[old_wire] = its simplified reference.
    let mut refs: Vec<Ref> = (0..circuit.input_count).map(Ref::Wire).collect();

    for g in &circuit.gates {
        let r = match g {
            Gate::Const { c } => Ref::Const(field::fe(c)),
            Gate::AddConst { a, c } => match refs[*a as usize].clone() {
                Ref::Const(v) => Ref::Const(field::add(&v, c)),
                Ref::Wire(w) => {
                    if c.is_zero() {
                        Ref::Wire(w)
                    } else {
                        Ref::Wire(opt.emit(Gate::AddConst {
                            a: w,
                            c: field::fe(c),
                        }))
                    }
                }
            },
            Gate::MulConst { a, c } => match refs[*a as usize].clone() {
                Ref::Const(v) => Ref::Const(field::mul(&v, c)),
                Ref::Wire(w) => {
                    if c.is_zero() {
                        Ref::Const(BigUint::zero())
                    } else if c.is_one() {
                        Ref::Wire(w)
                    } else {
                        Ref::Wire(opt.emit(Gate::MulConst {
                            a: w,
                            c: field::fe(c),
                        }))
                    }
                }
            },
            Gate::Add { a, b } => {
                let (ra, rb) = (refs[*a as usize].clone(), refs[*b as usize].clone());
                opt.add(&ra, &rb)
            }
            Gate::Mul { a, b } => {
                let (ra, rb) = (refs[*a as usize].clone(), refs[*b as usize].clone());
                opt.mul(&ra, &rb)
            }
            // Comparison/select: not folded (semantics live in the MASCOT backend);
            // resolve operands to concrete wires, then emit (CSE applies).
            Gate::Lt { a, b } => {
                let (wa, wb) = (
                    opt.wire_of(&refs[*a as usize]),
                    opt.wire_of(&refs[*b as usize]),
                );
                Ref::Wire(opt.emit(Gate::Lt { a: wa, b: wb }))
            }
            Gate::Eq { a, b } => {
                let (wa, wb) = (
                    opt.wire_of(&refs[*a as usize]),
                    opt.wire_of(&refs[*b as usize]),
                );
                Ref::Wire(opt.emit(Gate::Eq { a: wa, b: wb }))
            }
            Gate::Select { cond, a, b } => {
                let wc = opt.wire_of(&refs[*cond as usize]);
                let (wa, wb) = (
                    opt.wire_of(&refs[*a as usize]),
                    opt.wire_of(&refs[*b as usize]),
                );
                Ref::Wire(opt.emit(Gate::Select {
                    cond: wc,
                    a: wa,
                    b: wb,
                }))
            }
        };
        refs.push(r);
    }

    // Resolve outputs; materialize constant outputs as Const gates.
    let mut outputs = Vec::with_capacity(circuit.outputs.len());
    for &ow in &circuit.outputs {
        match refs[ow as usize].clone() {
            Ref::Wire(w) => outputs.push(w),
            Ref::Const(v) => outputs.push(opt.emit(Gate::Const { c: v })),
        }
    }

    dead_code_elim(opt.input_count, opt.gates, outputs)
}

/// Keep only gates reachable from the outputs, then renumber wires densely.
fn dead_code_elim(input_count: u32, gates: Vec<Gate>, outputs: Vec<Wire>) -> Circuit {
    let mut needed = vec![false; gates.len()];
    let mut stack = outputs.clone();
    while let Some(w) = stack.pop() {
        if w < input_count {
            continue;
        }
        let gi = (w - input_count) as usize;
        if needed[gi] {
            continue;
        }
        needed[gi] = true;
        match &gates[gi] {
            Gate::Add { a, b } | Gate::Mul { a, b } => {
                stack.push(*a);
                stack.push(*b);
            }
            Gate::AddConst { a, .. } | Gate::MulConst { a, .. } => stack.push(*a),
            Gate::Const { .. } => {}
            Gate::Lt { a, b } | Gate::Eq { a, b } => {
                stack.push(*a);
                stack.push(*b);
            }
            Gate::Select { cond, a, b } => {
                stack.push(*cond);
                stack.push(*a);
                stack.push(*b);
            }
        }
    }

    let mut map: HashMap<Wire, Wire> = (0..input_count).map(|i| (i, i)).collect();
    let mut new_gates: Vec<Gate> = Vec::new();
    for (gi, g) in gates.into_iter().enumerate() {
        if !needed[gi] {
            continue;
        }
        let new_w = input_count + new_gates.len() as u32;
        let ng = match g {
            Gate::Add { a, b } => Gate::Add {
                a: map[&a],
                b: map[&b],
            },
            Gate::Mul { a, b } => Gate::Mul {
                a: map[&a],
                b: map[&b],
            },
            Gate::AddConst { a, c } => Gate::AddConst { a: map[&a], c },
            Gate::MulConst { a, c } => Gate::MulConst { a: map[&a], c },
            Gate::Const { c } => Gate::Const { c },
            Gate::Lt { a, b } => Gate::Lt {
                a: map[&a],
                b: map[&b],
            },
            Gate::Eq { a, b } => Gate::Eq {
                a: map[&a],
                b: map[&b],
            },
            Gate::Select { cond, a, b } => Gate::Select {
                cond: map[&cond],
                a: map[&a],
                b: map[&b],
            },
        };
        new_gates.push(ng);
        map.insert(input_count + gi as u32, new_w);
    }

    let new_outputs = outputs.iter().map(|w| map[w]).collect();
    Circuit {
        input_count,
        gates: new_gates,
        outputs: new_outputs,
    }
}
