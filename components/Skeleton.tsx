"use client";

import { cn } from "@/lib/cn";

/**
 * Animated loading placeholder. A pulsing neutral block used wherever real
 * content is being fetched, so the UI reads as "loading" rather than "broken".
 * Match the rough size/shape of the content it stands in for.
 */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn("animate-pulse rounded-md bg-ink-100/70", className)}
    />
  );
}

/**
 * A skeleton shaped like a stacked TimeSlotCard (date eyebrow + time). Renders
 * a grid of these while availability loads, mirroring the real 3-col slot grid.
 */
export function TimeSlotCardSkeleton() {
  return (
    <div className="flex flex-col items-start rounded-2xl border border-ink-100 bg-cream-50 p-4">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="mt-2.5 h-5 w-20" />
    </div>
  );
}

/** A grid of slot-card skeletons (default 6) matching TimeStage's layout. */
export function TimeSlotGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="mt-6" aria-busy="true" aria-label="Loading available times">
      {/* A faux day-group heading */}
      <Skeleton className="h-3 w-28" />
      <div className="mt-3 grid grid-cols-3 gap-2">
        {Array.from({ length: count }).map((_, i) => (
          <TimeSlotCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
