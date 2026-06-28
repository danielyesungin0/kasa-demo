import { cn } from "@/lib/cn";

/**
 * Consistent, clearly-tappable expand/collapse affordance.
 *
 * A bordered circular chevron that visually reads as interactive (unlike a
 * bare "›" glyph), with a 44px touch target. Used across settings, services,
 * and onboarding review rows so the expand pattern is identical everywhere.
 *
 * Purely presentational — the parent owns the open state and the tap handler
 * (this sits inside the parent's button/row, so it's `aria-hidden`).
 */
export function ExpandChevron({ expanded }: { expanded: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-all",
        expanded
          ? "rotate-180 border-ink-300 bg-cream-100 text-ink-700"
          : "border-ink-200 bg-white text-ink-500"
      )}
    >
      {/* Down-chevron SVG — crisper than a glyph, rotates 180° when open. */}
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
        <path
          d="M4 6l4 4 4-4"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
