# Booking Prototype — Project Context

A Next.js frontend prototype for a booking-link experience aimed at solo hairstylists. It complements (does not replace) Square: clients open a link, see availability, and book in a few taps. Stylists keep using Square as their backend.

This document is the handoff brief. Read it before changing anything.

---

## 1. What this product is

**Pitch:** "Stop replying to appointment DMs. Send one link. Clients pick a time instantly. Bookings stay organized in Square."

**Core problem:** solo stylists get appointment requests through Instagram DMs, WeChat, KakaoTalk, SMS. They don't want to constantly reply while working. Existing booking tools (Square, etc.) are too clunky and take too many steps for a simple request like "do you have Saturday afternoon?"

**Core product:** a clean booking link the stylist puts in Instagram bio or sends via any messaging app. Clients open it, see availability, choose a service/time, and confirm. Behind the scenes, Square stays the source of truth.

**What this is NOT:**
- Not a full booking system or Square replacement
- Not a CRM or inbox aggregator
- Not a pure AI chatbot — it's tap-first with a lightweight assistant for unsure clients
- Not multi-stylist (single stylist, "Mia", is the only persona)

**UX philosophy:**
- Airbnb-like: clean, minimal, calm, mobile-first
- Tap-first, not chat-first
- Show availability as early as possible
- Booking should feel faster than texting
- Avoid long forms and dense service lists
- Client should not need to log in
- Stylist should do almost no work day-to-day

---

## 2. Tech stack

- Next.js 14.2.5 (App Router)
- TypeScript (strict)
- Tailwind CSS
- React `useState` only (no global state library)
- Fonts: Fraunces (display) + Inter Tight (body) via `next/font/google`
- No backend, no auth, no payments, no real APIs
- Mock data lives in `lib/mock-data.ts`

---

## 3. Directory structure

```
booking-prototype/
├── app/
│   ├── layout.tsx              # Root layout, fonts, body classes
│   ├── globals.css             # Tailwind base + CSS variables for colors
│   ├── page.tsx                # Landing → links to /setup, /mia, /dashboard
│   ├── setup/page.tsx          # 5-step stylist onboarding (Square mock-connect)
│   ├── mia/page.tsx            # THE main file — client booking flow (~3260 lines)
│   └── dashboard/page.tsx      # Stylist dashboard (today's appointments + quick replies)
├── components/
│   ├── PageShell.tsx           # Standard page wrapper with header
│   ├── TimeSlotCard.tsx        # Slot button (used in chat + time picker)
│   ├── ServiceCard.tsx         # Legacy — currently unused but kept for reference
│   ├── AppointmentCard.tsx     # Used on /dashboard
│   ├── QuickReplyCard.tsx      # Used on /dashboard + /setup
│   ├── CopyButton.tsx          # Copy-to-clipboard for booking link / quick replies
│   └── ProgressSteps.tsx       # Used on /setup
├── lib/
│   ├── types.ts                # Service, TimeSlot, Stylist, Appointment types
│   ├── mock-data.ts            # SERVICES, SLOT_GRID, STYLIST, MOCK_TODAY, etc.
│   ├── parse-intent.ts         # Intent parser, recommender, time-refinement filter
│   ├── booking-summary.ts      # Combined-booking math + formatting helpers
│   ├── setup-config.ts         # Mock state for /setup
│   └── cn.ts                   # className merge helper
├── scripts/
│   └── smoke-test-parser.ts    # Edge case matrix A-P (run with npx tsx)
├── package.json
├── tsconfig.json
├── tailwind.config.ts
├── postcss.config.js
├── next.config.js
└── next-env.d.ts
```

---

## 4. Routes

| Route | Purpose | Notes |
|---|---|---|
| `/` | Landing page | Links to `/setup`, `/mia`, `/dashboard`. Demo navigation only. |
| `/setup` | Stylist onboarding | 5 steps: Connect Square (mock) → Review services → Review availability → Customize assistant → Share link. Display-only persistence (state lost on refresh). |
| `/mia` | **The main demo** | Client-facing booking page for stylist "Mia". Where ~95% of the engineering effort lives. |
| `/dashboard` | Stylist dashboard | Shows today's appointments + quick-reply templates. Mostly static. |

**Local dev:** `npm run dev` → visit http://localhost:3000.

---

## 5. Current assistant behavior (`/mia`)

The booking experience is "tap-first with a chat assistant for unsure clients." The page renders three regions:

1. **Earliest slots** at the top (3 cards) — for users who just want a fast time
2. **Chat assistant** in the middle — handles natural-language requests
3. **Service categories** at the bottom — fallback browser

The chat assistant supports a wide range of intents through `lib/parse-intent.ts`. Here's the intent dispatch order:

### Intent priority (in `parseClientMessage`)

