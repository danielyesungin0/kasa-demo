# MIGRATION/INVENTORY.md — Phase 0 Discovery

**Status:** Discovery only. Nothing has been refactored, moved, or deleted.
**Date:** 2026-06-28

## Label legend
- **BACKEND (keep)** — server logic worth preserving; relocate behind callable services.
- **INTEGRATION (keep, extract)** — talks to an external system (Square / Supabase / AI / email / SMS); keep, but make frontend-agnostic.
- **FRONTEND (replace)** — UI built for the *old* product; replaced by the new mobile app.
- **DEAD / UNCLEAR (flag)** — stale, superseded, or out-of-scope for the new product; do not carry forward without a decision.

> ⚠️ Important framing: the old app and the new app are **different products on a shared spine.**
> The old app is a **client-facing booking link + AI chat-that-books** (one stylist's clients open a link and book themselves). The new app is a **stylist-facing unified inbox** (Shen reads/【replies to】messages from 4 channels and books *for* clients). The reusable spine is **Square + Supabase + the Anthropic AI call + the OAuth/token/crypto plumbing.** Most of the *data model* and *all* of the UI are new.

---

## 1. The old stack (confirmed from files, not the README)

The root `README.md` is **stale** — it claims "mock data only, no backend." That is no longer true. The real stack:

| Concern | What it actually is |
|---|---|
| Framework | **Next.js 14.2.5 (App Router)**, React 18, TypeScript 5 |
| Styling | **Tailwind CSS 3** (`tailwind.config.ts`, `postcss.config.js`) + Framer Motion |
| Package manager | **npm** (`package-lock.json` present; no pnpm/yarn lockfile) |
| Backend | **Next.js Route Handlers** under `app/api/**` (~22 routes) — *not* a separate server, *not* Supabase Edge Functions |
| Database / Auth | **Supabase** (Postgres + Auth + RLS). Clients in `lib/supabase/{client,server}.ts`; service-role client bypasses RLS for server routes |
| Booking system | **Square** (sandbox) via the `square` SDK + raw REST; OAuth connect/callback, token refresh, catalog sync |
| AI | **Anthropic Claude Haiku** (`@anthropic-ai/sdk`) as the sole active provider; Groq present but dormant (`lib/ai/provider.ts`) |
| Email | **Resend** (`lib/email.ts`) |
| SMS | **`lib/sms.ts`** (+ `docs/sms.md`) — reminders path |
| Hosting | Not pinned in-repo (no `vercel.json`/Docker). `NEXT_PUBLIC_APP_URL` env + Next 14 ⇒ almost certainly **Vercel**. **Confirm with owner.** |
| Version control | **Already a git repo** with history; remote `origin → github.com/danielyesung/kasa-demo.git` |
| Tests/QA | **Vitest** unit tests under `qa/unit/**` + `lib/__tests__`; a custom scenario runner under `qa/` |

**Where the important logic lives:**
- **Square** → `lib/square/*` (`config.ts`, `ensure-fresh-token.ts`, `sync-services.ts`) + routes `app/api/square/*` and `app/api/bookings/*`.
- **AI booking-intent** → two distinct layers: (a) `lib/ai/provider.ts` = the real Claude call returning strict JSON; (b) `lib/parse-intent.ts` (~2,400 lines) + `lib/engine/*` = a **deterministic** parser/executor for the old chat-to-book flow.
- **Supabase access** → `lib/supabase/*`, schema in `supabase/migrations/001..008`.
- **Secrets** → `.env.local` (gitignored). Square token encryption via `lib/crypto.ts` (AES-256-GCM, `ENCRYPTION_KEY`).

---

## 2. Supabase schema snapshot

Captured migrations (`supabase/migrations/`):

| File | Adds |
|---|---|
| `001_booking_mvp.sql` | `stylist_availability`, `blocked_times`, `bookings` (+ RLS, seeds for Shen) |
| `002_beta_readiness.sql` | extends `stylists` (slug, onboarding/publish, plan/trial, instagram_handle, handoff_email); `provider_services`; `unsupported_rules` |
| `003_provider_services_sync.sql` | unique index for Square sync upserts |
| `004_seed_shen_rules.sql` | seeds Shen's `unsupported_rules` (bleach → handoff) |
| `005_last_synced_at.sql` | `stylists.last_synced_at` |
| `006_provider_service_key.sql` | `provider_services.service_key` |
| `007_consultation_logs.sql` | `consultation_logs` (what clients asked — sensor) |
| `008_provider_qa.sql` | `provider_qa` (provider-approved answers) |

⚠️ **Gap:** the base **`stylists`** table is *referenced* by 001 but never *created* by a migration — it was made in the Supabase UI before migrations existed. The live DB has it; a fresh DB rebuilt from these files alone would fail. **Phase 2 must add a `000_*` migration that creates `stylists` to make the schema self-contained.**

**RLS pattern (consistent and good):** every table is owner-scoped via `stylist_id in (select id from stylists where user_id = auth.uid())`; writes go through the service-role client after an auth check.

**Edge Functions:** **none.** All server logic is Next.js route handlers. (`ARCHITECTURE.md` targets Supabase Edge Functions; that's a *new* destination, not an existing asset.)

### Schema reconciliation vs. new `DATA_MODEL.md`
The existing schema is **booking-link-shaped**; the new product is **inbox-shaped**. Mapping:

| New model table | Exists today? | Notes |
|---|---|---|
| `stylists` | ~partial | exists (un-migrated); new fields (timezone, push tokens, square_merchant/location) to add |
| `services` | partial → `provider_services` | reconcile: rename/extend; already syncs Square catalog |
| `appointments` | partial → `bookings` | reconcile: add `client_id`, `source`, `origin_conversation_id`, status enum |
| `channels` | **missing** | new — per-stylist channel connections |
| `clients` | **missing** | new — old app stored customer name/phone *on the booking*, no client entity |
| `client_identities` | **missing** | new — powers duplicate-merge |
| `conversations` | **missing** | new — core of the inbox; carries `intent` + `intent_payload` |
| `messages` | **missing** | new — the inbox itself |
| `webhook_events` | **missing** | new — raw inbound payloads for debugging |
| `stylist_availability`, `blocked_times` | exist | keep — feed duration-aware availability |
| `consultation_logs`, `provider_qa`, `unsupported_rules` | exist | **out of scope** for new product (old chat-assistant analytics/KB). Keep in DB, ignore in new app, decide in Phase 5. |

**Net:** the messaging/inbox half of the data model **does not exist yet** and is net-new Phase 2 work. The booking half largely exists and needs reconciliation, not invention.

---

## 3. File-by-file inventory

### `app/api/**` — server routes
| File | Label | Notes |
|---|---|---|
| `square/connect/route.ts` | **INTEGRATION (keep, extract)** | Square OAuth start. Core, reusable. |
| `square/callback/route.ts` | **INTEGRATION (keep, extract)** | OAuth token exchange + encrypted store. Core. |
| `square/services/route.ts` | **INTEGRATION (keep, extract)** | Pull Square catalog. |
| `availability/route.ts` | **BACKEND (keep)** | Duration-aware availability — directly maps to new `square-availability`. |
| `bookings/route.ts` | **BACKEND (keep)** | GET (stylist, returns PII) + POST create booking → Square. Maps to `square-create-booking`. |
| `bookings/cancel/route.ts` | **BACKEND (keep)** | Cancel w/ last-4 verification. |
| `bookings/lookup/route.ts` | **BACKEND (keep)** | Client booking lookup. May be out-of-scope for inbox app — re-evaluate. |
| `bookings/verify/route.ts` | **BACKEND (keep)** | Phone-last-4 verify. Old client-self-service; re-evaluate. |
| `chat/route.ts` | **BACKEND (keep, slim down)** | Orchestrates the old chat-to-book. The new `parse-intent` is a *much smaller* subset of this. Mine it; don't port wholesale. |
| `handoff/route.ts` | **BACKEND (keep)** | "Send to Shen" — emails the stylist. Adjacent to new product. |
| `provider/services/route.ts` | **BACKEND (keep)** | Stylist edits her service menu. |
| `provider/availability/route.ts` | **BACKEND (keep)** | Stylist availability read/write. |
| `provider/handoff-settings/route.ts` | **BACKEND (keep)** | Handoff prefs. |
| `provider/unsupported/route.ts` | **DEAD/UNCLEAR** | Old chat KB rules. Out of scope for inbox. |
| `dashboard/insights/route.ts` | **DEAD/UNCLEAR** | "Questions clients asked" — old analytics surface. |
| `dashboard/qa/route.ts` | **DEAD/UNCLEAR** | Provider-approved-answers CRUD. Out of scope. |
| `stylist/route.ts` | **BACKEND (keep)** | Stylist profile read/update. |
| `stylist/status/route.ts` | **BACKEND (keep)** | Connection status surface. |
| `analytics/route.ts` | **DEAD/UNCLEAR** | Old ad-hoc analytics sink. New analytics is a Phase-5 rebuild (`ANALYTICS.md`). |
| `ai-metrics/route.ts` | **DEAD/UNCLEAR** | AI metrics debug surface. |
| `cron/reminders/route.ts` | **INTEGRATION (keep, extract)** | SMS reminders cron. Useful later; out of MVP scope. |
| `version/route.ts` | **DEAD/UNCLEAR** | Build version stub. |
| `app/auth/callback/route.ts` | **INTEGRATION (keep)** | Supabase auth callback. |

### `lib/**`
| Path | Label | Notes |
|---|---|---|
| `square/*` | **INTEGRATION (keep, extract)** | OAuth base, token refresh, catalog sync. **High-value, reusable as-is.** |
| `crypto.ts` | **INTEGRATION (keep)** | AES-256-GCM for Square tokens. Reusable. |
| `supabase/{client,server}.ts` | **INTEGRATION (keep)** | Browser/server/service-role clients. Reusable. |
| `ai/provider.ts` | **BACKEND (keep)** | **The real Claude call.** This is the AI asset to preserve for `parse-intent`. |
| `ai/metrics.ts` | **BACKEND (keep, optional)** | AI metrics; keep if cheap, else drop. |
| `ai/category-browse.ts`, `deterministic-faq.ts`, `guidance-presentation.ts` | **DEAD/UNCLEAR** | Old chat-flow helpers. Out of scope for the smaller new AI job. |
| `ai/locale-normalize.ts` | **BACKEND (keep, maybe)** | Language handling; may help intent parsing. |
| `parse-intent.ts` (~2,400 lines) | **DEAD/UNCLEAR (mine, don't port)** | Deterministic chat-to-book parser/executor for the old product. The new `parse-intent` (classify booking/none + extract) is a tiny subset. **Salvage the time-extraction + service-matching ideas; discard the executor/flow state machine.** |
| `engine/catalog.ts`, `engine/intent-patterns.ts` | **BACKEND (keep, maybe)** | Catalog fuzzy-match + modifier extraction. Possibly reusable in slimmed parser. |
| `availability.ts`, `booking-summary.ts`, `bookings/mode.ts` | **BACKEND (keep)** | Availability/booking helpers. |
| `provider-services.ts`, `unsupported-services.ts`, `setup-config.ts`, `stylist-config.ts` | **BACKEND/UNCLEAR** | Service config (keep) vs. unsupported rules (out of scope). Split during extraction. |
| `consultation-log.ts`, `personal-judgment.ts` | **DEAD/UNCLEAR** | Old chat analytics/judgment. Out of scope. |
| `email.ts`, `sms.ts`, `reminders.ts` | **INTEGRATION (keep)** | Resend + SMS + reminders. Out of MVP scope, keep. |
| `analytics.ts` | **DEAD/UNCLEAR** | Superseded by Phase-5 analytics. |
| `businesses/*`, `stylists/*` | **DEAD/UNCLEAR → simplify** | Multi-business/multi-stylist abstraction. New product is single-stylist (Shen); collapse. `stylists/slug.ts`, `resolve.ts` may still matter. |
| `mock-data.ts` | **DEAD/UNCLEAR** | Mock seed for old prototype + still imported by `parse-intent.ts`. Drop with the old chat flow. |
| `types.ts` | **BACKEND (keep, fork)** | Shared types — fork the still-relevant ones into `packages/shared`. |
| `api/origin-check.ts`, `api/rate-limit.ts` | **BACKEND (keep)** | Route hardening. Reusable. |
| `dashboard/auth.ts` | **BACKEND (keep)** | Stylist auth guard. |
| `cn.ts`, `use-is-mobile.ts`, `use-keyboard-viewport.ts` | **FRONTEND (replace)** | Web UI utils; RN app has its own. |
| `appointments-store.tsx` | **FRONTEND (replace)** | React context store for old UI. |

### `app/**` pages & `components/**`
| Path | Label |
|---|---|
| `app/page.tsx` (landing), `app/setup/page.tsx`, `app/dashboard/**`, `app/book/[slug]/page.tsx`, `app/shen/page.tsx`, `app/internal/shen/page.tsx`, `app/layout.tsx`, `app/globals.css` | **FRONTEND (replace)** — entire old web UI; superseded by the Expo app built from `kasa.html`. |
| `components/*` (all 11) | **FRONTEND (replace)** |

### Config / tooling / tests
| Path | Label | Notes |
|---|---|---|
| `next.config.js`, `tailwind.config.ts`, `postcss.config.js`, `tsconfig.json`, `next-env.d.ts` | **FRONTEND (replace)** | Web build config; the RN app brings its own. |
| `package.json` / `package-lock.json` | **FRONTEND (replace, partial)** | Becomes the monorepo root / `apps/mobile`; backend deps move with the functions. |
| `vitest.config.ts`, `qa/**`, `lib/__tests__/**`, `scripts/smoke-test-parser.ts` | **BACKEND (keep, port selectively)** | Tests target the old parser; keep the ones covering logic we preserve (availability, time-parse, slug), drop chat-flow scenarios. |
| `docs/*` (`ai-providers.md`, `sms.md`, `consultation-logging.md`) | **keep (reference)** | Useful background; not code. |
| `PROJECT_CONTEXT.md`, `README.md` | **DEAD/UNCLEAR (stale)** | Describe the old product/“no backend.” Rewrite in Phase 1. |
| `.env.local` | **keep (never commit)** | Already gitignored. Source for `.env.example` names. |
| `.next/`, `node_modules/`, `tsconfig.tsbuildinfo` | build artifacts (ignored) |

---

## 4. Secrets present (names only — values never read/committed)
From `.env.local` (gitignored): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SQUARE_APPLICATION_ID`, `SQUARE_APPLICATION_SECRET`, `SQUARE_ENVIRONMENT`, `SQUARE_REDIRECT_URL`, `NEXT_PUBLIC_APP_URL`, `ENCRYPTION_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `AI_ENABLED`, `AI_PROVIDER`, `GROQ_API_KEY`, `GROQ_MODEL`, `AI_DEBUG_MODE`, `ANTHROPIC_API_KEY`. These become the `.env.example` key list in Phase 1. Square is on **sandbox** (`SQUARE_ENVIRONMENT` defaults to sandbox in code).

---

## 5. Recommendation (end of Phase 0 — paragraph)

Keep the **spine**, replace the **product surface.** The genuinely valuable, reusable backend is narrow and clean: the Square OAuth/token-refresh/encryption layer (`lib/square/*`, `lib/crypto.ts`), the Supabase clients + RLS pattern, the duration-aware availability + create/cancel booking routes, and the single Anthropic Claude call in `lib/ai/provider.ts`. Preserve those. **Do not port `lib/parse-intent.ts` or the `chat` orchestration wholesale** — they implement a *client-facing chat-that-books*, a different product from the new *stylist inbox*; the new `parse-intent` job (classify `booking` vs `none`, extract service/time) is a small fraction of that code, so mine the time-extraction and catalog-matching ideas and leave the 2,400-line executor behind. The biggest real work in Phase 2 is **net-new**: the inbox data model (`channels`, `clients`, `client_identities`, `conversations`, `messages`, `webhook_events`) doesn't exist yet, and `bookings`→`appointments` / `provider_services`→`services` need reconciliation against `DATA_MODEL.md`. Two assumptions in the kickoff are already overtaken by reality and should be adjusted: a **git repo and GitHub remote already exist** (`kasa-demo`), and **8 SQL migrations already exist** (so Phase 1 adapts rather than `git init`s, and Phase 2 starts by adding the missing `stylists`-creating migration to make the schema self-contained, then evolves). Target architecture note: there are **no Supabase Edge Functions today** — moving server logic there (per `ARCHITECTURE.md`) is a real relocation, not a lift of existing functions; an equally valid option is to keep thin server logic as Next/route-style handlers callable by the app. I recommend we decide that explicitly at the top of Phase 2.

**Stop here for your confirmation before any changes.**
