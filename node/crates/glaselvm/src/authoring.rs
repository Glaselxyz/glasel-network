//! File-based circuit authoring + project scaffolding for external developers.
//!
//! Until the Arcis proc-macro DSL lands, developers author circuits as a small
//! JSON file — no Rust toolchain required. `glaselvm new` scaffolds a complete
//! project (circuit + manifest + Solidity callback + README), and `compile` /
//! `simulate` accept the `.json` directly.
//!
//! JSON circuit format:
//! ```json
//! { "inputs": 2,
//!   "gates": [ {"op":"mul","a":0,"b":1} ],   // wire g → input_count+g
//!   "outputs": [2] }
//! ```
//! ops: add|mul (a,b) · addconst|mulconst (a,c) · const (c) · lt|eq (a,b) ·
//!      select (cond,a,b). Constants `c` are decimal strings.
use glasel_circuit::{Circuit, Gate};
use num_bigint::BigUint;
use serde::Deserialize;
use std::path::Path;

#[derive(Deserialize)]
struct JsonGate {
    op: String,
    #[serde(default)]
    a: u32,
    #[serde(default)]
    b: u32,
    #[serde(default)]
    cond: u32,
    #[serde(default)]
    c: Option<String>,
}

#[derive(Deserialize)]
struct JsonCircuit {
    inputs: u32,
    gates: Vec<JsonGate>,
    outputs: Vec<u32>,
}

/// Parse the JSON circuit authoring format into the IR.
pub fn parse_circuit_json(s: &str) -> anyhow::Result<Circuit> {
    let j: JsonCircuit = serde_json::from_str(s)?;
    let mut gates = Vec::with_capacity(j.gates.len());
    for g in &j.gates {
        let konst = || -> anyhow::Result<BigUint> {
            let c =
                g.c.as_deref()
                    .ok_or_else(|| anyhow::anyhow!("op '{}' needs a constant `c`", g.op))?;
            BigUint::parse_bytes(c.as_bytes(), 10)
                .ok_or_else(|| anyhow::anyhow!("bad constant '{c}'"))
        };
        gates.push(match g.op.as_str() {
            "add" => Gate::Add { a: g.a, b: g.b },
            "mul" => Gate::Mul { a: g.a, b: g.b },
            "addconst" => Gate::AddConst {
                a: g.a,
                c: konst()?,
            },
            "mulconst" => Gate::MulConst {
                a: g.a,
                c: konst()?,
            },
            "const" => Gate::Const { c: konst()? },
            "lt" => Gate::Lt { a: g.a, b: g.b },
            "eq" => Gate::Eq { a: g.a, b: g.b },
            "select" => Gate::Select {
                cond: g.cond,
                a: g.a,
                b: g.b,
            },
            other => anyhow::bail!("unknown gate op '{other}'"),
        });
    }
    let circuit = Circuit {
        input_count: j.inputs,
        gates,
        outputs: j.outputs,
    };
    validate_circuit(&circuit)?;
    Ok(circuit)
}

/// Reject structurally invalid circuits at authoring time with a clear message,
/// rather than letting a bad wire reference surface later as an evaluator error
/// or a cryptic MP-SPDZ `compile.py` traceback. A gate at index `g` produces wire
/// `input_count + g` and may only reference *earlier* wires (`< input_count + g`),
/// so this also rejects forward/self references. Every output wire must exist.
pub fn validate_circuit(c: &Circuit) -> anyhow::Result<()> {
    let total = c.input_count as usize + c.gates.len();
    for (g, gate) in c.gates.iter().enumerate() {
        let limit = c.input_count + g as u32; // wires definable before this gate
        let refs: Vec<u32> = match gate {
            Gate::Add { a, b } | Gate::Mul { a, b } | Gate::Lt { a, b } | Gate::Eq { a, b } => {
                vec![*a, *b]
            }
            Gate::AddConst { a, .. } | Gate::MulConst { a, .. } => vec![*a],
            Gate::Const { .. } => vec![],
            Gate::Select { cond, a, b } => vec![*cond, *a, *b],
        };
        for r in refs {
            if r >= limit {
                anyhow::bail!(
                    "gate {g} references wire {r}, which is not defined before it \
                     (only wires 0..{limit} exist at that point) — forward or \
                     out-of-range reference"
                );
            }
        }
    }
    for &w in &c.outputs {
        if w as usize >= total {
            anyhow::bail!(
                "output references wire {w}, but the circuit only has {total} wires (0..{total})"
            );
        }
    }
    if c.outputs.is_empty() {
        anyhow::bail!("circuit has no outputs");
    }
    Ok(())
}

