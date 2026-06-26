"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

type Heading = { id: string; text: string; level: number };

export function TableOfContents() {
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll<HTMLElement>("article h2, article h3"));
    const hs = nodes
      .filter((n) => n.id)
      .map((n) => ({ id: n.id, text: n.textContent ?? "", level: n.tagName === "H2" ? 2 : 3 }));
    setHeadings(hs);

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 1 },
    );
    nodes.forEach((n) => n.id && observer.observe(n));
    return () => observer.disconnect();
  }, []);

  if (headings.length === 0) return null;

  return (
    <div className="sticky top-24">
      <div className="mb-3 text-xs font-semibold uppercase tracking-wider text-faint">On this page</div>
      <ul className="space-y-1.5 border-l" style={{ borderColor: "var(--line)" }}>
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={cn(
                "-ml-px block border-l py-0.5 text-sm transition-colors",
                h.level === 3 ? "pl-6" : "pl-3",
                active === h.id ? "border-cyan text-white" : "border-transparent text-muted hover:text-white",
              )}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
