# Kasa Validation Plan — talk to 10 tattoo artists before building the backend

Goal: prove (or kill) the wedge with real artists using the **Phase-0 mock
prototype** (MVP_BUILD_PLAN.md) — before investing in Supabase/AI plumbing.

## Who to talk to (target 10)
- Mix of NYC + Korea (your two observed markets) + a couple online (IG outreach).
- Solo artists (not big studios) who use IG as their storefront.
- Bias toward those who currently use Google Forms/Jotform or "DM me" — they feel
  the pain most.

## How
- 15–20 min each, screen-share or in person. Show the deployed mock link on a
  phone (it must feel real). Let them tap through the client flow AND see the
  artist brief/dashboard.
- Record (with consent). Capture verbatim quotes — they're gold for messaging.

## The interview script (ask, then show)

### Part 1 — current reality (ask BEFORE showing Kasa)
1. **What do you currently use for tattoo request intake?** (Form? DMs? Which tool?)
2. **What happens after a request/form is submitted?** (Walk me through it.)
3. **How long does it take you to review one request** and decide what to do?
4. **What makes you decline a request?** (Listen for: budget, scope, vibe, AI art,
   placement, first-timers, etc. — this powers risk flags + decline suggestions.)
5. What's the most annoying part of getting/reviewing requests?
6. How many requests do you get a week? How many turn into bookings?

### Part 2 — show the prototype, then ask
Let them tap the client flow first (as if a client), then the artist side.
7. First reaction to the **client intake** vs their current form?
8. First reaction to the **AI brief** — **would AI summaries actually save you
   time?** Where specifically?
9. Is anything in the brief wrong/missing/that you wouldn't trust?
10. **Would you replace Google Forms/Jotform/your current intake with this?**
    (If no — what's missing?)
11. Would you put `kasa.ink/<you>` in your IG bio? Why / why not?
12. What would make this a *no-brainer* yes?

### Part 3 — willingness to pay
13. **What would you pay per month for this?** (Let them answer unprompted first,
    then test ~$15 / $25 / $40 reactions.)
14. Free vs paid: would a free tier (e.g. N requests/mo) get you to try it?

## What we're trying to learn (decision criteria)
- **Is intake review a real, time-costing pain?** (Qs 2–5) — if "nah, DMs are
  fine," the wedge is weak.
- **Does the brief create an "aha"?** (Qs 8–9) — the core hypothesis. If artists
  shrug at the brief, the AI isn't the wedge and we rethink.
- **Switching intent** (Qs 10–11) — would they actually swap their form.
- **Price signal** (Qs 13–14) — anchor the business model.

## Signals → go / iterate / kill
- **GO:** ≥6/10 say they'd swap their form + brief gives clear time savings +
  ≥$15/mo willingness from several. Build Phase 1.
- **ITERATE:** they love the intake but shrug at the brief (or vice-versa) →
  refocus the build on whichever half lands; fix the other.
- **KILL/RETHINK:** "my DMs/form are fine," brief doesn't impress, no pay signal
  → the pivot's wedge isn't there; reconsider before building backend.

## Logistics
- Build a 1-page interview notes template (one per artist): current tool, post-
  submit steps, review time, decline reasons, brief reaction, swap (y/n), price.
- After 10: synthesize — top 3 reasons they'd swap, top 3 objections, the price
  band, and the single most-loved + most-doubted feature. That synthesis drives
  the Phase-1 build priorities.

## Note
This is cheap and fast precisely because Phase 0 is mock — no backend risk. Ten
conversations can save weeks of building the wrong thing (the exact lesson from
the messaging-channel detour).
