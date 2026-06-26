//! Prometheus metrics for GlaselOS. Counters are exposed in the text exposition
//! format on a `/metrics` endpoint for a Prometheus scraper / Grafana board.
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

#[derive(Default)]
pub struct Metrics {
    pub seen: AtomicU64,
    pub completed: AtomicU64,
    pub failed: AtomicU64,
    pub submit_errors: AtomicU64,
}

impl Metrics {
    pub fn inc(c: &AtomicU64) {
        c.fetch_add(1, Ordering::Relaxed);
    }

    /// Render in Prometheus 0.0.4 text exposition format.
    pub fn render(&self) -> String {
        let g = |c: &AtomicU64| c.load(Ordering::Relaxed);
        let mut s = String::new();
        for (name, help, val) in [
            (
                "glaseld_computations_seen",
                "Computations detected on-chain",
                g(&self.seen),
            ),
            (
                "glaseld_computations_completed",
                "Computations submitted successfully",
                g(&self.completed),
            ),
            (
                "glaseld_computations_failed",
                "Computations that errored before submit",
                g(&self.failed),
            ),
            (
                "glaseld_submit_errors",
                "submitResult transaction failures",
                g(&self.submit_errors),
            ),
        ] {
            s.push_str(&format!(
                "# HELP {name} {help}\n# TYPE {name} counter\n{name} {val}\n"
            ));
        }
        s
    }
}

/// Serve `/metrics` on `addr` (e.g. `0.0.0.0:9090`) — a minimal HTTP scrape target.
pub async fn serve(metrics: Arc<Metrics>, addr: String) -> std::io::Result<()> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    tracing::info!("metrics endpoint on http://{addr}/metrics");
    loop {
        let (mut sock, _) = listener.accept().await?;
        let m = metrics.clone();
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            let _ = sock.read(&mut buf).await; // request line ignored; always serve metrics
            let body = m.render();
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/plain; version=0.0.4\r\nContent-Length: {}\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = sock.write_all(resp.as_bytes()).await;
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn render_emits_prometheus_counters() {
        let m = Metrics::default();
        Metrics::inc(&m.seen);
        Metrics::inc(&m.seen);
        Metrics::inc(&m.completed);
        let out = m.render();
        assert!(out.contains("# TYPE glaseld_computations_seen counter"));
        assert!(out.contains("glaseld_computations_seen 2"));
        assert!(out.contains("glaseld_computations_completed 1"));
        assert!(out.contains("glaseld_submit_errors 0"));
    }
}
