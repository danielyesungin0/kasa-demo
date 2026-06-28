/**
 * Availability engine — computes open 30-min slot starts for a given service.
 *
 * Inputs (from Supabase):
 *   stylist_availability  — day-of-week windows (is_active, start_time, end_time)
 *   blocked_times         — specific timestamptz ranges (booked appointments, breaks)
 *
 * Output: TimeSlot[] in America/New_York, covering `weekCount` calendar weeks
 * starting from `weekShift` weeks after today.
 *
 * A slot start time S is open iff:
 *   1. The day is active in stylist_availability
 *   2. S >= window start AND S + durationMinutes <= window end
 *   3. [S, S+durationMinutes) does not overlap any blocked_time interval
 *   4. S is at least minNoticeHours from now
 */

import type { TimeSlot } from "@/lib/types";

const TZ = "America/New_York";
const SLOT_INTERVAL_MINUTES = 30;
const MIN_NOTICE_HOURS = 2;

// --------------------------------------------------------------------------
// Types matching Supabase rows
// --------------------------------------------------------------------------

export type StylistAvailabilityRow = {
  day_of_week: number; // 0=Sun…6=Sat
  start_time: string;  // "10:00"
  end_time: string;    // "19:30"
  is_active: boolean;
};

export type BlockedTimeRow = {
  starts_at: string; // ISO timestamptz
  ends_at: string;
};

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/** Parse "HH:MM" → minutes since midnight */
function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}

/** Format minutes since midnight → "HH:MM" (24-h) */
function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

/** "HH:MM" 24h → "h:MM AM/PM" */
function hm24ToLabel(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const isPM = h >= 12;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${isPM ? "PM" : "AM"}`;
}

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** Get today's date string "YYYY-MM-DD" in America/New_York */
function todayInNY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ }); // "2026-05-05"
}

/** Parse "YYYY-MM-DD" → { year, month (1-based), day } */
function parseDate(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}

/** Add `days` to a "YYYY-MM-DD" date string */
function addDays(dateKey: string, days: number): string {
  const { year, month, day } = parseDate(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Day-of-week (0=Sun) for a "YYYY-MM-DD" date */
function dayOfWeek(dateKey: string): number {
  const { year, month, day } = parseDate(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Convert a "YYYY-MM-DD" + "HH:MM" pair into a UTC timestamp (ms).
 * Interprets the time as America/New_York wall-clock time.
 *
 * We use Intl to find the UTC offset for that exact wall-clock moment so we
 * handle DST transitions correctly.
 */
function nyWallToUtcMs(dateKey: string, hm: string): number {
  const { year, month, day } = parseDate(dateKey);
  const [h, m] = hm.split(":").map(Number);

  // Candidate UTC timestamp assuming the offset is -5 (EST) as a first guess
  // then correct by re-reading the offset via Intl.
  // We iterate once because DST edge cases are within 1 hr of the transition.
  const candidate = Date.UTC(year, month - 1, day, h, m, 0);

  // Determine actual NY offset at this moment
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(candidate));

  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  // tzPart looks like "GMT-4" or "GMT-5"
  const offsetHours = parseInt(tzPart.replace("GMT", ""), 10); // -4 or -5
  const offsetMs = offsetHours * 3600 * 1000;

  // wall time in UTC = wall time - offset
  return Date.UTC(year, month - 1, day, h, m, 0) - offsetMs;
}

/** Build a TimeSlot from a dateKey + "HH:MM" slot start */
function buildSlot(dateKey: string, hm: string): TimeSlot {
  const dow = dayOfWeek(dateKey);
  const { month, day } = parseDate(dateKey);
  const dayLabel = DAY_SHORT[dow];
  const dateLabel = `${MONTH_SHORT[month - 1]} ${day}`;
  const timeLabel = hm24ToLabel(hm);
  const [h, m] = hm.split(":").map(Number);
  const hour24 = h + m / 60;

  return {
    id: `slot-${dateKey}-${hm.replace(":", "")}`,
    dayLabel,
    dateLabel,
    timeLabel,
    fullLabel: `${dayLabel} ${timeLabel}`,
    dateKey,
    dayOfMonth: day,
    hour24,
    isoTime: hm,
  };
}

// --------------------------------------------------------------------------
// Main export
// --------------------------------------------------------------------------

export type GenerateSlotsOptions = {
  availability: StylistAvailabilityRow[];
  blockedTimes: BlockedTimeRow[];
  durationMinutes: number;
  /** 0 = this week starting today, 1 = next week, etc. */
  weekShift?: number;
  /** Number of calendar weeks to cover (default 3) */
  weekCount?: number;
};

export function generateSlots(opts: GenerateSlotsOptions): TimeSlot[] {
  const {
    availability,
    blockedTimes,
    durationMinutes,
    weekShift = 0,
    weekCount = 3,
  } = opts;

  const todayKey = todayInNY();
  const nowMs = Date.now();
  const minNoticeMs = MIN_NOTICE_HOURS * 3600 * 1000;

  // Build day-of-week lookup: dow → { startMinutes, endMinutes } | null
  const dowMap = new Map<number, { startMinutes: number; endMinutes: number }>();
  for (const row of availability) {
    if (row.is_active) {
      dowMap.set(row.day_of_week, {
        startMinutes: hmToMinutes(row.start_time),
        endMinutes: hmToMinutes(row.end_time),
      });
    }
  }

  // Pre-parse blocked intervals as [startMs, endMs]
  const blocked: [number, number][] = blockedTimes.map((b) => [
    new Date(b.starts_at).getTime(),
    new Date(b.ends_at).getTime(),
  ]);

  const slots: TimeSlot[] = [];

  // Determine date range: weekShift * 7 days from today, covering weekCount * 7 days
  const startDateKey = addDays(todayKey, weekShift * 7);
  const endDateKey = addDays(startDateKey, weekCount * 7);

  let cursor = startDateKey;
  while (cursor < endDateKey) {
    const dow = dayOfWeek(cursor);
    const window = dowMap.get(dow);

    if (window) {
      // Walk slot starts every SLOT_INTERVAL_MINUTES within the window
      // A slot is valid if [start, start+duration) fits inside the window
      let slotStart = window.startMinutes;
      while (slotStart + durationMinutes <= window.endMinutes) {
        const slotHm = minutesToHm(slotStart);
        const slotStartMs = nyWallToUtcMs(cursor, slotHm);
        const slotEndMs = slotStartMs + durationMinutes * 60 * 1000;

        // Min notice check
        if (slotStartMs >= nowMs + minNoticeMs) {
          // Overlap check against blocked intervals
          const isBlocked = blocked.some(([bStart, bEnd]) => {
            // Overlap: slot starts before block ends AND slot ends after block starts
            return slotStartMs < bEnd && slotEndMs > bStart;
          });

          if (!isBlocked) {
            slots.push(buildSlot(cursor, slotHm));
          }
        }

        slotStart += SLOT_INTERVAL_MINUTES;
      }
    }

    cursor = addDays(cursor, 1);
  }

  return slots;
}