struct Template {
    name: &'static str,
    blurb: &'static str,
    circuit_json: &'static str,
    /// (input names) used in the generated README + callback comments.
    inputs: &'static str,
}

fn templates() -> &'static [Template] {
    &[
        Template {
            name: "hello",
            blurb: "order notional = price * quantity (one private multiply)",
            inputs: "price, quantity",
            circuit_json: r#"{
  "inputs": 2,
  "gates": [ { "op": "mul", "a": 0, "b": 1 } ],
  "outputs": [2]
}
"#,
        },
        Template {
            name: "auction",
            blurb: "sealed-bid: highest of two private bids = max(bid0, bid1)",
            inputs: "bid0, bid1",
            // wire2 = bid0<bid1 ; wire3 = select(wire2, bid1, bid0) = max
            circuit_json: r#"{
  "inputs": 2,
  "gates": [
    { "op": "lt", "a": 0, "b": 1 },
    { "op": "select", "cond": 2, "a": 1, "b": 0 }
  ],
  "outputs": [3]
}
"#,
        },
        Template {
            name: "vote",
            blurb: "private tally of three yes(1)/no(0) votes = sum",
            inputs: "vote0, vote1, vote2",
            circuit_json: r#"{
  "inputs": 3,
  "gates": [
    { "op": "add", "a": 0, "b": 1 },
    { "op": "add", "a": 3, "b": 2 }
  ],
  "outputs": [4]
}
"#,
        },
    ]
}

pub fn template_names() -> Vec<&'static str> {
    templates().iter().map(|t| t.name).collect()
}

/// Scaffold a new project directory from a template.
pub fn scaffold(dir: &str, template: &str) -> anyhow::Result<()> {
    let t = templates()
        .iter()
        .find(|t| t.name == template)
        .ok_or_else(|| {
            anyhow::anyhow!(
                "unknown template '{template}'; have: {:?}",
                template_names()
            )
        })?;
    let root = Path::new(dir);
    if root.exists() {
        anyhow::bail!("{dir} already exists");
    }
    std::fs::create_dir_all(root.join("src"))?;

    std::fs::write(root.join("circuit.json"), t.circuit_json)?;
    std::fs::write(root.join("glasel.toml"), glasel_toml(t.name))?;
    let pascal = pascal_case(t.name);
    std::fs::write(
        root.join("src").join(format!("{pascal}Callback.sol")),
        callback_sol(&pascal, t),
    )?;
    std::fs::write(root.join("README.md"), readme(t))?;
    println!("created {dir}/ from template '{}'", t.name);
    println!("  circuit.json  — {} ({})", t.blurb, t.inputs);
    println!("  glasel.toml  — project + Base Sepolia addresses");
    println!("  src/{pascal}Callback.sol — ConfidentialBase consumer stub");
    println!("  README.md     — next steps");
    println!("\nNext:\n  glaselvm simulate {dir}/circuit.json --inputs <values>\n  glaselvm compile  {dir}/circuit.json --out {dir}/circuit.bin");
    Ok(())
}

/// Generate a Solidity `ConfidentialBase` callback stub for a compiled circuit,
/// with the circuit's input/output arity baked into the doc comment.
pub fn gen_callback(contract_name: &str, circuit: &Circuit) -> String {
    format!(
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {{ConfidentialBase}} from "glasel-contracts/ConfidentialBase.sol";

/// @title {name}
/// @notice Auto-generated by `glaselvm compile --emit-callback` for a Glasel
///         circuit ({inputs} encrypted input(s) → {outputs} sealed output(s)).
contract {name} is ConfidentialBase {{
    bytes32 public compDefId; // your deployed circuit's compDefId

    constructor(address coordinator, address feeOracle, address token, bytes32 _compDefId)
        ConfidentialBase(coordinator, feeOracle, token)
    {{
        compDefId = _compDefId;
    }}

    /// Commission a computation over `encInputs` (from @glasel/client).
    function run(bytes32 mxeId, bytes calldata encInputs) external returns (bytes32) {{
        return _invokeConfidential(
            mxeId, compDefId, encInputs, this.onComputationComplete.selector, 200_000
        );
    }}

    function onComputationComplete(bytes32 computationId, bytes calldata encResult)
        external
        override
        onlyCoordinator
    {{
        // TODO: decode the {outputs} sealed output(s) for your application.
        emit ComputationHandled(computationId, encResult);
    }}

    event ComputationHandled(bytes32 indexed computationId, bytes encResult);
}}
"#,
        name = contract_name,
        inputs = circuit.input_count,
        outputs = circuit.output_count(),
    )
}

