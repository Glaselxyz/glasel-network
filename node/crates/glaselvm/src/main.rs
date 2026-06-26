//! glaselvm — the Glasel developer CLI (§8.1).
//!
//! Subcommands:
//!   list                                  list built-in circuits
//!   compile <name> --out <path>           optimize + serialize a circuit (+ .abi.json)
//!   info <path.bin>                        show circuit stats
//!   simulate <name|--bin path> --inputs a,b,c   evaluate in the clear
//!   deploy-circuit <path.bin> --rpc <u> --private-key <k> --registry <addr>
//!   estimate-fee --comp-def <id> --rpc <u> --fee-oracle <addr> [--callback-gas n]
mod authoring;
mod chain;
mod manifest;

use alloy::primitives::B256;
use glasel_circuit::{deserialize, evaluate, examples, optimize, serialize, Circuit};
use num_bigint::BigUint;
use std::collections::HashMap;
use std::str::FromStr;

fn main() {
    if let Err(e) = run() {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn run() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("help");
    let rest: &[String] = if args.is_empty() { &[] } else { &args[1..] };
    let opts = parse_opts(rest);

    match cmd {
        "list" => cmd_list(),
        "new" => cmd_new(rest, &opts),
        "compile" => cmd_compile(rest, &opts),
        "info" => cmd_info(rest),
        "simulate" => cmd_simulate(rest, &opts),
        "deploy-circuit" => cmd_deploy(rest, &opts),
        "estimate-fee" => cmd_estimate(&opts),
        _ => {
            print_help();
            Ok(())
        }
    }
}

fn cmd_list() -> anyhow::Result<()> {
    println!("built-in circuits:");
    for name in ["identity5", "sum5", "order_notional"] {
        let c = examples::by_name(name).unwrap();
        println!(
            "  {name:<16} inputs={} outputs={} gates={}",
            c.input_count,
            c.output_count(),
            c.gates.len()
        );
    }
    Ok(())
}

fn load_named(name: &str) -> anyhow::Result<Circuit> {
    examples::by_name(name).ok_or_else(|| anyhow::anyhow!("unknown circuit '{name}'"))
}

/// Resolve a circuit by `.json` authoring file, `.bin` bytecode, or built-in name.
fn load_circuit(name_or_path: &str) -> anyhow::Result<Circuit> {
    if name_or_path.ends_with(".json") {
        authoring::parse_circuit_json(&std::fs::read_to_string(name_or_path)?)
    } else if name_or_path.ends_with(".bin") {
        deserialize(&std::fs::read(name_or_path)?).map_err(|e| anyhow::anyhow!(e))
    } else {
        load_named(name_or_path)
    }
}

fn cmd_new(rest: &[String], opts: &Opts) -> anyhow::Result<()> {
    let dir = positional(rest).ok_or_else(|| {
        anyhow::anyhow!(
            "usage: new <dir> --template <{}>",
            authoring::template_names().join("|")
        )
    })?;
    let template = opts.get("template").unwrap_or_else(|| "hello".to_string());
    authoring::scaffold(&dir, &template)
}

fn cmd_compile(rest: &[String], opts: &Opts) -> anyhow::Result<()> {
    // Circuit from a positional arg, or default to the project's glasel.toml.
    let manifest = manifest::Manifest::maybe_cwd();
    let name = match positional(rest) {
        Some(n) => n,
        None => manifest
            .as_ref()
            .map(|m| m.project.circuit.clone())
            .ok_or_else(|| anyhow::anyhow!("usage: compile <name|circuit.json> --out <path> (or run in a project with glasel.toml)"))?,
    };
    let out = opts.req("out")?;
    let circuit = load_circuit(&name)?;
    let optimized = optimize(&circuit);
    let bytes = serialize(&optimized);
    std::fs::write(&out, &bytes)?;

    // Optionally emit a Solidity callback stub derived from the circuit.
    if let Some(cb_path) = opts.get("emit-callback") {
        let contract = std::path::Path::new(&cb_path)
            .file_stem()
            .and_then(|s| s.to_str())
            .unwrap_or("GlaselCallback")
            .to_string();
        std::fs::write(&cb_path, authoring::gen_callback(&contract, &optimized))?;
        println!("  wrote callback stub {cb_path}");
    }

    let abi = serde_json::json!({
        "name": name,
        "inputCount": optimized.input_count,
        "outputCount": optimized.output_count(),
        "gateCount": optimized.gates.len(),
        "mulCount": optimized.mul_count(),
        "estimatedGates": optimized.estimated_gates(),
    });
    let abi_path = format!("{out}.abi.json");
    std::fs::write(&abi_path, serde_json::to_string_pretty(&abi)?)?;

    println!("compiled '{name}':");
    println!(
        "  gates {} -> {} after optimization",
        circuit.gates.len(),
        optimized.gates.len()
    );
    println!("  estimatedGates {}", optimized.estimated_gates());
    println!("  wrote {out} ({} bytes) + {abi_path}", bytes.len());
    Ok(())
}

fn cmd_info(rest: &[String]) -> anyhow::Result<()> {
    let path = positional(rest).ok_or_else(|| anyhow::anyhow!("usage: info <path.bin>"))?;
    let bytes = std::fs::read(&path)?;
    let c = deserialize(&bytes).map_err(|e| anyhow::anyhow!(e))?;
    println!("circuit {path}:");
    println!(
        "  inputs {}  outputs {}  gates {}  muls {}  estimatedGates {}",
        c.input_count,
        c.output_count(),
        c.gates.len(),
        c.mul_count(),
        c.estimated_gates()
    );
    Ok(())
}

fn cmd_simulate(rest: &[String], opts: &Opts) -> anyhow::Result<()> {
    let circuit = if let Some(bin) = opts.get("bin") {
        deserialize(&std::fs::read(bin)?).map_err(|e| anyhow::anyhow!(e))?
    } else {
        let name = positional(rest).ok_or_else(|| {
            anyhow::anyhow!("usage: simulate <name|circuit.json> --inputs a,b,...")
        })?;
        load_circuit(&name)?
    };
    let inputs_str = opts
        .req("inputs")
        .map_err(|_| anyhow::anyhow!("--inputs required (comma-separated decimals)"))?;
    let inputs: Vec<BigUint> = inputs_str
        .split(',')
        .map(|s| BigUint::from_str(s.trim()).map_err(|e| anyhow::anyhow!("bad input '{s}': {e}")))
        .collect::<anyhow::Result<_>>()?;
    let out = evaluate(&circuit, &inputs).map_err(|e| anyhow::anyhow!(e))?;
    println!(
        "outputs: [{}]",
        out.iter()
            .map(|x| x.to_string())
            .collect::<Vec<_>>()
            .join(", ")
    );
    Ok(())
}

fn cmd_deploy(rest: &[String], opts: &Opts) -> anyhow::Result<()> {
    let path = positional(rest).ok_or_else(|| {
        anyhow::anyhow!("usage: deploy-circuit <path.bin> --rpc --private-key --registry")
    })?;
    let bytes = std::fs::read(&path)?;
    let circuit = deserialize(&bytes).map_err(|e| anyhow::anyhow!(e))?;
    // RPC + registry default from glasel.toml when not passed explicitly.
    let manifest = manifest::Manifest::maybe_cwd();
    let rpc = opts
        .get("rpc")
        .or_else(|| manifest.as_ref().and_then(|m| m.network.rpc.clone()))
        .ok_or_else(|| anyhow::anyhow!("--rpc required (or [network].rpc in glasel.toml)"))?;
    let registry = opts
        .get("registry")
        .or_else(|| {
            manifest
                .as_ref()
                .and_then(|m| m.contracts.computation_registry.clone())
        })
        .ok_or_else(|| {
            anyhow::anyhow!(
                "--registry required (or [contracts].computation_registry in glasel.toml)"
            )
        })?;
    let key = opts.req("private-key")?;

    let rt = tokio::runtime::Runtime::new()?;
    let id = rt.block_on(chain::deploy_circuit(
        &rpc,
        &key,
        &registry,
        bytes,
        circuit.estimated_gates(),
        circuit.input_count,
        circuit.output_count() as u32,
    ))?;
    println!("compDefId = {id}");
    Ok(())
}

fn cmd_estimate(opts: &Opts) -> anyhow::Result<()> {
    let rpc = opts.req("rpc")?;
    let fee_oracle = opts.req("fee-oracle")?;
    let comp_def = B256::from_str(opts.req("comp-def")?.trim_start_matches("0x"))?;
    let gas: u64 = opts
        .get("callback-gas")
        .map(|s| s.parse())
        .transpose()?
        .unwrap_or(200_000);
    let rt = tokio::runtime::Runtime::new()?;
    let (fee, deadline) = rt.block_on(chain::estimate_fee(&rpc, &fee_oracle, comp_def, gas))?;
    println!("fee = {fee} CONFIDE-wei, deadline = {deadline}s");
    Ok(())
}

// ─── arg parsing ──────────────────────────────────────────────────────────────

struct Opts(HashMap<String, String>);
impl Opts {
    fn get(&self, k: &str) -> Option<String> {
        self.0.get(k).cloned()
    }
    fn req(&self, k: &str) -> anyhow::Result<String> {
        self.get(k).ok_or_else(|| anyhow::anyhow!("--{k} required"))
    }
}

fn parse_opts(args: &[String]) -> Opts {
    let mut m = HashMap::new();
    let mut i = 0;
    while i < args.len() {
        if let Some(key) = args[i].strip_prefix("--") {
            if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                m.insert(key.to_string(), args[i + 1].clone());
                i += 2;
            } else {
                m.insert(key.to_string(), "true".to_string());
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    Opts(m)
}

/// First non-flag argument (skipping flag values).
fn positional(args: &[String]) -> Option<String> {
    let mut i = 0;
    while i < args.len() {
        if args[i].starts_with("--") {
            i += if i + 1 < args.len() && !args[i + 1].starts_with("--") {
                2
            } else {
                1
            };
        } else {
            return Some(args[i].clone());
        }
    }
    None
}

fn print_help() {
    println!("glaselvm — Glasel developer CLI");
    println!("commands:");
    println!("  list");
    println!("  new <dir> --template <hello|auction|vote>   scaffold a project");
    println!("  compile <name|circuit.json> --out <path>");
    println!("  info <path.bin>");
    println!("  simulate <name|circuit.json|--bin path> --inputs a,b,c");
    println!("  deploy-circuit <path.bin> --rpc <u> --private-key <k> --registry <addr>");
    println!("  estimate-fee --comp-def <id> --rpc <u> --fee-oracle <addr> [--callback-gas n]");
}
