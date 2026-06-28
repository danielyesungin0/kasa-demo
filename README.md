# Kasa

One calm inbox for an independent hair stylist (**Shen**). Every client message — Instagram,
SMS, WeChat, KakaoTalk — funnels into one place. She reads, replies in her own words, and books
appointments into **Square**, all from her phone. Not a CRM, not a chatbot. The AI only helps her
*notice* a booking request; it never acts for her.

> **Status: mid-migration.** This repo is moving from an old **Next.js web app** (a client-facing
> booking + AI-chat page) to a new **Expo (React Native)** stylist-facing inbox on the same
> Supabase + Square + Claude backend. The old web UI is being **archived, not extended**.
> The plan and the locked decisions live in [`kasa-handoff/`](kasa-handoff/) — read
> **`DECISIONS.md`** first, then `MIGRATION_PLAN.md`.

## Guardrails (non-negotiable — enforced in code and copy)

- **Never auto-send a message.** Sending is always a deliberate tap.
- **Never auto-book.** The AI may *suggest* a time and pre-fill the Book sheet; creating the
  appointment is always Shen tapping **Confirm in Square**.
- **Respect each channel's reply window** (Instagram 24h, WeChat 48h). Show the limit honestly
  rather than letting a send silently fail.
- **Secrets never live in the repo.** Env var *names* are documented in `.env.example`; real
  values go in `.env.local` (gitignored) or Supabase function secrets.

## Architecture (target)

- **Mobile app:** Expo (React Native) + expo-router + NativeWind → `apps/mobile/`
- **Backend:** Supabase (Postgres + Auth + RLS + Realtime + Storage)
- **Server logic + channel webhooks:** Supabase Edge Functions → `supabase/functions/`
- **AI:** a single Anthropic **Claude (Haiku)** booking-intent call (mined from the old parser)
- **Booking:** Square (sandbox until launch) — the only write path is `square-create-booking`

See `kasa-handoff/ARCHITECTURE.md` for the full layout and `MIGRATION/INVENTORY.md` for the
Phase-0 inventory of what's kept / relocated / archived.

## Repo layout (target — built out across phases)

```
apps/mobile/            # NEW Expo app (Phase 3)
supabase/
  migrations/           # versioned schema (Phase 2)
  functions/            # Square, parse-intent, channel webhooks (Phase 2/4)
packages/shared/        # shared types + helpers
design/reference.html   # the interactive prototype (visual source of truth)
kasa-handoff/           # specs + decisions
MIGRATION/              # migration inventory & notes
_archive/               # old Next.js client-facing UI (parked, not built)
```

> The current `app/`, `components/`, `lib/` (the old Next.js app) are still in place and will be
> reorganized during Phase 2 as logic is relocated and the old UI is archived. Until then, the
> repo still builds as the old Next.js app.

## Develop (current, pre-migration)

```bash
npm install
cp .env.example .env.local   # then fill in real values locally
npm run dev                  # http://localhost:3000
npm test                     # vitest
```

Run instructions for the new Expo app will be added when it's scaffolded (Phase 3).
