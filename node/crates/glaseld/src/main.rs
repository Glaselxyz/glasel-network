//! GlaselOS — Glasel MPC node daemon (Phase 3).
//!
//! Watches the ComputationCoordinator for ComputationRequested events, runs the
//! (simulated) MPC engine, threshold-signs the result, and submits it on-chain.
mod chain;
mod config;
mod dkg_signer;
mod engine;
mod malicious;
mod metrics;
mod mpc_engine;
mod mpc_session;
mod retry;
mod scheduler;
mod signer;

use crate::chain::Chain;
use crate::config::{hex32, Config};
use crate::engine::Engine;
use crate::malicious::MaliciousBackend;
use crate::metrics::Metrics;
use crate::mpc_session::MpcSession;
use crate::scheduler::Scheduler;
use crate::signer::BlsSigner;
use std::sync::Arc;
use std::time::Duration;
use tracing::{info, warn};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_max_level(tracing::Level::INFO)
        .init();

    let path = std::env::args().nth(1).unwrap_or_else(|| {
        std::env::var("GLASELD_CONFIG").unwrap_or_else(|_| "glaseld.toml".to_string())
    });
    let cfg = Config::load(&path)?;
    info!("GlaselOS starting; config = {path}");
    if config::has_inline_secret(&cfg) {
        warn!("node secrets are inlined in {path}; use env:/file: references in production");
    }

    // Secrets resolved via env:/file: (or inline). Recipient key is public.
    let cluster_key = hex32(&config::resolve_secret(&cfg.cluster.x25519_private_key)?)?;
    let recipient_key = hex32(&cfg.engine.recipient_public_key)?;
    let engine = Engine::new(cluster_key, recipient_key);
    // When [mpc] is configured, computations run as a real BGW session over the
    // authenticated, encrypted mesh; otherwise the single-process engine is used.
    let mpc_session = cfg.mpc.clone().map(|m| {
        info!(
            "MPC mode: party {} of {} (dealer {}, t={})",
            m.party_id,
            m.parties.len(),
            m.dealer_id,
            m.threshold
        );
        MpcSession::new(m, cluster_key, recipient_key)
    });
    let malicious = cfg.malicious.clone().map(|m| {
        info!(
            "MALICIOUS mode: MP-SPDZ MASCOT, {} parties via {}:{}, {}",
            m.parties, m.host, m.port, m.mpspdz_dir
        );
        MaliciousBackend::new(
            m.mpspdz_dir.into(),
            cluster_key,
            recipient_key,
            m.parties,
            m.host,
            m.port,
        )
    });
    let signer = BlsSigner::new(&config::resolve_secret(&cfg.cluster.bls_group_secret)?)?;
    // The first signer key funds + sends the submitResult transaction.
    let chain = Chain::new(
        &cfg.rpc_url,
        &cfg.contracts.coordinator,
        &cfg.contracts.computation_registry,
        &config::resolve_secret(&cfg.signers.keys[0])?,
    )?;
    let mut scheduler = Scheduler::new();

    // Prometheus metrics endpoint (optional).
    let metrics = Arc::new(Metrics::default());
    if let Some(addr) = cfg.metrics_addr.clone() {
        let m = metrics.clone();
        tokio::spawn(async move {
            if let Err(e) = metrics::serve(m, addr).await {
                warn!("metrics server error: {e}");
            }
        });
    }

    info!("BLS group key: {:?}", signer.group_pubkey());
    let mut from = cfg.start_block;

    loop {
        let latest = match chain.latest_block().await {
            Ok(b) => b,
            Err(e) => {
                warn!("rpc error: {e}");
                tokio::time::sleep(Duration::from_millis(cfg.poll_interval_ms)).await;
                continue;
            }
        };

        if latest >= from {
            match chain.poll(from, latest).await {
                Ok(tasks) => {
                    for t in tasks {
                        scheduler.enqueue(t);
                    }
                }
                Err(e) => warn!("poll error: {e}"),
            }
            from = latest + 1;
        }

        while let Some(task) = scheduler.next() {
            info!("computing {}", task.computation_id);
            Metrics::inc(&metrics.seen);
            let bytecode = match chain.circuit_bytecode(task.comp_def_id).await {
                Ok(b) => b,
                Err(e) => {
                    warn!("fetch circuit failed for {}: {e}", task.computation_id);
                    Metrics::inc(&metrics.failed);
                    continue;
                }
            };
            let enc_result = if let Some(backend) = &malicious {
                // Malicious-secure compute via MP-SPDZ MASCOT.
                match backend.run(&bytecode, &task.enc_inputs) {
                    Ok(r) => r,
                    Err(e) => {
                        warn!("malicious backend error for {}: {e}", task.computation_id);
                        continue;
                    }
                }
            } else if let Some(session) = &mpc_session {
                // Real multi-party BGW over the authenticated, encrypted mesh.
                match session.run(&bytecode, &task.enc_inputs) {
                    Ok(r) => r,
                    Err(e) => {
                        warn!("mpc session error for {}: {e}", task.computation_id);
                        continue;
                    }
                }
            } else {
                match engine.run(&bytecode, &task.enc_inputs) {
                    Ok(r) => r,
                    Err(e) => {
                        warn!("engine error for {}: {e}", task.computation_id);
                        continue;
                    }
                }
            };

            // In MPC mode every node computes the same opened result, but only the
            // designated submitter posts it on-chain (avoids N duplicate submits).
            if let Some(m) = &cfg.mpc {
                if !m.submitter {
                    info!(
                        "participated in MPC for {} (submitter posts result)",
                        task.computation_id
                    );
                    if cfg.run_once {
                        info!("run_once set; exiting after one computation");
                        return Ok(());
                    }
                    continue;
                }
            }

            let sig = signer.sign_result(task.computation_id, &enc_result);
            // Tolerate transient RPC failures with exponential backoff (3 tries).
            let submit = retry::retry_with_backoff(3, Duration::from_millis(800), || {
                chain.submit_result(task.computation_id, enc_result.clone(), sig)
            })
            .await;
            match submit {
                Ok(tx) => {
                    info!("submitted result for {} in tx {}", task.computation_id, tx);
                    Metrics::inc(&metrics.completed);
                    if cfg.run_once {
                        info!("run_once set; exiting after one successful computation");
                        return Ok(());
                    }
                }
                Err(e) => {
                    warn!("submit failed for {}: {e}", task.computation_id);
                    Metrics::inc(&metrics.submit_errors);
                    if cfg.run_once {
                        anyhow::bail!("submit failed under run_once: {e}");
                    }
                }
            }
        }

        tokio::time::sleep(Duration::from_millis(cfg.poll_interval_ms)).await;
    }
}
