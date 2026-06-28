# Kasa — engineering handoff

This folder is the spec for rebuilding **Kasa** as a mobile app on top of the backend you
already built. Hand it to Claude Code along with the prototype file `kasa.html` and your
existing repo.

### What Kasa is
One calm inbox for an independent stylist. Every client message — Instagram, SMS, WeChat,
KakaoTalk — funnels into one place. She reads, replies in her own words, and books
appointments into Square, all from her phone. Not a CRM, not a chatbot. The AI helps her
*notice* a booking request; it never acts for her.

### Read in this order
0. **`DECISIONS.md`** — the settled choices (Edge Functions, RN rewrite, repo transfer, retired client page). Read first.
1. **`00_KICKOFF_PROMPT.md`** — paste this into Claude Code to start. Phase 0 (discovery) is already done.
2. **`PRODUCT_BRIEF.md`** — what we're building and the guardrails.
3. **`DESIGN.md`** — the visual system (tokens, components, screens). Source of truth is `kasa.html`.
4. **`ARCHITECTURE.md`** — target stack and repo layout.
5. **`DATA_MODEL.md`** — Supabase schema.
6. **`INTEGRATIONS.md`** — how to connect Square + the four messaging channels.
7. **`AI_BEHAVIOR.md`** — what the booking-intent parser does (and doesn't do).
8. **`MIGRATION_PLAN.md`** — phased plan to move from the old web app without losing work.
9. **`ANALYTICS.md`** — events to instrument (there was no analytics before).

### The one-line strategy
**Keep the backend logic. Rewrite the frontend.** The old app is **Next.js 14** (a client-facing
booking-chat web page) on **Supabase + Square + one Claude call**. The useful backend logic gets
**relocated into Supabase Edge Functions**; the entire UI is **rewritten in React Native (Expo)**
as a stylist-facing inbox. The old client-facing page is retired. No Vercel, no web host.

### Keep `kasa.html` in the repo
Drop the prototype at `/design/reference.html`. It's the interactive design reference — when a
screen's spacing or interaction is ambiguous in `DESIGN.md`, open the prototype and match it.
