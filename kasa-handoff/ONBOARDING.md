# ONBOARDING.md

How a stylist gets from "downloaded Kasa" to "messages flowing in." The interactive reference is
**`onboarding-reference.html`** (keep it at `design/onboarding-reference.html`) — open it to see the
exact flow, states, and copy. This doc explains the *why* and the real-world gotchas the prototype
can only hint at.

---

## The one distinction that matters: two different "logins"
These get conflated constantly. They are separate systems and separate screens.

1. **Auth — Shen logging into Kasa.** "Who is using the app." Handled by **Supabase Auth** (already
   set up). Easy, mostly done.
2. **Channel linking — connecting Shen's Instagram / WeChat / Square *to* Kasa.** "What accounts
   Kasa is allowed to act on." A series of per-platform OAuth/authorize flows that happen *inside*
   the app, *after* she's logged in. This is the hard, slow part — and it has nothing to do with
   how she logs into Kasa.

Design implication: she signs in once, then lands on a **Connect your accounts** screen. That
screen is the onboarding gate, and it's the *same component* as Settings → Channels — just shown
proactively the first time.

---

## Part 1 — Auth (easy)
- **Email + password**, **Continue with Google**, **Continue with Apple** — all via Supabase Auth
  (Google + Apple are OAuth providers you enable in the Supabase dashboard + provider consoles).
- **Apple Sign In is effectively required** by App Store review if you offer Google sign-in on iOS.
  So ship all three.
- Supabase issues the session JWT the app sends to the Edge Functions (`verify_jwt = true` on
  `square-create-booking` etc. already relies on this).
- That's basically it. Don't overbuild auth — the real work is Part 2.

## Part 2 — Connect accounts (the actual work)
The **Connect your accounts** screen is a checklist with real connection state per provider. Kasa
shouldn't behave as "ready" until the gate is met:

> **Gate to enter the app: Square connected + at least one message channel connected.**

For MVP that channel is Instagram or WeChat. Each row kicks off that platform's flow and writes a
row to the `channels` table (`connected`, `external_account_id`, `credentials_ref` → encrypted
token, never the raw token). Connection states to represent: **idle → connecting → connected**, plus
**action-needed** (e.g. token expired → "Reconnect", or "pending review"). The prototype shows
idle/connecting/connected; build the action-needed state too, since tokens expire.

### Square (booking) — the easy connect
- Standard **OAuth**: tap Connect → Square authorize screen → grant **Bookings + Catalog** scopes →
  back to Kasa, connected. Show the merchant + location once linked.
- **Use Square sandbox through all of development and beta.** The sandbox has its own dashboard
  where test bookings appear exactly like production — that *is* your "did it show up on Square's
  end" check. Switch credentials to production only at launch. Never test booking writes on prod.
- The plumbing (OAuth, token refresh, encryption) is already ported into the functions.

### Instagram (MVP channel #1) — the long pole
Direct **Meta Graph API**, built ourselves (no third-party middleman). Requirements Shen must have,
which the onboarding has to check/guide:
- An **Instagram Professional account** (Business or Creator), **linked to a Facebook Page**. The
  prototype includes an "I don't have a Professional account" branch with the switch-it steps —
  keep that; many stylists are on personal accounts.
- Connection = Meta OAuth (Facebook Login) → pick the Page/IG account → grant messaging permission.
- **The gate is Meta App Review.** Your Kasa Meta app must pass App Review for the messaging
  permission before it can connect *real* (non-test) users — this takes **weeks to months**, so
  it's started in parallel, not at this step. During beta, add Shen's account as a **test user /
  role** on the Meta app so the flow works before review clears.
- Reply window: **24h** from the client's last message — surface this in-thread, not as a failure.

### WeChat (MVP channel #2) — heavier, gated on the account
Direct integration with a **verified WeChat Official Account (Service Account type)**, built
ourselves. Reality:
- Shen needs a **Service Account** (not Subscription), **verified** (documents + annual fee), and
  **especially involved for overseas businesses** — confirm she can actually obtain one before
  sinking time here.
- Authorization is typically **QR-based** (authorize via the WeChat platform), reflected in the
  prototype. Clients must message her account first; contacts can't be imported.
- Reply window: **48h**. Keep the "I don't have a Service Account" help branch — this is the
  step most likely to stall a real stylist.

### SMS + KakaoTalk — shown, not built (MVP)
The prototype lists these as **"After launch"** so scope is honest on screen. SMS (Twilio) is
technically the *easiest* channel but deferred (Twilio's registration/approval is slow). KakaoTalk
likely needs an authorized partner/BSP, so it's a separate provider decision later.

---

## What the prototype simulates vs. production
The prototype fakes the external OAuth/QR screens so you can feel the flow. In production:
- **Square** → real `connect.squareup.com` authorize screen (sandbox during dev).
- **Instagram** → real Meta permission screen, gated on **App Review**; test users during beta.
- **WeChat** → real WeChat authorization (QR), gated on a **verified Service Account**.
- Use the platforms' **official sign-in buttons** for Google/Apple (the prototype uses generic
  stand-ins to avoid copying brand assets).

## Connection lifecycle (after onboarding)
- Tokens are stored encrypted (`credentials_ref` → the hardened `_shared/crypto.ts`), refreshed by
  the token-refresh helper. When a refresh fails or a user revokes access, flip the channel to
  **action-needed** and prompt **Reconnect** in Settings → Channels. Don't fail silently.
- Disconnect = revoke + clear the `channels` row; keep historical messages.

## Suggested build sequence (fits Phase 3 / 4)
1. **Phase 3 (now):** build auth (email/Google/Apple) + the Connect-accounts **screen and states**,
   wired to the real `channels` table. The Connect buttons can render the full flow even while the
   real platform OAuth is stubbed behind a `TODO(oauth)` seam — same pattern as the webhook
   `TODO(verify)`/`TODO(send)` seams. Reuse the screen as Settings → Channels.
3. **In parallel (you):** Meta App Review, WeChat Service Account, link Square sandbox.
4. **Phase 4:** fill the OAuth seams with the real Meta / WeChat / Square flows; climb to a real
   end-to-end test (real IG DM → Kasa → reply → Square-sandbox booking → calendar).

## Testing the connect flow without the platforms
- **Square:** sandbox end-to-end now (once linked).
- **Instagram/WeChat before approvals:** you can't run real OAuth yet, but you can **seed a
  `channels` row as if connected** and **POST simulated inbound webhook payloads** at your webhook
  functions to exercise everything downstream of the connection. (A per-channel sample-payload kit
  belongs in a `TESTING.md` — worth adding next.)
