"use client";

import { motion, useReducedMotion, type Variants } from "framer-motion";
import type { ReactNode } from "react";

/**
 * Subtle scroll-reveal for the marketing page. A section fades + rises a few px
 * as it scrolls into view, once. Respects prefers-reduced-motion (then it just
 * renders, no animation). Deliberately small/fast so it reads premium, not
 * gimmicky — and never delays anything interactive.
 *
 * Landing-page only — keep this out of the booking/chat flow so that surface
 * stays lean and instant.
 */

const EASE = [0.22, 1, 0.36, 1] as const; // gentle ease-out

export function Reveal({
  children,
  delay = 0,
  className,
  as = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "section" | "li";
}) {
  const reduce = useReducedMotion();
  const MotionTag = motion[as];

  if (reduce) {
    const Tag = as;
    return <Tag className={className}>{children}</Tag>;
  }

  return (
    <MotionTag
      className={className}
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.25, margin: "0px 0px -10% 0px" }}
      transition={{ duration: 0.45, ease: EASE, delay }}
    >
      {children}
    </MotionTag>
  );
}

/**
 * Stagger container — children revealed in sequence as the group enters view.
 * Use <RevealGroup> around a grid, and <RevealItem> on each card.
 */
const groupVariants: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.08 } },
};
const itemVariants: Variants = {
  hidden: { opacity: 0, y: 14 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: EASE } },
};

export function RevealGroup({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div
      className={className}
      variants={groupVariants}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
    >
      {children}
    </motion.div>
  );
}

export function RevealItem({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const reduce = useReducedMotion();
  if (reduce) return <div className={className}>{children}</div>;
  return (
    <motion.div className={className} variants={itemVariants}>
      {children}
    </motion.div>
  );
}
