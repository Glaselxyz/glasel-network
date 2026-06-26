"use client";

import { motion, useScroll, useSpring } from "framer-motion";

/** Thin cyan progress bar pinned to the top, tracking page scroll. */
export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, { stiffness: 120, damping: 30, mass: 0.3 });
  return (
    <motion.div
      style={{ scaleX }}
      className="fixed inset-x-0 top-0 z-[60] h-0.5 origin-left"
      aria-hidden
    >
      <div className="h-full w-full bg-gradient-to-r from-frost via-cyan to-glacier" />
    </motion.div>
  );
}
