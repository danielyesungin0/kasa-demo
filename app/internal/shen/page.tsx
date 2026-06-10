import { notFound } from "next/navigation";
import { ClientBookingPage } from "@/components/ClientBookingPage";

/**
 * Private internal testing route for the Shen demo.
 *
 * - NOT linked from the public landing page.
 * - Bypasses the `published` gate so the demo is testable even if Shen's row
 *   is ever unpublished.
 * - Gated behind INTERNAL_DEMO_ENABLED so it can be turned off in any
 *   environment where it shouldn't exist. Set INTERNAL_DEMO_ENABLED=true on
 *   the preview/dev deployment to use it; leave unset in a hardened prod.
 *
 * Renders the same client booking surface as /book/shen, pinned to the
 * "shen" slug, so chat/availability/handoff all resolve Shen's data.
 */
export default function InternalShenPage() {
  if (process.env.INTERNAL_DEMO_ENABLED !== "true") {
    notFound();
  }
  return <ClientBookingPage slug="shen" />;
}
