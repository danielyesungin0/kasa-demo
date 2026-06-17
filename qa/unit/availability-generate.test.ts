import { describe, it, expect } from "vitest";
import {
  generateSlots,
  type StylistAvailabilityRow,
  type BlockedTimeRow,
} from "@/lib/availability";

/**
 * generateSlots is pure but reads the real clock + NY timezone, so we assert on
 * STRUCTURAL properties (which weekdays appear, relative slot counts, blocked
 * exclusion) rather than absolute timestamps. weekShift is pushed out a couple
 * weeks so the min-notice window never trims our assertions.
 */

// Open Tue(2)/Thu(4)/Sat(6) 10:00–12:00; Mon/Wed/Fri/Sun closed.
const AVAIL: StylistAvailabilityRow[] = [
  { day_of_week: 2, start_time: "10:00", end_time: "12:00", is_active: true },
  { day_of_week: 4, start_time: "10:00", end_time: "12:00", is_active: true },
  { day_of_week: 6, start_time: "10:00", end_time: "12:00", is_active: true },
  // An inactive row must be ignored entirely.
  { day_of_week: 1, start_time: "09:00", end_time: "17:00", is_active: false },
];

const NO_BLOCKS: BlockedTimeRow[] = [];

function weekdays(slots: { dayLabel: string }[]): Set<string> {
  return new Set(slots.map((s) => s.dayLabel));
}

describe("generateSlots — closed days", () => {
  it("never produces slots on closed weekdays", () => {
    const slots = generateSlots({
      availability: AVAIL,
      blockedTimes: NO_BLOCKS,
      durationMinutes: 60,
      weekShift: 2,
      weekCount: 2,
    });
    const days = weekdays(slots);
    for (const closed of ["Mon", "Wed", "Fri", "Sun"]) {
      expect(days.has(closed)).toBe(false);
    }
  });

  it("only produces slots on the active open weekdays", () => {
    const slots = generateSlots({
      availability: AVAIL,
      blockedTimes: NO_BLOCKS,
      durationMinutes: 60,
      weekShift: 2,
      weekCount: 2,
    });
    const days = weekdays(slots);
    expect([...days].sort()).toEqual(["Sat", "Thu", "Tue"]);
  });

  it("ignores inactive availability rows (Mon is_active:false → still closed)", () => {
    const slots = generateSlots({
      availability: AVAIL,
      blockedTimes: NO_BLOCKS,
      durationMinutes: 60,
      weekShift: 2,
      weekCount: 2,
    });
    expect(weekdays(slots).has("Mon")).toBe(false);
  });
});

describe("generateSlots — out-of-hours / window fit", () => {
  it("never starts a slot whose duration overruns the window", () => {
    // Window 10:00–12:00 (120 min). A 120-min service fits exactly once/day
    // (10:00). A 121-min service would not fit at all.
    const fits = generateSlots({
      availability: AVAIL,
      blockedTimes: NO_BLOCKS,
      durationMinutes: 120,
      weekShift: 2,
      weekCount: 1,
    });
    // Each open day yields exactly one 10:00 start.
    expect(fits.every((s) => s.timeLabel.includes("10:00"))).toBe(true);

    const tooLong = generateSlots({
      availability: AVAIL,
      blockedTimes: NO_BLOCKS,
      durationMinutes: 121,
      weekShift: 2,
      weekCount: 1,
    });
    expect(tooLong.length).toBe(0);
  });

  it("shorter services yield more slots than longer ones in the same window", () => {
    const short = generateSlots({
      availability: AVAIL, blockedTimes: NO_BLOCKS, durationMinutes: 30, weekShift: 2, weekCount: 1,
    });
    const long = generateSlots({
      availability: AVAIL, blockedTimes: NO_BLOCKS, durationMinutes: 90, weekShift: 2, weekCount: 1,
    });
    expect(short.length).toBeGreaterThan(long.length);
  });
});

describe("generateSlots — blocked/booked exclusion", () => {
  it("removes slots that overlap a blocked interval", () => {
    const base = generateSlots({
      availability: AVAIL, blockedTimes: NO_BLOCKS, durationMinutes: 30, weekShift: 2, weekCount: 1,
    });
    expect(base.length).toBeGreaterThan(0);

    // Block the entire first open day's window. Build the block from that
    // slot's own dateKey so we hit a real generated day.
    const firstDay = base[0].dateKey;
    const blocked: BlockedTimeRow[] = [
      {
        starts_at: `${firstDay}T00:00:00.000Z`,
        ends_at: `${firstDay}T23:59:59.000Z`,
      },
    ];
    const withBlock = generateSlots({
      availability: AVAIL, blockedTimes: blocked, durationMinutes: 30, weekShift: 2, weekCount: 1,
    });
    // No remaining slot should fall on the fully-blocked day.
    expect(withBlock.some((s) => s.dateKey === firstDay)).toBe(false);
    // And blocking one day strictly reduces the count.
    expect(withBlock.length).toBeLessThan(base.length);
  });
});

describe("generateSlots — empty availability", () => {
  it("no availability rows → zero slots", () => {
    const slots = generateSlots({
      availability: [], blockedTimes: NO_BLOCKS, durationMinutes: 60, weekShift: 2, weekCount: 2,
    });
    expect(slots.length).toBe(0);
  });
});
