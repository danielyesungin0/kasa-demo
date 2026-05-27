import type {
  Service,
  TimeSlot,
  Appointment,
  QuickReply,
  Availability,
} from "./types";
import { MIA_CATALOG } from "./businesses/mia-hair";

export const STYLIST = {
  name: "Shen",
  handle: "shen",
  bookingUrl: "book.kasa.app/shen",
  location: "Shen Hair Studio · 160 Madison Ave., Suite 13, New York, NY",
  initials: "S",
};

/** Service list sourced from the catalog (CatalogEntry extends Service). */
export const SERVICES: Service[] = MIA_CATALOG;

/* -------------------------------------------------------------------------- */
/* Dynamic "today" reference — always relative to the current date            */
/* -------------------------------------------------------------------------- */

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

function todayLocalDateKey(): string {
  const d = new Date();
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function addDaysToDateKey(dateKey: string, n: number): string {
  const d = new Date(dateKey + "T12:00:00"); // noon to avoid DST edge
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

function dateKeyToMeta(dateKey: string) {
  const d = new Date(dateKey + "T12:00:00");
  return {
    dateKey,
    dayLabel: DAY_NAMES[d.getDay()] as typeof DAY_NAMES[number],
    dateLabel: `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`,
    dayOfMonth: d.getDate(),
  };
}

function buildSlotFromDateKey(dateKey: string, time24: string): TimeSlot {
  const meta = dateKeyToMeta(dateKey);
  const [h, m] = time24.split(":").map(Number);
  const hour24 = h + m / 60;
  const isPM = h >= 12;
  const hour12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  const timeLabel = `${hour12}:${m.toString().padStart(2, "0")} ${isPM ? "PM" : "AM"}`;
  return {
    id: `slot-${dateKey}-${time24.replace(":", "")}`,
    dayLabel: meta.dayLabel,
    dateLabel: meta.dateLabel,
    timeLabel,
    fullLabel: `${meta.dayLabel} ${timeLabel}`,
    dateKey: meta.dateKey,
    dayOfMonth: meta.dayOfMonth,
    hour24,
    isoTime: time24,
  };
}

export const MOCK_TODAY = (() => {
  const key = todayLocalDateKey();
  return dateKeyToMeta(key);
})();

export const MOCK_TOMORROW = (() => {
  const key = addDaysToDateKey(todayLocalDateKey(), 1);
  return dateKeyToMeta(key);
})();

/* -------------------------------------------------------------------------- */
/* Dynamic slot generator                                                      */
/*                                                                             */
/* Working days: Tue, Thu, Fri, Sat (+ occasional Mon for some services).     */
/* Generates slots across the next 21 days (3 weeks) from today.              */
/* Times are a realistic mix — morning, midday, afternoon — per service type. */
/* Week 3 is intentionally sparse to demo limited-availability copy.          */
/* -------------------------------------------------------------------------- */

type SlotPattern = {
  // Days of week (0=Sun…6=Sat) that this service is offered on
  days: number[];
  // Times offered on those days (not all times on all days — see perDay)
  times: string[];
  // Optional override: day-of-week → specific times (overrides `times` for that dow)
  perDay?: Partial<Record<number, string[]>>;
  // Days offset from today for week 3 start (default 14)
  sparseFromDay?: number;
  // How many times per week-3 day (default 1 = just the first time)
  sparseTimesPerDay?: number;
};

// DOW constants
const TUE = 2, WED = 3, THU = 4, FRI = 5, SAT = 6, MON = 1;

const SERVICE_PATTERNS: Record<string, SlotPattern> = {
  "svc-medium-long-cut": {
    days: [TUE, WED, FRI, SAT],
    times: ["9:00", "10:30", "12:15", "14:00", "15:30"],
    perDay: {
      [WED]: ["11:00", "14:00", "16:30"],
      [SAT]: ["11:00", "13:30", "15:00"],
    },
    sparseTimesPerDay: 1,
  },
  "svc-short-cut": {
    days: [TUE, WED, THU, FRI, SAT],
    times: ["10:00", "11:30", "13:30", "15:00", "16:00"],
    perDay: {
      [MON]: ["11:00"],
      [SAT]: ["10:00", "13:00"],
    },
    sparseTimesPerDay: 1,
  },
  "svc-root-touchup": {
    days: [TUE, WED, FRI, SAT],
    times: ["10:30", "11:00", "13:00", "14:30"],
    perDay: {
      [WED]: ["10:30", "14:30"],
      [SAT]: ["12:00", "13:30"],
    },
    sparseTimesPerDay: 1,
  },
  "svc-full-color": {
    days: [WED, THU, FRI, SAT],
    times: ["10:00", "10:30", "11:00", "13:00"],
    perDay: {
      [SAT]: ["10:00", "11:30"],
    },
    sparseTimesPerDay: 1,
  },
  "svc-cut-down-perm": {
    days: [WED, FRI, SAT],
    times: ["10:30", "12:00", "13:00"],
    sparseTimesPerDay: 1,
  },
  "svc-mens-perm-cut": {
    days: [TUE, WED, FRI, SAT],
    times: ["10:00", "12:30", "13:00", "14:00"],
    sparseTimesPerDay: 1,
  },
  "svc-bang-perm": {
    days: [TUE, WED, FRI, SAT],
    times: ["15:30", "16:00", "16:30"],
    sparseTimesPerDay: 1,
  },
  "svc-womens-regular-perm": {
    days: [WED, FRI],
    times: ["10:00", "10:30"],
    sparseTimesPerDay: 1,
  },
  "svc-womens-digital-perm": {
    days: [THU],
    times: ["10:00"],
    sparseTimesPerDay: 1,
  },
  "svc-straightening-perm": {
    days: [THU, MON],
    times: ["10:00"],
    sparseTimesPerDay: 1,
  },
  "svc-head-spa": {
    days: [TUE, WED, THU, FRI, SAT],
    times: ["11:00", "13:00", "14:00", "14:30"],
    perDay: {
      [SAT]: ["12:30", "11:30"],
    },
    sparseTimesPerDay: 1,
  },
  "svc-milbon": {
    days: [WED, FRI, SAT],
    times: ["11:30", "12:30", "13:30"],
    sparseTimesPerDay: 1,
  },
  "svc-keratin": {
    days: [THU, MON],
    times: ["13:00"],
    sparseTimesPerDay: 1,
  },
};

function generateSlotsForPattern(pattern: SlotPattern): TimeSlot[] {
  const slots: TimeSlot[] = [];
  const todayKey = todayLocalDateKey();
  const sparseStart = addDaysToDateKey(todayKey, pattern.sparseFromDay ?? 14);
  const horizon = addDaysToDateKey(todayKey, 21);

  let cursor = addDaysToDateKey(todayKey, 1); // start tomorrow
  while (cursor < horizon) {
    const d = new Date(cursor + "T12:00:00");
    const dow = d.getDay();

    if (pattern.days.includes(dow)) {
      const isSparse = cursor >= sparseStart;
      const dayTimes = pattern.perDay?.[dow] ?? pattern.times;
      const limit = isSparse ? (pattern.sparseTimesPerDay ?? 1) : dayTimes.length;

      for (let i = 0; i < limit; i++) {
        slots.push(buildSlotFromDateKey(cursor, dayTimes[i]));
      }
    }

    cursor = addDaysToDateKey(cursor, 1);
  }

  return slots;
}

// Lazily built so date is always fresh at module load time
const SLOT_GRID: Record<string, TimeSlot[]> = Object.fromEntries(
  Object.entries(SERVICE_PATTERNS).map(([id, pattern]) => [
    id,
    generateSlotsForPattern(pattern),
  ])
);

/**
 * Look up slots for a given service. Falls back to medium/long cut if the
 * service has no specific grid (defensive — shouldn't happen in practice).
 */
export function getSlotsForService(serviceId: string): TimeSlot[] {
  return SLOT_GRID[serviceId] ?? SLOT_GRID["svc-medium-long-cut"];
}

/* -------------------------------------------------------------------------- */
/* Combo service matcher                                                       */
/*                                                                             */
/* The brief calls out a specific failure mode: "men's cut and perm" should   */
/* map to the existing combo Square service "Men's Perm + Hair Cut", NOT     */
/* split into Haircut + Perm as separate services. The tag-based path can't  */
/* tell the difference, so we short-circuit with phrase-pattern matching.     */
/*                                                                             */
/* The matcher is intentionally permissive about word order ("perm and cut"  */
/* vs "cut and perm") because real users phrase it both ways. Each rule has  */
/* a `requires` list — every required token must be present, in any order.   */
/* `excludes` lets us avoid false positives.                                  */
/* -------------------------------------------------------------------------- */

type ComboRule = {
  serviceId: string;
  // All of these must match (each is a regex or substring) for the rule to fire
  requires: RegExp[];
  // None of these may match — used to disambiguate (e.g. "down perm" must not
  // match the generic perm+haircut combo intended for digital/regular)
  excludes?: RegExp[];
};

const COMBO_RULES: ComboRule[] = [
  // Hair Cut + Down Perm — kept because the stylist has a real single-SKU
  // combo with its own price/duration for this specific request. "Down perm"
  // is a specific perm style, not a gender or length signal.
  {
    serviceId: "svc-cut-down-perm",
    requires: [/\bdown\s*perm\b/, /\b(hair\s*cut|cut|trim)\b/],
  },
  // NOTE: the "Men's Perm + Hair Cut" combo rule was removed deliberately.
  // Generic "perm and haircut" requests now route through the tag-based
  // multi-service path so the chat books TWO services (perm + haircut)
  // regardless of catalog shape. This scales to any stylist's catalog —
  // not just those with a Mia-style combo SKU. Combo SKUs that map to
  // genuinely specific user intent (like "down perm") still apply.
  // Bang Perm — standalone service, real bang-specific SKU.
  {
    serviceId: "svc-bang-perm",
    requires: [/\b(bang|bangs)\b/, /\bperm\b/],
  },
  // Digital Perm — standalone service, real "digital perm" SKU.
  {
    serviceId: "svc-womens-digital-perm",
    requires: [/\bdigital\b/, /\bperm\b/],
  },
  // Straightening Perm — standalone service.
  {
    serviceId: "svc-straightening-perm",
    requires: [/\bstraighten|\bstraight\b/, /\bperm\b/],
  },
];

export type ComboMatch = {
  service: Service;
  ruleIndex: number;
};

/**
 * Returns the best combo Square service for a given message, or null.
 * Caller should short-circuit and skip tag-based recommendation when this
 * returns a match.
 */
export function findBestComboServiceMatch(message: string): ComboMatch | null {
  const text = message.toLowerCase();
  for (let i = 0; i < COMBO_RULES.length; i++) {
    const rule = COMBO_RULES[i];
    const allRequired = rule.requires.every((re) => re.test(text));
    if (!allRequired) continue;
    const anyExcluded =
      rule.excludes?.some((re) => re.test(text)) ?? false;
    if (anyExcluded) continue;
    const service = SERVICES.find((s) => s.id === rule.serviceId);
    if (service) return { service, ruleIndex: i };
  }
  return null;
}

/**
 * The latest date for which we have any mock slots (21 days from today).
 */
export const MOCK_AVAILABILITY_HORIZON = (() => {
  const key = addDaysToDateKey(todayLocalDateKey(), 20);
  const meta = dateKeyToMeta(key);
  return { dateKey: meta.dateKey, dayOfMonth: meta.dayOfMonth, dateLabel: meta.dateLabel };
})();

/**
 * Days of the week Shen takes appointments. Used to distinguish between
 * "Shen doesn't usually work that day" (non-working day) and "Shen is working
 * but fully booked" (working day with no slots) when answering availability
 * questions like "are you available Thursday?".
 */
export const WORKING_DAYS: ReadonlyArray<"Sun" | "Mon" | "Tue" | "Wed" | "Thu" | "Fri" | "Sat"> = [
  "Sun",
  "Tue",
  "Thu",
  "Fri",
  "Sat",
];

/**
 * The three earliest slots across all services, used at the top of the booking page.
 * Always pulled from the live medium/long cut grid so they're never in the past.
 */
export const EARLIEST_SLOTS: TimeSlot[] = getSlotsForService("svc-medium-long-cut").slice(0, 3);

/**
 * Legacy export — used by the time picker fallback when no service is selected
 * yet.
 */
export const SERVICE_SLOTS: TimeSlot[] = SLOT_GRID["svc-medium-long-cut"];

export const CONSULTATION_SLOTS: TimeSlot[] = getSlotsForService("svc-short-cut").slice(0, 3);

export const DEFAULT_AVAILABILITY: Availability = {
  days: ["Tue", "Thu", "Fri", "Sat", "Sun"],
  startLabel: "10:00 AM",
  endLabel: "7:30 PM",
  bufferMinutes: 15,
  minNoticeHours: 12,
};

// Today's appointments (relative to current date)
const _todayKey = todayLocalDateKey();
const _todayMeta = dateKeyToMeta(_todayKey);
const _d2 = addDaysToDateKey(_todayKey, 2);
const _d2meta = dateKeyToMeta(_d2);
const _d4 = addDaysToDateKey(_todayKey, 4);
const _d4meta = dateKeyToMeta(_d4);
const _d6 = addDaysToDateKey(_todayKey, 6);
const _d6meta = dateKeyToMeta(_d6);
const _d7 = addDaysToDateKey(_todayKey, 7);
const _d7meta = dateKeyToMeta(_d7);

export const TODAY_APPOINTMENTS: Appointment[] = [
  {
    id: "appt-1",
    clientName: "Sarah K.",
    clientPhone: "5550000001",
    serviceId: "svc-medium-long-cut",
    serviceName: "Medium / Long Hair Cut",
    dayLabel: "Today",
    dateLabel: _todayMeta.dateLabel,
    dateKey: _todayKey,
    isoTime: "11:00",
    timeLabel: "11:00 AM",
    durationLabel: "1 hr 15 min",
    channel: "Booking link",
  },
  {
    id: "appt-2",
    clientName: "James L.",
    clientPhone: "5550000002",
    serviceId: "svc-mens-perm-cut",
    serviceName: "Men's Perm + Hair Cut",
    dayLabel: "Today",
    dateLabel: _todayMeta.dateLabel,
    dateKey: _todayKey,
    isoTime: "14:30",
    timeLabel: "2:30 PM",
    durationLabel: "2 hr",
    channel: "Instagram",
  },
];

// Demo phone book (for the client-side lookup flow):
//   5551234567 → 1 upcoming (Priya, Full Color)
//   5559876543 → 2 upcoming (Min-jun, Head Spa + Root Touch-up)
//   anything else → 0 found (drives the not-found branch)
export const UPCOMING_APPOINTMENTS: Appointment[] = [
  {
    id: "appt-3",
    clientName: "Priya R.",
    clientPhone: "5551234567",
    serviceId: "svc-full-color",
    serviceName: "Full Color",
    dayLabel: `${_d2meta.dayLabel}, ${_d2meta.dateLabel}`,
    dateLabel: _d2meta.dateLabel,
    dateKey: _d2,
    isoTime: "10:30",
    timeLabel: "10:30 AM",
    durationLabel: "2 hr",
    channel: "Booking link",
  },
  {
    id: "appt-4",
    clientName: "Min-jun C.",
    clientPhone: "5559876543",
    serviceId: "svc-head-spa",
    serviceName: "Head Spa",
    dayLabel: `${_d4meta.dayLabel}, ${_d4meta.dateLabel}`,
    dateLabel: _d4meta.dateLabel,
    dateKey: _d4,
    isoTime: "14:00",
    timeLabel: "2:00 PM",
    durationLabel: "1 hr",
    channel: "Booking link",
  },
  {
    id: "appt-5",
    clientName: "Laura T.",
    clientPhone: "5553334444",
    serviceId: "svc-root-touchup",
    serviceName: "Root Touch-up",
    dayLabel: `${_d6meta.dayLabel}, ${_d6meta.dateLabel}`,
    dateLabel: _d6meta.dateLabel,
    dateKey: _d6,
    isoTime: "13:15",
    timeLabel: "1:15 PM",
    durationLabel: "1 hr 30 min",
    channel: "WeChat",
  },
  {
    id: "appt-6",
    clientName: "Min-jun C.",
    clientPhone: "5559876543",
    serviceId: "svc-root-touchup",
    serviceName: "Root Touch-up",
    dayLabel: `${_d7meta.dayLabel}, ${_d7meta.dateLabel}`,
    dateLabel: _d7meta.dateLabel,
    dateKey: _d7,
    isoTime: "11:30",
    timeLabel: "11:30 AM",
    durationLabel: "1 hr 30 min",
    channel: "Booking link",
  },
];

/* -------------------------------------------------------------------------- */
/* Phone helpers + client-side appointment lookup                              */
/* -------------------------------------------------------------------------- */

/**
 * Strip non-digit characters and return the canonical 10-digit US phone.
 * Accepts "(555) 123-4567", "555-123-4567", "555.123.4567", "+1 555 123 4567",
 * "5551234567", "15551234567". Returns null otherwise.
 */
export function extractPhoneDigits(input: string): string | null {
  const digits = input.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return null;
}

/** "5551234567" → "(555) 123-4567" */
export function formatPhoneDisplay(digits: string): string {
  if (digits.length !== 10) return digits;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Format a US phone as the user types. Strips non-digit characters, caps at
 * 10 digits, and inserts parens / spaces / dashes progressively:
 *   ""        → ""
 *   "4"       → "4"
 *   "444"     → "444"
 *   "4442"    → "(444) 2"
 *   "4442345" → "(444) 234-5"
 *   full      → "(444) 234-5678"
 * Anything beyond 10 digits is dropped — onChange handlers don't need extra
 * length-cap logic.
 */
export function formatPhoneAsTyped(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length < 4) return digits;
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/**
 * Filter the given appointments down to upcoming ones (today or later) for the
 * provided phone. Caller passes the live store list so we get fresh post-cancel
 * results, not the static mock.
 */
export function findUpcomingByPhone(
  phone: string,
  appointments: Appointment[]
): Appointment[] {
  const normalized = extractPhoneDigits(phone);
  if (!normalized) return [];
  const todayKey = todayLocalDateKey();
  return appointments.filter(
    (a) => a.clientPhone === normalized && a.dateKey >= todayKey
  );
}

// Curated 2-3 service shortlists per category for the assistant
// (full lists live in SERVICES; the assistant keeps choices tight)
export const ASSISTANT_SHORTLIST_IDS: Record<string, string[]> = {
  Haircut: ["svc-short-cut", "svc-medium-long-cut"],
  Color: ["svc-root-touchup", "svc-full-color"],
  Perm: ["svc-cut-down-perm", "svc-mens-perm-cut", "svc-bang-perm"],
  Treatment: ["svc-head-spa", "svc-milbon", "svc-keratin"],
  Other: [],
};

export function getShortlist(category: string): Service[] {
  const ids = ASSISTANT_SHORTLIST_IDS[category] ?? [];
  return ids
    .map((id) => SERVICES.find((s) => s.id === id))
    .filter((s): s is Service => Boolean(s) && s!.status !== "hidden");
}

/**
 * Returns the N soonest slots across all services in a category, deduped by
 * day+time and sorted chronologically. Used by the entry screen's
 * "Book soonest available" path so each slot is tied to a real service
 * (not a hardcoded default).
 *
 * Each returned slot carries its source serviceId so the caller can route
 * the user to Details with the right service pre-selected.
 */
export type EarliestSlot = TimeSlot & { serviceId: string };

export function getSoonestSlotsForCategory(
  category: string,
  count: number
): EarliestSlot[] {
  const services = getShortlist(category);
  const merged: EarliestSlot[] = [];
  for (const svc of services) {
    for (const slot of getSlotsForService(svc.id)) {
      merged.push({ ...slot, serviceId: svc.id });
    }
  }
  // Sort by (dateKey, isoTime) ascending — getSlotsForService already returns
  // chronologically-sorted slots per service, but merging two services
  // requires a re-sort.
  merged.sort((a, b) => {
    if (a.dateKey !== b.dateKey) return a.dateKey < b.dateKey ? -1 : 1;
    return a.isoTime < b.isoTime ? -1 : 1;
  });
  // Dedupe by dateKey+isoTime so we don't show two cards for the same wall
  // clock time (which would feel duplicative to the user).
  const seen = new Set<string>();
  const out: EarliestSlot[] = [];
  for (const slot of merged) {
    const key = `${slot.dateKey}T${slot.isoTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(slot);
    if (out.length >= count) break;
  }
  return out;
}

export const QUICK_REPLIES: QuickReply[] = [
  {
    id: "qr-short",
    label: "Short",
    body: "Book here: book.kasa.app/shen",
  },
  {
    id: "qr-friendly",
    label: "Friendly",
    body: "Hey! I'm with a client right now 💇‍♀️ Fastest way to book is here: book.kasa.app/shen",
  },
  {
    id: "qr-existing",
    label: "Existing client",
    body: "Of course! You can see my latest openings and book instantly here: book.kasa.app/shen",
  },
  {
    id: "qr-new",
    label: "New client",
    body: "Hi! I'd love to help. Please start here so I can find the best time for you: book.kasa.app/shen",
  },
];

export const DASHBOARD_STATS = {
  bookingsThroughLink: 42,
  manualRepliesAvoided: 116,
  estimatedTimeSavedHours: 9.5,
};
