import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import type { Service, ServiceCategory } from "@/lib/types";

/**
 * Server-side reads for per-provider chat configuration (Pass 2A).
 *
 * Both functions return [] when the provider has nothing configured, so
 * callers can cleanly fall back to the demo/mock catalog. This is the
 * safety net that keeps /book/shen working before Square is synced.
 */

const SERVICE_CATEGORIES: ServiceCategory[] = [
  "Haircut",
  "Treatment",
  "Perm",
  "Color",
  "Manicure",
  "Pedicure",
  "Other",
];

function formatDurationLabel(minutes: number | null): string {
  if (minutes == null) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

export type ProviderServiceRow = {
  id: string;
  name: string;
  category: string | null;
  price_cents: number | null;
  duration_minutes: number | null;
  visible_in_chat: boolean;
  behavior: "book" | "consultation" | "handoff" | "hidden";
  aliases: string[];
  chat_description: string | null;
};

export type ProviderUnsupportedRule = {
  trigger_term: string;
  response_type: "not_offered" | "handoff" | "consultation" | "custom";
  custom_response: string | null;
};

/**
 * All chat-relevant services for a provider. Excludes hidden services up
 * front so callers never have to re-filter. Returns [] on any error or when
 * the provider has no rows (not synced yet) — caller falls back to mock.
 */
export async function getProviderServices(
  stylistId: string
): Promise<ProviderServiceRow[]> {
  try {
    const admin = createServiceRoleSupabaseClient();
    const { data, error } = await admin
      .from("provider_services")
      .select(
        "id, name, category, price_cents, duration_minutes, visible_in_chat, behavior, aliases, chat_description"
      )
      .eq("stylist_id", stylistId)
      .neq("behavior", "hidden");
    if (error || !data) return [];
    return data as ProviderServiceRow[];
  } catch {
    return [];
  }
}

/**
 * A provider's unsupported-service rules. Returns [] when none configured —
 * the chat then relies solely on the global hardcoded list (augment model).
 */
export async function getProviderUnsupportedRules(
  stylistId: string
): Promise<ProviderUnsupportedRule[]> {
  try {
    const admin = createServiceRoleSupabaseClient();
    const { data, error } = await admin
      .from("unsupported_rules")
      .select("trigger_term, response_type, custom_response")
      .eq("stylist_id", stylistId);
    if (error || !data) return [];
    return data as ProviderUnsupportedRule[];
  } catch {
    return [];
  }
}

/** Convenience: just the trigger terms, lowercased. For the client prop + checks. */
export async function getProviderUnsupportedTerms(
  stylistId: string
): Promise<string[]> {
  const rules = await getProviderUnsupportedRules(stylistId);
  return rules.map((r) => r.trigger_term.toLowerCase()).filter(Boolean);
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/**
 * The provider's REAL working days (full weekday names), derived from
 * stylist_availability — the same source the slot generator uses. This keeps
 * the AI's text answers ("are you open Wednesday?") consistent with the
 * actual schedule, instead of a stale hardcoded list.
 *
 * Returns [] when no availability rows exist; caller falls back to its
 * default so behavior is unchanged for unconfigured providers.
 */
export async function getProviderWorkingDays(
  stylistId: string
): Promise<string[]> {
  try {
    const admin = createServiceRoleSupabaseClient();
    const { data, error } = await admin
      .from("stylist_availability")
      .select("day_of_week, is_active")
      .eq("stylist_id", stylistId)
      .eq("is_active", true)
      .order("day_of_week");
    if (error || !data || data.length === 0) return [];
    // Map active day_of_week (0=Sun..6=Sat) → full weekday name.
    const days: string[] = [];
    for (const row of data as Array<{ day_of_week: number }>) {
      const name = WEEKDAY_NAMES[row.day_of_week];
      if (name && !days.includes(name)) days.push(name);
    }
    return days;
  } catch {
    return [];
  }
}

/**
 * Synced provider services mapped to the client's `Service` shape, for
 * rendering tappable service cards.
 *
 * CRITICAL: `Service.id` is set from `service_key` (svc-*), NOT the row's
 * UUID. That svc-* id is what /api/availability and /api/bookings look up in
 * service_catalog, so a card carrying it books cleanly through the existing
 * flow. Rows with a null/blank service_key (legacy, pre-migration-006, or
 * unmatched) are SKIPPED so a card can never carry an unbookable id —
 * the client falls back to the mock catalog for those.
 *
 * Returns [] when the provider has no usable rows; caller falls back to mock.
 */
export async function getProviderServicesAsServiceType(
  stylistId: string
): Promise<Service[]> {
  try {
    const admin = createServiceRoleSupabaseClient();
    const { data, error } = await admin
      .from("provider_services")
      .select(
        "service_key, name, category, price_cents, duration_minutes, visible_in_chat, behavior"
      )
      .eq("stylist_id", stylistId)
      .neq("behavior", "hidden")
      .eq("visible_in_chat", true);
    if (error || !data) return [];

    const out: Service[] = [];
    for (const row of data as Array<{
      service_key: string | null;
      name: string;
      category: string | null;
      price_cents: number | null;
      duration_minutes: number | null;
      behavior: string;
    }>) {
      // No svc-* key → can't be booked through the existing flow → skip.
      if (!row.service_key) continue;

      const category: ServiceCategory = SERVICE_CATEGORIES.includes(
        row.category as ServiceCategory
      )
        ? (row.category as ServiceCategory)
        : "Other";

      out.push({
        id: row.service_key,
        name: row.name,
        category,
        priceLabel:
          row.price_cents != null
            ? `$${Math.round(row.price_cents / 100)}`
            : "Price varies",
        durationMinutes: row.duration_minutes ?? 60,
        durationLabel: formatDurationLabel(row.duration_minutes),
        status: row.behavior === "consultation" ? "consultation" : "online",
      });
    }
    return out;
  } catch {
    return [];
  }
}
