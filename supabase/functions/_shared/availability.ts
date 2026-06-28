// ============================================================
// Availability engine (pure) — faithful Deno port of lib/availability.ts.
//
// Computes open 30-min slot starts for a given service duration over a date
// range. TZ-aware (America/New_York, DST-correct), duration-aware (slot must
// fit the day window), conflict-aware (no overlap with blocked/booked), and
// respects a minimum-notice lead time.
//
// Kept as a pure function (no I/O) so it stays unit-testable and identical in
// behavior to the old Next.js engine. The Edge Function does the Supabase
// reads and calls this.
// ============================================================

const TZ = "America/New_York";
const SLOT_INTERVAL_MINUTES = 30;
const MIN_NOTICE_HOURS = 2;

export type StylistAvailabilityRow = {
  day_of_week: number; // 0=Sun…6=Sat
  start_time: string; // "10:00"
  end_time: string; // "19:30"
  is_active: boolean;
};

export type BlockedTimeRow = {
  starts_at: string; // ISO timestamptz
  ends_at: string;
};

export type TimeSlot = {
  id: string;
  dayLabel: string;
  dateLabel: string;
  timeLabel: string;
  fullLabel: string;
  dateKey: string;
  dayOfMonth: number;
  hour24: number;
  isoTime: string;
  /** ISO start instant (UTC) — useful for the booking call downstream. */
  startsAtIso: string;
};

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function hmToMinutes(hm: string): number {
  const [h, m] = hm.split(":").map(Number);
  return h * 60 + m;
}
function minutesToHm(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}
function hm24ToLabel(hm: string): string {
  const [h, m] = hm.split(":").map(Number);
  const isPM = h >= 12;
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${isPM ? "PM" : "AM"}`;
}
function todayInNY(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
function parseDate(dateKey: string): { year: number; month: number; day: number } {
  const [year, month, day] = dateKey.split("-").map(Number);
  return { year, month, day };
}
function addDays(dateKey: string, days: number): string {
  const { year, month, day } = parseDate(dateKey);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function dayOfWeek(dateKey: string): number {
  const { year, month, day } = parseDate(dateKey);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Convert "YYYY-MM-DD" + "HH:MM" (NY wall-clock) → UTC ms, DST-correct via Intl.
 */
function nyWallToUtcMs(dateKey: string, hm: string): number {
  const { year, month, day } = parseDate(dateKey);
  const [h, m] = hm.split(":").map(Number);
  const candidate = Date.UTC(year, month - 1, day, h, m, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    hour: "numeric",
    hour12: false,
    timeZoneName: "shortOffset",
  }).formatToParts(new Date(candidate));
  const tzPart = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT-5";
  const offsetHours = parseInt(tzPart.replace("GMT", ""), 10);
  const offsetMs = offsetHours * 3600 * 1000;
  return Date.UTC(year, month - 1, day, h, m, 0) - offsetMs;
}

function buildSlot(dateKey: string, hm: string, startsAtMs: number): TimeSlot {
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
    startsAtIso: new Date(startsAtMs).toISOString(),
  };
}

export type GenerateSlotsOptions = {
  availability: StylistAvailabilityRow[];
  blockedTimes: BlockedTimeRow[];
  durationMinutes: number;
  weekShift?: number;
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

  const nowMs = Date.now();
  const minNoticeMs = MIN_NOTICE_HOURS * 3600 * 1000;

  const dowMap = new Map<number, { startMinutes: number; endMinutes: number }>();
  for (const row of availability) {
    if (row.is_active) {
      dowMap.set(row.day_of_week, {
        startMinutes: hmToMinutes(row.start_time),
        endMinutes: hmToMinutes(row.end_time),
      });
    }
  }

  const blocked: [number, number][] = blockedTimes.map((b) => [
    new Date(b.starts_at).getTime(),
    new Date(b.ends_at).getTime(),
  ]);

  const slots: TimeSlot[] = [];
  const startDateKey = addDays(todayInNY(), weekShift * 7);
  const endDateKey = addDays(startDateKey, weekCount * 7);

  let cursor = startDateKey;
  while (cursor < endDateKey) {
    const window = dowMap.get(dayOfWeek(cursor));
    if (window) {
      let slotStart = window.startMinutes;
      while (slotStart + durationMinutes <= window.endMinutes) {
        const slotHm = minutesToHm(slotStart);
        const slotStartMs = nyWallToUtcMs(cursor, slotHm);
        const slotEndMs = slotStartMs + durationMinutes * 60 * 1000;
        if (slotStartMs >= nowMs + minNoticeMs) {
          const isBlocked = blocked.some(
            ([bStart, bEnd]) => slotStartMs < bEnd && slotEndMs > bStart,
          );
          if (!isBlocked) slots.push(buildSlot(cursor, slotHm, slotStartMs));
        }
        slotStart += SLOT_INTERVAL_MINUTES;
      }
    }
    cursor = addDays(cursor, 1);
  }

  return slots;
}
