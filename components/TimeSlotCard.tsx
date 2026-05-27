"use client";

import { cn } from "@/lib/cn";
import type { TimeSlot } from "@/lib/types";

type TimeSlotCardProps = {
  slot: TimeSlot;
  selected?: boolean;
  onClick?: () => void;
  variant?: "stacked" | "inline";
};

export function TimeSlotCard({
  slot,
  selected,
  onClick,
  variant = "stacked",
}: TimeSlotCardProps) {
  if (variant === "inline") {
    return (
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex items-center justify-between rounded-xl border px-4 py-3 text-left transition",
          selected
            ? "border-ink-900 bg-cream-100"
            : "border-ink-100 bg-cream-50 hover:border-ink-300"
        )}
      >
        <span className="text-sm font-medium text-ink-900">
          {slot.dayLabel}, {slot.dateLabel}
        </span>
        <span className="text-sm text-ink-700">{slot.timeLabel}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex flex-col items-start rounded-2xl border p-4 text-left transition",
        selected
          ? "border-ink-900 bg-cream-100 shadow-soft"
          : "border-ink-100 bg-cream-50 hover:border-ink-300 hover:shadow-soft"
      )}
    >
      <span className="font-display text-xs uppercase tracking-[0.14em] text-ink-500">
        {slot.dayLabel} · {slot.dateLabel}
      </span>
      <span className="mt-1.5 font-display text-xl font-medium text-ink-900">
        {slot.timeLabel}
      </span>
    </button>
  );
}
