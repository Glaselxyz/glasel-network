import Link from "next/link";
import { Github } from "lucide-react";
import { site } from "@/lib/site";
import { Logo, XLogo } from "./logo";

const cols = [
  {
    title: "Docs",
    links: [
      { title: "Introduction", href: "/docs" },
      { title: "Quickstart", href: "/docs/quickstart" },
      { title: "Core concepts", href: "/docs/concepts" },
      { title: "Blog", href: "/blog" },
    ],
  },
  {
    title: "Protocol",
    links: [
      { title: "Architecture", href: "/docs/architecture" },
      { title: "Computation lifecycle", href: "/docs/lifecycle" },
      { title: "Security model", href: "/docs/security" },
      { title: "Deployments", href: "/docs/network" },
    ],
  },
  {
    title: "Build",
    links: [
      { title: "Circuits (Arcis)", href: "/docs/circuits" },
      { title: "Run a node", href: "/docs/node" },
      { title: "Encryption stack", href: "/docs/encryption" },
    ],
  },
];

export function Footer() {
  return (
    <footer className="relative mt-24 border-t border-line">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan to-transparent opacity-50" />
      <div className="container-page grid grid-cols-2 gap-8 py-14 md:grid-cols-5">
        <div className="col-span-2 md:col-span-2">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-lg font-semibold text-white">Glasel</span>
          </Link>
          <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted">
            {site.tagline} MPC over encrypted inputs with threshold-verified results, live on {site.chain.name}.
          </p>
          <div className="mt-4 flex items-center gap-4">
            <a
              href={site.github}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted hover:text-cyan"
            >
              <Github className="h-4 w-4" /> GitHub
            </a>
            <a
              href={site.x}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-muted hover:text-cyan"
            >
              <XLogo className="h-3.5 w-3.5" /> X
            </a>
          </div>
        </div>
        {cols.map((c) => (
          <div key={c.title}>
            <div className="text-xs font-semibold uppercase tracking-wider text-cyan">{c.title}</div>
            <ul className="mt-3 space-y-2">
              {c.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-muted transition-colors hover:text-white">
                    {l.title}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-line">
        <div className="container-page flex flex-col items-center justify-between gap-2 py-6 text-xs text-faint sm:flex-row">
          <span>© {new Date().getFullYear()} Glasel. Research preview.</span>
          <span className="font-mono text-faint">
            Threshold-BLS · X25519 · Rescue-Prime · MPC on {site.networkLabel}
          </span>
        </div>
      </div>
    </footer>
  );
}
