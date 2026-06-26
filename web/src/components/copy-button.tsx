"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        });
      }}
      aria-label="Copy"
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded-md border text-faint transition-colors hover:text-white",
        className,
      )}
      style={{ borderColor: "var(--line-strong)", background: "rgba(255,255,255,0.03)" }}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-cyan" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}
