import { describe, it, expect } from "vitest";
import { extractTimeHints, rankTimeSlots } from "@/lib/parse-intent";
import type { TimeSlot } from "@/lib/availability";

function slot(dateKey: string, dayLabel: string, hour24: number): TimeSlot {
  const day = Number(dateKey.split("-")[2]);
  const hm = `${String(Math.floor(hour24)).padStart(2, "0")}:00`;
  return {
    id: `slot-${dateKey}-${hm}`,
    dayLabel,
    dateLabel: dateKey,
    timeLabel: hm,
    fullLabel: `${dayLabel} ${hm}`,
    dateKey,
    dayOfMonth: day,
    hour24,
    isoTime: hm,
  };
}

/**
 * Regression guard for the "next Tuesday at 5" bug:
 *   - "at 5" must be a CLOCK TIME (5pm), never day-of-month 5.
 *   - the stated weekday must be preserved.
 *   - day-of-month parsing must still work for genuine "the 5th" phrasing.
 */

describe("bare hour after a time cue is a clock time, not a date", () => {
  it("'next Tuesday at 5' → Tuesday + 5pm, NOT day-of-month 5", () => {
    const h = extractTimeHints("i need a haircut next tuesday at 5");
    expect(h.days).toContain("Tue");
    expect(h.hour24).toBe(17); // 5pm
    expect(h.dayOfMonth).toBeNull(); // <-- the bug: was 5
  });

  it("'at 3' → 3pm (afternoon business-hours reading)", () => {
    const h = extractTimeHints("can I come at 3");
    expect(h.hour24).toBe(15);
    expect(h.dayOfMonth).toBeNull();
  });

  it("'around 11' → 11am (8–11 stays AM)", () => {
    const h = extractTimeHints("around 11");
    expect(h.hour24).toBe(11);
    expect(h.dayOfMonth).toBeNull();
  });

  it("'at 5pm' still parses explicitly as 5pm", () => {
    const h = extractTimeHints("tuesday at 5pm");
    expect(h.hour24).toBe(17);
    expect(h.dayOfMonth).toBeNull();
  });

  it("explicit AM context keeps a bare hour in the morning ('at 9 in the morning')", () => {
    const h = extractTimeHints("at 9 in the morning");
    expect(h.hour24).toBe(9);
  });
});

describe("genuine day-of-month phrasing still works", () => {
  it("'the 5th' → day-of-month 5", () => {
    const h = extractTimeHints("can I book the 5th");
    expect(h.dayOfMonth).toBe(5);
  });

  it("'on the 12th' → day-of-month 12", () => {
    const h = extractTimeHints("how about on the 12th");
    expect(h.dayOfMonth).toBe(12);
  });

  it("'the 5th at 5' → day-of-month 5 AND 5pm (both, unambiguous)", () => {
    const h = extractTimeHints("the 5th at 5");
    expect(h.dayOfMonth).toBe(5);
    expect(h.hour24).toBe(17);
  });
});

describe("no false day-of-month from clock times", () => {
  it("'haircut at 4' does not set dayOfMonth", () => {
    expect(extractTimeHints("haircut at 4").dayOfMonth).toBeNull();
  });
  it("'2pm' does not set dayOfMonth", () => {
    expect(extractTimeHints("2pm please").dayOfMonth).toBeNull();
  });
});

describe("END-TO-END regression: 'next Tuesday at 5' ranks a Tuesday slot first, not the 5th", () => {
  // The original bug: "at 5" became dayOfMonth=5, so a Sunday-the-5th slot
  // outranked Tuesday. With the fix, hints = {days:[Tue], hour24:17}, so a
  // Tuesday 5pm slot must rank above an (unrequested) Sunday Jul 5 slot.
  it("Tuesday 5pm outranks Sunday Jul 5", () => {
    const hints = extractTimeHints("i need a haircut next tuesday at 5");
    const tue5pm = slot("2026-07-07", "Tue", 17); // a Tuesday, 5pm
    const sunThe5th = slot("2026-07-05", "Sun", 11); // the 5th (Sunday), 11am
    const ranked = rankTimeSlots([sunThe5th, tue5pm], hints);
    expect(ranked[0].dayLabel).toBe("Tue");
    expect(ranked[0].hour24).toBe(17);
  });

  it("on the requested day, the nearest hour to 5pm ranks first (same-day fallback)", () => {
    const hints = extractTimeHints("haircut tuesday at 5");
    const tue4 = slot("2026-07-07", "Tue", 16);
    const tue5 = slot("2026-07-07", "Tue", 17);
    const tue7 = slot("2026-07-07", "Tue", 19);
    const ranked = rankTimeSlots([tue7, tue4, tue5], hints);
    expect(ranked[0].hour24).toBe(17); // exact 5pm wins
    expect(ranked[1].hour24).toBe(16); // then nearest (4pm) — still Tuesday
  });
});
