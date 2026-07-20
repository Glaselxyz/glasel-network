"use client";

import { useEffect, useRef, useState } from "react";
import { hexToBytes, bytesToHex, type Hex } from "viem";
import {
  GlaselClient,
  ORDER_SCHEMA,
  generateKeyPair,
  publicKeyFromPrivate,
} from "@glasel/client";
import { Lock, ArrowRight, Loader2, Check, ExternalLink, ShieldCheck, Eye } from "lucide-react";
import { activeChain } from "@/lib/chain";
import { site, defaultRpcUrl } from "@/lib/site";
import { playgroundAddresses } from "@/lib/playground";
import { cn } from "@/lib/utils";

const EXPLORER = site.chain.explorer;

// Read-only client just so the SDK can construct; encrypt/decrypt are pure and
// never touch the chain. All chain I/O goes through the /api/playground routes.
const glasel = new GlaselClient({
  publicClient: {} as never,
  addresses: playgroundAddresses,
});

type Phase = "idle" | "keypair" | "encrypt" | "commission" | "compute" | "decrypt" | "done" | "error";

const STEPS: { key: Phase; label: string }[] = [
  { key: "keypair", label: "Generate your private key (in this browser)" },
  { key: "encrypt", label: "Encrypt your inputs" },
  { key: "commission", label: "Send the sealed job on-chain" },
  { key: "compute", label: "A live node computes on it — blind" },
  { key: "decrypt", label: "Decrypt the result (only you can)" },
];

const order = STEPS.map((s) => s.key);
function stepState(step: Phase, phase: Phase): "pending" | "active" | "done" {
  if (phase === "error") return order.indexOf(step) < order.indexOf("compute") ? "done" : "pending";
  if (phase === "done") return "done";
  const cur = order.indexOf(phase);
  const idx = order.indexOf(step);
  if (idx < cur) return "done";
  if (idx === cur) return "active";
  return "pending";
}