fn glasel_toml(name: &str) -> String {
    // Live BLS-only Base Sepolia deployment (docs/TESTNET.md).
    format!(
        r#"[project]
name = "{name}"
circuit = "circuit.json"

[network]
name = "base-sepolia"
rpc = "https://sepolia.base.org"
chain_id = 84532

[contracts]
coordinator          = "0x1FbB367715D26F752357dc7ee60b957CB40d8452"
cluster_manager      = "0x875975030Ea94dDbEacfb5fcb9dAeaD4dC70A523"
mxe_factory          = "0x7CE839Eea76EA1F2F808E4c831a0910A23425f30"
computation_registry = "0x359e6fd81BD1EAE7F4ae7a7Fdc29b1986f679F72"
fee_oracle           = "0x0d3cCA64CaAC0b9c1CBaE9420898A33d8b3615Fc"
glasel_token        = "0xa9E29104Fa0287db5bb5BB048a729C93f746b09C"
"#
    )
}

fn callback_sol(pascal: &str, t: &Template) -> String {
    format!(
        r#"// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {{ConfidentialBase}} from "glasel-contracts/ConfidentialBase.sol";

/// @title {pascal}
/// @notice {blurb}.
///         Inputs ({inputs}) are encrypted client-side; the cluster computes the
///         circuit under MPC and calls back with the sealed result.
contract {pascal} is ConfidentialBase {{
    bytes32 public compDefId; // set to your deployed circuit's compDefId

    constructor(address coordinator, address feeOracle, address token, bytes32 _compDefId)
        ConfidentialBase(coordinator, feeOracle, token)
    {{
        compDefId = _compDefId;
    }}

    /// Commission a computation over `encInputs` (produced by the @glasel/client SDK).
    function run(bytes32 mxeId, bytes calldata encInputs) external returns (bytes32) {{
        return _invokeConfidential(
            mxeId, compDefId, encInputs, this.onComputationComplete.selector, 200_000
        );
    }}

    /// Called by the coordinator with the sealed result.
    function onComputationComplete(bytes32 computationId, bytes calldata encResult)
        external
        override
        onlyCoordinator
    {{
        // TODO: decode/handle the sealed result for your application.
        emit ComputationHandled(computationId, encResult);
    }}

    event ComputationHandled(bytes32 indexed computationId, bytes encResult);
}}
"#,
        pascal = pascal,
        blurb = t.blurb,
        inputs = t.inputs,
    )
}

fn readme(t: &Template) -> String {
    format!(
        r#"# {name} — a Glasel confidential-compute app

**Circuit:** {blurb}
**Private inputs:** {inputs}

## 1. Simulate locally (no chain, no nodes)
```
glaselvm simulate circuit.json --inputs <comma-separated values>
```

> **Prefer Rust?** `circuit.json` is the no-toolchain authoring path. You can also
> author the same circuit in plain Rust with the Arcis-style DSL and operator
> overloading, then `serialize()` it to the `circuit.bin` used in step 3:
> ```rust
> use glasel_circuit::{{Program, serialize}};
> use num_bigint::BigUint;
> let (p, [bid, reserve]) = Program::new::<2>();
> let zero = p.constant(BigUint::from(0u32));
> let payout = bid.lt(&reserve).select(&zero, &bid);
> let bytes = serialize(&p.build([payout]));   // → circuit.bin
> ```
> See `cargo run -p glasel-circuit --example dsl_auction` for a complete program.

## 2. Compile to bytecode
```
glaselvm compile circuit.json --out circuit.bin
```

## 3. Deploy the circuit definition (Base Sepolia)
```
glaselvm deploy-circuit circuit.bin \
  --rpc https://sepolia.base.org \
  --private-key $PRIVATE_KEY \
  --registry 0x359e6fd81BD1EAE7F4ae7a7Fdc29b1986f679F72
# → compDefId = 0x...
```

## 4. Wire your callback contract
`src/*Callback.sol` extends `ConfidentialBase`. Set its `compDefId`, deploy it,
and call `run(mxeId, encInputs)` with inputs encrypted by `@glasel/client`:
```ts
import {{ GlaselClient }} from "@glasel/client";
const enc = client.encrypt({{ schema, value, clusterKey }});
```

## 5. Watch + decrypt the result
```ts
const res = await client.watchComputation({{ computationId }});
const out = client.decryptResult({{ encResult: res.encResult, privateKey, schema }});
```

Contracts + addresses are in `glasel.toml`. See the Glasel docs for the full
lifecycle and the `@glasel/client` SDK reference.
"#,
        name = t.name,
        blurb = t.blurb,
        inputs = t.inputs,
    )
}

