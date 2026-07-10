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

/** X (formerly Twitter) brand glyph. lucide ships the old bird, so we inline the
 *  current X mark. `currentColor` so it inherits hover/text colors like lucide. */
export function XLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={cn("h-4 w-4", className)} aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.656l-5.214-6.817-5.966 6.817H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77Z" />
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
