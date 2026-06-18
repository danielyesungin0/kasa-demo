# AI Providers (Groq + Claude)

Kasa's chat brain is provider-agnostic. The whole app calls `callAI()` in
`lib/ai/provider.ts`; everything downstream (booking, availability, service
matching, confirm-before-book) only consumes the structured `AIResponse` and
never touches a provider directly. Switching providers is **env-vars only** —
no code, no URL, no UI change. Shen's `/book/shen` link is unaffected.

## Providers

| Provider | Default? | Model env | Notes |
|---|---|---|---|
| **Groq** | ✅ yes | `GROQ_MODEL` (default `llama-3.1-8b-instant`) | Fast, free tier. The safe default. |
| **Claude** | no | `ANTHROPIC_MODEL` (default `claude-haiku-4-5-20251001`) | Smarter conversational quality, better ambiguity + Korean/English mixing. Opt-in. |

## Environment variables

```bash
# Master switch (must be "true" for any AI at all)
AI_ENABLED=true

# Which brain. "groq" (default) or "claude". Unset/unknown → groq.
AI_PROVIDER=groq

# Groq (already configured)
GROQ_API_KEY=...
GROQ_MODEL=llama-3.1-8b-instant        # optional

# Claude (only needed if AI_PROVIDER=claude, or as a manual test)
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-haiku-4-5-20251001   # optional; override Haiku version
```

## How to switch Groq → Claude (and back)

**To Claude:**
1. Set `ANTHROPIC_API_KEY` (Vercel → Settings → Environment Variables, Production).
2. Set `AI_PROVIDER=claude`.
3. Redeploy. That's it — same `/book/shen` link, now on Claude.

**Back to Groq:**
1. Set `AI_PROVIDER=groq` (or remove the var entirely — Groq is the default).
2. Redeploy.

**Fully reversible by env vars.** No code change either direction.

## Safety / fallback behavior

- **No Claude key + `AI_PROVIDER=claude`** → treated as "not configured" → silently
  falls back to Groq. Setting the flag without a key **cannot break the beta**.
- **Claude errors / times out / rate-limited** → automatic fallback to Groq.
- **Both fail** → `callAI` returns null → the chat shows its warm
  "assistant is busy, try again in a moment" message **with a handoff escape**.
- **Confirm-before-book is unchanged.** No provider ever creates, reschedules, or
  cancels a booking; the AI only interprets, and the deterministic flow requires
  explicit user confirmation before any booking action.

## Comparison logging

Every chat request logs one line (no API keys, no user content):

```
[ai-provider] {"provider":"groq","outcome":"success","latencyMs":312}
[ai-provider] {"provider":"claude","outcome":"success","latencyMs":880}
```

Grep Vercel logs for `[ai-provider]` to compare provider, outcome
(`success | rate_limited | error | timeout`), and latency across the two.

## Per-stylist override (future)

Currently a single global switch. A per-stylist override (e.g. Shen on Claude,
everyone else on Groq) has a clear `TODO(per-provider)` marker in
`resolveProviderName()` — it would key off the slug/stylist id there. Left out
for now to avoid overbuilding.

---

# Manual test plan — Groq vs Claude

Run the **same prompts** against each provider and compare. Since both share the
prompt + `AIResponse` schema, the *structure* should match; Claude should handle
ambiguity, Korean, and personality better.

**Setup:** test on `/book/shen-test` (the internal provider). Run once with
`AI_PROVIDER=groq`, once with `AI_PROVIDER=claude` (+ `ANTHROPIC_API_KEY`),
redeploying between. Compare the `[ai-provider]` logs to confirm which handled each.

| # | Prompt | What to check (both providers) |
|---|---|---|
| 1 | "Can I come after work next Thursday?" | Resolves to Thursday, evening/after-work time. Not "the 4th", not another day. |
| 2 | "Can I do balayage but I'm not sure what service to pick?" | Recognizes balayage as unsupported AND offers guidance/handoff — doesn't dead-end. |
| 3 | "I want the same thing I got last time." | Asks to look up / clarify rather than guessing a service. Routes sensibly (lookup or clarification), no fabricated booking. |
| 4 | "Can I reschedule to Tuesday at 5?" | Detects manage/reschedule intent; "5" = 5pm not the 5th; Tuesday preserved. Does NOT reschedule without confirmation. |
| 5 | Korean-only booking (e.g. "다음 주 화요일에 머리 자르고 싶어요") | Understands it; **replies in Korean**; correct service (haircut) + day (next Tue). |
| 6 | Mixed Korean/English ("haircut 예약하고 싶어요 next Friday 3pm") | Understands the mix; books haircut, Friday 3pm; replies naturally (Claude should mirror language better). |
| 7 | Unsupported service ("can I get acrylic nails?") | Routes to unsupported/handoff; never confirms it as bookable. |
| 8 | Cancellation ("I need to cancel my appointment") | Detects cancel intent; goes to lookup/verify; does NOT cancel without explicit confirmation. |
| 9 | Confirm-only-after-yes: book a service, reach review, then say "yes" | Booking is created ONLY after the explicit yes/confirm tap — never before. |

**Pass criteria:**
- Both providers: no raw API errors, no fabricated services/times, confirm-before-book holds.
- Claude advantages to watch for: #2 (ambiguity), #5/#6 (Korean + mixing), #3 (graceful "same as last time"), and overall warmth/personality.
- Note any case where Claude regresses vs Groq — those are prompt-portability issues to file, not blockers (Groq remains default).

## Important: Claude path is not yet live-tested

The Claude provider compiles, shares the contract, and falls back safely, but
the actual Anthropic round-trip has **not** been exercised (no `ANTHROPIC_API_KEY`
was present during implementation). Before relying on it: add the key locally,
set `AI_PROVIDER=claude`, and run prompts 1–9. Until then, Groq remains the
tested default.
