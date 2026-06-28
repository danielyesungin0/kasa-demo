# MIGRATION/DB_SNAPSHOT.md — live database snapshot (Phase 2 start)

Captured from the **live** Supabase project `cridgriesmapykmeqmuo` via
`supabase db query --linked` (read-only). This is the ground truth — the
8 migration files in `supabase/migrations/` have **drifted** from it.

## Live tables + row counts
| Table | Rows | Verdict |
|---|---|---|
| `stylists` | 1 (`slug: shen-test`) | **KEEP + evolve** — has all Square columns |
| `stylist_availability` | 7 | **KEEP** — Shen's weekly hours |
| `bookings` | 1 (test) | **KEEP → rename/extend to `appointments`** |
| `provider_services` | 0 | **KEEP → becomes `services`** (Square Catalog mirror) |
| `consultation_logs` | 37 | **DROP** — old chat-assistant analytics |
| `unsupported_rules` | 0 | **DROP** — old chat KB |
| `analytics_events` | 0 | **DROP** — old ad-hoc analytics (untracked in migrations) |
| `handoff_requests` | 0 | **DROP** — old "send to Shen" (untracked in migrations) |
| `provider_qa` | (migration 008, **never applied**) | not present live |

## Schema drift (files vs live)
- **Live but untracked** (made in Supabase UI, not in any migration): `stylists`, `analytics_events`, `handoff_requests`.
- **In migrations but not live**: `provider_qa` (008 never ran).
- ⇒ The repo's migrations can't reproduce the live DB. Phase 2 fixes this with a clean, self-rebuildable migration baseline.

## Square connection status — IMPORTANT
Checked `stylists` (presence only, no token values printed):
`has_merchant_id=false`, `has_access_token=false`, `has_refresh_token=false`,
`has_service_catalog=false`, `token_expires_at=null`.
**⇒ No Square connection or appointment data exists yet.** The owner will set up
the Square sandbox + link it later to test real appointment pull-through. The
schema + integration code (`lib/square/*`, `lib/crypto.ts`) must stay **ready to
receive** that data; nothing Square to preserve today.

## `stylists` columns present live (keep all)
id, user_id, name, email, square_merchant_id, square_location_id,
square_team_member_id, square_access_token, square_refresh_token,
square_token_expires_at, service_catalog (jsonb), square_business_name,
square_location_name, square_team_member_name, display_name, slug,
onboarding_complete, published, instagram_handle, handoff_email,
handoff_email_enabled, plan, subscription_status, trial_started_at,
trial_ends_at, last_synced_at, created_at.
**Missing vs DATA_MODEL.md:** `timezone`, `business_name`, `location`,
push-token fields, `updated_at` → add in Phase 2.

## Decisions locked with owner
- **Clean rebuild, keep seed data** (not a full reset, not additive-only).
- **`bookings` → rename + extend to `appointments`** (migrate the 1 test row).
- Keep Shen's seed stylist + 7 availability rows.
- Drop the 4 dead chat/analytics tables (after confirming each is out of scope).
- Square stays unconnected for now; build to receive it.
