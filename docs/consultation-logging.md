# Consultation logging (Phase 2 foundation)

Instrumentation that turns the validation period into learning. It records
question-shaped chat turns so that, once Shen + testers have used Kasa for a
bit, you can answer:

- What questions clients ask most often
- Which questions the assistant struggles with (low confidence / degraded source)
- Which questions should become provider-approved answers (high frequency)
- Which moments would have benefited from a "Send to Shen" flow (`needs_handoff`)
- Which consultation categories occur most (`intent` / `question_type`)

It is **instrumentation, not a feature** — no customer-facing change, no
dashboard yet, no change to booking.

## Setup

1. Run the migration `supabase/migrations/007_consultation_logs.sql` in the
   Supabase SQL editor (creates the table + indexes + RLS).
2. That's it. Logging is on by default. The app no-ops safely if the table
   doesn't exist yet, so deploy order doesn't matter.

Env flag (optional): `CONSULTATION_LOGGING_ENABLED=false` disables it.

## What's logged

A row is written ONLY for learning-relevant turns:
- intent ∈ {consultation, service_guidance, faq}, OR
- the turn needed a handoff (escalation opportunity).

Plain bookings, reschedules, cancels, slot picks, confirmations, and greetings
are NOT logged (noise).

Per row: `question` (verbatim, truncated 1000 chars), `question_norm`
(normalized for frequency grouping), `intent`, `question_type`, `answer` (the
reply given), `confidence`, `needs_handoff`, `source`, `created_at`, scoped to
`stylist_id`.

## What's NOT logged (privacy)

- **No PII**: no phone, email, name, or IP — we log *what* was asked, never
  *who* asked. Not tied to a person.
- **No conversation threads**: each row is one Q+A, not a linked session. You
  cannot reconstruct anyone's conversation.
- Booking/details/phone-entry flows are never logged.

## How it sets up the future dashboard

The future "Questions Clients Asked" dashboard is pure READS on this table —
no new capture work:

```sql
-- Top questions by frequency (the dashboard's main list)
select question_norm, count(*) as asked,
       max(question) as example, max(answer) as last_answer
from consultation_logs
where stylist_id = :id
group by question_norm
order by asked desc;

-- Where the assistant struggled
select question, intent, confidence, source
from consultation_logs
where stylist_id = :id and (confidence < 0.5 or source <> 'ai')
order by created_at desc;

-- "Send to Shen" candidates
select question, answer, created_at
from consultation_logs
where stylist_id = :id and needs_handoff = true
order by created_at desc;
```

When Phase 2 full ships, a separate `provider_qa` table holds the *approved*
answers (what Shen blessed); `consultation_logs` stays the *raw observation*
feeding it. Clean separation: logs = what happened, provider_qa = what's approved.
