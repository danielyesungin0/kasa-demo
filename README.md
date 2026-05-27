# Booking Prototype

A simpler booking front-end for solo stylists who use Square. Mock data only, no backend.

**Positioning:** Square stays the source of truth for services, availability, and bookings. This product is the clean, fast, mobile-first link clients actually want to use — replacing the back-and-forth in Instagram, WeChat, KakaoTalk, and SMS.

## Routes

- `/` — Marketing landing page
- `/setup` — 4-step stylist onboarding (Square, services, hours, share)
- `/dashboard` — Stylist dashboard (booking link, Square status, quick replies, appointments, stats)
- `/mia` — Client booking page (the most important screen)

## Setup

### 1. Create the Next.js project

You have two options:

**Option A: Use this folder directly**
```bash
cd booking-prototype
npm install
npm run dev
```

**Option B: Paste into a fresh Next.js project**

```bash
npx create-next-app@14 my-booking-app \
  --typescript --tailwind --app --eslint \
  --src-dir=false --import-alias="@/*"
cd my-booking-app
```

Then copy these files/folders, overwriting any conflicts:

```
app/
  layout.tsx
  globals.css
  page.tsx
  setup/page.tsx
  dashboard/page.tsx
  mia/page.tsx
components/
  PageShell.tsx
  CopyButton.tsx
  ServiceCard.tsx
  TimeSlotCard.tsx
  ProgressSteps.tsx
  AppointmentCard.tsx
  QuickReplyCard.tsx
lib/
  types.ts
  mock-data.ts
  cn.ts
tailwind.config.ts
postcss.config.js
```

### 2. Install dependencies

```bash
npm install
```

The only runtime dependencies are `next`, `react`, `react-dom`. Tailwind, TypeScript, and PostCSS are dev dependencies. No shadcn/ui, no UI libraries.

### 3. Run

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## File map

```
app/
  layout.tsx          Root layout, loads Fraunces + Inter Tight from Google Fonts
  globals.css         Tailwind base + custom CSS vars + fade-up animation
  page.tsx            Landing
  setup/page.tsx      Stylist setup flow (Square → services → hours → share; multi-step, useState only)
  dashboard/page.tsx  Stylist dashboard
  mia/page.tsx        Client booking flow (state machine: home → category → service → time → details → confirmed; also assistant + consultation + custom branches)

components/
  PageShell.tsx       Shared container; variants: marketing, stylist, client (mobile)
  CopyButton.tsx      navigator.clipboard with copied state
  ServiceCard.tsx     Two modes: setup (with status toggle) and select (tap to pick)
  TimeSlotCard.tsx    Two variants: stacked grid card, inline row card
  ProgressSteps.tsx   1-indexed step indicator
  AppointmentCard.tsx Today/upcoming variants
  QuickReplyCard.tsx  Templates with copy button

lib/
  types.ts            Service, TimeSlot, Appointment, QuickReply, Availability
  mock-data.ts        All seeded data (services, slots, appointments, replies, stats)
  cn.ts               className concat util
```

## Where to plug in real systems later

This product is positioned as **a better booking front-end for Square**. Square is the source of truth for services, availability, and appointments. Mock data is centralized in `lib/mock-data.ts` and is shaped to mirror Square's data model.

When the integration ships:

- **Services** → Square Catalog API (`SearchCatalogObjects` for `ITEM` type with `service` variations); replace `SERVICES`
- **Availability/slots** → Square Bookings API (`SearchAvailability`); replace `EARLIEST_SLOTS`, `SERVICE_SLOTS`, `CONSULTATION_SLOTS`
- **Appointments** → Square Bookings API (`SearchBookings` for read, `CreateBooking` for write); replace `TODAY_APPOINTMENTS` / `UPCOMING_APPOINTMENTS`
- **Stylist profile** → Square Locations + Team Members; replace `STYLIST`
- **Stats** → analytics aggregation over Bookings data; replace `DASHBOARD_STATS`
- **Confirm appointment** in `app/mia/page.tsx` `DetailsStage` → POST to a thin Next.js route that calls Square `CreateBooking` before moving to `confirmed` stage
- **Connect Square** in `app/setup/page.tsx` `StepSquare` → real Square OAuth (`oauth/authorize` → token exchange → store refresh token in your DB)

Client-facing data (name, phone, notes) can persist in your own DB (e.g. Supabase) and sync to Square's customer record on booking.

The component shapes are designed to take props directly from Square's response objects with minimal mapping.

## Design notes

- **Palette**: warm cream backgrounds, deep ink for text, muted terracotta accent
- **Type**: Fraunces (serif display) for headings + numbers, Inter Tight for body
- **Mobile-first**: `/mia` capped at 440px; stylist pages widen at lg breakpoint
- **No external UI libs** — every primitive is hand-rolled with Tailwind for clean handoff
- **Copy buttons** use the real `navigator.clipboard` API and show a 1.6s "Copied" state

## Known limitations (prototype scope)

- Time slots are static labels, not real datetimes
- "Add to calendar" on the client confirmation shows an alert instead of generating .ics
- "Connect Square" is a fake state toggle — no real OAuth or API
- "Manage Square connection" on the dashboard is intentionally disabled
- Custom request "Open Instagram" links to instagram.com generically
- No persistence — refreshing resets all state