fn pascal_case(s: &str) -> String {
    s.split(|c| c == '-' || c == '_')
        .map(|w| {
            let mut ch = w.chars();
            match ch.next() {
                Some(f) => f.to_uppercase().chain(ch).collect::<String>(),
                None => String::new(),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use glasel_circuit::evaluate;

    #[test]
    fn json_roundtrips_and_evaluates() {
        for (tmpl, inputs, expect) in [
            ("hello", vec![1000u64, 7], 7000u64),
            ("auction", vec![5, 7], 7),
            ("vote", vec![1, 0, 1], 2),
        ] {
            let t = super::templates().iter().find(|t| t.name == tmpl).unwrap();
            let c = parse_circuit_json(t.circuit_json).unwrap();
            let out = evaluate(
                &c,
                &inputs.iter().map(|&x| BigUint::from(x)).collect::<Vec<_>>(),
            )
            .unwrap();
            assert_eq!(out, vec![BigUint::from(expect)], "template {tmpl}");
        }
    }

    #[test]
    fn parse_rejects_malformed_circuits() {
        // not even valid JSON
        assert!(parse_circuit_json("{ not json").is_err());
        // unknown op
        assert!(parse_circuit_json(
            r#"{"inputs":2,"gates":[{"op":"xor","a":0,"b":1}],"outputs":[2]}"#
        )
        .is_err());
        // const op without a constant
        assert!(
            parse_circuit_json(r#"{"inputs":0,"gates":[{"op":"const"}],"outputs":[0]}"#).is_err()
        );
        // non-decimal constant
        assert!(parse_circuit_json(
            r#"{"inputs":1,"gates":[{"op":"addconst","a":0,"c":"0xff"}],"outputs":[1]}"#
        )
        .is_err());
    }

    #[test]
    fn validate_rejects_bad_wire_references() {
        // forward reference: gate 0 produces wire 2 but reads wire 2 (itself)
        let fwd = r#"{"inputs":2,"gates":[{"op":"mul","a":0,"b":2}],"outputs":[2]}"#;
        assert!(parse_circuit_json(fwd).is_err(), "self/forward ref");

        // out-of-range input reference (only wires 0,1 exist before gate 0)
        let oor = r#"{"inputs":2,"gates":[{"op":"add","a":0,"b":9}],"outputs":[2]}"#;
        assert!(parse_circuit_json(oor).is_err(), "out-of-range input");

        // output references a non-existent wire (total wires = 2 inputs + 1 gate = 3)
        let bad_out = r#"{"inputs":2,"gates":[{"op":"add","a":0,"b":1}],"outputs":[99]}"#;
        assert!(parse_circuit_json(bad_out).is_err(), "out-of-range output");

        // no outputs
        let no_out = r#"{"inputs":1,"gates":[],"outputs":[]}"#;
        assert!(parse_circuit_json(no_out).is_err(), "no outputs");

        // a valid chained circuit still parses: w2=w0+w1, w3=w2*w0, out [w3]
        let ok = r#"{"inputs":2,"gates":[{"op":"add","a":0,"b":1},{"op":"mul","a":2,"b":0}],"outputs":[3]}"#;
        let c = parse_circuit_json(ok).expect("valid chained circuit");
        let out = evaluate(&c, &[BigUint::from(5u32), BigUint::from(3u32)]).unwrap();
        assert_eq!(out, vec![BigUint::from(40u32)], "(5+3)*5 = 40");
    }
}
