import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";
import { SQUARE_BASE } from "@/lib/square/config";
import { resolveStylist } from "@/lib/stylists/resolve";

// Our canonical service IDs mapped to Square catalog item names (case-insensitive substring match)
const SERVICE_NAME_MAP: Record<string, { nameHints: string[]; durationMinutes: number; category: string }> = {
  "svc-short-cut":           { nameHints: ["short hair", "barber short", "short cut"],         durationMinutes: 60,  category: "Haircut"   },
  "svc-medium-long-cut":     { nameHints: ["medium", "long hair cut", "medium/long"],           durationMinutes: 75,  category: "Haircut"   },
  "svc-head-spa":            { nameHints: ["head spa", "scalp treatment"],                       durationMinutes: 60,  category: "Treatment" },
  "svc-keratin":             { nameHints: ["keratin"],                                           durationMinutes: 150, category: "Treatment" },
  "svc-milbon":              { nameHints: ["milbon"],                                            durationMinutes: 60,  category: "Treatment" },
  "svc-cut-down-perm":       { nameHints: ["down perm", "cut + down", "cut+down"],              durationMinutes: 90,  category: "Perm"      },
  "svc-mens-perm-cut":       { nameHints: ["men's perm", "mens perm", "perm + hair cut"],       durationMinutes: 120, category: "Perm"      },
  "svc-bang-perm":           { nameHints: ["bang perm"],                                        durationMinutes: 60,  category: "Perm"      },
  "svc-womens-regular-perm": { nameHints: ["women's regular perm", "regular perm"],             durationMinutes: 180, category: "Perm"      },
  "svc-womens-digital-perm": { nameHints: ["digital perm"],                                     durationMinutes: 240, category: "Perm"      },
  "svc-straightening-perm":  { nameHints: ["straightening perm", "straightening"],              durationMinutes: 240, category: "Perm"      },
  "svc-root-touchup":        { nameHints: ["root touch", "root-touch"],                         durationMinutes: 90,  category: "Color"     },
  "svc-full-color":          { nameHints: ["full color"],                                        durationMinutes: 120, category: "Color"     },
};

type NormalizedService = {
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

export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug");

  // Resolve provider strictly by slug when present; first-row fallback on the
  // legacy slug-less path. The shared resolver deliberately does NOT select
  // secrets, so we read the encrypted token separately by id below.
  const resolved = await resolveStylist(slug);
  if (!resolved) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const admin = createServiceRoleSupabaseClient();
  const { data: tokenRow, error: tokenErr } = await admin
    .from("stylists")
    .select("square_access_token, service_catalog")
    .eq("id", resolved.id)
    .single();

  if (tokenErr || !tokenRow) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const accessToken = decryptSecret(tokenRow.square_access_token);
  if (!accessToken) {
    return NextResponse.json({ error: "square_not_connected" }, { status: 400 });
  }

  // Fetch catalog from Square sandbox
  const squareRes = await fetch(
    `${SQUARE_BASE}/v2/catalog/list?types=ITEM`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2024-01-18",
        "Content-Type": "application/json",
      },
    }
  );

  if (!squareRes.ok) {
    const body = await squareRes.text();
    console.error("Square catalog fetch failed:", squareRes.status, body);
    return NextResponse.json({ error: "square_catalog_failed" }, { status: 502 });
  }

  const catalogData = await squareRes.json();
  const items: any[] = catalogData.objects ?? [];

  // Build normalized services by matching Square catalog items to our service IDs
  const serviceCatalog: Record<string, any> = {};
  const normalized: NormalizedService[] = [];
  // Rows to upsert into provider_services (Pass 1 Square sync).
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
    let foundName = svcMeta.nameHints[0]; // fallback display name

    // Try to find a matching Square catalog item
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
        // Grab first variation
        const variations: any[] = item.item_data?.variations ?? [];
        if (variations.length > 0) {
          const variation = variations[0];
          squareVariationId = variation.id;
          priceCents =
            variation.item_variation_data?.price_money?.amount ?? null;
        }
        break;
      }
    }

    const priceLabel = priceCents
      ? `$${Math.round(priceCents / 100)}`
      : "Price varies";

    const entry: NormalizedService = {
      id: svcId,
      squareCatalogItemId,
      squareVariationId,
      name: foundName,
      category: svcMeta.category,
      durationMinutes: svcMeta.durationMinutes,
      priceCents,
      priceLabel,
      isActive: true,
    };

    normalized.push(entry);

    if (squareVariationId) {
      serviceCatalog[svcId] = {
        squareCatalogItemId,
        squareVariationId,
        durationMinutes: svcMeta.durationMinutes,
        priceCents,
      };

      // Collect a provider_services upsert row. Only services with a Square
      // variation id are upserted — that id is the dedup key. Provider-edited
      // columns (visible_in_chat, behavior, aliases, chat_description) are
      // intentionally OMITTED so a re-sync never overwrites them; Postgres
      // only updates the columns present in the payload on conflict.
      //
      // NOTE (Pass 1 limitation): discovery is still gated by the hardcoded
      // SERVICE_NAME_MAP above, so only services whose Square names match
      // those hints are captured. Generic catalog discovery is a later phase;
      // this still lands real rows for Shen so Pass 2 chat grounding has data.
      providerServiceRows.push({
        stylist_id: resolved.id,
        // svc-* id — matches the service_catalog keys that /api/availability
        // and /api/bookings look up, so a card carrying this key books cleanly
        // through the existing flow (never the row UUID).
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

  // Save service_catalog + stamp the sync time on the stylist row. The
  // dashboard/settings surface last_synced_at so the provider can trust the
  // synced data is current. (Migration 005 adds the column.)
  await admin
    .from("stylists")
    .update({
      service_catalog: serviceCatalog,
      last_synced_at: new Date().toISOString(),
    })
    .eq("id", resolved.id);

  // Upsert synced services into provider_services. Dedup on
  // (stylist_id, square_variation_id) — requires the unique index from
  // migration 003_provider_services_sync.sql. Non-fatal: a failure here
  // doesn't break the existing service_catalog response.
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

  return NextResponse.json({ services: normalized, catalog: serviceCatalog });
}
