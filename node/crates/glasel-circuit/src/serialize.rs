//! Binary circuit format (§7.3) — the bytecode stored in ComputationRegistry and
//! fetched by nodes. Deterministic, length-prefixed, big-endian.
//!
//! Layout:
//!   magic   : "CFDC"            (4 bytes)
//!   version : u16               (2)
//!   field   : 32-byte modulus   (32)  — p = 2^255-19
//!   input_count  : u32          (4)
//!   gate_count   : u32          (4)
//!   output_count : u32          (4)
//!   gates[]      : tag(u8) + operands
//!   outputs[]    : u32 each
//!
//! Gate tags: 0=Add{a,b} 1=Mul{a,b} 2=AddConst{a,c} 3=MulConst{a,c} 4=Const{c}
//!            5=Lt{a,b} 6=Eq{a,b} 7=Select{cond,a,b}
use crate::ir::{Circuit, Gate};
use glasel_crypto::field;
use num_bigint::BigUint;

const MAGIC: &[u8; 4] = b"CFDC";
const VERSION: u16 = 1;

pub fn serialize(c: &Circuit) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(MAGIC);
    out.extend_from_slice(&VERSION.to_be_bytes());
    out.extend_from_slice(&field::biguint_to_bytes_be(field::p()));
    out.extend_from_slice(&c.input_count.to_be_bytes());
    out.extend_from_slice(&(c.gates.len() as u32).to_be_bytes());
    out.extend_from_slice(&(c.outputs.len() as u32).to_be_bytes());

    for g in &c.gates {
        match g {
            Gate::Add { a, b } => {
                out.push(0);
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&b.to_be_bytes());
            }
            Gate::Mul { a, b } => {
                out.push(1);
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&b.to_be_bytes());
            }
            Gate::AddConst { a, c } => {
                out.push(2);
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&field::fe_to_bytes_be(c));
            }
            Gate::MulConst { a, c } => {
                out.push(3);
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&field::fe_to_bytes_be(c));
            }
            Gate::Const { c } => {
                out.push(4);
                out.extend_from_slice(&field::fe_to_bytes_be(c));
            }
            Gate::Lt { a, b } => {
                out.push(5);
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&b.to_be_bytes());
            }
            Gate::Eq { a, b } => {
                out.push(6);
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&b.to_be_bytes());
            }
            Gate::Select { cond, a, b } => {
                out.push(7);
                out.extend_from_slice(&cond.to_be_bytes());
                out.extend_from_slice(&a.to_be_bytes());
                out.extend_from_slice(&b.to_be_bytes());
            }
        }
    }
    for w in &c.outputs {
        out.extend_from_slice(&w.to_be_bytes());
    }
    out
}

pub fn deserialize(bytes: &[u8]) -> Result<Circuit, String> {
    let mut r = Reader { b: bytes, pos: 0 };
    if r.take(4)? != MAGIC {
        return Err("bad magic".into());
    }
    let version = u16::from_be_bytes(r.take(2)?.try_into().unwrap());
    if version != VERSION {
        return Err(format!("unsupported version {version}"));
    }
    let modulus = BigUint::from_bytes_be(r.take(32)?);
    if &modulus != field::p() {
        return Err("field modulus mismatch".into());
    }
    let input_count = r.u32()?;
    let gate_count = r.u32()?;
    let output_count = r.u32()?;

    let mut gates = Vec::with_capacity(gate_count as usize);
    for _ in 0..gate_count {
        let tag = r.take(1)?[0];
        let g = match tag {
            0 => Gate::Add {
                a: r.u32()?,
                b: r.u32()?,
            },
            1 => Gate::Mul {
                a: r.u32()?,
                b: r.u32()?,
            },
            2 => Gate::AddConst {
                a: r.u32()?,
                c: r.fe()?,
            },
            3 => Gate::MulConst {
                a: r.u32()?,
                c: r.fe()?,
            },
            4 => Gate::Const { c: r.fe()? },
            5 => Gate::Lt {
                a: r.u32()?,
                b: r.u32()?,
            },
            6 => Gate::Eq {
                a: r.u32()?,
                b: r.u32()?,
            },
            7 => Gate::Select {
                cond: r.u32()?,
                a: r.u32()?,
                b: r.u32()?,
            },
            other => return Err(format!("bad gate tag {other}")),
        };
        gates.push(g);
    }
    let mut outputs = Vec::with_capacity(output_count as usize);
    for _ in 0..output_count {
        outputs.push(r.u32()?);
    }
    Ok(Circuit {
        input_count,
        gates,
        outputs,
    })
}

struct Reader<'a> {
    b: &'a [u8],
    pos: usize,
}
impl<'a> Reader<'a> {
    fn take(&mut self, n: usize) -> Result<&'a [u8], String> {
        if self.pos + n > self.b.len() {
            return Err("unexpected end of bytes".into());
        }
        let s = &self.b[self.pos..self.pos + n];
        self.pos += n;
        Ok(s)
    }
    fn u32(&mut self) -> Result<u32, String> {
        Ok(u32::from_be_bytes(self.take(4)?.try_into().unwrap()))
    }
    fn fe(&mut self) -> Result<BigUint, String> {
        Ok(field::fe_from_bytes_be(self.take(32)?))
    }
}
