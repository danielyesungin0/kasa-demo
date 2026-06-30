# Kasa Product Spec — Tattoo Request Intake (MVP)

## Core promise
**"Stop reading messy tattoo forms. Get artist-ready briefs instead."**

## Who it's for
Solo tattoo artists (NYC/Korea-style workflows) who use Instagram as their
storefront and currently route inquiries to Google Forms / Jotform / DMs.

## The job-to-be-done
1. Client has a tattoo idea → taps the artist's `kasa.ink/<handle>` link.
2. A guided, beautiful intake captures the idea + references + placement + logistics.
3. AI turns the raw submission into a clean **brief** + flags missing info + suggests
   the next action.
4. Artist reviews the request board, understands each request **in <30 seconds**,
   and decides: reply / quote / decline / archive — booking happens wherever they
   already do it (DM, Acuity, deposit link). Kasa does NOT book.

## Explicitly OUT of MVP scope
Not a booking app · not a CRM · not a calendar · not a Square/Acuity replacement
· not a DM manager · no payments · no Instagram DM integration · no messaging
consolidation. Kasa replaces the **ugly request form**, nothing else (yet).

## Two experiences

### A) Client side (public web, no login)
Mobile-first, feels like a premium guided flow — NOT one giant form.
- **Artist profile** — name, IG handle, studio/location, style tags, booking
  status ("Books open for July–Aug"), short intro, CTA "Start tattoo request",
  optional policy preview.
- **Guided request flow** — stepper, one idea per screen, progress, can go back,
  autosave to local state. Steps (artist-configurable which appear):
  1. Basic info (name, pronouns?, 18+ confirm, email, phone?, IG handle)
  2. Request type (flash / custom / cover-up / consultation)
  3. Concept (describe idea, style direction, mood/meaning?)
  4. Placement (body area picker, notes, optional placement photo)
  5. Size (in/cm OR guided comparisons — coin, phone, palm, forearm)
  6. References (upload images; tag each: style / composition / subject /
     placement / artist's past work / color)
  7. Timing (preferred dates, flexible, traveling from out of town)
  8. Budget (range or "not sure")
  9. Policies (deposit / cancellation / 18+ / consent acknowledgements)
  10. Review (clean summary, edit any section)
  11. Success ("Your request has been sent" + what happens next + response
      expectation)

### B) Artist side (web, auth)
- **Request board** (NOT an inbox) — cards grouped/filterable by status:
  New · Needs more info · Ready to quote · Deposit needed · Booked externally ·
  Declined · Archived. Card shows: client name, type, placement, size, preferred
  timing, image count, **AI one-liner**, missing-info count, priority, submitted
  time.
- **Request detail** (the core workflow) — AI brief, raw submission, reference
  images (categorized) + placement photo, missing info, risk flags, suggested
  next action, suggested replies (copyable), artist notes, status controls
  (ready to quote / deposit needed / booked externally / decline politely /
  archive).
- **Settings** — profile, booking status, styles, request types, required
  fields, deposit/cancellation policy, min price, hourly rate?, budget ranges,
  preferred contact, custom questions, auto-reply copy, suggested-reply tone.
- **Intake setup** (feels like "tattoo intake setup," not a form builder) —
  toggles: require placement photo / require references / ask budget / first
  tattoo? / allergies? / cover-up? / preferred dates? / traveling? / exact size /
  general size / deposit ack / age confirm.
- **AI behavior** — what they accept/decline, style prefs, min budget, tone,
  common decline reasons, deposit instructions, how to handle vague requests,
  how to handle AI-generated tattoo art references (+ flag toggle).

## Two non-negotiable quality bars
1. **Client intake must feel dramatically better than Google Forms/Jotform on
   mobile** — guided, calm, image-forward, fast, never a wall of fields.
2. **Artist understands a request in <30 seconds** — the AI brief + one-liner +
   missing-info count do the heavy lifting; raw data is one tap away, not the
   default.

## AI's role (see AI_BEHAVIOR.md)
- Summarize the request into a brief (the headline value).
- Extract structured fields (type, placement, size, style, timing, budget).
- Detect missing info the artist needs to quote.
- Flag risks (under-18 signal, AI-art references, scope/budget mismatch, vague).
- Suggest a next action + 1–2 copyable replies in the artist's tone.
- **Never** auto-replies, never books, never quotes a price. Suggestions only —
  the same honesty guardrail as the old product, carried forward.

## Success metric for MVP
An artist says: "I'd put this link in my bio and delete my Google Form." +
willingness to pay (validate target price in VALIDATION_PLAN.md).
