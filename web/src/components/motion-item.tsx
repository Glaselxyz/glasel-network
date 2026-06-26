"use client";

import { motion, type Variants } from "framer-motion";

/** A stagger child — consumes the parent <Stagger> orchestration via variants. */
export function MotionItem({
  children,
  className,
  variants,
}: {
  children: React.ReactNode;
  className?: string;
  variants: Variants;
}) {
  return (
    <motion.div className={className} variants={variants}>
      {children}
    </motion.div>
  );
}
