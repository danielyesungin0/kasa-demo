# _archive/ — the old Next.js app (RETIRED, not paused)

This is the original **client-facing booking + AI-chat web app** (Next.js 14).
It is **retired** — the product is now a stylist-facing Expo inbox on the same
Supabase + Square + Claude backend. Nothing builds or deploys from here.

## Why it's kept (and why that's safe)
- **Reference**, not a dependency. The valuable backend logic (Square OAuth /
  token refresh / AES-256-GCM crypto / availability / the single Claude call)
  was **ported** into `supabase/functions/_shared` + the Edge Functions in
  Phase 2 (steps 1–3). The live functions import only from `../_shared` — never
  from this tree (verified before archiving).
- **git history** keeps this app fully intact and checkout-able if it's ever
  needed to run again.
- **Deletion** is a separate, later decision — only after Phase 4 proves the new
  channel path end to end (see `kasa-handoff/DECISIONS.md`).

## What's here
The old `app/` (routes, client booking page, dashboard), `components/`, `lib/`
(chat parser, mock data, Square/Supabase/AI/email/SMS helpers), `qa/`,
`scripts/`, `docs/`, and the old Next/Tailwind/TS build config + `package.json`.

## What was NOT carried forward
- Groq (dormant in the old `lib/ai/provider.ts`) — fully dropped; the live AI is
  a single Claude (Haiku) call in `supabase/functions/parse-intent`.
- The client-facing "book with me" page — retired; clients now message Shen.

Do not import from this directory in new code.
