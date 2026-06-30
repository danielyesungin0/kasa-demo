# Kasa Pivot Plan — Unified Inbox → Tattoo Request Intake

## The pivot in one line
From "unified messaging inbox + booking assistant for solo service businesses"
→ **"A beautiful tattoo request link that turns messy client ideas into clean,
artist-ready briefs."**

## Why (the honest takeaway from the channel research)
Messaging consolidation is gated by platforms we don't control — personal
WeChat/Kakao/SMS have no legitimate API, and even Instagram/WhatsApp ride on
Meta's permission. **Intake is a problem we fully own:** a link, a form, AI, a
dashboard. No carrier approval, no A2P, no Meta review, no per-tenant phone
numbers. We can ship it this week and it works for every artist on day one.

---

## 1. Current project structure (what exists)
- **One Expo (iOS) app** at `apps/mobile` — React Native, expo-router, NativeWind,
  on `main`. No web target in use (`web.output: single` exists but unused).
- **Supabase backend**: Postgres + Auth + Storage + ~17 Edge Functions (Deno).
- **Design system**: warm-neutral editorial tokens (theme/colors.ts + tailwind),
  Inter + Fraunces, a dozen polished UI primitives. **This is genuinely great and
  on-brand for tattoo** — keep it.
- **AI**: `parse-intent` — a clean Claude (Haiku) call → strict-JSON structured
  output. The *pattern* is exactly what brief-generation needs.
- **Auth**: real Supabase auth (lib/auth.tsx) — Apple/Google/email seams exist.
- **Storage upload**: `lib/uploadMedia.ts` (local file → Supabase Storage →
  public URL) — directly reusable for reference/placement images.

## 2. THE big architectural decision (read this first)
**The client intake is web, not native.** `kasa.ink/dizon` is a link tapped from
an Instagram bio — no tattoo client downloads an app to submit a request. So:

- **Client side → a mobile web app** (Next.js on Vercel/Cloudflare, or Expo Router
  web). Public, no login, gorgeous on mobile.
- **Artist side → can be either** a mobile app (reuse the current Expo app) OR
  web. Recommendation: **artist dashboard as web too**, so it's one codebase, one
  deploy, reviewable on a laptop, and shippable fastest. (A native artist app can
  come later for push notifications.)

**Recommendation: pivot to a single Next.js web app** (`apps/web`) for both the
public intake and the artist dashboard, reusing the design tokens + Supabase +
the AI function. Keep the Expo app archived (not deleted) in case we want a
native artist app later. This is the fastest path to a real, shareable product
and matches how the product is actually used (a link).

> If you'd rather not introduce Next.js: Expo Router *can* export web, so we could
> stay in `apps/mobile` and serve the intake as web routes. It's possible but
> fights the grain (RN-web quirks, SEO, share-link polish). Next.js is the right
> tool for "a public link that must be beautiful on mobile web." This plan assumes
> Next.js; flag if you want the Expo-web route instead.

## 3. What to REUSE
| Asset | Reuse how |
|---|---|
| **Design tokens** (colors, type scale, radii) | Port verbatim to web (CSS vars / Tailwind config). Already perfect for tattoo. |
| **AI Edge Function pattern** (`parse-intent`) | Fork into `generate-brief` — same Claude call + strict-JSON shape, new prompt. |
| **Supabase project** (Postgres, Auth, Storage) | Keep. New tables; reuse Storage for images. |
| **Auth** (lib/auth.tsx) | Reuse for the artist side (artists sign in). Clients never auth. |
| **Upload pattern** (uploadMedia.ts) | Reuse logic for reference/placement image upload (web file input + Storage). |
| **UI primitives** (Text, Button-ish, Sheet, Toast, ConfirmDialog, ImageViewer, Skeleton) | Re-author as web components keeping the same visual spec. ImageViewer + Skeleton concepts map directly. |
| **Status-machine idea** (conversation states) | Becomes request statuses (New → Needs info → Ready to quote → …). |
| **MEMORY/docs discipline** | Keep. |

## 4. What to ARCHIVE (pause, don't delete)
Move to a `legacy/` reference or just stop touching — all of:
- Unified inbox (inbox/thread/clients/calendar/book screens)
- Instagram/WeChat/Kakao/SMS/Square integrations + their Edge Functions
- Channel abstraction, send-message, webhooks, A2P/Twilio plan
- Booking/calendar/availability, MonthCalendar, ChannelDot
- The Meta/Square/encryption secrets stay set but unused

Keep them in git history + an `ARCHIVE.md` note so nothing is lost. The Square/
Meta research + functions are real work; they may return in a later "booking"
phase, but they are **out of MVP scope.**

## 5. New MVP architecture (proposed)
```
apps/web (Next.js, Vercel or CF Pages)
  /[artist]            → public artist profile (kasa.ink/dizon)
  /[artist]/request    → guided intake flow (multi-step, mobile-first, public)
  /[artist]/request/success
  /dashboard           → artist request board (auth)
  /dashboard/[id]      → request detail + AI brief + actions (auth)
  /settings/*          → profile, intake setup, policies, AI behavior (auth)

Supabase
  Postgres   → new schema (DATA_MODEL.md)
  Auth       → artists only
  Storage    → request-images bucket (reference + placement photos)
  Edge fn    → generate-brief (Claude: raw submission → structured brief)
```
Client submits → row written + images uploaded → `generate-brief` runs (async) →
artist dashboard shows the AI brief. No realtime needed for MVP (poll/refresh).

## 6. Build-first recommendation
See MVP_BUILD_PLAN.md. Headline: **build the client intake flow with mock/local
state FIRST** (no backend) to nail the "dramatically better than Google Forms"
feel, validate with artists, THEN wire Supabase + AI. The intake UX *is* the
product's wedge — prototype it before plumbing.

## 7. Fastest path to a clickable prototype
1. Spin up `apps/web` (Next.js) with the design tokens.
2. Build the **guided intake flow** as a self-contained client component with
   local state + mock submit (no DB). Real images via local object URLs.
3. Build a **static artist dashboard** + **request detail** with 3–4 hard-coded
   sample requests + a hard-coded AI brief.
4. Deploy to a preview URL → clickable end-to-end in ~1–2 focused sessions.
That prototype is enough to show 10 artists (VALIDATION_PLAN.md) before we build
any backend.

## 8. Design system
**Keep it — it's an asset.** The warm, editorial, premium aesthetic is *more*
fitting for tattoo (portfolio-adjacent) than it was for a SaaS inbox. Minor
adjustments in DESIGN_SYSTEM.md (slightly more editorial/portfolio energy, image-
forward layouts, `kasa.ink` wordmark). No rebuild.

## 9. What can be built with mock data first
Everything client-facing + the dashboard shell:
- Full intake flow (local state)
- Artist profile page (static props)
- Dashboard board + cards (mock requests)
- Request detail + a sample AI brief (hard-coded)
- Settings screens (local state)
Only these need backend: persistence, image upload to Storage, real AI brief,
artist auth. Defer all to after the prototype validates.

## 10. Sequencing (high level)
P0 Prototype (mock) → validate with artists →
P1 Backend (schema + auth + upload + submit) →
P2 AI brief (generate-brief) →
P3 Artist actions (status, notes, suggested replies) →
P4 Settings/intake customization →
Later: Instagram DM auto-reply, deposits (Stripe), calendar, templates.

See MVP_BUILD_PLAN.md for the detailed, ordered build.
