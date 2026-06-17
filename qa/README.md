# Kasa QA suite

Lightweight, zero-dependency pre-deploy checks for the chat + booking logic.
Run this before every deploy.

## Run it

```bash
# terminal 1
npm run dev

# terminal 2 (waits ~4s between chat calls to respect the Groq free tier)
npm run qa
```

Exit code `0` = all passed, `1` = a failure, `2` = suite crashed (dev server not up).

## What it covers

Hits the local dev server against the live DB, asserting on the structured JSON
from `/api/chat` and `/api/availability` (slug `shen-test`):

- **Fake availability** — no slots on closed days (Mon/Wed for shen-test)
- **Closed-day contradiction** — chat says "closed", never offers a closed day
- **Service recommendation** — "haircut" maps to a cut service
- **Unsupported service** — "bleach"/"balayage" not wrongly confirmed
- **Multi-person** — group request detected / routed
- **Handoff routing** — explicit human request → `needsHumanHandoff`
- **Booking-flow contract** — slot shape the UI depends on is present
- **Rate-limit fallback** — never a raw error; any busy fallback offers handoff

## Config (env vars)

- `QA_BASE_URL`  (default `http://localhost:3000`)
- `QA_SLUG`      (default `shen-test`)
- `QA_THROTTLE_MS` (default `4000`) — delay between chat calls

## Notes / limits

- The rate-limit test is **environment-dependent**: if the Groq limit doesn't
  trip during the run, that path is skipped (not failed) — the invariant
  ("never a raw error") is still asserted every run.
- Chat assertions tolerate the graceful fallback (`source: "fallback"`) so a
  transient rate limit never produces a false failure.
- This is **logic/contract** QA. End-to-end UI booking (click service → time →
  confirm) is a separate Playwright layer — add when you want UI regression
  coverage.
