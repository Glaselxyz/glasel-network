//! glaseld-party — run one MPC party as its own process, or deal inputs.
//!
//!   glaseld-party deal --inputs 1000,7 --n 3 --t 1 --out-dir ./mpc-run
//!   glaseld-party run  --id 1 --t 1 --addrs 127.0.0.1:9001,127.0.0.1:9002,127.0.0.1:9003 \
//!                    --shares ./mpc-run/shares-1.json --circuit ./mpc-run/circuit.json \
//!                    --roster ./mpc-run/roster.json [--recipient 0x… | --insecure]
//!
//! `deal` secret-shares the cleartext inputs and writes a circuit, a Noise
//! identity keypair per party (private in each share file), and a `roster.json`
//! of all public keys. `run` connects to the other parties **over an
//! authenticated, encrypted Noise mesh by default** (verifying each peer's key
//! against the roster), evaluates the circuit over shares (BGW), robustly opens
//! the output, and prints it. `--insecure` falls back to plaintext TCP for local
//! debugging only. No `run` process ever sees a plaintext input.
use glasel_circuit::ir::{Circuit, Gate};
use glasel_crypto::{seal, serialize_payload};
use glasel_mpc::net::{SecureTcpNet, TcpNet};
use glasel_mpc::secure::generate_static_keypair;
use glasel_mpc::{deal, run_party_checked};
use num_bigint::BigUint;
use rand::rngs::StdRng;
use rand::SeedableRng;
use std::collections::HashMap;
use std::fs;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let sub = args.get(1).map(String::as_str).unwrap_or("");
    let opts = parse_opts(&args);
    let r = match sub {
        "deal" => cmd_deal(&opts),
        "run" => cmd_run(&opts),
        _ => {
            eprintln!("usage: glaseld-party <deal|run> [--flags]");
            std::process::exit(2);
        }
    };
    if let Err(e) = r {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn parse_opts(args: &[String]) -> HashMap<String, String> {
    let mut m = HashMap::new();
    let mut i = 2;
    while i < args.len() {
        if let Some(k) = args[i].strip_prefix("--") {
            // A valueless flag (e.g. --insecure) is one whose next token is
            // another flag or absent; otherwise consume the value.
            match args.get(i + 1) {
                Some(v) if !v.starts_with("--") => {
                    m.insert(k.to_string(), v.clone());
                    i += 2;
                }
                _ => {
                    m.insert(k.to_string(), "true".to_string());
                    i += 1;
                }
            }
        } else {
            i += 1;
        }
    }
    m
}

fn req<'a>(o: &'a HashMap<String, String>, k: &str) -> Result<&'a String, String> {
    o.get(k).ok_or_else(|| format!("missing --{k}"))
}

fn parse_fe(s: &str) -> BigUint {
    BigUint::parse_bytes(s.trim().as_bytes(), 10).expect("decimal field element")
}

