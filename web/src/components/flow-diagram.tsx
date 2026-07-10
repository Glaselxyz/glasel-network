import { Lock, Cpu, FileCheck2, Boxes } from "lucide-react";
import { Reveal } from "./motion";

const steps = [
  { icon: Lock, label: "Client encrypts", sub: "X25519 + Rescue-Prime", tag: "SDK" },
  { icon: Boxes, label: "Contract commissions", sub: "Coordinator + MXE", tag: "Robinhood" },
  { icon: Cpu, label: "MPC computes", sub: "arxOS cluster", tag: "Off-chain" },
  { icon: FileCheck2, label: "Verify & decrypt", sub: "Threshold-signed result", tag: "Robinhood + SDK" },
];

export function FlowDiagram() {
  return (
    <div className="grid gap-3 md:grid-cols-4">
      {steps.map((s, i) => {
        const Icon = s.icon;
        return (
          <Reveal key={s.label} delay={i * 110} className="relative">
            <div className="card h-full p-5">
              <div className="flex items-center justify-between">
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-lg animate-haze"
                  style={{
                    background: "linear-gradient(140deg, rgba(111,233,255,0.22), rgba(62,143,230,0.28))",
                    border: "1px solid rgba(111,233,255,0.25)",
                  }}
                >
                  <Icon className="h-4 w-4 text-cyan" />
                </span>
                <span className="font-mono text-[10px] uppercase tracking-wider text-faint">{s.tag}</span>
              </div>
              <div className="mt-3 text-sm font-medium text-white">{s.label}</div>
              <div className="mt-0.5 text-xs text-muted">{s.sub}</div>
              <span className="absolute -top-2 left-5 font-mono text-[10px] text-faint">0{i + 1}</span>
            </div>
            {i < steps.length - 1 && (
              <div
                className="flow-line pointer-events-none absolute right-[-9px] top-1/2 z-10 hidden h-px w-5 -translate-y-1/2 md:block"
                style={{ animationDelay: `${i * 0.5}s` }}
              />
            )}
          </Reveal>
        );
      })}
    </div>
  );
}
