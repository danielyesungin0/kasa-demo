# DESIGN.md

The interactive source of truth is **`kasa.html`** (keep it at `/design/reference.html`). When
anything here is ambiguous, open the prototype and match it. This doc captures the system so it
ports cleanly into React Native (recommended: NativeWind, so these tokens become theme values).

---

## 1. Principles
- **Calm, warm, premium, lightweight.** Boutique tool, not enterprise software.
- **Conversation-first.** The inbox and thread are the heart; everything else supports them.
- **Her control.** No auto-drafts shoved in her face, no AI verdicts. Suggestions are optional.
- **Honest states.** Show real channel limits and real Square outcomes; never fake success.

## 2. Color tokens
Warm paper base, clay-rose for primary actions, plum reserved for booking/Square. `-strong`
variants exist specifically to carry **white text at WCAG AA contrast** (use them on buttons,
sends, outgoing bubbles, and colored text on light backgrounds).

```
/* surfaces */
--bg:#F4F0E9;  --surface:#FFFFFF;  --surface-2:#FAF7F1;  --bg-warm:#ECE6DB;
/* ink (text) */
--ink:#211D18;  --ink-2:#534B41;  --ink-3:#746A5C;  --ink-4:#9A9082;
--line:#E9E2D6;  --line-2:#DED6C7;
/* brand */
--accent:#C56B5C;  --accent-strong:#A94B3E;  --accent-soft:#F5E3DD;  --accent-ink:#9A4A3D;
--plum:#7E6488;    --plum-strong:#6A5074;    --plum-soft:#ECE3EE;    --plum-ink:#5F4868;
/* semantic */
--ok:#5E9B73 / soft #E2EFE6 / ink #3C6F50
--warn:#B98A3C / soft #F4EAD6 / ink #85601F
--err:#C2554E / soft #F5E1DF / ink #8F3832
--blue:#5B7FA6 / soft #E3EAF2
```

**Color roles (use consistently):**
- `accent` / `accent-strong` = primary actions, send button, **outgoing message bubbles**, links, active tab.
- `plum` / `plum-strong` = **everything booking/Square** (Book button, booking sheet, calendar events, FAB).
- semantic colors only for status (ok/warn/err). Notes turn `warn` **only** when they contain a real caution (allergy, no-show, etc.), never by default.

**Channel colors** — two uses: a soft tint (badges/labels) and a **filled dot** (high-contrast, with a readable glyph). All glyph/fill pairs pass the 3:1 graphical-contrast bar.
```
Instagram  text/tint #B5547F / #F6E5EE   dot fill #C2548A  glyph #fff
SMS        text/tint #5B7FA6 / #E3EAF2   dot fill #4F86C6  glyph #fff
WeChat     text/tint #3FA56E / #E1F0E7   dot fill #1FA855  glyph #fff
KakaoTalk  text/tint #A98A00 / #FBF2C9   dot fill #F4C300  glyph #3A2E00 (dark on yellow)
```

## 3. Typography
- **UI:** Inter (400/450/500/600/700). In RN, ship the Inter font family.
- **Display (sparingly):** Fraunces — greetings, sheet titles, profile name, big stat numbers, "Booked". Don't use it for body or labels.
- Times and stat numbers use **tabular figures** so they align.
- Rough scale (px): display 26–35 (Fraunces 500), screen title 22–27 (600), section head 15 (600), body 14–15 (1.45 line-height), label/eyebrow 11–12 uppercase 700 tracking, caption 12–13.
- For real code: replace fixed px with scalable units and respect Dynamic Type / font scaling — the prototype is fixed-px and does **not** yet honor system font size. Treat that as a required accessibility task.

## 4. Spacing, shape, elevation
- **Spacing scale:** 4 / 8 / 12 / 16 / 20 / 24. **Screen gutter = 20.**
- **Radii:** cards 18, controls 12–14, pills/dots 999, bottom sheets 26 (top corners).
- **Shadows:** soft and warm, low opacity. Cards use a 1px + 4–14px blur stack; sheets/toasts heavier. Prefer hairline borders (`--line`) over heavy shadows for separation (e.g., message bubbles, list rows).
- **Lists sit on white (`--surface`)** with hairline dividers — not on the paper bg (that was a readability bug we fixed). Paper shows behind headers and gaps.

