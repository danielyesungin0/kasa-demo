import { type NextRequest, NextResponse } from "next/server";
import { createServiceRoleSupabaseClient } from "@/lib/supabase/server";
import { decryptSecret } from "@/lib/crypto";

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
  const admin = createServiceRoleSupabaseClient();

  // Load stylist row — single-stylist beta, just take the first
  const { data: stylist, error: stylistErr } = await admin
    .from("stylists")
    .select("id, square_access_token, service_catalog")
    .order("created_at", { ascending: true })
    .limit(1)
    .single();

  if (stylistErr || !stylist) {
    return NextResponse.json({ error: "stylist_not_found" }, { status: 404 });
  }

  const accessToken = decryptSecret(stylist.square_access_token);
  if (!accessToken) {
    return NextResponse.json({ error: "square_not_connected" }, { status: 400 });
  }

  // Fetch catalog from Square sandbox
  const squareRes = await fetch(
    "https://connect.squareupsandbox.com/v2/catalog/list?types=ITEM",
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
    }
  }

  // Save service_catalog back to the stylist row
  await admin
    .from("stylists")
    .update({ service_catalog: serviceCatalog })
    .eq("id", stylist.id);

  return NextResponse.json({ services: normalized, catalog: serviceCatalog });
}