export default function PlaygroundPage() {
  const [price, setPrice] = useState(1000);
  const [quantity, setQuantity] = useState(7);
  const [phase, setPhase] = useState<Phase>("idle");
  const [ciphertext, setCiphertext] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [computationId, setComputationId] = useState<string | null>(null);
  const [result, setResult] = useState<bigint | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const clusterKeyRef = useRef<Uint8Array | null>(null);
  const running = phase !== "idle" && phase !== "done" && phase !== "error";

  // Fetch the public cluster key once, up front (needed to encrypt).
  useEffect(() => {
    fetch("/api/playground/cluster-key")
      .then((r) => r.json())
      .then((d) => {
        if (d.clusterKey) clusterKeyRef.current = hexToBytes(d.clusterKey as Hex);
      })
      .catch(() => {});
  }, []);

  async function run() {
    setPhase("keypair");
    setError(null);
    setCiphertext(null);
    setTxHash(null);
    setComputationId(null);
    setResult(null);
    setElapsed(0);
    const t0 = Date.now();
    try {
      if (!clusterKeyRef.current) {
        const d = await (await fetch("/api/playground/cluster-key")).json();
        if (!d.clusterKey) throw new Error("network unavailable — try again in a moment");
        clusterKeyRef.current = hexToBytes(d.clusterKey as Hex);
      }

      // 1. A keypair that never leaves this browser.
      const me = generateKeyPair();
      await pause(500);

      // 2. Encrypt locally. Only ciphertext leaves the machine.
      setPhase("encrypt");
      const value = {
        price: BigInt(price),
        quantity: BigInt(quantity),
        side: false,
        buyerKey: bytesToHex(publicKeyFromPrivate(me.privateKey)),
      };
      const { encInputs } = glasel.encrypt({
        schema: ORDER_SCHEMA,
        clusterKey: clusterKeyRef.current,
        value,
        recipientPublicKey: me.publicKey,
      });
      setCiphertext(encInputs);
      await pause(500);

      // 3. Relayer submits it on-chain (pays gas). Server never sees plaintext.
      setPhase("commission");
      const runRes = await fetch("/api/playground/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encInputs }),
      });
      const runData = await runRes.json();
      if (!runRes.ok) throw new Error(runData.error || "could not submit the job");
      setTxHash(runData.txHash);
      setComputationId(runData.computationId);

      // 4. Wait for a live node to compute + submit its verified result.
      setPhase("compute");
      const timer = setInterval(() => setElapsed(Math.round((Date.now() - t0) / 1000)), 250);
      let encResult: Hex | null = null;
      try {
        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
          await pause(2000);
          const s = await (await fetch(`/api/playground/status?id=${runData.computationId}`)).json();
          if (s.state === "completed" && s.encResult) {
            encResult = s.encResult as Hex;
            break;
          }
          if (s.state === "failed") throw new Error("the network could not complete the job");
        }
      } finally {
        clearInterval(timer);
      }
      if (!encResult) throw new Error("timed out waiting for the node");

      // 5. Decrypt — only this browser's key can.
      setPhase("decrypt");
      await pause(400);
      const decoded = glasel.decryptResult({ encResult, privateKey: me.privateKey, schema: ORDER_SCHEMA }) as {
        price: bigint;
      };
      setResult(decoded.price);
      setElapsed(Math.round((Date.now() - t0) / 1000));
      setPhase("done");
    } catch (e: any) {
      setError(e?.message || "something went wrong");
      setPhase("error");
    }
  }

  const expected = BigInt(price) * BigInt(quantity);

  return (
    <div className="container-page py-14">
      <div className="mx-auto max-w-2xl">
        <div className="eyebrow-line mb-3 text-xs font-semibold uppercase tracking-wider text-cyan">
          Live playground
        </div>
        <h1 className="font-display text-4xl font-semibold tracking-tight text-white sm:text-5xl">
          See it with your own eyes
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted">
          Pick two numbers. Watch them get <span className="text-white">encrypted</span>, sent to{" "}
          {site.networkLabel}, computed on by a <span className="text-white">live node that never sees them</span>,
          and decrypted back — only in your browser. No wallet, no signup. Real mainnet, every step.
        </p>

        {/* Inputs */}
        <div className="card mt-10 p-6 sm:p-8">
          <div className="grid grid-cols-2 gap-5">
            <NumberField label="Price" value={price} onChange={setPrice} disabled={running} />
            <NumberField label="Quantity" value={quantity} onChange={setQuantity} disabled={running} />
          </div>
          <p className="mt-4 text-sm text-faint">
            The node will compute <span className="font-mono text-muted">price × quantity</span> without ever seeing
            either number. It should return <span className="font-mono text-cyan">{expected.toString()}</span> — but
            only <em>you</em> will be able to read that.
          </p>
          <button onClick={run} disabled={running} className="btn-primary mt-6 w-full sm:w-auto">
            {running ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Running…
              </>
            ) : (
              <>
                <Lock className="h-4 w-4" /> Run confidentially
              </>
            )}
          </button>
        </div>

        {/* Stepper */}
        {phase !== "idle" && (
          <div className="card mt-6 p-6 sm:p-8">
            <ol className="space-y-4">
              {STEPS.map((s) => {
                const st = stepState(s.key, phase);
                return (
                  <li key={s.key} className="flex gap-3">
                    <StepIcon state={st} />
                    <div className="min-w-0 flex-1">
                      <div
                        className={cn(
                          "text-sm font-medium",
                          st === "done" ? "text-white" : st === "active" ? "text-cyan" : "text-faint",
                        )}
                      >
                        {s.label}
                      </div>

                      {/* per-step detail */}
                      {s.key === "encrypt" && ciphertext && (
                        <div className="mt-2 rounded-lg border border-line bg-[rgba(0,0,0,0.25)] p-3">
                          <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-faint">
                            <Eye className="h-3 w-3" /> What the chain sees
                          </div>
                          <code className="block break-all font-mono text-xs text-muted">
                            {ciphertext.slice(0, 74)}…
                          </code>
                          <div className="mt-1 text-[11px] text-faint">
                            {(ciphertext.length - 2) / 2} bytes of noise — no price, no quantity in there.
                          </div>
                        </div>
                      )}
                      {s.key === "commission" && txHash && (
                        <ProofLink label="Job submitted on-chain" href={`${EXPLORER}/tx/${txHash}`} value={txHash} />
                      )}
                      {s.key === "compute" && st === "active" && (
                        <div className="mt-1 text-xs text-faint">a live MPC node is computing… {elapsed}s</div>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {phase === "done" && result !== null && (
              <div className="mt-6 rounded-xl border p-5" style={{ borderColor: "rgba(111,233,255,0.4)", background: "rgba(111,233,255,0.08)" }}>
                <div className="text-xs uppercase tracking-wider text-cyan">Decrypted in your browser</div>
                <div className="mt-1 font-display text-3xl font-semibold text-white">
                  {result.toString()}
                  {result === expected && <Check className="ml-2 inline h-6 w-6 text-cyan" />}
                </div>
                <p className="mt-2 text-sm text-muted">
                  A node computed this on data it never saw, in {elapsed}s, and only your browser could open the
                  answer. That's the whole idea.
                </p>
                <div className="mt-3 flex flex-wrap gap-3 text-sm">
                  <a href={`${EXPLORER}/tx/${txHash}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-cyan hover:text-white">
                    Job tx <ExternalLink className="h-3 w-3" />
                  </a>
                  <button onClick={run} className="inline-flex items-center gap-1 text-muted hover:text-white">
                    Run another <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              </div>
            )}

            {phase === "error" && (
              <div className="mt-5 rounded-lg border p-4 text-sm" style={{ borderColor: "rgba(163,240,255,0.4)", background: "rgba(163,240,255,0.06)" }}>
                <span className="text-[#a3f0ff]">Couldn't finish:</span> <span className="text-muted">{error}</span>
                <button onClick={run} className="ml-2 text-cyan hover:text-white">try again</button>
              </div>
            )}
          </div>
        )}

        {/* How it stays private */}
        <div className="mt-10 grid gap-3 sm:grid-cols-3">
          <Assurance icon={Lock} title="Encrypted on your device" body="Your numbers are sealed in this browser. Only ciphertext ever leaves it." />
          <Assurance icon={Eye} title="The network stays blind" body="The node computes on the ciphertext. No operator — and not us — sees your inputs." />
          <Assurance icon={ShieldCheck} title="Only you can read it" body="The answer is sealed to a key that never left your browser, and verified on-chain." />
        </div>

        <p className="mt-8 text-xs leading-relaxed text-faint">
          Research preview — unaudited, testnet-grade keys, a single operator. The demo circuit computes an order's
          value (<span className="font-mono">price × quantity</span>) and jobs are free. Don't route real value through
          it yet. Want the code?{" "}
          <a href="/blog/sealed-order-confidential-app" className="text-cyan hover:text-white">
            Read the tutorial
          </a>
          .
        </p>
      </div>
    </div>
  );
}

function pause(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function NumberField({ label, value, onChange, disabled }: { label: string; value: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-faint">{label}</span>
      <input
        type="number"
        min={0}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Math.max(0, Math.min(1_000_000, Number(e.target.value) || 0)))}
        className="w-full rounded-lg border border-line bg-[rgba(0,0,0,0.25)] px-3 py-2.5 font-mono text-lg text-white outline-none transition-colors focus:border-cyan disabled:opacity-60"
      />
    </label>
  );
}

function StepIcon({ state }: { state: "pending" | "active" | "done" }) {
  return (
    <div
      className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border"
      style={{
        borderColor: state === "pending" ? "var(--line)" : "rgba(111,233,255,0.5)",
        background: state === "done" ? "rgba(111,233,255,0.15)" : "transparent",
      }}
    >
      {state === "done" ? (
        <Check className="h-3.5 w-3.5 text-cyan" />
      ) : state === "active" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-cyan" />
      ) : (
        <span className="h-1.5 w-1.5 rounded-full bg-faint" />
      )}
    </div>
  );
}

function ProofLink({ label, href, value }: { label: string; href: string; value: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 text-xs text-cyan hover:text-white">
      {label}: <span className="font-mono">{value.slice(0, 12)}…</span> <ExternalLink className="h-3 w-3" />
    </a>
  );
}

function Assurance({ icon: Icon, title, body }: { icon: typeof Lock; title: string; body: string }) {
  return (
    <div className="card p-4">
      <Icon className="h-4 w-4 text-cyan" />
      <div className="mt-2 text-sm font-medium text-white">{title}</div>
      <div className="mt-1 text-xs leading-relaxed text-muted">{body}</div>
    </div>
  );
}
