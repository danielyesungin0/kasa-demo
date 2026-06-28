/**
 * Booking summary helpers.
 *
 * Centralized math + formatting for combined-booking awareness. Used by:
 *   - assistant price/duration responses (handleInfoQuery)
 *   - slot selection acknowledgement
 *   - Details stage (booking review)
 *   - Confirmed stage (final confirmation)
 *
 * The brief's quality bar: after a combined booking exists, every later
 * response must reflect the full booking. The client should never wonder
 * "did it forget my haircut?". These helpers are the single source of
 * truth for what's in the booking and how it's summarized.
 */
import type { Service } from "./types";
import type { AssistantContext } from "./parse-intent";

/**
 * Returns the full booking as a flat ordered list — primary first, then
 * each additional service in the order they were added. Filters undefined.
 */
export function getBookingServices(context: AssistantContext): Service[] {
  const primary = context.selectedService ?? context.lastRecommendedService;
  if (!primary) return [];
  return [primary, ...context.additionalServices];
}

/**
 * Parse "$130+" → { value: 130, hasPlus: true }.
 * Returns { value: null } when the label has no numeric component (e.g.
 * "Free", "Custom"). Caller decides how to handle missing values.
 */
export function parsePriceLabel(
  priceLabel: string
): { value: number | null; hasPlus: boolean } {
  const match = priceLabel.match(/\$\s*(\d+(?:\.\d{1,2})?)/);
  if (!match) return { value: null, hasPlus: false };
  const n = parseFloat(match[1]);
  if (!Number.isFinite(n)) return { value: null, hasPlus: false };
  return { value: n, hasPlus: priceLabel.includes("+") };
}

/**
 * Returns line-item price breakdown for the booking. Each entry has the
 * service name, original priceLabel (preserves "+"), and the parsed
 * numeric value (null when not parseable).
 */
export function getBookingPriceBreakdown(
  context: AssistantContext
): Array<{ name: string; priceLabel: string; value: number | null }> {
  return getBookingServices(context).map((s) => {
    const parsed = parsePriceLabel(s.priceLabel);
    return { name: s.name, priceLabel: s.priceLabel, value: parsed.value };
  });
}

/**
 * Compute the estimated total. Returns:
 *   { total: number, label: "$250+" | "$420", hasPlus: boolean }  on success
 *   { total: null, label: null, hasPlus: false }                  if any
 *     price isn't parseable (caller should fall back to a sentence that
 *     doesn't claim a total).
 *
 * The "+" suffix is sticky — if any single service has a "+" price, the
 * total carries it too ("estimated $250+"). This mirrors how a real
 * stylist would talk about variable pricing.
 */
export function getEstimatedTotalPrice(
  context: AssistantContext
): { total: number | null; label: string | null; hasPlus: boolean } {
  const breakdown = getBookingPriceBreakdown(context);
  if (breakdown.length === 0)
    return { total: null, label: null, hasPlus: false };
  if (breakdown.some((b) => b.value === null))
    return { total: null, label: null, hasPlus: false };

  const total = breakdown.reduce<number>((sum, b) => sum + (b.value as number), 0);
  const hasPlus = breakdown.some((b) =>
    parsePriceLabel(b.priceLabel).hasPlus
  );
  const label = `$${Math.round(total)}${hasPlus ? "+" : ""}`;
  return { total, label, hasPlus };
}

/**
 * Format minutes as "1 hr 30 min" / "45 min" / "2 hr". Used for both
 * single-service and combined durations.
 */
