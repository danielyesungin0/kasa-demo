# DATA_MODEL.md

Reconcile this with your existing Supabase schema — **add what's missing, don't drop your data.**

> **Phase-0 note:** 8 migrations already exist in `supabase/migrations/`, but the `stylists`
> table was created in the Supabase UI and is **not captured in a migration** — so the schema
> can't currently rebuild from zero. **First task in Phase 2: add the missing `stylists`
> migration.** The inbox tables below (`channels`, `clients`, `client_identities`,
> `conversations`, `messages`, `webhook_events`) are **net-new** — they don't exist yet.

All tables carry `id uuid pk default gen_random_uuid()`, `created_at`, `updated_at`, and a
`stylist_id` (owner) used by **Row Level Security** so each stylist sees only her own rows.

### `stylists` (app users)
`id`, `display_name`, `business_name`, `location`, `square_merchant_id`, `square_location_id`,
`timezone`, push-token fields.

### `channels` (per-stylist connection to a platform)
`stylist_id`, `type` enum(`instagram`,`sms`,`wechat`,`kakao`), `connected` bool,
`external_account_id` (IG page/business id, Twilio number, WeChat appid, Kakao channel id),
`credentials_ref` (pointer to a secret, **never the secret itself**), `status`, `last_sync_at`.

### `clients`
`stylist_id`, `name`, `value` enum(`high`,`regular`,`new`), `since`, `visits` int,
`last_appt_at`, `preferences` text, `notes` text, `tags` text[], plus contact fields
`phone`, `email`, `instagram_handle`. A client may map to **multiple channel identities** (below).

### `client_identities` (one client ↔ many platform handles)
`client_id`, `channel_type`, `external_user_id` (IG-scoped id, phone E.164, WeChat openid, Kakao
user key), `display_handle`. Unique on (`channel_type`,`external_user_id`). This is what powers
the **duplicate-merge** feature (same phone across two channels → suggest merge).

### `conversations` (one thread per client per channel)
`stylist_id`, `client_id`, `channel_type`, `external_thread_id`, `last_message_at`,
`unread` bool, `archived` bool, `window_expires_at` (when the channel's reply window closes —
e.g., 24h for IG, 48h for WeChat), `intent` enum(`none`,`booking`,...) set by the parser,
`intent_payload` jsonb (extracted service/time/preferred when booking-intent is detected).

### `messages`
`conversation_id`, `direction` enum(`in`,`out`,`note`), `body` text, `media` jsonb (image refs),
`channel_message_id` (provider id, for dedupe), `status` enum(`sent`,`delivered`,`failed`),
`sent_at`. `note` = an internal note Shen leaves on a thread (never sent).

### `services` (her menu — mirrors/syncs Square Catalog)
`stylist_id`, `name`, `duration_minutes`, `price_cents`, `square_catalog_id`, `active` bool.
(Prototype menu: Cut & blow-dry 60/$85, Gloss/toner 60/$95, Root touch-up 90/$130,
Partial balayage 150/$220, Full balayage 210/$280+, Color correction = consult, Consultation 30/free.)

### `appointments` (mirror of Square bookings)
`stylist_id`, `client_id`, `service_id`, `starts_at`, `ends_at`, `status`
enum(`booked`,`canceled`,`completed`), `square_booking_id`, `source` enum(`kasa`,`square`),
`origin_conversation_id` (nullable — the thread it came from). **Written only by the
`square-create-booking` function and by the Square webhook**, never directly from the app.

### Realtime
Enable Realtime on `messages`, `conversations`, and `appointments` so the app updates live
(new message in, booking confirmed, etc.).

### Notes
- Don't store secrets in any table — only references. Real keys live in Supabase function secrets.
- Keep a `webhook_events` table (raw payload + provider + signature-verified flag) for debugging
  ingestion without trusting unverified data.
