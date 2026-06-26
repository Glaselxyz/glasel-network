//! glasel-circuit — the Arcis arithmetic-circuit IR, optimizer, simulator and
//! binary format (§7). Shared by `glaselvm` (compile/simulate) and `glaseld` (the
//! node evaluates compiled circuits over decrypted inputs).
pub mod builder;
pub mod dsl;
pub mod eval;
pub mod examples;
pub mod ir;
pub mod mpspdz;
pub mod optimize;
pub mod serialize;

pub use builder::{fe, Builder};
pub use dsl::{Program, Secret};
pub use eval::{evaluate, EvalError};
pub use ir::{Circuit, Gate, Wire};
pub use optimize::optimize;
pub use serialize::{deserialize, serialize};
