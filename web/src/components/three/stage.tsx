"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { scrollState } from "@/lib/scroll-store";

const Scene = dynamic(() => import("./scene"), { ssr: false });

/**
 * Fixed full-viewport 3D stage that sits behind the page content. It owns the
 * scroll/pointer listeners that feed the shared scroll store, so the globe →
 * cluster → result narrative scrubs with the page scroll.
 */
export function Stage() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setReady(true);
    let raf = 0;
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      scrollState.progress = max > 0 ? window.scrollY / max : 0;
    };
    const onMove = (e: PointerEvent) => {
      scrollState.mx = (e.clientX / window.innerWidth) * 2 - 1;
      scrollState.my = -((e.clientY / window.innerHeight) * 2 - 1);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointermove", onMove);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed inset-0 -z-10">
      {/* ambient brand wash always present; the canvas fades in over it */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 60% at 30% 20%, rgba(62,143,230,0.18), transparent 60%)," +
            "radial-gradient(60% 60% at 80% 30%, rgba(62,143,230,0.16), transparent 60%)",
        }}
      />
      <div
        className={`absolute inset-0 transition-opacity duration-1000 ${ready ? "opacity-100" : "opacity-0"}`}
      >
        {ready && <Scene />}
      </div>
    </div>
  );
}
