# Kasa MVP Build Plan — Tattoo Intake

Principle: **the intake UX is the wedge — prototype it (mock) and validate with
artists BEFORE building any backend.** Don't plumb Supabase until the flow earns
"I'd delete my Google Form."

## Phase 0 — Prototype, all mock (no backend) ← START HERE
Goal: a clickable, deployed, end-to-end demo to show 10 artists.
1. **Scaffold `apps/web`** (Next.js + Tailwind) with the ported design tokens +
   Inter/Fraunces. Archive nothing yet; just stop touching the Expo app.
2. **Client intake flow** (C2) with local state + mock submit. Real image preview
   via local object URLs (no upload). Nail the guided, editorial feel.
3. **Artist profile page** (C1) from static props (one sample artist: "dizon").
4. **Success page** (C2.11).
5. **Artist dashboard** (A1) with 3–4 hard-coded sample requests.
6. **Request detail** (A2) with a hard-coded sample AI brief + sample images +
   copyable replies. Status buttons mutate local state only.
7. **Deploy to a preview URL** (Vercel/CF Pages).
**Exit criteria:** you can demo the whole loop on a phone. → run VALIDATION_PLAN.

> Deliberately skipped in P0: auth, DB, uploads, real AI, settings persistence.

## Phase 1 — Backend foundation
After validation says "build it":
1. **Schema** (DATA_MODEL.md) as a Supabase migration. Reuse the project.
2. **Artist auth** (reuse lib/auth patterns) — sign in, create `artists` +
   profile. Handle reservation (`kasa.ink/<handle>`).
3. **Storage** `request-images` bucket + signed/Edge upload.
4. **`submit-request` Edge Function** — public endpoint: validate, write
   `tattoo_requests` + `request_images` + `client_contacts`, return success.
   (Submissions go through the function, not raw anon insert — safer.)
5. Wire the client flow to real submit + upload. Wire the dashboard/detail to read
   real rows. Profile + intake config read from DB by handle.

## Phase 2 — AI brief
1. **`generate-brief` Edge Function** (fork parse-intent's pattern; AI_BEHAVIOR.md).
2. Call it async from `submit-request`; write `ai_summaries` + `suggested_replies`.
3. Detail page renders the real brief; dashboard card shows the real one-liner +
   missing-info count. "Regenerate" button.

## Phase 3 — Artist workflow
1. Status controls + `request_status_events` (board moves).
2. Artist notes. Copy-reply. Priority.
3. Board filtering/sorting by status.

## Phase 4 — Customization
1. **Intake setup** (A4) → `intake_forms` toggles drive which client steps render.
2. **Settings** (A3) → profile/policies/auto-reply persist + show on the public page.
3. **AI behavior** (A5) → feeds `generate-brief`.

## Later (post-MVP, explicitly deferred)
Instagram DM auto-reply with the link · DM import · Stripe deposits · calendar/
Acuity/Google sync · saved reply templates · studio/team mode · flash-drop mode ·
guest-spot mode · analytics · client portal · consent forms. **No booking, no
payments, no messaging integration in MVP.**

## Reuse cheat-sheet (so we don't rebuild)
- Design tokens, type, voice → port verbatim
- `parse-intent` → fork to `generate-brief`
- `uploadMedia.ts` logic → web image upload
- `lib/auth.tsx` → artist auth
- RLS + GRANT lesson (old migration 022) → apply to new tables
- ImageViewer / Toast / ConfirmDialog / Skeleton / Text → re-author, same specs

## Recommended FIRST STEP (one concrete action)
**Scaffold `apps/web` (Next.js) + port the design tokens + build the C2 intake
flow as a mock-only clickable stepper.** That single artifact is what you show
artists, and it's the highest-information thing we can build. Everything else
waits behind it.

## Open decision for you before P0
- **Web stack:** Next.js (recommended) vs Expo Router web. Plan assumes Next.js.
- **Repo shape:** add `apps/web` alongside `apps/mobile` (monorepo) vs new repo.
  Recommend `apps/web` in this repo (shares Supabase, design tokens, git history).
- **Artist side now or later:** prototype both client + artist in P0 (recommended,
  it's all mock) so the full story is demoable.