## 5. Layout & safe areas (important for real devices)
- Full-height container must use the **dynamic viewport** (`100dvh` on web; in RN this is the
  natural full screen). The bottom tab bar must never hide behind browser/OS chrome.
- Respect **safe-area insets** top and bottom (notch + home indicator). In RN use
  `SafeAreaView` / `useSafeAreaInsets`; the tab bar and bottom sheets pad by the bottom inset.
- Tap targets ≥ 44pt. Focus states visible. Honor reduce-motion.

## 6. Components (the vocabulary)
- **Avatar** — initials on a deterministic color; sizes 28/34/40/56/72.
- **Channel dot / badge** — filled dot (in lists/threads) or soft pill with label (profile/settings).
- **Bottom sheet** — slide-up, grip handle, scrim; used for Book, Result, Merge.
- **Pills / segmented control** — fixed height, content vertically centered (so day/week/month
  pills are the same height); selected = ink fill or `-strong`.
- **Buttons** — primary (`accent-strong`/`plum-strong`, white text), ghost (`bg-warm`), dark (ink). Min height ~44.
- **Toast** — transient confirmation, bottom, above tab bar.
- **Inset list group** — white rounded container, rows with hairline dividers, chevron for navigable rows.

## 7. Screens (match the prototype)
**Bottom tabs:** Today · Inbox · Calendar · Clients · More.

- **Today** — Fraunces greeting; "Today's schedule" (derived from the *same* source as Calendar — never a second hardcoded list); "New messages" (unread). Appointments are tappable → client. No triage tiles.
- **Inbox** — search + filter chips (All / Unread / Booked); rows on white with leading unread dot, filled channel dot on the avatar, snippet, time, and a small plum calendar glyph when the thread has a booking. Swipe → Read / Archive.
- **Thread** — header: back, tappable name (→ profile), client-details icon. Messages as left/right bubbles (incoming = surface + hairline, outgoing = `accent-strong` white). **Composer is Instagram-style:** a rounded bar containing a **Book** button (plum, inside-left), the text field, and a send button that **appears only when she's typing**. Restricted channels swap the field for "Reply on {Channel}" but keep Book. A dismissible **booking nudge** appears only when the conversation clearly points at a time.
- **Calendar** — segmented **Day / Week / Month**; the **pill strip below navigates in the active unit** (days / week-ranges / months), all pills the same fixed height. Day = vertical time grid with a now-line and plum event blocks sized by duration. Week = 7-column grid. Month = date grid with per-day booking dots. **Floating "+" (FAB) bottom-right** opens the Book sheet. Tapping an event → client.
- **Clients** — white list, avatar, name (VIP star), last visit, channel dots → profile.
- **Profile** — avatar, name, **status badge** (VIP/Regular/New), channel badges, **Book** button; a 3-stat row (Visits / Last visit / Since); optional duplicate-merge card; **Preferences** (neutral) and **Notes** (neutral, or amber "Heads up" only when it's a real caution); Tags; Conversations; Contact.
- **Book sheet (the star)** — pick **client** (if not already in context) → **service** (from her menu) → **day** → **available times**. Times are **duration-aware**: a 3.5h service greys out slots that can't fit before close or that overlap an existing booking. Summary line, **Confirm in Square**, and the guard line "Reviewed by you — created in Square only when you confirm." Success → "Booked" + the appointment appears on the calendar. Failure → honest "Couldn't reach Square."
- **Settings/More** — Channels (the four, with connection state) and Square. WeChat noted as working via a connected Official Account.

## 8. Interaction details worth preserving
- Sending a message **optimistically appears in the thread** immediately.
- A confirmed booking **immediately shows on the calendar** (with a "New" marker) and Today.
- Booking is duration-aware and conflict-aware (no double-booking).
- Everything reflects her actions — the app never just toasts and forgets.
