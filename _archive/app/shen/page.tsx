import { ClientBookingPage } from "@/components/ClientBookingPage";

/**
 * /shen — legacy slug-less entry point for the Shen demo. Renders the client
 * booking surface with no slug, so the API routes fall back to the first
 * stylist row (the current Shen demo). New public providers are served via
 * /book/[slug]. This route is kept working for now but is NOT linked from the
 * public landing page.
 */
export default function ShenRoutePage() {
  return <ClientBookingPage />;
}
