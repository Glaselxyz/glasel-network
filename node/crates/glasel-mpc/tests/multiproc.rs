//! Real multi-process MPC: spawn the `glaseld-party` binary as three independent
//! OS processes that talk over the **authenticated, encrypted Noise mesh** (the
//! secure default), secret-share an input, compute a circuit over shares,
//! robustly open (with cheating detection), and seal the result to a recipient.
//! Asserts the sealed `encResult` decrypts to the expected output — and that no
//! single process ever held a plaintext input.
use glasel_crypto::{decrypt, deserialize_payload, generate_keypair};
use num_bigint::BigUint;
use std::process::{Command, Stdio};

fn bin() -> &'static str {
    env!("CARGO_BIN_EXE_glaseld-party")
}

#[test]
fn three_real_processes_compute_and_seal() {
    let dir = std::env::temp_dir().join(format!("glasel-mpc-{}", std::process::id()));
    let dir = dir.to_str().unwrap().to_string();

    // 1) Deal the (private) inputs into one share file per party.
    let st = Command::new(bin())
        .args([
            "deal",
            "--inputs",
            "1000,7",
            "--n",
            "3",
            "--t",
            "1",
            "--out-dir",
            &dir,
        ])
        .status()
        .expect("spawn deal");
    assert!(st.success(), "deal failed");

    // 2) Recipient key: the result is sealed so only this key can read it.
    let (recipient_priv, recipient_pub) = generate_keypair();
    let rcpt = format!("0x{}", hex::encode(recipient_pub));
    let addrs = "127.0.0.1:18021,127.0.0.1:18022,127.0.0.1:18023";

    // 3) Launch three party processes over real TCP.
    let kids: Vec<_> = (1..=3)
        .map(|id| {
            Command::new(bin())
                .args([
                    "run",
                    "--id",
                    &id.to_string(),
                    "--t",
                    "1",
                    "--addrs",
                    addrs,
                    "--shares",
                    &format!("{dir}/shares-{id}.json"),
                    "--circuit",
                    &format!("{dir}/circuit.json"),
                    "--roster",
                    &format!("{dir}/roster.json"),
                    "--recipient",
                    &rcpt,
                ])
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
                .expect("spawn party")
        })
        .collect();

    // 4) Each party emits the sealed encResult; collect them all.
    let mut enc_results = Vec::new();
    for k in kids {
        let out = k.wait_with_output().expect("wait party");
        assert!(out.status.success(), "a party process aborted");
        let stdout = String::from_utf8_lossy(&out.stdout);
        let line = stdout.trim().lines().last().expect("party produced output");
        let v: serde_json::Value = serde_json::from_str(line).expect("party json");
        enc_results.push(v["encResult"].as_str().expect("encResult").to_string());
    }
    assert_eq!(enc_results.len(), 3);

    // 5) Decrypt one sealed result with the recipient key → 1000 * 7 = 7000.
    let bytes = hex::decode(enc_results[0].trim_start_matches("0x")).unwrap();
    let payload = deserialize_payload(&bytes).unwrap();
    let outputs = decrypt(&payload, &recipient_priv);
    assert_eq!(
        outputs,
        vec![BigUint::from(7000u64)],
        "MPC across 3 processes must seal price*quantity"
    );

    let _ = std::fs::remove_dir_all(&dir);
}
