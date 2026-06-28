import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Writes the provider-facing onboarding availability model into the
 * stylist_availability table that /api/availability and the AI working-days
 * grounding both read.
 *
 * The onboarding model (lib/types.ts Availability) speaks day ABBREVIATIONS
 * ("Tue") and 12-hour LABELS ("10:00 AM"); the table stores integer
 * day_of_week (0=Sun..6=Sat) and 24-hour "HH:MM". This module owns that
 * translation so the reader stays untouched.
 *
 * NOTE: this is the manual/default availability path for beta. Importing hours
 * from Square is a deliberate later phase (not built here).
 */

export type AvailabilityInput = {
  days: string[]; // e.g. ["Tue","Thu","Fri","Sat","Sun"]
  startLabel: string; // e.g. "10:00 AM"
  endLabel: string; // e.g. "7:30 PM"
};

// Sensible default for a provider who skips the availability step entirely, so
// /book/<slug> shows real slots instead of an empty calendar. Mirrors the
// onboarding DEFAULT_AVAILABILITY shape.
export const DEFAULT_AVAILABILITY_INPUT: AvailabilityInput = {
  days: ["Tue", "Thu", "Fri", "Sat", "Sun"],
  startLabel: "10:00 AM",
  endLabel: "7:30 PM",
};

const DAY_ABBR_TO_INDEX: Record<string, number> = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
};

/**
 * Parse a label like "10:00 AM", "7:30 PM", "9 am", or already-24h "14:00"
 * into "HH:MM" 24-hour text. Returns null if unparseable.
 */
export function labelTo24h(label: string | null | undefined): string | null {
  if (!label) return null;
  const raw = label.trim().toLowerCase();

  const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return null;

  let hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const meridiem = m[3];

  if (Number.isNaN(hour) || Number.isNaN(minute) || hour > 23 || minute > 59) {
    return null;
  }

  if (meridiem === "am") {
    if (hour === 12) hour = 0;
  } else if (meridiem === "pm") {
    if (hour !== 12) hour += 12;
  }
  // No meridiem → treat as already 24-hour.

  if (hour > 23) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function dayAbbrToIndex(abbr: string): number | null {
  const idx = DAY_ABBR_TO_INDEX[abbr.trim().slice(0, 3).toLowerCase()];
  return idx === undefined ? null : idx;
}

/**
 * Replace a stylist's availability windows with the given onboarding model.
 * Deletes existing rows for that stylist, then inserts one row per selected
 * day. Returns the number of rows written, or throws on a DB error.
 */
export async function writeAvailability(
  stylistId: string,
  input: AvailabilityInput
): Promise<number> {
  const start = labelTo24h(input.startLabel);
  const end = labelTo24h(input.endLabel);
  if (!start || !end) {
    throw new Error(
      `Unparseable time labels: start="${input.startLabel}" end="${input.endLabel}"`
    );
  }

  const dayIndexes = Array.from(
    new Set(
      (input.days ?? [])
        .map(dayAbbrToIndex)
        .filter((d): d is number => d !== null)
    )
  );

  const admin = createServiceRoleSupabaseClient();

  // Replace semantics: clear existing windows, then insert the new set.
  const { error: delErr } = await admin
    .from("stylist_availability")
    .delete()
    .eq("stylist_id", stylistId);
  if (delErr) throw new Error(`availability delete failed: ${delErr.message}`);

  if (dayIndexes.length === 0) return 0;

  const rows = dayIndexes.map((day_of_week) => ({
    stylist_id: stylistId,
    day_of_week,
    start_time: start,
    end_time: end,
    is_active: true,
  }));

  const { error: insErr } = await admin
    .from("stylist_availability")
    .insert(rows);
  if (insErr) throw new Error(`availability insert failed: ${insErr.message}`);

  return rows.length;
}

/**
 * Seed default availability ONLY if the provider has none yet. Idempotent:
 * existing providers (or anyone who already set hours) are left untouched.
 * Used by the Square OAuth callback so a brand-new provider is never left with
 * zero slots. Non-fatal by contract — callers log and continue on failure.
 */
export async function seedDefaultAvailabilityIfEmpty(
  stylistId: string
): Promise<{ seeded: boolean }> {
  const admin = createServiceRoleSupabaseClient();
  const { count } = await admin
    .from("stylist_availability")
    .select("id", { count: "exact", head: true })
    .eq("stylist_id", stylistId);

  if ((count ?? 0) > 0) return { seeded: false };

  await writeAvailability(stylistId, DEFAULT_AVAILABILITY_INPUT);
  return { seeded: true };
}
