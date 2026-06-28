import { notFound } from "next/navigation";
import { ClientBookingPage } from "@/components/ClientBookingPage";
import { getStylistBySlug } from "@/lib/stylists/resolve";
import {
  getProviderUnsupportedTerms,
  getProviderServicesAsServiceType,
} from "@/lib/provider-services";

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
 * Renders the same client booking surface as /book/shen-test, pinned to the
 * "shen-test" slug, so chat/availability/handoff all resolve the INTERNAL TEST
 * provider's data.
 *
 * Pinned to "shen-test" (not "shen") on purpose: the real Shen claims "shen"
 * via self-serve signup, so this internal surface must point at the renamed
 * test row to avoid silently resolving to her live data.
 */
const INTERNAL_TEST_SLUG = "shen-test";

export default async function InternalShenPage() {
  if (process.env.INTERNAL_DEMO_ENABLED !== "true") {
    notFound();
  }
  // Resolve the test provider's row to load its provider-configured unsupported
  // terms, mirroring /book/[slug]. Falls back to [] (global list) if not found.
  const stylist = await getStylistBySlug(INTERNAL_TEST_SLUG);
  const unsupportedTerms = stylist
    ? await getProviderUnsupportedTerms(stylist.id)
    : [];
  const syncedServices = stylist
    ? await getProviderServicesAsServiceType(stylist.id)
    : [];
  return (
    <ClientBookingPage
      slug={INTERNAL_TEST_SLUG}
      unsupportedTerms={unsupportedTerms}
      syncedServices={syncedServices}
    />
  );
}
