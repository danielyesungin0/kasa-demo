# SMS: confirmations + reminders (Twilio)

Booking confirmation and appointment-reminder texts via Twilio. **Off by
default** — nothing is ever sent until you explicitly enable it, exactly like
the `SQUARE_BOOKING_ENABLED` booking kill-switch.

## Cost (real numbers)

| Item | Cost |
|---|---|
| Twilio per SMS (US) | ~$0.0079 |
| Phone number | ~$1.15/mo |
| A2P 10DLC registration | ~$4 one-time + ~$2/mo brand fee (required for real US clients) |
| Per provider, real use (~40 bookings × ~3 texts) | ~$1/mo in messages |

**Testing now costs ~$0:** Twilio's free trial credit (~$15) covers it, and trial
mode only delivers to **verified numbers** (so you can't accidentally text real
clients). Keep `SMS_ENABLED` off in production until A2P registration clears.

## Environment variables

```bash
SMS_ENABLED=true                 # master switch — default OFF. No flag = no-op.
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+15551234567  # your Twilio number
CRON_SECRET=<random string>      # protects the reminder cron endpoint
```

If `SMS_ENABLED` isn't `"true"`, or any Twilio var is missing, all sends are
no-ops — safe to deploy with these unset.

## What sends, and when

- **Confirmation** — fired from `POST /api/bookings` right after a booking is
  saved (fire-and-forget; never blocks or fails the booking). Code: `lib/sms.ts`
  `sendBookingConfirmationSms`.
- **Reminder** — `lib/reminders.ts` `sendDueReminders()` finds confirmed
  bookings in a lookahead window and texts them. Triggered via
  `GET /api/cron/reminders`.

## Testing locally / in trial mode (≈ $0)

1. Create a Twilio trial account; **verify your own phone number** in the console.
2. Set the env vars above (use your trial number for `TWILIO_FROM_NUMBER`).
3. Set `SMS_ENABLED=true`.
4. Make a booking with **your verified number** as the client phone → you get a
   confirmation text (with Twilio's trial prefix).
5. Test reminders manually:
   ```bash
   curl -H "Authorization: Bearer $CRON_SECRET" \
        http://localhost:3000/api/cron/reminders
   ```
   Returns a JSON summary (`candidates`, `sent`). Safe to call with SMS off — it
   reports targets without sending.

## Going live to real clients (later)

1. Complete **A2P 10DLC** brand + campaign registration in the Twilio console
   (takes days–weeks; small fees above). Real US client SMS is blocked/filtered
   without it.
2. **Add a dedup column** before automating reminders: `reminder_sent_at
   timestamptz` on `bookings`, skip rows already stamped, stamp after sending.
   The current scaffold uses a tight time window instead (good for testing, not
   for an indefinitely-running scheduler). Marked `TODO(production dedup)` in
   `lib/reminders.ts`.
3. **Wire the scheduler** — add to `vercel.json`:
   ```json
   { "crons": [{ "path": "/api/cron/reminders", "schedule": "0 * * * *" }] }
   ```
   (hourly). Vercel calls it with the `x-vercel-cron` header, which the route
   accepts without `CRON_SECRET`.
4. Flip `SMS_ENABLED=true` in production.

## Verify which build is live

`GET /api/version` → `{ commit, shortCommit, env }`. Use this to confirm a
deploy is current instead of guessing — e.g.
`curl https://<stable-domain>/api/version`.
