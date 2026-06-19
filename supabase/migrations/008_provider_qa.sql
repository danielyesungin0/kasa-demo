-- ============================================================
-- 008_provider_qa.sql
-- Phase 2: PROVIDER-APPROVED ANSWERS.
--
-- consultation_logs (007) = raw observations of what clients asked + how the
-- assistant handled it. This table = what the PROVIDER blessed: a canonical,
-- human-approved answer for a question. Clean separation:
--   logs       = what happened (sensor)
--   provider_qa = what's approved (knowledge base)
--
-- This pass builds approve/edit only. The assistant does NOT yet reuse these
-- answers (that's the next, higher-risk step). No customer-facing change.
-- Run in Supabase SQL Editor (after 007).
-- ============================================================

create table if not exists public.provider_qa (
  id               uuid primary key default gen_random_uuid(),
  stylist_id       uuid not null references public.stylists(id) on delete cascade,

  -- Links an approved answer to a frequency-group from consultation_logs.
  -- Normalized (lowercased + whitespace-collapsed) so it matches the same
  -- grouping key the insights view uses. One approved answer per question.
  question_norm    text not null,

  -- The provider-facing canonical phrasing of the question (editable) and the
  -- provider-approved answer.
  question_display text not null,
  answer           text not null,

  -- Which raw log this was promoted from (nullable, best-effort provenance).
  source_log_id    uuid references public.consultation_logs(id) on delete set null,

  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),

  unique (stylist_id, question_norm)
);

alter table public.provider_qa enable row level security;
grant all on public.provider_qa to service_role;

-- Provider can do everything with their OWN approved answers (read + write).
-- The dashboard writes through the service role after an auth check, but these
-- policies also make the table safe for direct authed access.
create policy "provider_qa_own_select" on public.provider_qa
  for select using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );
create policy "provider_qa_own_insert" on public.provider_qa
  for insert with check (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );
create policy "provider_qa_own_update" on public.provider_qa
  for update using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );
create policy "provider_qa_own_delete" on public.provider_qa
  for delete using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );

create index if not exists provider_qa_stylist
  on public.provider_qa (stylist_id);
