# MIGRATION_PLAN.md

Phased path from the old Next.js web app to the new Expo mobile app. Phase 0 done; Phases 1–2
substantially done (see `MIGRATION/` for inventory, DB snapshot, and the Phase-2 code plan).
Do phases in order; pause for confirmation between them.

## Guiding rule
Keep the backend logic; rewrite the frontend; delete nothing valuable. Old client-facing UI is
**archived, not ported**. Square/Supabase/AI code is **relocated, not rewritten from scratch**.

---

### Phase 0 — Discovery ✅ done
Inventory in `MIGRATION/INVENTORY.md`.

### Phase 1 — GitHub account move + repo cleanup ✅ done
Repo at `danielyesungin0/kasa-demo`; identity fixed; `.env.example` / `.gitignore` / README done;
secret scan clean.

### Phase 2 — Preserve backend + self-rebuildable schema 🔄 in progress
- ✅ Schema reconciled to `DATA_MODEL.md` (migrations 009–014 applied): inbox tables added,
  `bookings`→`appointments`, `services` view, dead tables dropped, seed kept.
- 🔄 Relocate Square + availability/booking + the single Claude call into **Supabase Edge
  Functions**; scaffold channel webhooks. Plan + order: `MIGRATION/PHASE2_CODE_PLAN.md`.
  - Deploy **parse-intent early**; keep Square functions written/committed but **undeployed**
    until the Square sandbox is linked (`DECISIONS.md` #11).
- ⏳ Archive the client-facing UI (step 5; archive not delete); remove Groq.

### Phase 3 — New mobile app (full RN rewrite)
Scaffold Expo + NativeWind; port `DESIGN.md` tokens; build every screen to match
`reference-prototype.html`; wire to Supabase + the Phase-2 Edge Functions.

### Phase 4 — Channels (REVISED ORDERING — Instagram + WeChat first)
> Supersedes the old "SMS first". MVP = **Instagram + WeChat together** — the channels Shen's
> clients actually use; both must work for the MVP to be real. All **custom-built, no respond.io**
> (`DECISIONS.md` #8). Full rationale + gates in `INTEGRATIONS.md`.

- **Start NOW, in parallel (not gated on Phase 3):**
  - **Meta App Review** for the Instagram messaging permission (weeks — the long pole).
  - **WeChat verified Service Account** acquisition — confirm it's obtainable for this business.
- **Build order:** Instagram (Meta Graph, direct) **+** WeChat (Service Account, webhook) → then
  **SMS (Twilio)** deferred (easy code, slow A2P carrier registration) → **KakaoTalk** post-MVP
  (likely partner/BSP — separate provider decision).
- Each channel: inbound webhook live (write message first, then `parse-intent`), outbound
  respecting the reply window.

### Phase 5 — Analytics + cleanup
Instrument `ANALYTICS.md`. **Delete** the archived old frontend (separate sign-off, only after
Phase 4 proves the new channel path end to end). Add run instructions. Lean repo.

---

## Cleanup principles
- Delete dead code rather than commenting it out — git history is the safety net.
- One source of truth per concern (availability comes from `square-availability`, nowhere else).
- No business logic in the client; no secrets in the repo; no duplicate util piles.
- Drop dependencies the new app doesn't use (Groq, email/SMS-reminder libs, the big parser).

## Ordering notes
- **Old UI = working reference** for Square/Supabase patterns until Phase 4 proves the new path;
  that's why it's archived, not deleted, and why deletion needs separate sign-off.
- **No respond.io** — custom channel integrations from the start (`DECISIONS.md` #8).
