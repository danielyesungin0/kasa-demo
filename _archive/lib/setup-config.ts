/**
 * Stylist's local "overlay" config — controls how the assistant presents and
 * routes Square data without modifying Square itself.
 *
 * Source-of-truth split:
 *   - Square owns: service price, duration, raw availability, real bookings
 *   - Our app owns: display name, assistant-facing status, assistant behavior
 *
 * For the prototype these settings are state-bound but not yet wired into
 * /mia. Production would thread them through getRecommendedServices and the
 * assistant's response generator.
 */

export type AssistantServiceStatus =
  | "instant" // Book instantly — assistant skips clarification
  | "clarify" // Assistant should clarify first
  | "consult" // Consultation recommended
  | "hidden"; // Hide from booking link

export type ServiceOverlay = {
  serviceId: string;
  // Display name overlay — null means use Square's name
  displayName: string | null;
  status: AssistantServiceStatus;
};

export type BookingStyle =
  | "best-times" // Show 3 best times first
  | "earliest" // Show earliest available
  | "ask-first"; // Ask one clarifying question

export type CustomRequestHandling =
  | "consult" // Send to consultation
  | "dm" // Tell client to DM stylist
  | "note"; // Add note to booking

export type AssistantTone = "warm" | "minimal" | "professional";

export type AssistantConfig = {
  greeting: string;
  bookingStyle: BookingStyle;
  customRequestHandling: CustomRequestHandling;
  tone: AssistantTone;
};

export const DEFAULT_ASSISTANT_CONFIG: AssistantConfig = {
  greeting:
    "Hi! I'm Shen's assistant. Tell me what you're looking for and I'll find the right booking.",
  bookingStyle: "best-times",
  customRequestHandling: "consult",
  tone: "warm",
};

/**
 * Pre-populated overlays — every imported service starts with sensible defaults
 * so the stylist doesn't have to configure each one.
 *
 * The status defaults match how the assistant currently routes things:
 *   - Consultation services → "consult"
 *   - Color full → "clarify" (already asks root vs full in the assistant)
 *   - Everything else → "instant"
 */
export function buildDefaultOverlays(
  services: { id: string; status: "online" | "consultation" | "hidden" }[]
): ServiceOverlay[] {
  return services.map((s) => {
    let status: AssistantServiceStatus;
    if (s.status === "consultation") status = "consult";
    else if (s.status === "hidden") status = "hidden";
    else if (s.id === "svc-full-color") status = "clarify";
    else status = "instant";
    return {
      serviceId: s.id,
      displayName: null,
      status,
    };
  });
}
