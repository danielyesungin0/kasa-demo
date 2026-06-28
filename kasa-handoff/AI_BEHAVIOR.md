# AI_BEHAVIOR.md

You already built AI that reads incoming messages to detect booking intent — a single
**Anthropic Claude (Haiku)** call in `lib/ai/provider.ts`, sitting inside a ~2,400-line
deterministic parser. **Mine it, don't port it:** lift the one Claude call into the
`parse-intent` Edge Function and leave the giant parser behind. Give the AI a smaller, sharper
job than the old web app did — in the new design it does not draft replies or run the
conversation. It does exactly one thing:

## The only job: flag a booking, extract the details, suggest — never act
When a new inbound message arrives, `parse-intent` decides: *is this conversation pointing toward
booking an appointment?* If yes, it sets `conversations.intent = 'booking'` and fills
`intent_payload` with whatever it can extract:
```json
{
  "service_guess": "full balayage",     // map to a services row if possible
  "preferred": "Friday evening",         // natural-language preference
  "candidate_times": ["Fri 5:30 PM"],   // parsed times if present
  "confidence": 0.0-1.0
}
```
The app uses this to show a **dismissible nudge** in the thread:
> "Sounds like **Friday 5:30** could work — book Emily in?" → tapping opens the **Book sheet
> pre-filled** with that service/day. It does **not** book.

That's the whole contribution. Smaller than before, but it's the spark that makes the booking
flow feel smart without taking control away from Shen.

## Hard rules
- **Never send a message.** The AI may not generate-and-send replies. (It may, at most, be used
  later to *offer* a suggested draft she edits — but only if you deliberately add that, and it
  must require a tap to send. The current design has no auto-draft at all.)
- **Never book.** Output is a suggestion + pre-fill only.
- **Suggestions are dismissible and quiet.** Only show the nudge when intent is `booking` and
  there's a concrete service or time on the table. No confidence meters or checklists in the UI.
- **Pre-fill, then hand off.** The booking sheet still validates real availability
  (duration-aware, conflict-aware) — the AI's extracted time is a starting point, not gospel.

## Implementation notes
- Run it server-side in the `parse-intent` Edge Function, called from the inbound webhook after a
  message is written. Don't block message ingestion on it — write the message first, enrich after.
- Keep the model prompt scoped to: classify intent (`booking` vs `none`) and extract
  service/time/preference. Return strict JSON. Low temperature.
- Be conservative: a false "she wants to book" nudge is mildly annoying; over-triggering erodes
  trust. When unsure, set `intent:'none'` and show nothing.
- Log inputs/outputs (without sensitive content beyond what's needed) so you can tune precision.

## What was removed vs the old app (and why)
The old web app leaned on AI to draft replies, score confidence, and run a booking-assistant
flow. User testing said that felt like the app was doing too much *for* her. The new product
keeps the genuinely useful part — noticing a booking request and pre-filling the sheet — and
drops the rest. Don't reintroduce auto-drafting or AI-run booking.
