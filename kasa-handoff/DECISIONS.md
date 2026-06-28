# DECISIONS.md

Resolved choices for the Kasa rebuild. These are settled — don't re-open them without a reason.
Read this before the other docs; where any doc seems to disagree, this wins.

## Locked
1. **Strategy:** Keep the backend *logic*, rewrite the frontend. The old app's value is its
   Square / Supabase / AI code, not its UI.
2. **Frontend:** Full **React Native (Expo)** rewrite for iOS + Android. **None** of the old
   Next.js screens/components are ported — the new app is a stylist-facing inbox, the old one was
   a client-facing booking-chat web page. Build to `DESIGN.md` + `reference-prototype.html`.
3. **Server endpoints:** **Supabase Edge Functions.** The old backend is ~22 Next.js route
   handlers; the useful ones (Square, availability/booking, the one Claude call, plus new channel
   webhooks) get **relocated into Supabase Edge Functions.** One platform for DB + Auth + server
   code + secrets. (Cloudflare Workers would also work; we chose Edge Functions for simplicity.
   No Vercel, no separate web host — there's no web frontend to host.)
4. **Public webhook URL:** lives on Supabase Edge Functions, on a **stable URL from day one**
   (you register it with Instagram/WeChat/Kakao/Twilio and don't want to change it later).
5. **GitHub:** the repo already exists (`github.com/danielyesung/kasa-demo`). **Transfer it to
   the GitHub account that holds your other projects (the down app)** — do not `git init` a new
   one. Reconcile local git identity first (see kickoff Phase 1).
6. **Client-facing "book with me" booking page:** **retired.** In the new product clients never
   book themselves — they message Shen, and she books. Archive that surface; don't port it. (Easy
   to add back later as an online-booking link if ever wanted.)
7. **AI:** keep the single **Claude (Haiku) booking-intent call**; **mine, don't port** the
   ~2,400-line deterministic parser. The new AI job is tiny (see `AI_BEHAVIOR.md`).

## Out of scope for the new app (archive / don't carry forward)
- The Next.js client-facing booking + AI-chat UI.
- Resend email and the SMS-reminder paths (revisit later if wanted).
- Groq (dormant) — remove.

## Still open (decide as you go)
- Exact Supabase project/branch strategy for dev vs prod.
- Whether email/SMS reminders come back as a post-launch feature.
