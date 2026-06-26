"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { flatDocs } from "@/lib/site";

export function DocsPager() {
  const pathname = usePathname();
  const idx = flatDocs.findIndex((d) => d.href === pathname);
  if (idx === -1) return null;
  const prev = flatDocs[idx - 1];
  const next = flatDocs[idx + 1];

  return (
    <div className="mt-14 grid gap-3 border-t pt-8 sm:grid-cols-2">
      {prev ? (
        <Link href={prev.href} className="card group p-4 transition-colors hover:bg-panel">
          <div className="flex items-center gap-1 text-xs text-faint">
            <ArrowLeft className="h-3 w-3" /> Previous
          </div>
          <div className="mt-1 text-sm font-medium text-muted group-hover:text-white">{prev.title}</div>
        </Link>
      ) : (
        <span />
      )}
      {next && (
        <Link href={next.href} className="card group p-4 text-right transition-colors hover:bg-panel">
          <div className="flex items-center justify-end gap-1 text-xs text-faint">
            Next <ArrowRight className="h-3 w-3" />
          </div>
          <div className="mt-1 text-sm font-medium text-muted group-hover:text-white">{next.title}</div>
        </Link>
      )}
    </div>
  );
}
