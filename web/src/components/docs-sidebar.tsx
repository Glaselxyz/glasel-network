"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { docsNav } from "@/lib/site";
import { cn } from "@/lib/utils";

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="space-y-7">
      {docsNav.map((group) => (
        <div key={group.title}>
          <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-faint">{group.title}</div>
          <ul className="space-y-0.5">
            {group.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={cn(
                      "relative block rounded-md px-2 py-1.5 text-sm transition-colors",
                      active ? "text-white" : "text-muted hover:text-white",
                    )}
                    style={active ? { background: "rgba(111,233,255,0.1)" } : undefined}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full"
                        style={{ background: "linear-gradient(180deg,#6fe9ff,#3e8fe6)" }}
                      />
                    )}
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
