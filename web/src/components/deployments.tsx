import { ExternalLink } from "lucide-react";
import { contracts, site } from "@/lib/site";
import { CopyButton } from "./copy-button";

export function Deployments() {
  return (
    <div className="not-prose my-6 overflow-hidden rounded-xl border">
      <div className="flex items-center justify-between border-b px-4 py-3" style={{ background: "var(--panel-2)" }}>
        <span className="text-sm font-medium text-white">{site.chain.name}</span>
        <span className="font-mono text-xs text-faint">chainId {site.chain.chainId}</span>
      </div>
      <div className="divide-y" style={{ borderColor: "var(--line)" }}>
        {contracts.map((c) => (
          <div key={c.name} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="text-sm font-medium text-white">{c.name}</div>
              <div className="text-xs text-faint">{c.note}</div>
            </div>
            <div className="flex items-center gap-2">
              <a
                href={`${site.chain.explorer}/address/${c.address}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:text-white"
                style={{ borderColor: "var(--line-strong)" }}
              >
                {c.address}
                <ExternalLink className="h-3 w-3 shrink-0 text-faint" />
              </a>
              <CopyButton text={c.address} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
