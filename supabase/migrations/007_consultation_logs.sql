-- ============================================================
-- 007_consultation_logs.sql
-- Phase 2 FOUNDATION: instrumentation for the future "Questions Clients Asked"
-- dashboard. This is a SENSOR (raw observations) — the dashboard + provider
-- approve/edit/reuse come later and READ from this table. No PII, no thread
-- reconstruction, no customer-facing change.
-- Run in Supabase SQL Editor.
-- ============================================================

create table if not exists public.consultation_logs (
  id              uuid primary key default gen_random_uuid(),
  stylist_id      uuid references public.stylists(id) on delete cascade,

  -- WHAT was asked. `question` = trimmed client message (verbatim, truncated
  -- in app code). `question_norm` = lowercased + whitespace-collapsed, used to
  -- GROUP frequency ("38 people asked …").
  question        text not null,
  question_norm   text not null,

  -- HOW the assistant classified + answered it.
  intent          text,   -- consultation | service_guidance | faq | booking | handoff | unsupported | unknown
  question_type   text,   -- price | duration | hours | location | other | null
  answer          text,   -- the reply given (so providers can later approve/edit it)

  -- HOW WELL it went (struggle + escalation signals).
  confidence      real,            -- 0..1, null if unavailable
  needs_handoff   boolean default false, -- "would've benefited from Send to Shen"
  source          text,            -- ai | cached | deterministic-fallback | fallback

  created_at      timestamptz default now()
);

alter table public.consultation_logs enable row level security;
grant all on public.consultation_logs to service_role;

-- Provider can read ONLY their own rows (dashboard later). Writes are
-- service-role only (the chat route), never the client.
create policy "consultation_logs_own_read" on public.consultation_logs
  for select using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );

-- Indexes for the future dashboard reads.
create index if not exists consultation_logs_stylist_time
  on public.consultation_logs (stylist_id, created_at desc);
create index if not exists consultation_logs_stylist_norm
  on public.consultation_logs (stylist_id, question_norm);   -- frequency grouping
create index if not exists consultation_logs_stylist_intent
  on public.consultation_logs (stylist_id, intent);
