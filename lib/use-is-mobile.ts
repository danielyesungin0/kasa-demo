"use client";

import { useEffect, useState } from "react";

/**
 * Matches Tailwind's `sm` breakpoint (640px). Used to switch between the
 * mobile chat shell and the desktop card layout on /shen.
 *
 * Lazy-initializes from window.matchMedia synchronously on the client so
 * the very first client render returns the correct value — eliminates
 * the desktop-then-mobile layout flash on phones. SSR still returns
 * false (server can't know the screen size), which is fine because the
 * client immediately re-paints with the right value.
 */
export function useIsMobile(): boolean {
  // Always start false to match the server render — the client reads the real
  // value in useEffect and re-paints before the user can interact.
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(max-width: 639px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}
