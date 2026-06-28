# PRODUCT_BRIEF.md

## Who it's for
**Shen** — an independent hair stylist who runs her own books. She's busy, non-technical, and
lives on her phone between clients. Messages reach her across **Instagram, SMS, WeChat, and
KakaoTalk**, and she books into **Square**. Today that's chaos across four apps; Kasa makes it
one calm place.

## What Kasa is
A unified client inbox + lightweight booking tool. Three jobs, in order of importance:
1. **Consolidate** every channel's messages into one inbox.
2. **Reply** — she types naturally, or fires a quick response, all in-app.
3. **Book** — when a client's ready, she pulls up her real availability and slots them into
   Square herself.

## What Kasa is NOT
- Not a CRM. Not a marketing/blast tool. Not a chatbot that talks to clients for her.
- Not an auto-responder. Not a tool that books on her behalf.

## The guardrails (these are non-negotiable, enforce them in code and copy)
- **Never auto-send a message.** Drafts/suggestions are fine; sending is always a deliberate tap.
- **Never auto-book.** The AI may *suggest* "looks like Friday 5:30 works — book her in?", which
  only *opens the booking sheet pre-filled*. Creating the appointment is always Shen tapping
  **Confirm in Square**.
- **Copy rule:** say "Confirm in Square" / "Review before booking", never "AI booked it."
- **She is in control.** When in doubt, surface information and let her decide; don't decide for her.

## The core loop
Message arrives (any channel) → appears in her inbox → she opens the thread → replies in her
words → if a booking is on the table, she taps **Book**, picks service + time from her real
availability, and confirms into Square. The AI's only job is to gently flag when a thread looks
like it's heading toward a booking.

## Why mobile
She needs to know the moment a client messages and respond between clients. That means **push
notifications** and an app she opens reflexively — which is why the target is a real mobile app,
not a web page. (See `ARCHITECTURE.md` for the Expo recommendation.)

## Channel reality (shapes the UX — see INTEGRATIONS.md)
- **Instagram**: can only free-reply within **24h** of the client's last message.
- **WeChat**: Official/Service Account, **48h** service window; client must message first.
- **SMS**: no window limits (via Twilio).
- **KakaoTalk**: business Channel; two-way "consultation" chat after the client initiates, plus
  approved templates for notifications.
The app shows these limits honestly (e.g., "Instagram reply window closed — open Instagram")
rather than letting a send silently fail.
