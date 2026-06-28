# MIGRATION_PLAN.md

Phased path from the old Next.js web app to the new Expo mobile app **without losing backend
work** and **without carrying bloat forward.** Phase 0 (discovery) is **done** — findings are in
the kickoff prompt and `DECISIONS.md`. Do the remaining phases in order; finish each before the
next, and pause for confirmation between them.

## Guiding rule
**Keep the backend logic; rewrite the frontend; delete nothing valuable.** The old client-facing
UI is archived, not ported. The Square/Supabase/AI code is relocated, not rewritten from scratch.

---

### Phase 0 — Discovery ✅ done
Old stack identified (Next.js 14 App Router + TS + Tailwind, npm, ~22 route handlers, Supabase,
Square sandbox, single Claude Haiku call). Repo + 8 migrations exist; `stylists` migration is
missing. Inventory captured in `MIGRATION/INVENTORY.md`.

### Phase 1 — GitHub account move + repo cleanup
You may have **two GitHub accounts**; the repo currently lives at `danielyesung/kasa-demo` and
must move to the account holding your other projects (the down app).
- Report `git remote -v`, `git config user.name/email`, `gh auth status`; tell me which account
  I'm authenticated as. **Confirm the target account with me — don't guess.**
- **Scan history for committed secrets**; if found, flag for rotation before anything else.
- **Transfer** the repo (GitHub Transfer ownership) or create the empty repo on the target account
  and `git remote set-url origin`. Set local git identity to the right account. **Verify the first
  push landed in the target account.** Do **not** `git init`.
- Restructure in place per `ARCHITECTURE.md`; add `.gitignore`, `.env.example`, fix the stale README.
- **Deliverable:** repo in the correct account, restructured, history intact, secrets safe.

### Phase 2 — Preserve backend + self-rebuildable schema
- **Add the missing `stylists` migration** so the schema rebuilds from zero. Reconcile against
  `DATA_MODEL.md`: add the net-new inbox tables (`channels`, `clients`, `client_identities`,
  `conversations`, `messages`, `webhook_events`); keep existing data.
- **Relocate** Square + availability/booking + the single Claude call from `app/api/**` into
  **Supabase Edge Functions**. Scaffold the four channel webhooks.
- **Archive** the client-facing booking/chat UI; remove Groq + out-of-scope paths (Resend,
  SMS reminders) unless we revive them later.
- **Deliverable:** backend callable independent of any frontend; schema self-rebuilds; old UI parked.

### Phase 3 — New mobile app (full RN rewrite)
- Scaffold Expo + NativeWind; port `DESIGN.md` tokens. Build every screen to match
  `reference-prototype.html`. Wire to Supabase + the Phase-2 Edge Functions.
- **Deliverable:** the app runs on iOS + Android with real data.

### Phase 4 — Channels, one at a time
SMS (Twilio) → Instagram (Meta — **start App Review now**) → WeChat (Service Account) →
KakaoTalk (Channel + partner). Each: inbound webhook live, outbound respecting the window.

### Phase 5 — Analytics + cleanup
Instrument `ANALYTICS.md`. Delete the dead code flagged in Phase 0. Add run instructions. Lean repo.

---

## Cleanup principles (the anti-bloat rules)
- Delete dead code rather than commenting it out — git history is the safety net.
- One source of truth per concern (availability comes from `square-availability`, nowhere else).
- No business logic in the client; no secrets in the repo; no duplicate util piles.
- Drop dependencies the new app doesn't use (Groq, email/SMS-reminder libs, the big parser).

## The specific things you flagged
- **Two GitHub accounts / wrong account** → Phase 1 reconciles identity, then transfers the repo
  to the correct account and verifies the push landed there.
- **No analytics** → Phase 5.
- **Confused about the "book with me" link** → it's the old client-facing booking page; it's
  **retired** (clients now just message Shen). Not ported.
- **Worried about bloat** → replace-don't-refactor + archive the client UI + Phase-5 deletion.
- **Don't know what's stable for hosting** → settled: **Supabase Edge Functions** (one platform).
