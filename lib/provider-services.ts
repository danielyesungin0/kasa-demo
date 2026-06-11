import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";

/**
 * Server-side reads for per-provider chat configuration (Pass 2A).
 *
 * Both functions return [] when the provider has nothing configured, so
 * callers can cleanly fall back to the demo/mock catalog. This is the
 * safety net that keeps /book/shen working before Square is synced.
 */

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
