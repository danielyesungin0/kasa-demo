# ARCHITECTURE.md

> See `DECISIONS.md` for the locked choices. Phase-0 reality: the old backend is **Next.js 14
> route handlers**, not Edge Functions. We are **relocating** the useful logic into Supabase Edge
> Functions (decided because there's no web host in the new setup — see below).

## The core idea
**Keep the backend logic, rebuild the frontend.** Supabase + Square + the one Claude call don't
care that the UI changed from a client-facing web chat to a stylist-facing mobile app. The
transition lifts that logic out of Next.js route handlers into Supabase Edge Functions, then
builds a new Expo client against them.

## Why Edge Functions (not Vercel / route handlers as-is, not Cloudflare)
The new product has **no web frontend to host**, so there's no Vercel deployment to keep the
Next.js route handlers running on. The channel webhooks, though, still need a **public HTTPS
endpoint** (a phone can't receive Instagram/WeChat/Kakao/Twilio POSTs). Supabase Edge Functions
give us that endpoint on the platform we already use for DB + Auth — one platform, one place for
secrets. (Cloudflare Workers would also serve; we chose Edge Functions for fewer moving parts.)

## Stack
- **Mobile app:** **Expo (React Native)** + **expo-router** + **NativeWind** (so `DESIGN.md`
  tokens become theme values) + **react-native-safe-area-context**. Chosen over a PWA because
  Shen needs **push notifications** and an app-store install.
- **Backend:** **Supabase** — Postgres + Auth + RLS + Realtime + Storage (already set up).
- **Server logic + webhooks:** **Supabase Edge Functions** (Deno/TypeScript). All secrets in
  Supabase function secrets.
- **Push:** Expo Notifications → APNs/FCM for production.
- **Shared types:** `packages/shared` so app + functions share DB-generated types.

## Repo layout (restructure the existing `kasa-demo` in place — do NOT re-init)
```
kasa/                       # the existing repo, transferred to your main GitHub account
  apps/
    mobile/                 # NEW Expo app — the entire frontend (DESIGN.md + reference-prototype.html)
  supabase/
    migrations/             # 8 exist; ADD the missing `stylists` migration first (see DATA_MODEL.md)
    functions/
      square-availability/  # SearchAvailability + Catalog  (relocated from app/api/**)
      square-create-booking/# CreateBooking — ONLY write path to Square (relocated)
      parse-intent/         # the single Claude (Haiku) booking-intent call (mined from lib/)
      webhook-instagram/    # inbound IG -> messages
      webhook-sms/          # Twilio inbound
      webhook-wechat/       # WeChat OA inbound
      webhook-kakao/        # Kakao inbound (via partner/BSP)
      send-message/         # outbound; picks channel + respects its reply window
  packages/shared/          # types, channel enums, helpers
  design/reference.html     # the prototype (reference-prototype.html)
  _archive/                 # old Next.js client-facing UI, parked out of the build (or deleted)
  .env.example
```
Old Next.js route handlers: the **useful ones are relocated** to `functions/` above; the
**client-facing booking/chat UI is archived** (`_archive/` or deleted — see `DECISIONS.md`).

## Data flow
**Inbound:** channel webhook (Edge Function) verifies the provider signature → normalizes into a
`messages` row (creating/matching `client` + `conversation`) → calls `parse-intent` to set a
booking-intent flag → Supabase Realtime pushes to the app → app shows it (+ push later).

**Reply:** app calls `send-message` → it checks the channel's reply window → sends via that
channel → writes the outbound `message`. App also shows the message optimistically.

**Booking:** app calls `square-availability` for real, duration-aware open times → Shen confirms
→ app calls `square-create-booking` → an `appointments` row is written and Realtime updates the
calendar. **No other code path writes bookings to Square.**

## Public URL / config
- Put the webhook endpoint on a **stable URL from day one** (you register it with four platforms;
  changing it later means re-registering everywhere). Use a custom domain or a fixed function URL.
- Secrets (Square, Anthropic, Twilio/Meta/WeChat/Kakao) live in Supabase function secrets +
  `.env` (gitignored). `.env.example` documents names only.
- **RLS** so a stylist sees only her own rows. Webhooks verify provider signatures before trusting payloads.
- Keep Square in **sandbox** until launch.
