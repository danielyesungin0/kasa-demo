// ============================================================
// square-sync — pulls a connected seller's real Square data into Kasa so a
// freshly-connected account works end-to-end with NO manual steps:
//   - CATALOG  → provider_services (bookable services w/ variation id, price,
//                duration). This is what the Book sheet lists.
//   - TEAM     → the bookable team member id/name on the stylist row
//                (square-create-booking requires square_team_member_id).
//   - LOCATION → main location id/name (also set on connect; refreshed here).
//
// Idempotent: re-running updates in place (Settings "Resync" can call it too).
// Runs as the seller via their stored token (ensureFreshSquareToken). Called
// automatically after OAuth connect (square-oauth-callback) and on demand.
//
// verify_jwt=false: invoked server-to-server by the callback (no app JWT there).
// It resolves the stylist from the explicit stylist_id in the body, which the
// callback knows. Never logs tokens.
// ============================================================

import { corsHeaders, jsonResponse } from "../_shared/cors.ts";
import { createAdminClient } from "../_shared/supabase-admin.ts";
import { ensureFreshSquareToken, SQUARE_BASE } from "../_shared/square-token.ts";

const SQUARE_VERSION = "2024-01-18";

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "service";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  let body: { stylist_id?: string } = {};
  try { body = await req.json(); } catch { /* empty */ }

  const admin = createAdminClient();

  // Resolve the stylist (explicit id from the callback, else the only/first row).
  let stylistId = body.stylist_id ?? null;
  if (!stylistId) {
    const { data: s } = await admin.from("stylists").select("id").limit(1).maybeSingle();
    stylistId = s?.id ?? null;
  }
  if (!stylistId) return jsonResponse({ error: "no_stylist" }, 404);

  const tok = await ensureFreshSquareToken(admin, stylistId);
  if (!tok.ok) return jsonResponse({ error: "no_token", reason: tok.reason }, 400);
  const accessToken = tok.accessToken;
  const H = {
    Authorization: `Bearer ${accessToken}`,
    "Square-Version": SQUARE_VERSION,
    "Content-Type": "application/json",
  };

  const result = { services: 0, team_member: false, location: false };

  // ── LOCATION ──
  try {
    const r = await fetch(`${SQUARE_BASE}/v2/locations`, { headers: H });
    if (r.ok) {
      const main = (await r.json()).locations?.[0];
      if (main?.id) {
        await admin.from("stylists").update({
          square_location_id: main.id,
          square_location_name: main.name ?? null,
          square_business_name: main.business_name ?? main.name ?? null,
        }).eq("id", stylistId);
        result.location = true;
      }
    }
  } catch { /* non-fatal */ }

  // ── TEAM MEMBER (first bookable one) ──
  try {
    const r = await fetch(`${SQUARE_BASE}/v2/bookings/team-member-booking-profiles`, { headers: H });
    if (r.ok) {
      const profiles = (await r.json()).team_member_booking_profiles ?? [];
      const bookable = profiles.find((p: any) => p.is_bookable) ?? profiles[0];
      if (bookable?.team_member_id) {
        await admin.from("stylists").update({
          square_team_member_id: bookable.team_member_id,
          square_team_member_name: bookable.display_name ?? null,
        }).eq("id", stylistId);
        result.team_member = true;
      }
    }
  } catch { /* non-fatal */ }

  // ── CATALOG → provider_services ──
  try {
    const r = await fetch(`${SQUARE_BASE}/v2/catalog/search`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ object_types: ["ITEM"] }),
    });
    if (r.ok) {
      const objects = (await r.json()).objects ?? [];
      const rows = objects.map((o: any) => {
        const it = o.item_data ?? {};
        const v = (it.variations ?? [])[0];
        const vd = v?.item_variation_data ?? {};
        const durMs = vd.service_duration ?? 0;
        return {
          stylist_id: stylistId,
          service_key: slugify(it.name ?? "service"),
          name: it.name ?? "Service",
          category: it.category_id ? "Services" : "Services",
          price_cents: (vd.price_money?.amount ?? 0),
          duration_minutes: durMs ? Math.round(durMs / 60000) : 60,
          square_item_id: o.id ?? null,
          square_variation_id: v?.id ?? null,
          visible_in_chat: true,
          active: true,
        };
      }).filter((r: any) => r.square_variation_id); // only bookable variations

      // Upsert by (stylist_id, service_key): update existing, insert new. Avoids
      // PostgREST onConflict (which couldn't bind the index) by select-then-write.
      for (const row of rows) {
        const { data: existing } = await admin
          .from("provider_services")
          .select("id")
          .eq("stylist_id", stylistId)
          .eq("service_key", row.service_key)
          .maybeSingle();
        if (existing) {
          await admin.from("provider_services").update(row).eq("id", existing.id);
        } else {
          await admin.from("provider_services").insert(row);
        }
        result.services++;
      }
    }
  } catch { /* non-fatal */ }

  return jsonResponse({ ok: true, synced: result });
});
