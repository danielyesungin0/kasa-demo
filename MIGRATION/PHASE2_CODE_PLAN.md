# MIGRATION/PHASE2_CODE_PLAN.md — backend code relocation (for approval)

Database half of Phase 2 is **done** (migrations 009–014 applied + committed).
This plan covers the remaining Phase 2 work: relocating backend **logic** out of
the old Next.js route handlers into **Supabase Edge Functions** (Deno/TS), per
DECISIONS.md #3 and ARCHITECTURE.md. **No function code is written yet — this is
the plan to approve.**

## Guiding constraints (from the docs)
- Edge Functions are Deno, not Node. The old code is Node/Next. So this is a
  **port**, not a copy — `@supabase/supabase-js` works in Deno; the Square SDK
  may not, so Square calls likely become direct REST (`SQUARE_BASE` + fetch),
  which the old code already does in places.
- Secrets move to **Supabase function secrets** (not `.env.local`). Names already
  documented in `.env.example`.
- **Guardrails stay enforced server-side:** parse-intent only suggests; the only
  Square write path is `square-create-booking`; outbound respects the reply window.
- Square stays **sandbox**; no Square connection exists yet, so functions are
  built + deployable but fully testable only once you link Square.

## Target function layout (supabase/functions/)
```
_shared/            # shared Deno helpers: supabase admin client, cors, square base,
                    # crypto (port of lib/crypto.ts), reply-window logic
square-availability/    # SearchAvailability + Catalog → duration-aware open times
square-create-booking/  # CreateBooking — the ONLY Square write path
parse-intent/           # the single Claude (Haiku) call (mined from lib/ai/provider.ts)
webhook-sms/            # Twilio inbound → normalize → messages   (Phase 4 fills send)
webhook-instagram/      # Meta inbound  → normalize → messages
webhook-wechat/         # WeChat OA inbound → normalize → messages
webhook-kakao/          # Kakao inbound → normalize → messages
send-message/           # outbound; picks channel + checks window  (Phase 4 wires sends)
```

## Proposed order (each = its own reviewable commit)
1. **`_shared/` + `parse-intent`** — start here. parse-intent is self-contained
   (one Claude call returning strict JSON) and proves the port pattern end to end.
   Mine `lib/ai/provider.ts` (the `callClaudeRaw` path + the strict-JSON parse);
   **drop** Groq, the 2,400-line deterministic parser, and the chat-flow scaffolding.
   New scope per AI_BEHAVIOR.md: classify `booking` vs `none`, extract
   service/preferred/candidate_times/confidence → write `conversations.intent` +
   `intent_payload`. Never drafts, never books.
2. **`square-availability`** — port from `app/api/availability/route.ts` +
   `lib/availability.ts` + `lib/square/*`. Duration-aware, conflict-aware against
   `appointments` + `blocked_times`.
3. **`square-create-booking`** — port from `app/api/bookings/route.ts` (POST).
   Writes Square + the `appointments` row. The only write path.
4. **4 webhook stubs + `send-message` stub** — scaffolding that already normalizes
   into `clients`/`conversations`/`messages` per the INTEGRATIONS.md contract;
   real provider wiring is Phase 4. Stubs verify signatures + write `webhook_events`.
5. **Archive old UI + drop Groq** — move the old Next.js client-facing app
   (`app/`, `components/`, old `lib/*` chat code) into `_archive/` (or delete —
   git history is the safety net), remove Groq env/code. Keep `lib/square/*`,
   `lib/crypto.ts`, `lib/supabase/*` until their Edge-Function ports are proven,
   then retire the route handlers they backed.

## What I will NOT touch without separate sign-off
- Anything that writes to Square (sandbox) at runtime — needs your Square link first.
- Deleting (vs archiving) the old frontend — confirm archive-vs-delete in step 5.

## Open questions for you
- **Deploy now or later?** Functions can be written + committed without deploying.
  Deploying needs `supabase functions deploy` + setting function secrets. We can
  defer deploy until you've set up Square, or deploy parse-intent early (it only
  needs ANTHROPIC_API_KEY) to test the AI live.
- **Archive vs delete** the old client-facing UI in step 5.