```
PRIORITY 0: Pending state (newly typed answers to bot questions)
  0a. pendingSwitch     — "Switch / Add / Keep" prompt is up
                          → matches "add color" / "switch" / "keep" / "no"
  0b. pendingFuzzy      — fuzzy yes/no is up ("balayge → color, right?")
                          → matches "yes/yeah/sure" / "no/nope"
  0c. pendingClarification — length/color/perm option questions
                          → matches "short" / "medium" / "root" / "full" / "down"
  0d. pendingAdditionalService — primary resolved, secondary needs clarification
                          → e.g. color picked, asking haircut size

PRIORITY 1: Service intents (in resolveServiceIntent)
  - Combo Square match   — "men's cut and perm" → svc-mens-perm-cut
  - Multi-service        — "color and haircut" → add_services fresh
  - Add-service          — "wait i need color too" → add_services additive
  - Switch-service       — "actually color instead" → switch_service
  - Confirm-switch       — "what about color" (ambiguous)

PRIORITY 2: Info query  — "how much" / "how long" → info_query

PRIORITY 3: Slot selection — "book the 2pm" / "second one" / "yes"

PRIORITY 4: Time refinement — "earlier" / "next week" / "Tuesday"

PRIORITY 5: Cold-start book intent
  5a. Fuzzy fallback     — "balayge" with no other tags → confirm_fuzzy_match
                          (else per-word fuzzy rescue if core has tags)

PRIORITY 6: Unknown
```

### Key behaviors

- **Pending state lives on `AssistantContext`** (parser-level), not page-level `useState`. Four fields: `pendingClarification`, `pendingSwitch`, `pendingFuzzy`, `pendingAdditionalService`. This is what lets typed answers route through the same handlers as button taps.
- **Multi-service flow:** when user says "color and haircut" without specifying haircut size, we ask color first, recommend Full Color, then ask haircut size as a follow-up clarification (`pendingAdditionalService`).
- **Combined-booking awareness:** every later screen (recommendation bubble, slot pick ack, details, confirmation) uses `lib/booking-summary.ts` helpers so the booking is consistently surfaced everywhere.
- **Anchor-first availability copy:** every slot grid is preceded by a message that explains *what was searched* and *why these slots* (e.g. "Looking at Tue May 12 — here are the openings I found for that day" or "I don't see any openings on Mon May 18, but here are the closest available times right after that — Tue May 19").
- **Fuzzy matching:** "balayge" → balayage with soft Yes/No confirm at cold start, but silent merge when other tags already detected ("haircut and balayge" preserves both).
- **Non-working day handling:** asking about Sunday/Monday triggers special copy *"Mia doesn't usually take appointments on Sundays. Here are her next available openings."*

### Files to read before editing the assistant

1. `lib/parse-intent.ts` — Intent parser, recommender, refinement filter. ~2350 lines. Has clear `/* PRIORITY N */` comment markers.
2. `app/mia/page.tsx` lines ~290-580 — dispatch + handler functions. Each intent kind has its own handler.
3. `lib/booking-summary.ts` — single source of truth for combined-booking math/formatting.

---

## 6. Mock data assumptions

All in `lib/mock-data.ts`. Critical to understand before changing anything.

### Date framework

- **`MOCK_TODAY` is hardcoded as Sun May 3, 2026** (`dateKey: "2026-05-03"`). The whole demo is set in May 2026.
- **`MOCK_AVAILABILITY_HORIZON` is Sat May 23, 2026.** No slots beyond this date.
- **`WORKING_DAYS` is Tue/Wed/Thu/Fri/Sat.** Sun and Mon are non-working days. `DAY_META` does not include Sunday entries (Mon May 4 exists for the "Monday" non-working test case).
- **Three "weeks" in the demo:**
  - This week: May 4-10 (Mon-Sat available, Sun is past)
  - Next week: May 11-17
  - Week after: May 18-24 (intentionally sparse)

If you change `MOCK_TODAY`, update the synthetic-anchor logic in `filterSlotsByRefinement` (the `todayIdx = 0` and `targetDay = 3 + offset` constants).

### Services (14 total)

Defined as `SERVICES` array. IDs you'll see referenced everywhere:

- `svc-short-cut` — Short Hair Cut / Barber Short ($60)
- `svc-medium-long-cut` — Medium / Long Hair Cut ($120)
- `svc-bang-trim` — Bang Trim ($25)
- `svc-full-color` — Full Color ($300)
- `svc-root-touchup` — Root Touch-up ($130+) **← variable price, has "+" suffix**
- `svc-balayage` — Balayage ($350+)
- `svc-keratin` — Keratin Treatment ($250)
- `svc-head-spa` — Head Spa Treatment ($90)
- `svc-mens-perm-cut` — Men's Perm + Hair Cut ($200) **← combo service**
- `svc-cut-down-perm` — Hair Cut + Down Perm ($220) **← combo service**
- `svc-bang-perm` — Bang Perm ($80)
- `svc-womens-digital-perm` — Women's Digital Perm ($280)
- `svc-straightening-perm` — Straightening Perm ($310)
- `svc-consult` — Consultation with Mia (Free, in-person)

