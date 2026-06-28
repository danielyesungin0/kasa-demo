# INTEGRATIONS.md

How to connect Square (already coded, sandbox — keep it) and the messaging channels. Each channel
has the same shape: **inbound webhook → normalize into `messages` → outbound send that respects
the channel's reply window.**

> **No respond.io / no aggregator.** Core messaging is **built custom** so we own channel auth,
> webhooks, outbound, storage, tenant isolation, AI enrichment, and fallback logic. See
> `DECISIONS.md` #8. (KakaoTalk may still need a partner/BSP — the one pragmatic exception.)
>
> **Webhook URL:** all inbound webhooks live on **Supabase Edge Functions** on a **stable URL from
> day one** — you register it with each platform, and changing it later means re-registering.

> These platforms change rules and API versions often. Facts below are current as of mid-2026;
> always confirm against the official docs before building.

---

## MVP channel scope + ordering (supersedes the old "SMS first")

**First release = Instagram + WeChat, together.** Those are the channels Shen's clients actually
use, so both must work for the MVP to be real. Then SMS, then KakaoTalk.

| Channel | MVP? | Build | Real gate (watch this, not the code) |
|---|---|---|---|
| **Instagram** | ✅ MVP | Direct Meta Graph API, custom | **Meta App Review** for messaging permission — weeks. **Parallel track, start NOW.** |
| **WeChat** | ✅ MVP | Official Account (verified Service Account), custom webhook | **Obtaining a verified Service Account** for this business — flag early. |
| **SMS (Twilio)** | ⛔ Deferred | Twilio, custom | Carrier registration/approval (A2P 10DLC) is slow + strict. Tech is easy; add when chosen. |
| **KakaoTalk** | ⛔ Post-MVP | Likely partner/BSP | No clean open 2-way API; separate provider decision later. |

**Parallel tracks to start immediately (not Phase-4 tasks):**
- **Meta App Review** for the Instagram messaging permission.
- **WeChat verified Service Account** acquisition — confirm it's even obtainable for this business.

---

## Square (booking) — already coded in sandbox; keep it
- **OAuth** to connect the stylist's Square account; store `merchant_id` + `location_id`.
- **Catalog API** → pull services/team members into `services` (`provider_services` + `services` view).
- **Bookings API**: `SearchAvailability` (feeds the duration-aware picker), `CreateBooking` to book.
  This is the **only** write path to Square (`square-create-booking`).
- **Webhooks**: subscribe to `booking.created/updated/canceled` to keep `appointments` in sync.
- Keep **sandbox** until launch. Docs: developer.squareup.com/docs/bookings-api.

---

## Instagram — Meta Graph API (Messaging) — MVP, custom, App Review in parallel NOW
- Requires an **Instagram Professional (Business/Creator) account** linked to a Facebook Page,
  and a Meta app. Calls go to `graph.facebook.com` (versioned quarterly; verify current version).
- **App Review** is required for the messaging permission (e.g. `instagram_business_manage_messages`)
  before messaging real users at scale — **weeks; start now as a parallel track.** Up to ~25 test
  users work without review during development (enough to build + demo).
- Inbound: subscribe to the **messages webhook**; verify signature → write `messages`.
- **Reply window: 24 hours** from the client's last message; resets on each new client message.
  Store `window_expires_at`; when closed, show "Instagram reply window closed — open Instagram"
  instead of letting a send fail.
- Rate limits exist — queue/backoff.
- Docs: developers.facebook.com/docs/instagram-platform (Messaging).

---

## WeChat — Official Account (Service Account) — MVP, custom; verify the account gate EARLY
- Needs a **WeChat Official Account of type "Service Account"** (not Subscription), **verified**
  (annual verification fee). Overseas → Weixin Open Platform / open.wechat.com. Contacts can't be
  imported — **the client must message the account first.**
- ⚠️ **Real gate:** confirm a *verified* Service Account is actually obtainable for this business
  before sinking time into code. This, not the integration, is the risk.
- Inbound: configure the OA server URL + token; verify signature, echo the challenge on setup →
  write `messages`.
- **Reply window: 48 hours** (customer-service-message window) from the client's last action;
  resets on each new client message; small per-window cap. Outside it, only pre-approved template
  messages. When closed, show "WeChat service window closed — open WeChat."
- Docs: developers.weixin.qq.com / open.wechat.com.

---

## SMS — Twilio — DEFERRED (easiest tech, slow approval)
- Provision a Twilio number; inbound webhook → verify Twilio signature → upsert client by phone
  (E.164) → write `messages`. Outbound via Twilio API. **No reply-window restriction.**
- Deferred only because **A2P 10DLC carrier registration is slow + strict.** Drop-in once chosen.
- Docs: twilio.com/docs/messaging.

---

## KakaoTalk — Kakao Channel — POST-MVP (likely needs a partner/BSP)
- No single open two-way API. Needs a **Kakao business Channel** + usually an authorized
  **partner/BSP** (Sinch, Sendbird, Solapi, NHN). This is the one allowed exception to the
  build-custom rule — decided separately when we reach it.
- **ConsultationTalk** = two-way chat after the client initiates (powers the thread).
  **AlimTalk** = template-based business-initiated notifications (confirmations/reminders only).
- Docs: developers.kakao.com + chosen BSP.

---

## Normalization contract (all channels converge here)
Every inbound handler must:
1. **Write the message first** — match/create `client` (via `client_identities` on the channel's
   external user id), match/create the `conversation` (per client per channel) with
   `window_expires_at` set from the channel rule, insert the `messages` row (`direction:'in'`,
   provider id for dedupe, media refs), and log raw payload to `webhook_events`.
2. **THEN call `parse-intent`** to enrich `conversations.intent` + `intent_payload`.
   **Never block ingestion on the AI call** — a slow/failed Claude call must never drop a message
   (see `DECISIONS.md` #12).

Every outbound send must: check `window_expires_at`, refuse + surface the honest UI state if
closed, otherwise send and write `direction:'out'`.

## Connection UX
Settings shows each channel with real state (connected / read-only / connect). Each "Connect"
kicks off that platform's OAuth/setup. Show the window rules plainly so Shen understands why a
thread is sometimes reply-locked.
