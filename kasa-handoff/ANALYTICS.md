# ANALYTICS.md

You had no analytics before. Add a lightweight, privacy-respecting layer so you can see whether
Kasa actually saves Shen time and where she drops off. Keep it simple — events with a few
properties, one tool.

## Tooling
- **PostHog** (has a React Native SDK, generous free tier, self-host option) or **Amplitude**.
  Either is fine; pick one and wrap it in a tiny `track(event, props)` helper so swapping later is trivial.
- Add **crash/error reporting** too (Sentry for Expo). Analytics ≠ error monitoring; you want both.
- Respect privacy: no message contents, no client PII in event properties. Use ids, counts, enums.

## North-star + key funnels
- **North star:** booking confirmed from a conversation (the loop working end-to-end).
- **Activation:** stylist connects ≥1 channel and replies to a first message.
- **Core loop funnel:** message received → thread opened → reply sent → Book opened → **booked**.

## Events to fire
**Onboarding / setup**
- `channel_connect_started` { channel }
- `channel_connected` { channel }
- `square_connected`

**Messaging**
- `message_received` { channel }  (server-side, on ingestion)
- `thread_opened` { channel }
- `message_sent` { channel }
- `reply_blocked_by_window` { channel }   // they hit a closed reply window
- `template_or_external_open` { channel } // tapped "open Instagram/WeChat"

**Booking (most important)**
- `book_sheet_opened` { source: nudge | composer | profile | calendar_fab }
- `booking_suggestion_shown` { had_time: bool }     // the AI nudge appeared
- `booking_suggestion_accepted`
- `booking_confirmed` { service, source }            // success
- `booking_failed_square_error`

**Calendar / navigation**
- `calendar_view_changed` { view: day | week | month }
- `appointment_opened`

**Retention signals**
- `app_opened` (with day/week active tracking handled by the SDK)
- `notification_opened` { type }

## What to watch
- **Reply-window friction:** how often `reply_blocked_by_window` fires per channel — tells you how
  much the 24h/48h limits hurt and whether the honest UI is enough.
- **Nudge precision:** `booking_suggestion_accepted` / `booking_suggestion_shown`. Low ratio →
  the AI is over-triggering; make it more conservative (see `AI_BEHAVIOR.md`).
- **Loop completion:** `booking_confirmed` / `thread_opened`.
- **Source of bookings:** which entry point (nudge vs composer Book vs calendar FAB) she actually uses.

## Implementation notes
- Fire server-side events (`message_received`, `booking_confirmed`) from Edge Functions so they're
  reliable even if the app is backgrounded; fire UI events from the app.
- Gate analytics behind a consent/setting and document what's collected.
- Don't over-instrument on day one — these events are enough to answer "is the core loop working?"