Combo services are detected by `findBestComboServiceMatch` using the `COMBO_RULES` table (regex-based matchers). When a combo matches, the booking uses the single combo Square service rather than two separate services.

### Slots

`SLOT_GRID: Record<serviceId, TimeSlot[]>` maps each service to its available slots. Built via the `slot()` factory that pulls from `DAY_META`. Slots are pre-baked, not computed.

Slot grids vary by service to simulate realistic availability — e.g. Men's Perm + Cut has fewer slots than basic Haircuts. Don't assume any service has slots on every working day.

### Variable prices

Three services have `+` suffix priceLabels: Root Touch-up `$130+`, Balayage `$350+`. The combined-booking math preserves the `+` (a $130+ service plus a $120 service totals `$250+`). If you add new variable-price services, the existing helper handles it automatically — but be aware that `parsePriceLabel` extracts the *minimum* numeric value, so the "estimate" should be communicated as such.

---

## 7. Known limitations

### Behavioral gaps

1. **Smoke test F is a known gap** — `"i need both"` returns book intent with empty tags rather than reusing `lastMentionedServices` from prior conversation. To fix, would need to track recently-mentioned categories in `AssistantContext`. Not urgent — phrased this way, the user is being maximally vague.

2. **No real Square integration.** Setup flow shows a "Square connected" state but it's a mock. The booking doesn't actually sync anywhere.

3. **No persistence between sessions.** Refreshing the page or navigating away clears all state. `/setup` doesn't actually save anything.

4. **Single stylist hardcoded as "Mia".** Multi-stylist would require restructuring `STYLIST` constant and routing.

5. **No real availability lookup.** If you change `MOCK_TODAY`, slots don't auto-shift — you'd need to manually edit `DAY_META`.

6. **Time refinement weekShift is hardcoded** to handle weeks 0/1/2 only. "Three weeks from now" would parse but the filter wouldn't honor it.

### UI/visual

7. **No keyboard-only flow tested.** Buttons and chips are all `<button>` so should work but I haven't fully audited focus order.

8. **No reduced-motion handling.** Animations use Tailwind's `animate-fade-up` class.

9. **Mobile-first but no real responsive testing on narrow screens** beyond visual inspection.

10. **`ServiceCard` component is unused.** Kept in the repo as a reference for an alternate browse-style UI we discarded. Safe to delete if you want.

### Edge cases worth knowing

