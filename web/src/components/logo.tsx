import { cn } from "@/lib/utils";

/**
 * Placeholder mark — the real Glasel logo/favicon will be supplied by the user.
 * Kept neutral and on-theme (cold cyan / glacier) so it doesn't clash meanwhile.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" fill="none" className={cn("h-7 w-7", className)} aria-hidden>
      <defs>
        <linearGradient id="gl-a" x1="6" y1="8" x2="26" y2="40" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D6FAFF" />
          <stop offset="1" stopColor="#3E8FE6" />
        </linearGradient>
        <linearGradient id="gl-b" x1="40" y1="8" x2="24" y2="44" gradientUnits="userSpaceOnUse">
          <stop stopColor="#7EDCFF" />
          <stop offset="1" stopColor="#164F86" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="36" height="36" rx="10" stroke="url(#gl-a)" strokeWidth="2.4" />
      <path d="M16 30l8-12 8 12" stroke="url(#gl-b)" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24" cy="18" r="1.8" fill="#D6FAFF" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      <Logo />
      <span className="font-display text-[18px] font-semibold tracking-tight text-white">Glasel</span>
    </span>
  );
}
