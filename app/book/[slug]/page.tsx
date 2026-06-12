import { getStylistBySlug } from "@/lib/stylists/resolve";
import {
  getProviderUnsupportedTerms,
  getProviderServicesAsServiceType,
} from "@/lib/provider-services";
import { ClientBookingPage } from "@/components/ClientBookingPage";
import { PageShell } from "@/components/PageShell";

/**
 * Public client booking + chat route, scoped to a provider by slug.
 *
 * STRICT resolution: this route resolves the provider by slug ONLY. It never
 * falls back to "first stylist." If the slug is missing, invalid, or the
 * provider isn't published yet, we show a neutral "not available" page —
 * never another provider's data.
 *
 * Server component so the published gate runs before any provider data is
 * sent to the browser.
 */
export default async function BookBySlugPage({
  params,
}: {
  params: { slug: string };
}) {
  const stylist = await getStylistBySlug(params.slug);

  // No such slug, or provider hasn't published their link yet → not available.
  // We do NOT distinguish "doesn't exist" vs "unpublished" to avoid leaking
  // which slugs are taken.
  if (!stylist || !stylist.published) {
    return <NotAvailable />;
  }

  // Provider-configured unsupported terms (Pass 2A). Passed to the client so
  // its synchronous unsupported check is provider-aware without an async
  // refactor. Empty array → client falls back to the global list.
  const unsupportedTerms = await getProviderUnsupportedTerms(stylist.id);

  // Synced services for tappable cards. Empty → client falls back to the mock
  // catalog. Cards carry svc-* ids so they book through the existing flow.
  const syncedServices = await getProviderServicesAsServiceType(stylist.id);

  return (
    <ClientBookingPage
      slug={params.slug}
      unsupportedTerms={unsupportedTerms}
      syncedServices={syncedServices}
    />
  );
}

function NotAvailable() {
  return (
    <PageShell>
      <div className="mx-auto mt-24 max-w-md px-6 text-center">
        <h1 className="font-display text-2xl text-ink-900">
          This booking link isn&rsquo;t available
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-ink-600">
          The link may be incorrect, or this provider hasn&rsquo;t published
          their booking page yet. Double-check the link you were given.
        </p>
      </div>
    </PageShell>
  );
}
