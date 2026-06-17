import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { SQUARE_BASE } from "@/lib/square/config";

/**
 * Shared Square → Supabase service sync.
 *
 * Extracted from app/api/square/services/route.ts so it can run in two places
 * with identical behavior:
 *   - automatically inside the Square OAuth callback (self-serve onboarding),
 *     so a provider's services are persisted the moment they connect; and
 *   - on-demand from GET /api/square/services (dashboard "re-sync" button).
 *
 * It fetches the provider's Square catalog, matches items to our canonical
 * service ids, then persists BOTH:
 *   - stylists.service_catalog (keyed by svc-* id) + last_synced_at, and
 *   - provider_services rows (with service_key = svc-* id) deduped on
 *     (stylist_id, square_variation_id).
 *
 * Provider-edited columns (visible_in_chat, behavior, aliases,
 * chat_description) are intentionally OMITTED from the upsert payload so a
 * re-sync never clobbers them — Postgres only updates columns present in the
 * payload on conflict.
 */

// Canonical service ids → Square catalog item name hints (case-insensitive
// substring match), with our duration/category metadata.
const SERVICE_NAME_MAP: Record<
  string,
  { nameHints: string[]; durationMinutes: number; category: string }
> = {
  "svc-short-cut": { nameHints: ["short hair", "barber short", "short cut"], durationMinutes: 60, category: "Haircut" },
  "svc-medium-long-cut": { nameHints: ["medium", "long hair cut", "medium/long"], durationMinutes: 75, category: "Haircut" },
  "svc-head-spa": { nameHints: ["head spa", "scalp treatment"], durationMinutes: 60, category: "Treatment" },
  "svc-keratin": { nameHints: ["keratin"], durationMinutes: 150, category: "Treatment" },
  "svc-milbon": { nameHints: ["milbon"], durationMinutes: 60, category: "Treatment" },
  "svc-cut-down-perm": { nameHints: ["down perm", "cut + down", "cut+down"], durationMinutes: 90, category: "Perm" },
  "svc-mens-perm-cut": { nameHints: ["men's perm", "mens perm", "perm + hair cut"], durationMinutes: 120, category: "Perm" },
  "svc-bang-perm": { nameHints: ["bang perm"], durationMinutes: 60, category: "Perm" },
  "svc-womens-regular-perm": { nameHints: ["women's regular perm", "regular perm"], durationMinutes: 180, category: "Perm" },
  "svc-womens-digital-perm": { nameHints: ["digital perm"], durationMinutes: 240, category: "Perm" },
  "svc-straightening-perm": { nameHints: ["straightening perm", "straightening"], durationMinutes: 240, category: "Perm" },
  "svc-root-touchup": { nameHints: ["root touch", "root-touch"], durationMinutes: 90, category: "Color" },
  "svc-full-color": { nameHints: ["full color"], durationMinutes: 120, category: "Color" },
};

export type NormalizedService = {
  id: string;
  squareCatalogItemId: string | null;
  squareVariationId: string | null;
  name: string;
  category: string;
  durationMinutes: number;
  priceCents: number | null;
  priceLabel: string;
  isActive: boolean;
};

export type SyncServicesResult =
  | { ok: true; services: NormalizedService[]; catalog: Record<string, any> }
  | { ok: false; error: "square_catalog_failed" };

/**
 * Run the catalog sync for one provider. Caller supplies the already-decrypted
 * Square access token and the stylist row id.
 *
 * Persistence failures on provider_services are non-fatal (logged, not thrown)
 * to match the original route behavior — the service_catalog response is still
 * returned so the UI keeps working.
 */
export async function syncProviderServices(
  stylistId: string,
  accessToken: string
): Promise<SyncServicesResult> {
  const admin = createServiceRoleSupabaseClient();

  const squareRes = await fetch(`${SQUARE_BASE}/v2/catalog/list?types=ITEM`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": "2024-01-18",
      "Content-Type": "application/json",
    },
  });

  if (!squareRes.ok) {
    const body = await squareRes.text();
    console.error("Square catalog fetch failed:", squareRes.status, body);
    return { ok: false, error: "square_catalog_failed" };
  }

  const catalogData = await squareRes.json();
  const items: any[] = catalogData.objects ?? [];

  const serviceCatalog: Record<string, any> = {};
  const normalized: NormalizedService[] = [];
  const providerServiceRows: Array<{
    stylist_id: string;
    service_key: string;
    square_item_id: string | null;
    square_variation_id: string;
    name: string;
    category: string | null;
    price_cents: number | null;
    duration_minutes: number | null;
  }> = [];

  for (const [svcId, svcMeta] of Object.entries(SERVICE_NAME_MAP)) {
    let squareCatalogItemId: string | null = null;
    let squareVariationId: string | null = null;
    let priceCents: number | null = null;
    let foundName = svcMeta.nameHints[0];

    for (const item of items) {
      if (item.type !== "ITEM") continue;
      const itemName: string = item.item_data?.name ?? "";
      const itemNameLower = itemName.toLowerCase();
      const matched = svcMeta.nameHints.some((hint) =>
        itemNameLower.includes(hint.toLowerCase())
      );
      if (matched) {
        squareCatalogItemId = item.id;
        foundName = itemName;
        const variations: any[] = item.item_data?.variations ?? [];
        if (variations.length > 0) {
          const variation = variations[0];
          squareVariationId = variation.id;
          priceCents = variation.item_variation_data?.price_money?.amount ?? null;
        }
        break;
      }
    }

    const priceLabel = priceCents ? `$${Math.round(priceCents / 100)}` : "Price varies";

    normalized.push({
      id: svcId,
      squareCatalogItemId,
      squareVariationId,
      name: foundName,
      category: svcMeta.category,
      durationMinutes: svcMeta.durationMinutes,
      priceCents,
      priceLabel,
      isActive: true,
    });

    if (squareVariationId) {
      serviceCatalog[svcId] = {
        squareCatalogItemId,
        squareVariationId,
        durationMinutes: svcMeta.durationMinutes,
        priceCents,
      };
      providerServiceRows.push({
        stylist_id: stylistId,
        service_key: svcId,
        square_item_id: squareCatalogItemId,
        square_variation_id: squareVariationId,
        name: foundName,
        category: svcMeta.category,
        price_cents: priceCents,
        duration_minutes: svcMeta.durationMinutes,
      });
    }
  }

  // Persist service_catalog + sync timestamp on the stylist row.
  await admin
    .from("stylists")
    .update({
      service_catalog: serviceCatalog,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", stylistId);

  // Upsert provider_services (dedup on stylist_id,square_variation_id).
  // Non-fatal on error.
  if (providerServiceRows.length > 0) {
    const { error: upsertErr } = await admin
      .from("provider_services")
      .upsert(providerServiceRows, {
        onConflict: "stylist_id,square_variation_id",
      });
    if (upsertErr) {
      console.error("provider_services upsert failed:", upsertErr);
    }
  }

  return { ok: true, services: normalized, catalog: serviceCatalog };
}
