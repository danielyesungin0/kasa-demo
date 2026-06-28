/**
 * Lightweight client-side analytics. Fire-and-forget POST to an internal
 * endpoint. No third-party tracking scripts, no PII in event props.
 *
 * Usage:
 *   track("service_selected", { serviceId: "svc-medium-long-cut" });
 *
 * Never include names, phones, emails, IPs, or any other identifying data.
 * The endpoint and table are intentionally cheap; if we need richer analytics
 * later we'll add a proper tool, but until then this gives us a usage signal.
 */

export type AnalyticsEvent =
  | "booking_started"
  | "assistant_opened"
  | "service_selected"
  | "slot_selected"
  | "booking_completed"
  | "booking_failed"
  | "cancel_completed";

type AnalyticsProps = Record<string, string | number | boolean>;

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  if (typeof window === "undefined") return;
  try {
    void fetch("/api/analytics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, props: props ?? {}, ts: Date.now() }),
      // keepalive lets the request survive a page navigation, useful for
      // events like booking_completed that fire right before a stage change.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Analytics must never break a user flow.
  }
}
