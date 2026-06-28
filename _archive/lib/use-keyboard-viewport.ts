"use client";

import { useEffect, useState } from "react";

type ViewportState = {
  /** Visible viewport height in CSS pixels — shrinks when the keyboard opens. */
  viewportHeight: number;
  /** Y-offset of the visible viewport relative to the layout viewport. iOS shifts
   *  this when the focused input would otherwise be hidden behind the keyboard. */
  viewportOffsetTop: number;
  /** Pixels of the layout viewport currently covered by the keyboard / OS chrome. */
  keyboardOffset: number;
  /** True when the keyboard appears to be open (offset > a small threshold). */
  keyboardOpen: boolean;
};

/**
 * Tracks the iOS visual viewport so we can size the chat shell to the area
 * actually visible to the user — i.e. above the on-screen keyboard.
 *
 * On iOS Safari, when the keyboard opens, the layout viewport (window.innerHeight)
 * does not change but the visual viewport shrinks. The composer needs to follow
 * that shrink, otherwise it sits behind the keyboard.
 *
 * On browsers without visualViewport (very old Android, server render), this
 * reports a sensible default (window.innerHeight, no keyboard) so layouts that
 * fall back to 100dvh still work.
 */
export function useKeyboardAwareViewport(): ViewportState {
  // SSR-safe initial state. On the client, lazy-initialize from window so
  // the shell paints at the correct height on the first frame instead of
  // collapsing to 0 before the effect runs.
  const [state, setState] = useState<ViewportState>(() => {
    if (typeof window === "undefined") {
      return { viewportHeight: 0, viewportOffsetTop: 0, keyboardOffset: 0, keyboardOpen: false };
    }
    const vv = window.visualViewport;
    if (vv) {
      const offset = Math.max(0, window.innerHeight - vv.height);
      return {
        viewportHeight: vv.height,
        viewportOffsetTop: vv.offsetTop,
        keyboardOffset: offset,
        keyboardOpen: offset > 80,
      };
    }
    return {
      viewportHeight: window.innerHeight,
      viewportOffsetTop: 0,
      keyboardOffset: 0,
      keyboardOpen: false,
    };
  });

  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;

    function read() {
      if (vv) {
        const layoutH = window.innerHeight;
        const visibleH = vv.height;
        // The keyboard covers (layoutH - visibleH) pixels at the bottom.
        const offset = Math.max(0, layoutH - visibleH);
        setState({
          viewportHeight: visibleH,
          viewportOffsetTop: vv.offsetTop,
          keyboardOffset: offset,
          // 80px threshold keeps tiny address-bar collapses from being treated
          // as the keyboard opening.
          keyboardOpen: offset > 80,
        });
      } else {
        setState({
          viewportHeight: window.innerHeight,
          viewportOffsetTop: 0,
          keyboardOffset: 0,
          keyboardOpen: false,
        });
      }
    }

    read();

    if (vv) {
      vv.addEventListener("resize", read);
      vv.addEventListener("scroll", read);
      return () => {
        vv.removeEventListener("resize", read);
        vv.removeEventListener("scroll", read);
      };
    }

    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);

  return state;
}
