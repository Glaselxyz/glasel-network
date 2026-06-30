"use client";

import { useState } from "react";
import { site } from "@/lib/site";

type Result =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; txHash: string; amount: string; balance: string }
  | { kind: "error"; message: string };

export default function FaucetPage() {
  const [address, setAddress] = useState("");
  const [result, setResult] = useState<Result>({ kind: "idle" });

  async function claim(e: React.FormEvent) {
    e.preventDefault();
    setResult({ kind: "loading" });
    try {
      const res = await fetch("/api/faucet", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: address.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setResult({ kind: "error", message: data.error || `request failed (${res.status})` });
        return;
      }
      setResult({ kind: "ok", txHash: data.txHash, amount: data.amount, balance: data.balance });
    } catch (err: any) {
      setResult({ kind: "error", message: err?.message || "network error" });
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-20">
      <p className="font-mono text-xs uppercase tracking-[0.2em] text-cyan">Testnet faucet</p>
      <h1 className="mt-3 font-display text-4xl font-semibold text-ink">Get test GLASEL</h1>
      <p className="mt-4 text-muted">
        GLASEL is the network&apos;s token — developers pay job fees in it and operators stake it.
        Testnet jobs are <span className="text-ice">free for now</span>, so you only need{" "}
        {site.chain.name} ETH for gas to start; grab GLASEL here to be ready for when fees switch on,
        or to experiment with staking. No value, testing only, one claim per address per day.
      </p>

      <form onSubmit={claim} className="mt-8 rounded-2xl border border-line bg-panel p-6">
        <label htmlFor="addr" className="block font-mono text-xs uppercase tracking-wider text-muted">
          Your address
        </label>
        <input
          id="addr"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="0x…"
          spellCheck={false}
          autoComplete="off"
          className="mt-2 w-full rounded-lg border border-line bg-void px-4 py-3 font-mono text-sm text-ink outline-none transition focus:border-[var(--line-strong)]"
        />
        <button
          type="submit"
          disabled={result.kind === "loading" || address.trim().length === 0}
          className="mt-4 w-full rounded-lg bg-cyan px-4 py-3 font-medium text-void transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {result.kind === "loading" ? "Sending…" : "Request GLASEL"}
        </button>

        {result.kind === "ok" && (
          <div className="mt-5 rounded-lg border border-line bg-void p-4 text-sm">
            <p className="text-cyan">✅ Sent {result.amount} GLASEL.</p>
            <p className="mt-1 text-muted">New balance: {result.balance} GLASEL</p>
            <a
              href={`${site.chain.explorer}/tx/${result.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block break-all font-mono text-xs text-ice underline decoration-line underline-offset-2 hover:text-cyan"
            >
              {result.txHash}
            </a>
          </div>
        )}
        {result.kind === "error" && (
          <p className="mt-5 rounded-lg border border-line bg-void p-4 text-sm text-[#ff9d9d]">
            {result.message}
          </p>
        )}
      </form>

      <div className="mt-8 text-sm text-muted">
        <p>
          You also need {site.chain.name} ETH for gas — get it from a public Base Sepolia ETH
          faucet (Coinbase Developer Platform, Alchemy). This faucet dispenses GLASEL only.
        </p>
      </div>
    </main>
  );
}