fn cmd_deal(o: &HashMap<String, String>) -> Result<(), String> {
    let inputs: Vec<BigUint> = req(o, "inputs")?.split(',').map(parse_fe).collect();
    let n: usize = req(o, "n")?.parse().map_err(|_| "bad --n")?;
    let t: usize = req(o, "t")?.parse().map_err(|_| "bad --t")?;
    let out_dir = o.get("out-dir").cloned().unwrap_or_else(|| ".".into());
    if inputs.len() != 2 {
        return Err("this demo dealer expects exactly 2 inputs (a product circuit)".into());
    }
    fs::create_dir_all(&out_dir).map_err(|e| e.to_string())?;

    // order_notional: out = in0 * in1
    let circuit = Circuit {
        input_count: 2,
        gates: vec![Gate::Mul { a: 0, b: 1 }],
        outputs: vec![2],
    };
    fs::write(
        format!("{out_dir}/circuit.json"),
        serde_json::to_vec_pretty(&circuit).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    // Per-party Noise identity keypairs (in production these are the nodes'
    // long-lived keys registered on-chain; here the dealer/orchestrator mints
    // them for the demo). The roster of public keys authenticates the mesh.
    let identities: Vec<(Vec<u8>, Vec<u8>)> = (0..n).map(|_| generate_static_keypair()).collect();
    let roster: Vec<String> = identities.iter().map(|(_, pk)| hex::encode(pk)).collect();
    fs::write(
        format!("{out_dir}/roster.json"),
        serde_json::to_vec_pretty(&serde_json::json!({ "pubkeys": roster }))
            .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut rng = StdRng::from_entropy();
    let per_party = deal(&inputs, n, t, &mut rng);
    for (i, shares) in per_party.iter().enumerate() {
        let dec: Vec<String> = shares.iter().map(|s| s.to_str_radix(10)).collect();
        let body = serde_json::json!({
            "id": i + 1, "n": n, "t": t, "shares": dec,
            "identity_private": hex::encode(&identities[i].0),
        });
        fs::write(
            format!("{out_dir}/shares-{}.json", i + 1),
            serde_json::to_vec_pretty(&body).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }
    println!(
        "dealt {} inputs to {n} parties (t={t}) in {out_dir}/",
        inputs.len()
    );
    Ok(())
}

fn cmd_run(o: &HashMap<String, String>) -> Result<(), String> {
    let id: usize = req(o, "id")?.parse().map_err(|_| "bad --id")?;
    let t: usize = req(o, "t")?.parse().map_err(|_| "bad --t")?;
    let addrs: Vec<String> = req(o, "addrs")?
        .split(',')
        .map(|s| s.trim().to_string())
        .collect();
    let n = addrs.len();

    let circuit: Circuit =
        serde_json::from_slice(&fs::read(req(o, "circuit")?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;

    let share_doc: serde_json::Value =
        serde_json::from_slice(&fs::read(req(o, "shares")?).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let input_shares: Vec<BigUint> = share_doc["shares"]
        .as_array()
        .ok_or("shares must be an array")?
        .iter()
        .map(|v| parse_fe(v.as_str().unwrap()))
        .collect();

    let insecure = o.contains_key("insecure");
    let mut rng = StdRng::from_entropy();

    // Connect the mesh — authenticated + encrypted (Noise) by default; plaintext
    // only with --insecure. Robust open aborts if any party lies about a share.
    let outputs = if insecure {
        eprintln!("[party {id}] connecting to {n} parties (INSECURE plaintext) …");
        let net = TcpNet::connect(id, n, addrs).map_err(|e| e.to_string())?;
        eprintln!("[party {id}] mesh up; evaluating circuit over shares …");
        run_party_checked(&circuit, &input_shares, &net, t, &mut rng)
    } else {
        let id_priv = hex::decode(
            share_doc["identity_private"]
                .as_str()
                .ok_or("share file missing identity_private")?,
        )
        .map_err(|e| e.to_string())?;
        let roster: serde_json::Value =
            serde_json::from_slice(&fs::read(req(o, "roster")?).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let peer_pks: Vec<Vec<u8>> = roster["pubkeys"]
            .as_array()
            .ok_or("roster must have a pubkeys array")?
            .iter()
            .map(|v| hex::decode(v.as_str().unwrap()).unwrap())
            .collect();
        eprintln!("[party {id}] connecting to {n} parties (authenticated Noise mesh) …");
        let net =
            SecureTcpNet::connect(id, n, addrs, &id_priv, &peer_pks).map_err(|e| e.to_string())?;
        eprintln!("[party {id}] secure mesh up; evaluating circuit over shares …");
        run_party_checked(&circuit, &input_shares, &net, t, &mut rng)
    }
    .map_err(|e| format!("MPC aborted: {e}"))?;

    // If a recipient X25519 key is given, seal the result and emit the on-chain
    // `encResult` bytes — the MPC output plugs straight into submitResult(BLS).
    if let Some(rcpt) = o.get("recipient") {
        let bytes = hex::decode(rcpt.trim_start_matches("0x")).map_err(|e| e.to_string())?;
        let mut key = [0u8; 32];
        if bytes.len() != 32 {
            return Err("--recipient must be 32 bytes".into());
        }
        key.copy_from_slice(&bytes);
        let enc_result = serialize_payload(&seal(&outputs, &key));
        println!(
            "{}",
            serde_json::json!({ "party": id, "encResult": format!("0x{}", hex::encode(enc_result)) })
        );
    } else {
        let dec: Vec<String> = outputs.iter().map(|s| s.to_str_radix(10)).collect();
        println!("{}", serde_json::json!({ "party": id, "outputs": dec }));
    }
    Ok(())
}
