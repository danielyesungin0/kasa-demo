import { describe, it, expect } from "vitest";
import { extractTimeHints, type TimeHints } from "@/lib/parse-intent";

/**
 * Booking-context continuity primitives.
 *
 * The "assistant forgets the date when I change service" bug was caused by the
 * unsupported/multi-person guards short-circuiting BEFORE the user's time hints
 * were captured. The fix captures time hints from every (non-pending) message
 * up front; downstream merge logic then reuses them. These tests lock the
 * PATCH semantics the fix depends on:
 *   - a message WITH a time produces signal-bearing hints (→ persisted/replaced)
 *   - a message WITHOUT a time produces empty hints (→ prior context preserved)
 *
 * Mirror of the component's hintsHaveSignal (kept in sync deliberately).
 */
function hasSignal(h: TimeHints): boolean {
  return (
    h.days.length > 0 ||
    h.dayOfMonth !== null ||
    h.dateKey !== null ||
    h.period !== null ||
    h.relative !== null ||
    h.hour24 !== null ||
    h.weekShift !== null ||
    h.prefersSoonest
  );
}

describe("extractTimeHints — captures a stated time", () => {
  it("'next Tuesday at 5pm' yields a day + hour signal", () => {
    const h = extractTimeHints("balayage next Tuesday at 5pm");
    expect(hasSignal(h)).toBe(true);
    expect(h.days).toContain("Tue");
    expect(h.hour24).toBe(17);
  });

  it("'Thursday' yields a day signal (the 'actually make it Thursday' case)", () => {
    const h = extractTimeHints("actually make it Thursday");
    expect(hasSignal(h)).toBe(true);
    expect(h.days).toContain("Thu");
  });

  it("'4pm' yields an hour signal (the 'how about 4pm?' case)", () => {
    const h = extractTimeHints("how about 4pm?");
    expect(hasSignal(h)).toBe(true);
    expect(h.hour24).toBe(16);
  });
});

describe("extractTimeHints — service-only messages carry NO time signal", () => {
  // These must NOT overwrite a previously-captured date/time. hasSignal=false
  // means the continuity code leaves context.lastIntentTimeHints intact.
  it("'haircut instead' has no time signal (date/time must survive)", () => {
    expect(hasSignal(extractTimeHints("haircut instead"))).toBe(false);
  });
  it("'short' (a clarification answer) has no time signal", () => {
    expect(hasSignal(extractTimeHints("short"))).toBe(false);
  });
  it("'never mind, haircut' has no time signal", () => {
    expect(hasSignal(extractTimeHints("never mind, haircut"))).toBe(false);
  });
});

describe("PATCH semantics — replace time only when a new one is stated", () => {
  // Simulate the merge: keep prior hints unless the new message states a time.
  function patchTime(prior: TimeHints, message: string): TimeHints {
    const next = extractTimeHints(message);
    return hasSignal(next) ? next : prior;
  }

  it("'balayage next Tuesday 5pm' → 'haircut instead' keeps Tuesday 5pm", () => {
    const afterFirst = extractTimeHints("balayage next Tuesday at 5pm");
    const afterSwitch = patchTime(afterFirst, "okay never mind, haircut instead");
    expect(afterSwitch.days).toContain("Tue");
    expect(afterSwitch.hour24).toBe(17);
  });

  it("'haircut next Tuesday' → 'actually Thursday' replaces day, keeps nothing stale", () => {
    const first = extractTimeHints("haircut next Tuesday");
    const afterThursday = patchTime(first, "actually make it Thursday");
    expect(afterThursday.days).toContain("Thu");
    expect(afterThursday.days).not.toContain("Tue");
  });

  it("'haircut Tuesday 5pm' → 'how about 4pm' replaces the hour", () => {
    const first = extractTimeHints("haircut Tuesday at 5pm");
    const after4 = patchTime(first, "how about 4pm?");
    expect(after4.hour24).toBe(16);
  });
});
