# Kasa Screen Reference — Tattoo Intake (MVP)

Two surfaces: **Client (public web)** and **Artist (auth web)**. Components reuse
the design system (DESIGN_SYSTEM.md). ★ = build in the mock prototype first.

---

## CLIENT SIDE (public, mobile-first, no login)

### C1. Artist profile — `kasa.ink/<handle>` ★
The "storefront landing" the IG bio links to.
- Avatar, display name, IG handle (tappable), studio · location
- Style tag chips (fineline, blackwork, ornamental…)
- Booking-status pill ("Books open for July & August")
- Short intro paragraph
- Big primary CTA: **Start tattoo request**
- Collapsible "Policies" preview (deposit / cancellation) — optional
- Footer: "Powered by Kasa" (light)
- Feel: portfolio-adjacent, image-forward, calm. NOT a form yet.

### C2. Guided request flow — `kasa.ink/<handle>/request` ★
A **stepper**, one idea per screen. Top: slim progress bar + step label + back.
Bottom: sticky Continue. Autosave to local state (survive refresh). Each step is
a focused card, generous whitespace, large tap targets.

Steps (artist toggles which appear):
1. **Basic info** — name, pronouns (optional), 18+ confirm (toggle), email,
   phone (optional), IG handle
2. **Request type** — big selectable cards: Custom · Flash · Cover-up · Consultation
3. **Concept** — multiline "Describe your idea", style direction chips, mood/
   meaning (optional)
4. **Placement** — body-area picker (tappable body-map or chip list), notes,
   optional placement-photo upload
5. **Size** — toggle exact (in/cm) OR **guided** size cards with real-world
   comparisons (coin · phone · palm · forearm · back)
6. **References** — multi-image upload (camera roll), each thumbnail gets a
   category tag (style / composition / subject / placement / past work / color)
7. **Timing** — preferred dates (simple date chips or free text), "I'm flexible"
   toggle, "traveling from out of town" toggle
8. **Budget** — range chips (from artist config) or "Not sure yet"
9. **Policies** — acknowledgement checkboxes (deposit / cancellation / 18+ /
   consent), each showing the artist's actual policy text
10. **Review** ★ — clean editorial summary grouped by section, each section has
    an "Edit" affordance jumping back to that step
11. **Success** ★ — calm confirmation: "Your request has been sent." + "What
    happens next" + the artist's response expectation. Optional: "Save a copy" /
    return to profile.

Quality bar: must feel like a guided concierge, never a Google Form wall.

---

## ARTIST SIDE (auth web)

### A1. Request board — `/dashboard` ★
NOT an inbox — a **board**. Default: list grouped by status, or a filter row of
status pills (New · Needs info · Ready to quote · Deposit needed · Booked
externally · Declined · Archived). Sort by newest / priority.

**Request card** (the <30-second unit):
- Client name · request type
- Placement · size (compact)
- Preferred timing
- Image count (📎 6)
- **AI one-liner** (the headline)
- Missing-info count badge (e.g. "2 missing")
- Priority dot
- Submitted time (relative)
Tap → detail.

### A2. Request detail — `/dashboard/<id>` ★
The core artist workflow. Layout top→bottom (mobile) / two-column (desktop):
- **AI brief** (hero) — the paragraph summary + extracted fields as a tidy spec
  list (type, concept, placement, size, style, timing, budget, experience)
- **Missing info** — chips ("budget range", "final date")
- **Risk flags** — if any (under-18, AI-art reference, scope/budget mismatch, vague)
- **Suggested next action** — one line
- **Suggested replies** — 1–2 cards, each with a **Copy** button (artist's tone)
- **Reference images** — grid, grouped by category; tap → ImageViewer (reuse)
- **Placement photo** — shown distinctly
- **Raw submission** — collapsible (the verbatim answers)
- **Artist notes** — private, add/edit
- **Status controls** — Ready to quote · Deposit needed · Booked externally ·
  Decline politely · Archive (and back to New / Needs info)

### A3. Settings — `/settings` ★(static in mock)
Sections (each its own sub-page or accordion):
- **Profile** — display name, IG, studio, location, bio, avatar, style tags,
  booking status, accent color
- **Request types** offered
- **Policies** — deposit / cancellation / consent text, min price, hourly rate?,
  budget ranges, preferred contact method
- **Auto-reply** — message shown to client after submit, + response-time
  expectation

### A4. Intake setup — `/settings/intake`
Feels like "tattoo intake setup," not a form builder. Grouped toggles
(map 1:1 to `intake_forms` columns): require placement photo / require references
/ ask budget / first tattoo? / allergies? / cover-up? / preferred dates? /
traveling? / exact size / general size / deposit ack / age confirm. Plus a
"Custom questions" list (add label + type).
Live **preview** of the resulting intake on the side (nice-to-have).

### A5. AI behavior — `/settings/ai`
- What you accept / don't accept (free text → fed to the prompt)
- Style preferences, minimum budget
- Tone of voice for suggested replies (chips: warm / direct / playful / formal)
- Common decline reasons (list → power the "decline politely" suggestions)
- Deposit instructions (injected into suggested replies)
- How to handle vague requests / AI-generated art references (+ "flag AI art" toggle)

---

## Shared / reused components
- **Stepper / progress** (new)
- **Selectable card** (request type, size guide) (new, simple)
- **Image upload + thumbnail + category tagger** (new; logic from uploadMedia.ts)
- **ImageViewer** (reuse concept) — fullscreen reference viewing
- **Brief spec list** (new — label/value rows)
- **Status pill + board card** (new; status idea from old inbox)
- **Toast, ConfirmDialog, Skeleton, Text** (reuse specs)
- **Copy-to-clipboard reply card** (new)

## Navigation map
```
PUBLIC:  /[artist]  →  /[artist]/request  →  /[artist]/request/success
ARTIST:  /dashboard  →  /dashboard/[id]
         /settings (profile · policies · auto-reply)
         /settings/intake
         /settings/ai
         /login
```
