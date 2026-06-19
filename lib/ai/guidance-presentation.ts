/**
 * How should the chat PRESENT an AI response that carries one or more service
 * ids? This is the consultation-first guard against the "answered a question,
 * then stapled a booking cart to it" bug.
 *
 * The rule (answer first, don't assume a booking):
 *   - service_guidance with MULTIPLE options → the client asked "which of
 *     these?" / "what's the difference?". Show the options as a SELECTABLE
 *     LIST so they pick ONE. NEVER a stacked cart with an estimated total.
 *   - a genuine MULTI-SERVICE BOOKING ("a perm AND a haircut", flagged by
 *     multiServiceRequest on a booking intent) → a cart IS correct.
 *   - a single clear service → a normal recommendation.
 *
 * This is category-agnostic: it behaves identically for haircuts, perms,
 * colors, treatments, nails — anything with multiple matches.
 */

export type GuidanceIntent =
  | "faq"
  | "service_guidance"
  | "consultation"
  | "booking"
  | "handoff"
  | "unsupported"
  | "unknown"
  | string;

export type GuidancePresentation =
  /** Show options to choose ONE from. No primary, no cart, no total. */
  | { kind: "options" }
  /** Show a recommendation. `withCart` true only for a genuine multi-booking. */
  | { kind: "recommendation"; withCart: boolean }
  /** Nothing service-shaped to present (handle elsewhere — reply only, etc.). */
  | { kind: "none" };

export function decideGuidancePresentation(input: {
  intent: GuidanceIntent;
  resolvedServiceCount: number;
  multiServiceRequest: boolean;
}): GuidancePresentation {
  const { intent, resolvedServiceCount, multiServiceRequest } = input;

  if (resolvedServiceCount <= 0) return { kind: "none" };

  // A genuine multi-service booking is the ONLY case that earns a cart.
  const isGenuineMultiBooking =
    intent === "booking" && multiServiceRequest && resolvedServiceCount > 1;

  // "Which of these?" — guidance with several options. Show a chooser, never
  // a cart, regardless of category (perm/color/treatment/haircut/nails).
  if (
    intent === "service_guidance" &&
    resolvedServiceCount > 1 &&
    !isGenuineMultiBooking
  ) {
    return { kind: "options" };
  }

  if (intent === "service_guidance" || intent === "booking") {
    return { kind: "recommendation", withCart: isGenuineMultiBooking };
  }

  return { kind: "none" };
}
