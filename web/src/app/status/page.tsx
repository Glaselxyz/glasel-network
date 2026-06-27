"use client";

import { useEffect, useState } from "react";
import { site, clusterId } from "@/lib/site";

type Status = {
  rpcReachable: boolean;
  blockNumber: string | null;
  coordinatorAcceptingJobs: boolean | null;
  clusterActive: boolean | null;
  checkedAt: string;
};

function Dot({ ok }: { ok: boolean | null }) {
  const color = ok === null ? "var(--faint)" : ok ? "var(--cyan)" : "#ff9d9d";
  return (
    <span
      className="inline-block h-2.5 w-2.5 rounded-full"
      style={{ background: color, boxShadow: ok ? `0 0 10px ${color}` : "none" }}
    />
  );
}

function Row({ label, ok, detail }: { label: string; ok: boolean | null; detail: string }) {
  return (
    <div className="flex items-center justify-between border-b border-line py-4 last:border-0">
      <div className="flex items-center gap-3">
        <Dot ok={ok} />
        <span className="text-ink">{label}</span>
      </div>
      <span className="font-mono text-sm text-muted">{detail}</span>
    </div>
  );
}

export default function StatusPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch("/api/status", { cache: "no-store" });
      setStatus(await res.json());
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || "failed to load status");
    }
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  const allUp =
    status?.rpcReachable && status?.coordinatorAcceptingJobs === true && status?.clusterActive === true;

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan">Network status</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">
        {status === null ? "Checking…" : allUp ? "All systems operational" : "Degraded / check below"}
      </h1>
      <p className="mt-4 text-muted">
        Live health of the Glasel testnet on {site.chain.name}. Auto-refreshes every 15s.
      </p>

      <div className="mt-8 rounded-2xl border border-line bg-panel p-6">
        {err && <p className="text-sm text-[#ff9d9d]">{err}</p>}
        {status && (
          <>
            <Row
              label="RPC endpoint"
              ok={status.rpcReachable}
              detail={status.rpcReachable ? `block ${status.blockNumber}` : "unreachable"}
            />
            <Row
              label="Coordinator (accepting jobs)"
              ok={status.coordinatorAcceptingJobs}
              detail={
                status.coordinatorAcceptingJobs === null
                  ? "unknown"
                  : status.coordinatorAcceptingJobs
                    ? "accepting"
                    : "paused"
              }
            />
            <Row
              label="Operator cluster"
              ok={status.clusterActive}
              detail={
                status.clusterActive === null ? "unknown" : status.clusterActive ? "active" : "inactive"
              }
            />
          </>
        )}
      </div>

      {status && (
        <p className="mt-4 font-mono text-xs text-faint">
          cluster {clusterId.slice(0, 10)}… · checked {new Date(status.checkedAt).toLocaleTimeString()}
        </p>
      )}

      <div className="mt-8 text-sm text-muted">
        <p>
          Operators: per-node metrics are exposed by each <code className="font-mono text-ice">glaseld</code>{" "}
          daemon at <code className="font-mono text-ice">:9090/metrics</code> (Prometheus). Point Grafana
          at the cluster for graphs and alerts.
        </p>
      </div>
    </main>
  );
}
