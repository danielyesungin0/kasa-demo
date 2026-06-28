-- ============================================================
-- 009_baseline_untracked_tables.sql
-- Phase 2 — make the schema SELF-REBUILDABLE from zero.
--
-- The base `stylists` table (and two later tables) were created in the
-- Supabase UI and never captured in a migration, so a fresh DB built from
-- migrations 001..008 alone would FAIL (001 references stylists). This
-- migration defensively (re)creates `stylists` with the columns that exist
-- live today, using `create table if not exists` + `add column if not exists`
-- so it is a NO-OP against the current live DB but lets a from-zero rebuild
-- succeed.
--
-- It does NOT touch data. Idempotent — safe to re-run.
-- ============================================================

-- ── stylists (the app owner) ────────────────────────────────────────────────
create table if not exists public.stylists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid,
  created_at  timestamptz default now()
);

-- Columns as they exist live today (each guarded; no-op where present).
alter table public.stylists
  add column if not exists user_id                 uuid,
  add column if not exists name                    text,
  add column if not exists email                   text,
  add column if not exists square_merchant_id      text,
  add column if not exists square_location_id      text,
  add column if not exists square_team_member_id   text,
  add column if not exists square_access_token      text,
  add column if not exists square_refresh_token     text,
  add column if not exists square_token_expires_at  timestamptz,
  add column if not exists service_catalog          jsonb default '{}'::jsonb,
  add column if not exists square_business_name      text,
  add column if not exists square_location_name      text,
  add column if not exists square_team_member_name   text,
  add column if not exists display_name              text,
  add column if not exists slug                      text,
  add column if not exists onboarding_complete       boolean not null default false,
  add column if not exists published                 boolean not null default false,
  add column if not exists instagram_handle          text,
  add column if not exists handoff_email             text,
  add column if not exists handoff_email_enabled     boolean not null default false,
  add column if not exists plan                      text not null default 'beta',
  add column if not exists subscription_status       text not null default 'trialing',
  add column if not exists trial_started_at          timestamptz,
  add column if not exists trial_ends_at             timestamptz,
  add column if not exists last_synced_at            timestamptz;

alter table public.stylists enable row level security;
grant all on public.stylists to service_role;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stylists_user_id_key' and conrelid = 'public.stylists'::regclass
  ) then
    alter table public.stylists add constraint stylists_user_id_key unique (user_id);
  end if;
end $$;

create unique index if not exists stylists_slug_key
  on public.stylists (slug) where slug is not null;

drop policy if exists "stylists_own" on public.stylists;
create policy "stylists_own" on public.stylists
  for all using (user_id = auth.uid());

-- ── analytics_events (untracked; legacy — dropped in 014, baselined here so a
--    from-zero rebuild matches today's live DB before the drop runs) ──────────
create table if not exists public.analytics_events (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz default now()
);
alter table public.analytics_events enable row level security;
grant all on public.analytics_events to service_role;

-- ── handoff_requests (untracked; legacy — dropped in 014) ───────────────────
create table if not exists public.handoff_requests (
  id          uuid primary key default gen_random_uuid(),
  stylist_id  uuid references public.stylists(id) on delete cascade,
  created_at  timestamptz default now()
);
alter table public.handoff_requests enable row level security;
grant all on public.handoff_requests to service_role;