export function formatDurationMinutes(minutes: number): string {
  if (minutes <= 0) return "0 min";
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

/**
 * Compute estimated total duration across all booking services.
 * Returns { minutes, label }. Brief: "about 2 hr 45 min".
 */
export function getEstimatedTotalDuration(
  context: AssistantContext
): { minutes: number; label: string } {
  const services = getBookingServices(context);
  const minutes = services.reduce((sum, s) => sum + s.durationMinutes, 0);
  return { minutes, label: formatDurationMinutes(minutes) };
}

/**
 * Generate the conversational answer to "how much does it cost?" for the
 * current booking context. Returns null if there's no service in context
 * yet (caller should prompt the user to pick one).
 *
 *   Single service:
 *     "Full Color is $300."
 *
 *   Combined booking with parseable totals:
 *     "Full Color is $300 and Medium / Long Hair Cut is $120, so the
 *      estimated total is $420."
 *
 *   Combined booking with at least one un-parseable price:
 *     "Full Color is $300+ and Custom Style is custom-quoted — Shen will
 *      give you a final estimate when you arrive."
 */
export function formatPriceAnswer(context: AssistantContext): string | null {
  const services = getBookingServices(context);
  if (services.length === 0) return null;

  if (services.length === 1) {
    return `${services[0].name} is ${services[0].priceLabel}.`;
  }

  const breakdown = getBookingPriceBreakdown(context);
  const items = breakdown.map((b) => `${b.name} is ${b.priceLabel}`);
  const joined =
    items.length === 2
      ? items.join(" and ")
      : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];

  const total = getEstimatedTotalPrice(context);
  if (total.label) {
    return `${joined}, so the estimated total is ${total.label}.`;
  }
  return `${joined}. Shen will give you a final estimate when you arrive.`;
}

/**
 * Generate the conversational answer to "how long will it take?" for the
 * current booking context. Returns null if no service yet.
 *
 *   Single service:
 *     "Full Color usually takes about 2 hr."
 *
 *   Combined booking:
 *     "Full Color is 2 hr and Medium / Long Hair Cut is 1 hr 15 min. Shen
 *      will confirm the exact total time, but plan for about 3 hr 15 min."
 */
export function formatDurationAnswer(context: AssistantContext): string | null {
  const services = getBookingServices(context);
  if (services.length === 0) return null;

  if (services.length === 1) {
    const s = services[0];
    return `${s.name} usually takes about ${s.durationLabel.toLowerCase()}.`;
  }

  const items = services.map((s) => `${s.name} is ${s.durationLabel.toLowerCase()}`);
  const joined =
    items.length === 2
      ? items.join(" and ")
      : items.slice(0, -1).join(", ") + ", and " + items[items.length - 1];

  const total = getEstimatedTotalDuration(context);
  return `${joined}. Shen will confirm the exact total time, but plan for about ${total.label}.`;
}

/**
 * Multi-line summary suitable for the booking-review and confirmation
 * screens. Returns an object the UI can render directly:
 *
 *   {
 *     lines: [
 *       { name: "Full Color", priceLabel: "$300", durationLabel: "2 hr" },
 *       { name: "Medium / Long Hair Cut", priceLabel: "$120", durationLabel: "1 hr 15 min" },
 *     ],
 *     totalPriceLabel: "$420",         // null when prices not parseable
 *     totalDurationLabel: "3 hr 15 min",
 *     hasAdditional: true,
 *     noteLine: "Haircut added to appointment notes for Shen to confirm.",
 *   }
 */
export function formatCombinedBookingSummary(
  context: AssistantContext
): {
  lines: Array<{
    name: string;
    priceLabel: string;
    durationLabel: string;
  }>;
  totalPriceLabel: string | null;
  totalDurationLabel: string;
  hasAdditional: boolean;
  noteLine: string | null;
} {
  const services = getBookingServices(context);
  const lines = services.map((s) => ({
    name: s.name,
    priceLabel: s.priceLabel,
    durationLabel: s.durationLabel,
  }));
  const totalPrice = getEstimatedTotalPrice(context);
  const totalDuration = getEstimatedTotalDuration(context);
  const hasAdditional = context.additionalServices.length > 0;

  // Note line for the secondary services (clients should know they're
  // added as a note rather than a separate Square service)
  let noteLine: string | null = null;
  if (hasAdditional) {
    const addedNames = context.additionalServices
      .map((s) => s.name)
      .join(" and ");
    const cat = context.additionalServices[0].category.toLowerCase();
    noteLine = `${addedNames} added to appointment notes for Shen to confirm.`;
    // Suppress 'cat' to avoid TS unused-var; intentional for future use
    void cat;
  }

  return {
    lines,
    totalPriceLabel: totalPrice.label,
    totalDurationLabel: totalDuration.label,
    hasAdditional,
    noteLine,
  };
}
