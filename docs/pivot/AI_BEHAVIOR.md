# Kasa AI Behavior — Tattoo Brief Generation

## The one job
Turn a raw tattoo-request submission into an **artist-ready brief** that lets the
artist understand + triage it in <30 seconds. One Claude call per submission.

Reuses the proven pattern from the old `parse-intent` function: single Anthropic
call (`/v1/messages`), low temperature, **strict JSON output**, conservative,
fire-and-forget from the submit path (ingestion never blocks on AI).

## Function: `generate-brief` (Edge Function, service role)
Input: a `tattoo_requests` row + its images' categories + the artist's AI-behavior
config (accept/decline rules, min budget, tone, deposit instructions).
Output (written to `ai_summaries` + `suggested_replies`):

```json
{
  "brief": "Daniel wants a large Korean-inspired upper-arm piece combining tiger, pine tree, moon, and traditional mask imagery. Flexible on final composition; open to a deposit before design.",
  "extracted": {
    "request_type": "custom",
    "concept": "Korean-inspired tiger, pine tree, moon, traditional mask",
    "placement": "upper arm / sleeve",
    "size": "~48cm x 18cm",
    "style": "blackwork / oriental / red accents",
    "timing": "Jan 5–7 (flexible)",
    "budget": null,
    "experience": "first tattoo"
  },
  "missing_info": ["exact budget range", "final preferred date", "one multi-day piece vs split sessions"],
  "risk_flags": [],
  "next_action": "Reply asking for budget range and confirm deposit policy.",
  "suggested_replies": [
    { "tone": "warm", "body": "Hi Daniel! Love this concept ..." }
  ]
}
```

## Output contract
- **brief** — 1–3 sentence human paragraph. The headline value.
- **extracted** — normalized fields (nulls when absent; never invent).
- **missing_info** — only things the artist genuinely needs to quote/decide.
- **risk_flags** — enum-ish: `under_18`, `ai_art`, `scope_budget`, `vague`,
  `placement_unclear`. Empty when clean.
- **next_action** — one concrete suggestion.
- **suggested_replies** — 1–2 copyable drafts in the artist's configured tone,
  incorporating their deposit instructions when relevant.

## Hard rules (carried from the old product's guardrails)
1. **Suggestions only.** Never auto-sends, never books, never quotes a price.
   The artist copies/edits replies themselves.
2. **Conservative + honest.** Don't invent budget/dates/size. Unknown → null +
   list it in `missing_info`. A confidently-wrong brief erodes trust faster than
   a modest one.
3. **Respect artist config.** Accept/decline rules, min budget, style prefs, and
   tone come from `/settings/ai` and shape `next_action`, `risk_flags`, and the
   reply drafts. (e.g., budget below min → `scope_budget` flag + a polite-decline
   suggestion using the artist's decline reasons.)
4. **Strict JSON, low temp.** Same robustness as parse-intent. On parse failure,
   store the brief as "summary unavailable" — never block the request from showing.
5. **Privacy.** Only the submission + artist config go to the model. No client PII
   beyond what's needed; nothing logged in plaintext beyond the row itself.

## Risk-flag definitions
- `under_18` — age not confirmed or signals of a minor → surface prominently
  (legal/consent critical for tattoo).
- `ai_art` — references look AI-generated (artist opted in to flagging) → note it
  so the artist can decide their stance.
- `scope_budget` — described scope vs stated/typical budget mismatch.
- `vague` — concept too thin to quote; `next_action` = ask clarifying questions.
- `placement_unclear` — placement/size missing or contradictory.

## Tone handling
Artist picks a tone (warm / direct / playful / formal) in settings. Reply drafts
match it. Deposit instructions + common decline reasons (also from settings) are
injected so suggestions are immediately usable, not generic.

## Model
Reuse `claude-haiku-4-5` (fast, cheap, sufficient for structured extraction). Can
escalate to a larger model only if brief quality needs it — keep it swappable via
env, like the old function.

## When it runs
On submit (the `submit-request` Edge Function calls `generate-brief` async after
writing the row + images) and on-demand "regenerate" from the request detail.
Never on the client's critical path — the client sees "sent" instantly regardless.
