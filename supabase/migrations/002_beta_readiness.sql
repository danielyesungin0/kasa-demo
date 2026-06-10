-- ============================================================
-- 002_beta_readiness.sql
-- Phase 0+1: provider slug, onboarding/publish state, future-paywall
-- fields, per-provider service config + unsupported rules.
--
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query).
-- Idempotent — safe to re-run.
-- ============================================================

-- ── 1. Extend stylists ───────────────────────────────────────────────────────
alter table public.stylists
  add column if not exists slug                  text,
  add column if not exists onboarding_complete   boolean not null default false,
  add column if not exists published             boolean not null default false,
  add column if not exists instagram_handle      text,
  add column if not exists handoff_email         text,
  add column if not exists handoff_email_enabled boolean not null default false,
  add column if not exists plan                  text not null default 'beta',
  add column if not exists subscription_status   text not null default 'trialing',
  add column if not exists trial_started_at      timestamptz,
  add column if not exists trial_ends_at         timestamptz;

-- Unique slug, but allow multiple NULLs (partial index). Only enforces
-- uniqueness on rows that actually have a slug set.
create unique index if not exists stylists_slug_key
  on public.stylists (slug) where slug is not null;

-- ── 2. Backfill Shen (the oldest row = the current demo stylist) ─────────────
do $$
declare v_id uuid;
begin
  select id into v_id from public.stylists order by created_at asc limit 1;
  if v_id is null then
    raise notice 'No stylist row — skipping Shen backfill.';
    return;
  end if;
  update public.stylists
     set slug                = coalesce(slug, 'shen'),
         onboarding_complete = true,
         published           = true,
         plan                = 'beta',
         subscription_status = 'trialing',
         trial_started_at    = coalesce(trial_started_at, now())
   where id = v_id;
end;
$$;

-- ── 3. provider_services (per-provider catalog config) ───────────────────────
-- Created now so Phase 2 (de-hardcode the catalog, fix "treatment") can drop
-- in without another migration. NOT read by any code in this phase.
create table if not exists public.provider_services (
  id                  uuid primary key default gen_random_uuid(),
  stylist_id          uuid references public.stylists(id) on delete cascade,
  square_item_id      text,
  square_variation_id text,
  name                text not null,
  category            text,
  price_cents         integer,
  duration_minutes    integer,
  visible_in_chat     boolean not null default true,
  behavior            text not null default 'book'
                        check (behavior in ('book','consultation','handoff','hidden')),
  aliases             text[] not null default '{}',
  chat_description    text,
  created_at          timestamptz default now()
);
alter table public.provider_services enable row level security;
grant all on public.provider_services to service_role;
-- drop-then-create so the migration is re-runnable (policies have no
-- "create ... if not exists" form).
drop policy if exists "provider_services_own" on public.provider_services;
create policy "provider_services_own" on public.provider_services
  for all using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );

-- ── 4. unsupported_rules (per-provider) ──────────────────────────────────────
-- Created now so Phase 4 (per-provider "bleach" rules) can drop in without
-- another migration. NOT read by any code in this phase.
create table if not exists public.unsupported_rules (
  id              uuid primary key default gen_random_uuid(),
  stylist_id      uuid references public.stylists(id) on delete cascade,
  trigger_term    text not null,
  response_type   text not null default 'not_offered'
                    check (response_type in ('not_offered','handoff','consultation','custom')),
  custom_response text,
  created_at      timestamptz default now()
);
alter table public.unsupported_rules enable row level security;
grant all on public.unsupported_rules to service_role;
drop policy if exists "unsupported_rules_own" on public.unsupported_rules;
create policy "unsupported_rules_own" on public.unsupported_rules
  for all using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );
