"use client";

import { useRef, useState } from "react";
import { Check, Copy } from "lucide-react";

/** MDX <pre> wrapper that adds a hover copy button reading the rendered code. */
export function Pre(props: React.HTMLAttributes<HTMLPreElement>) {
  const ref = useRef<HTMLPreElement>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="group relative">
      <button
        type="button"
        onClick={() => {
          const text = ref.current?.querySelector("code")?.textContent ?? "";
          navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
          });
        }}
        aria-label="Copy code"
        className="absolute right-2.5 top-2.5 z-10 flex h-7 w-7 items-center justify-center rounded-md border text-faint opacity-0 transition-all hover:text-white group-hover:opacity-100"
        style={{ borderColor: "var(--line-strong)", background: "rgba(13,13,18,0.85)" }}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-cyan" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
      <pre ref={ref} {...props} />
    </div>
  );
}
