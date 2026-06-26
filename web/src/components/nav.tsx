"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Github, Menu, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { site } from "@/lib/site";
import { Wordmark } from "./logo";

const links = [
  { title: "Docs", href: "/docs" },
  { title: "Quickstart", href: "/docs/quickstart" },
  { title: "Architecture", href: "/docs/architecture" },
  { title: "Network", href: "/docs/network" },
];

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <motion.header
      initial={{ y: -24, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      className="sticky top-0 z-50 px-3 pt-3 sm:px-5 sm:pt-4"
    >
      <div
        className={cn(
          "shimmer-border container-page flex h-14 items-center justify-between rounded-2xl border px-3 transition-all duration-300 sm:px-4",
          scrolled
            ? "border-line-strong bg-[rgba(10,19,30,0.78)] shadow-[0_10px_40px_-12px_rgba(62,143,230,0.45)] backdrop-blur-xl"
            : "border-line bg-[rgba(10,19,30,0.5)] backdrop-blur-lg",
        )}
      >
        <div className="flex items-center gap-8">
          <Link href="/" className="shrink-0">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-1 md:flex">
            {links.map((l) => {
              const active = l.href === "/docs" ? pathname.startsWith("/docs") : pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    "relative rounded-md px-3 py-1.5 text-sm transition-colors",
                    active ? "text-white" : "text-muted hover:text-white",
                  )}
                >
                  {l.title}
                  {active && (
                    <span className="absolute inset-x-3 -bottom-px h-px bg-gradient-to-r from-transparent via-cyan to-transparent" />
                  )}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          <span className="badge hidden sm:inline-flex">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cyan opacity-70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-cyan" />
            </span>
            Live on {site.chain.name}
          </span>
          <a
            href={site.github}
            target="_blank"
            rel="noreferrer"
            className="hidden h-9 w-9 items-center justify-center rounded-lg border border-line text-muted transition-colors hover:border-line-strong hover:text-white sm:flex"
            aria-label="GitHub"
          >
            <Github className="h-4 w-4" />
          </a>
          <Link href="/docs/quickstart" className="btn-primary hidden sm:inline-flex">
            Start building
          </Link>
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-line-strong text-white md:hidden"
            aria-label="Menu"
          >
            {open ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="container-page mt-2 rounded-2xl border border-line-strong bg-[rgba(10,19,30,0.92)] p-2 backdrop-blur-xl md:hidden">
          <nav className="flex flex-col">
            {links.map((l) => (
              <Link key={l.href} href={l.href} className="rounded-lg px-3 py-2.5 text-sm text-muted hover:bg-[rgba(111,233,255,0.06)] hover:text-white">
                {l.title}
              </Link>
            ))}
            <Link href="/docs/quickstart" className="btn-primary mt-2">
              Start building
            </Link>
          </nav>
        </div>
      )}
    </motion.header>
  );
}