11. **The clarification re-ask flow** (when user types something the parser can't map to the pending question) calls `simplifyClarification(originalText)` to produce a tighter version. Only haircut/color/perm have pattern-matched simplifications; other clarifications fall back to the original phrasing.

12. **Dispatching `clarification_answer` routes through `handleClarifyTap`** with a synthesized turn ID if no active clarify turn is found. Should be rare but exists as a safety net.

13. **`handleAddServices` uses `inferAttributesFromService`** to reverse-engineer the resolved attributes of the current service. If you add new services, update the switch/case mapping in that function or it'll re-ask color/length unnecessarily.

14. **Production build with Google Fonts:** the dev environment can't reach `fonts.googleapis.com`. Local dev should work. If you hit a build error referencing fonts, the issue is your network, not the code.

---

## 8. What NOT to change accidentally

These are easy to break:

1. **Don't change `MOCK_TODAY` without updating the synthetic-anchor math** in `filterSlotsByRefinement` (look for `todayIdx = 0` comment, around line 2000 of `parse-intent.ts`).

2. **Don't add direct calls to `parseClientMessage` outside of `handleTextSubmit`.** The handler has special re-ask logic for unmatched clarifications that you'd bypass.

3. **Don't add `selectedService = null` in a slot-related code path** without also clearing `additionalServices`. The two should always be in sync.

4. **Don't reorder the PRIORITY blocks in `parseClientMessage`.** The order is load-bearing — pending state must beat normal parsing, combo must beat multi, etc.

5. **Don't rename the `clarification_answer` intent kind.** It's referenced in many places as a synthetic intent and the page assumes specific shape (`{ kind, rawText, key }`).

6. **Don't change the structure of `Recommendation`** without also updating all 17 literal returns in `getRecommendedServicesCore`. The `unresolvedAdditionalCategory: null` field has to be present on every literal.

7. **Don't bypass `lib/booking-summary.ts`** for any combined-booking math or formatting. It's the single source of truth — recommendation bubble, info query handler, details stage, and confirmed stage all read from it.

8. **Don't put "+" suffix logic anywhere except `parsePriceLabel`** in `booking-summary.ts`. It's tested and consistent there.

9. **Don't add starter chips back when `pendingSwitch` / `pendingAdditionalService` / `pendingFuzzy` is set.** The chip-suppression gate in `app/mia/page.tsx` already handles this — keep it that way.

10. **Don't move `pendingSwitch` / `pendingFuzzy` / `pendingAdditionalService` back to page-level `useState`.** They live on `AssistantContext` so the parser can see them in PRIORITY 0.

---

## 9. Next recommended engineering steps

If you continue development, here's a reasonable priority order:

### Tier 1 — backend hooks (real product readiness)

1. **Wire Square API.** Replace `lib/mock-data.ts` with Square-fetched services + slots. The data shapes are designed to map cleanly: `Service.id` → Square service catalog ID, `TimeSlot.dateKey/timeLabel` → Square availability slot. The `findBestComboServiceMatch` table needs to be either kept as a presentation layer (combo Square services have a single ID anyway) or generalized into a Square service tag system.

2. **Add Supabase or similar for bookings.** Once a slot is selected and the user submits the details form, write an appointment record. Schema: `{ stylist_id, service_id, additional_service_ids: [], slot_datetime, client_name, client_phone, client_email, notes, source: 'booking_link' }`.

3. **Stylist auth + multi-tenant routing.** Today the link is `/mia` hardcoded. Real product needs `/[stylistSlug]` with auth-gated `/dashboard` and `/setup` for the stylist. Use Supabase Auth or NextAuth.

4. **Real Google Calendar sync** for stylist availability (read-only is fine for MVP).

### Tier 2 — assistant improvements

5. **Fix smoke test F** (`"i need both"`) — track `lastMentionedServices` on context across turns so vague references resolve.

6. **Persistent conversation across page navigations.** Today, navigating away from `/mia` loses chat state. Consider URL-based conversation IDs + localStorage.

7. **Add a real LLM fallback** for the `unknown` intent path. Right now it gives a context-aware canned response. With a real LLM, send the message + recent conversation + service list and let it generate a routing decision back into the existing intent system.

8. **Better calendar picker** for "pick-date" chip (currently just a hint). Build a real month-view picker that respects working days + horizon.

### Tier 3 — polish

9. **Animations** — the chat is functional but spartan. Slot grid could fade in more smoothly. The transition between recommendation bubble → time grid is abrupt.

10. **Stylist customization** — currently `setup/customize` is display-only. Plumbing it through requires a real stylist preferences object and surfacing it to `/mia`.

11. **Dashboard make-real** — `dashboard/page.tsx` shows mock today's appointments. Wire it to the real bookings table.

12. **Quick-reply templates** — currently hardcoded strings in `lib/setup-config.ts`. Should be editable per-stylist and persisted.

13. **Analytics** — track which services get most-clicked, drop-off points in the funnel, etc. The clean separation between "tap" and "chat" paths makes this straightforward.

---

## 10. Common dev tasks

### Run locally
```
npm install
npm run dev
```

### TypeScript check
```
npx tsc --noEmit
```

### Run smoke tests
```
npx tsx scripts/smoke-test-parser.ts
```

### Production build
```
npm run build
npm run start
```

### Add a new service

1. Add the entry to `SERVICES` in `lib/mock-data.ts`
2. Add slots to `SLOT_GRID[serviceId]`
3. If it should match natural-language requests, update keyword maps in `lib/parse-intent.ts`:
   - `HAIRCUT_WORDS` / `COLOR_WORDS` / `PERM_WORDS` / `TREATMENT_WORDS` for category routing
   - `inferAttributesFromService` in `app/mia/page.tsx` if it has a resolved length/color/perm style

### Add a new combo

1. Add the combo Service to `SERVICES`
2. Add a rule to `COMBO_RULES` in `lib/mock-data.ts` with `requires` and `excludes` regexes
3. Update `findBestComboServiceMatch` if the matching logic needs more nuance

### Add a clarification question

1. Add the question shape in `getClarifyingQuestion` in `lib/parse-intent.ts`
2. Add option keys to `CLARIFICATION_MATCHERS` for free-text mapping
3. Handle the keys in `handleClarifyTap` in `app/mia/page.tsx`

---

## 11. Anything else?

Open this project in VS Code, run `npm install`, then `npm run dev`. Visit `/mia` to see the main flow. The codebase is heavily commented — every non-obvious decision has a `// Brief: ...` reference explaining why it works that way.

When in doubt: `parse-intent.ts` decides what the user meant; `mia/page.tsx` decides what to do about it; `booking-summary.ts` formats anything related to the booking. Stick to that division.
