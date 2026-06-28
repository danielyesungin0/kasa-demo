# Kickoff prompt for Claude Code

> Phase 0 (discovery) is already done — its findings are baked into this prompt and the docs.
> Paste this into Claude Code with the `kasa-handoff/` folder, the prototype, and the existing
> `kasa-demo` repo all open. Read `DECISIONS.md` first; it records the settled choices.

---

You are helping transition **Kasa** from an old web app to a new mobile app. Discovery is done.

**What Kasa is:** one calm inbox where an independent hair stylist ("Shen") sees every client
message from Instagram, SMS, WeChat, and KakaoTalk, replies, and books into Square — from her
phone. See `PRODUCT_BRIEF.md`. **Read `DECISIONS.md` before doing anything** — it records the
locked choices below so you don't re-open them.

**Ground truth from Phase 0 (don't re-discover):**
- Old app = **Next.js 14 (App Router) + TypeScript + Tailwind**, **npm**, ~22 route handlers in
  `app/api/**`. **Supabase** (Postgres + Auth + RLS) is the DB. **Square** (sandbox) is wired
  (OAuth, token refresh, catalog sync, create/cancel). AI = a single **Anthropic Claude (Haiku)**
  call in `lib/ai/provider.ts` (Groq is dormant — remove). Resend email + SMS reminders + a
  ~2,400-line deterministic parser exist but are **out of new scope**.
- A git repo + remote already exist: `github.com/danielyesung/kasa-demo`. **8 SQL migrations**
  exist in `supabase/migrations/`, but the **`stylists` table was made in the Supabase UI and is
  not captured** — the schema is not self-rebuildable until we add that migration.

**The locked decisions (from `DECISIONS.md`):**
- **Rewrite the entire frontend in React Native (Expo)** for iOS + Android. None of the old
  Next.js UI is ported — the old app was a *client-facing* booking-chat page; the new one is a
  *stylist-facing* inbox. Build to `DESIGN.md` + `reference-prototype.html`.
- **Server endpoints → Supabase Edge Functions.** Relocate the useful route-handler logic
  (Square, availability/booking, the one Claude call) into Edge Functions, and add the new channel
  webhooks there. **No Vercel, no separate web host.** Keep the webhook URL stable from day one.
- **Keep the backend logic, mine the AI.** Lift the Square + Supabase code; extract only the
  single booking-intent Claude call from the 2,400-line parser (see `AI_BEHAVIOR.md`).
- **Retire the client-facing booking page** — archive it, don't port it.

**Still work in phases and stop for my confirmation at the end of each.**

---

### Phase 1 — GitHub account move + repo cleanup
This repo must move to the GitHub account that holds my other projects (the "down app"), and I may
have **two GitHub accounts** — so reconcile identity carefully before pushing anything.
1. Report current state: `git remote -v`, `git config user.name/user.email`, and `gh auth status`.
   Tell me which account my machine is currently authenticated as.
2. Confirm with me which account is the **target** (the one with my other projects). Don't guess.
3. **Scan git history for any committed secret** (`.env`, Square/Anthropic/Supabase keys). If you
   find one, tell me immediately so I can rotate it — that affects whether we scrub history.
4. Move the repo to the target account (GitHub **Transfer ownership**, or create the empty repo
   there and `git remote set-url origin <new-url>`), set local identity to the right account, and
   **verify the first push landed in the target account.** Do **not** `git init` a new repo.
5. Restructure in place toward `ARCHITECTURE.md`: `apps/mobile/` (new Expo app), keep
   `supabase/` (migrations + functions), `packages/shared/` (types), `design/reference.html`
   (the prototype). Add `.gitignore`, `.env.example` (names only), and refresh the stale README
   (it falsely claims "mock data only").
6. **Deliverable:** repo lives in the correct account, restructured, history intact, secrets safe.

### Phase 2 — Preserve backend + make schema self-rebuildable
1. **Add the missing `stylists` migration** so the schema rebuilds from zero. Reconcile all
   migrations against `DATA_MODEL.md` — add the net-new inbox tables (`channels`, `clients`,
   `client_identities`, `conversations`, `messages`, `webhook_events`); keep existing data.
2. **Relocate** the useful Next.js route-handler logic into **Supabase Edge Functions**:
   `square-availability`, `square-create-booking` (the only write path to Square), `parse-intent`
   (the single Claude call — see `AI_BEHAVIOR.md`). Keep using my Square **sandbox** creds.
3. Scaffold channel webhook functions (`webhook-sms/instagram/wechat/kakao`) that normalize into
   `messages` per `INTEGRATIONS.md`, on a stable public URL.
4. **Archive** the client-facing booking/chat UI and remove Groq + out-of-scope paths.
5. **Deliverable:** backend is callable by any client, schema self-rebuilds, old client UI archived.

### Phase 3 — New mobile frontend (full rewrite)
1. Scaffold **Expo + expo-router + NativeWind**; port the `DESIGN.md` tokens into the theme.
2. Build the screens to match `reference-prototype.html`: Today, Inbox, Thread (Instagram-style
   composer with Book inside), Calendar (Day/Week/Month, unit-matched pill strip + FAB), Clients,
   Profile, Book sheet, Settings. Wire to Supabase + the Phase-2 Edge Functions.
3. **Deliverable:** app runs on iOS + Android with real data.

### Phase 4 — Channels, one at a time
Per `INTEGRATIONS.md`: SMS (Twilio, easiest) → Instagram (Meta — **start App Review now**, it's
slow) → WeChat (Service Account) → KakaoTalk (Channel + partner). Each: inbound webhook →
normalize → outbound respecting the reply window.

### Phase 5 — Analytics + final cleanup
Add analytics per `ANALYTICS.md` (there was none). Delete remaining dead code. Leave it lean.

---

### Rules that never change
- **Never auto-send a message; never auto-book.** AI only suggests + pre-fills; Shen taps to send
  and taps **Confirm in Square**. Copy never says "AI booked it."
- Respect channel windows (Instagram 24h, WeChat 48h).
- Secrets in Supabase secrets / env, never in the repo.
- Delete dead code rather than keeping it "just in case."
- End each phase with a summary and **wait for my go-ahead.**

Start with **Phase 1**: report git remote + identity + `gh auth status`, and tell me which account
I'm currently authenticated as before we move anything.
