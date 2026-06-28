# INTEGRATIONS.md

How to connect Square (already done in sandbox — keep it) and the four channels. Each channel
has the same shape: **inbound webhook → normalize into `messages` → outbound send that respects
the channel's reply window.** Build them one at a time; suggested order is SMS → Instagram →
WeChat → KakaoTalk (easiest to hardest).

> These platforms change their rules and API versions often. The facts below are current as of
> mid-2026; **always confirm against the official docs linked at each step before building.**
>
> **Webhook URL:** all four inbound webhooks live on **Supabase Edge Functions**. Put them on a
> **stable URL from day one** — you register it with each platform, and changing it later means
> re-registering across all four. Use a custom domain or a fixed function URL.

---

## Square (booking) — you already have this in sandbox
- **OAuth** to connect the stylist's Square account; store `merchant_id` + `location_id`.
- **Catalog API** → pull services and team members into `services`.
- **Bookings API**: `SearchAvailability` to render real open times (feed the duration-aware
  picker), `CreateBooking` to book. This is the **only** write path to Square.
- **Webhooks**: subscribe to `booking.created` / `booking.updated` / `booking.canceled` to keep
  `appointments` in sync if something changes inside Square.
- Keep **sandbox** until launch. Docs: developer.squareup.com/docs/bookings-api.

---

## SMS — via Twilio (do this first; no messaging window)
- Provision a Twilio number; set its inbound webhook to `webhook-sms`.
- Inbound: Twilio POSTs the message → verify the Twilio signature → upsert client by phone
  (E.164) → write `messages`.
- Outbound: `send-message` calls Twilio's API. **No reply-window restriction** — simplest channel.
- Docs: twilio.com/docs/messaging.

---

## Instagram — Meta Graph API (Messaging)
- Requires an **Instagram Professional (Business/Creator) account** linked to a Facebook Page,
  and a Meta app. Calls go to `graph.facebook.com` (versioned quarterly; verify current version).
- **App Review** is required for the messaging permission (e.g. `instagram_business_manage_messages`)
  before you can message real users at scale — this takes weeks, so start it early. Up to ~25 test
  users work without review during development.
- Inbound: subscribe to the **messages webhook**; Meta POSTs new DMs → verify signature → write `messages`.
- **Reply window: 24 hours** from the client's last message. Each new client message resets it.
  After it closes you cannot free-reply via the API (a human-agent tag allows support replies up
  to 7 days, but model the app around the 24h window). Store `window_expires_at` and, when closed,
  show "Instagram reply window closed — open Instagram" instead of letting a send fail.
- Rate limits exist (a few calls/sec per account; practical hourly caps) — queue/backoff.
- Docs: developers.facebook.com/docs/instagram-platform (Messaging).

---

## WeChat — Official Account (Service Account)
- The stylist needs a **WeChat Official Account of type "Service Account"** (not Subscription),
  **verified** (there's an annual verification fee). For overseas businesses use the Weixin Open
  Platform. Contacts can't be imported — **the client must message the account first.**
- Inbound: configure the OA's server URL + token; WeChat POSTs messages (verify the signature,
  echo the challenge on setup) → write `messages`.
- **Reply window: 48 hours** (the "customer service message" window) from the client's last
  action; resets on each new client message; there's a small cap on messages per window. Outside
  it, only pre-approved template messages are allowed.
- Model the app around the 48h window; when closed, show "WeChat service window closed — open WeChat."
- Docs: developers.weixin.qq.com (Official Account / customer service messages) and open.wechat.com for overseas.

---

## KakaoTalk — Kakao Channel (heaviest; usually via a partner/BSP)
Kakao doesn't expose a single open two-way messaging API like Meta. You need a **Kakao business
Channel** (publicly searchable), and business messaging generally goes through an **authorized
partner / BSP** (e.g. Sinch, Sendbird, Solapi, NHN). Two relevant message types:
- **ConsultationTalk (상담톡)** — two-way chat **after the client starts a conversation** with your
  Channel. This is what powers the inbox thread. Inbound arrives via the partner's webhook → write
  `messages`; outbound replies go back through the partner while the consultation session is open.
- **AlimTalk (알림톡)** — business-initiated, **template-based** notifications (templates must be
  pre-registered and approved). Use only for things like confirmations/reminders, not free chat.
- Setup needs the Channel's search ID + admin phone verification, and template approval for AlimTalk.
- Because of the partner dependency and Korean-language docs, scope this last. Docs:
  developers.kakao.com (Kakao Channel / messages) + your chosen BSP's docs.

---

## Normalization contract (all channels converge here)
Every inbound handler must produce:
- a `client` (matched via `client_identities` on the channel's external user id, or created),
- a `conversation` (per client per channel) with `window_expires_at` set from the channel's rule,
- a `messages` row (`direction:'in'`, provider id for dedupe, media refs).
Every outbound send must: check `window_expires_at`, refuse + surface the honest UI state if
closed, otherwise send and write `direction:'out'`.

## Connection UX
The Settings screen shows the four channels with real state (connected / read-only / connect).
Each "Connect" kicks off that platform's OAuth/setup. Show the window rules plainly so Shen
understands why a thread is sometimes reply-locked.
