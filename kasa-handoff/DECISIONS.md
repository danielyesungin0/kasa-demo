# DECISIONS.md

Resolved choices for the Kasa rebuild. These are settled — don't re-open them without a reason.
Read this before the other docs; where any doc seems to disagree, this wins.

## Locked
1. **Strategy:** Keep the backend *logic*, rewrite the frontend. The old app's value is its
   Square / Supabase / AI code, not its UI.
2. **Frontend:** Full **React Native (Expo)** rewrite for iOS + Android. **None** of the old
   Next.js screens/components are ported — the new app is a stylist-facing inbox, the old one was
   a client-facing booking-chat web page. Build to `DESIGN.md` + `reference-prototype.html`.
3. **Server endpoints:** **Supabase Edge Functions.** The old backend is ~22 Next.js route
   handlers; the useful ones (Square, availability/booking, the one Claude call, plus new channel
   webhooks) get **relocated into Supabase Edge Functions.** One platform for DB + Auth + server
   code + secrets. No Vercel, no separate web host — there's no web frontend to host.
4. **Public webhook URL:** lives on Supabase Edge Functions, on a **stable URL from day one.**
5. **GitHub:** repo lives at **`github.com/danielyesungin0/kasa-demo`** (transferred from
   `danielyesung` in Phase 1; local git identity set to `danielyesungin0`).
6. **Client-facing "book with me" booking page:** **retired.** Clients never book themselves —
   they message Shen, and she books. Archive that surface; don't port it.
7. **AI:** keep the single **Claude (Haiku) booking-intent call**; **mine, don't port** the
   ~2,400-line deterministic parser. The new AI job is tiny (see `AI_BEHAVIOR.md`).

8. **Messaging layer: BUILD CUSTOM — do NOT use respond.io (or any aggregator/BSP) for core
   messaging.** Kasa is a scalable multi-tenant SaaS, not a one-off tool for Shen. respond.io is
   fine for prototyping but introduces a dependency we don't own — its pricing, workspace model,
   API limits, channel behavior, and tenant isolation would all sit outside our control, and the
   long-term product depends on **owning the client conversation layer.** We own, from the start:
   channel auth · inbound webhooks · outbound replies · message storage · tenant isolation ·
   AI enrichment · booking state · channel-specific fallback logic. This buys stronger margins,
   clearer multi-tenant architecture, and fewer platform constraints. (KakaoTalk is the one
   pragmatic exception that may still require an authorized partner/BSP — decided separately when
   we reach it; see `INTEGRATIONS.md`.)

9. **MVP channel scope: Instagram + WeChat, together.** These are the two channels Shen's clients
   actually use, so **both** must work for the MVP to be real. This supersedes the old
   "SMS first" ordering. SMS (Twilio) is deferred (easy, but slow carrier registration);
   KakaoTalk is post-MVP. See `INTEGRATIONS.md` and `MIGRATION_PLAN.md` Phase 4 for the full
   ordering + rationale.

10. **Meta App Review is a parallel track starting NOW**, not a Phase-4 task. The long pole for
    Instagram is Meta's review of the messaging permission (weeks). Begin it immediately so it
    isn't the thing that blocks launch.

11. **Deploy timing (Phase 2 functions):** deploy **`parse-intent` early** (only needs
    `ANTHROPIC_API_KEY`, no Square dependency) so its real-world quality can be tuned against
    actual message text. Keep **`square-availability` + `square-create-booking` written/committed
    but UNDEPLOYED** until the Square sandbox account is linked — no deploying Square blind.

12. **Inbound ingestion ordering (non-negotiable):** an inbound webhook **writes the message
    first, THEN calls `parse-intent`** to enrich `conversations.intent` + `intent_payload`.
    Never block message ingestion on the AI call — a slow or failed Claude call must never drop
    an incoming message.

## Out of scope for the new app (archive / don't carry forward)
- The Next.js client-facing booking + AI-chat UI. **Archive, don't delete** — it stays as the
  working reference for the Square/Supabase patterns until Phase 4 proves the new path end to end.
  Deletion is behind a separate sign-off, after Phase 4.
- **respond.io / messaging aggregators** for core messaging (see #8).
- Resend email and the SMS-reminder paths (revisit later if wanted).
- Groq (dormant) — remove.

## Verified facts (Phase 0/1/2)
- **Secret history scan: CLEAN.** No real keys were ever committed (only `sk-ant-...`
  placeholders in `docs/ai-providers.md`). No rotation needed. Re-confirmed before archiving.
- **Live DB is dev/test:** 1 seed stylist, no Square connection, no real data. Schema reconciled
  to `DATA_MODEL.md` in Phase 2 (migrations 009–014, applied).

## Still open (decide as you go)
- Exact Supabase project/branch strategy for dev vs prod.
- Whether email/SMS reminders come back as a post-launch feature.
- KakaoTalk partner/BSP choice (post-MVP).
- **WeChat gate:** whether a *verified* Service Account is actually obtainable for this business
  — that, not the code, is the real risk. Flag/resolve early (see `INTEGRATIONS.md`).
