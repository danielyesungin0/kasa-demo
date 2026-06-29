// Calendar date helpers (NY timezone). Real "today" — not the prototype's fixed
// demo week. Builds the unit-matched pill strips (days / week-ranges / months)
// and the month grid.
const TZ = "America/New_York";

export const OPEN_HOUR = 9;
export const CLOSE_HOUR = 19; // studio hours 9am–7pm (matches availability engine)
export const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function todayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}
export function nowHour(): number {
  const s = new Date().toLocaleTimeString("en-US", { timeZone: TZ, hour12: false, hour: "2-digit", minute: "2-digit" });
  const [h, m] = s.split(":").map(Number);
  return h + m / 60;
}
export function parseKey(key: string) {
  const [y, mo, d] = key.split("-").map(Number);
  return { y, mo, d };
}
export function addDaysKey(key: string, n: number): string {
  const { y, mo, d } = parseKey(key);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}
export function dowOf(key: string): number {
  const { y, mo, d } = parseKey(key);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export type DayPill = { key: string; dow: string; n: number; isToday: boolean };

/** A horizontal strip of `count` days starting at startKey. */
export function dayStrip(startKey: string, count: number): DayPill[] {
  const today = todayKey();
  return Array.from({ length: count }, (_, i) => {
    const key = addDaysKey(startKey, i);
    return { key, dow: DAY_SHORT[dowOf(key)], n: parseKey(key).d, isToday: key === today };
  });
}

/** Monday-of-week for a key (week grid uses Mon..Sun). */
export function weekStart(key: string): string {
  const dow = dowOf(key); // 0=Sun
  const deltaToMon = dow === 0 ? -6 : 1 - dow;
  return addDaysKey(key, deltaToMon);
}

export type WeekPill = { startKey: string; top: string; range: string; label: string; isCurrent: boolean };

/** Week-range pills centered on the current week (a few before/after). */
export function weekStrip(anchorKey: string, before = 2, after = 3): WeekPill[] {
  const curStart = weekStart(todayKey());
  const out: WeekPill[] = [];
  for (let i = -before; i <= after; i++) {
    const startKey = addDaysKey(weekStart(anchorKey), i * 7);
    const endKey = addDaysKey(startKey, 6);
    const s = parseKey(startKey), e = parseKey(endKey);
    const top = MONTH_SHORT[s.mo - 1];
    const range = s.mo === e.mo ? `${s.d}–${e.d}` : `${s.d}–${MONTH_SHORT[e.mo - 1]} ${e.d}`;
    out.push({
      startKey, top, range,
      label: s.mo === e.mo ? `${top} ${s.d}–${e.d}` : `${top} ${s.d} – ${MONTH_SHORT[e.mo - 1]} ${e.d}`,
      isCurrent: startKey === curStart,
    });
  }
  return out;
}

export type MonthPill = { idx: number; label: string; isCurrent: boolean };
export function monthStrip(): MonthPill[] {
  const cur = new Date().getMonth();
  return MONTH_SHORT.map((label, idx) => ({ idx, label, isCurrent: idx === cur }));
}

export type MonthCell = { key: string; date: number; isToday: boolean } | null;

/** 7-col month grid (Mon-first) for a given year+month, with leading pads. */
export function monthGrid(year: number, monthIdx: number): MonthCell[] {
  const firstDow = (new Date(Date.UTC(year, monthIdx, 1)).getUTCDay() + 6) % 7; // Mon=0
  const dim = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  const today = todayKey();
  const cells: MonthCell[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let date = 1; date <= dim; date++) {
    const key = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(date).padStart(2, "0")}`;
    cells.push({ key, date, isToday: key === today });
  }
  return cells;
}

export function fmtHourShort(h: number): string {
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh} ${h >= 12 ? "PM" : "AM"}`;
}
export function fmtHour(h: number): string {
  const hh = h % 12 === 0 ? 12 : Math.floor(h % 12);
  const m = h % 1 ? ":30" : ":00";
  return `${hh}${m} ${h >= 12 ? "PM" : "AM"}`;
}
export function monthLabel(idx: number, year: number): string {
  return `${["January","February","March","April","May","June","July","August","September","October","November","December"][idx]} ${year}`;
}
export function dayHeaderLabel(key: string): string {
  const { mo, d } = parseKey(key);
  return `${DAY_SHORT[dowOf(key)]}, ${MONTH_SHORT[mo - 1]} ${d}`;
}
