-- 025 — SMS as a first-class channel: data model only (no live provider yet).
-- Provider-agnostic by design (Twilio first, swappable later) — nothing here
-- names a vendor.
--
-- SMS introduces two concepts the other channels don't have:
--   1) Legal opt-out (STOP) — we must never message a client who opted out.
--   2) A per-tenant sending number + a carrier-registration lifecycle
--      (A2P 10DLC), which is async and can be pending/rejected.

-- ── 1) Opt-out: legal STOP handling, keyed by client (per stylist). ──────────
-- A small table (not just a bool) so we keep when/why and can support re-opt-in
-- (START). Phone is stored E.164 so it matches client_identities for SMS.
create table if not exists public.sms_optouts (
  id           uuid primary key default gen_random_uuid(),
  stylist_id   uuid not null references public.stylists(id) on delete cascade,
  client_id    uuid references public.clients(id) on delete set null,
  phone        text not null,                 -- E.164 (e.g. +14155550123)
  opted_out    boolean not null default true, -- false after START re-opt-in
  reason       text,                          -- 'STOP' | 'manual' | ...
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (stylist_id, phone)
);
alter table public.sms_optouts enable row level security;
grant all on public.sms_optouts to service_role;
grant select, insert, update on public.sms_optouts to authenticated;

-- Owner-scoped RLS (same pattern as other app tables: stylist.user_id = auth.uid).
drop policy if exists "sms_optouts_own" on public.sms_optouts;
create policy "sms_optouts_own" on public.sms_optouts
  for all to authenticated
  using (stylist_id in (select id from public.stylists where user_id = auth.uid()))
  with check (stylist_id in (select id from public.stylists where user_id = auth.uid()));

-- ── 2) SMS sending-number + registration lifecycle on the channels row. ──────
-- channels.external_account_id already holds the per-tenant number (E.164).
-- Add provider-agnostic metadata so we can model provisioning + A2P review and
-- support BOTH provisioned and ported (bring-your-own) numbers later.
alter table public.channels
  add column if not exists sms_provider        text,   -- 'twilio' | 'telnyx' | ... (null until chosen)
  add column if not exists sms_number          text,   -- E.164 sending number
  add column if not exists sms_number_source   text,   -- 'provisioned' | 'ported'
  add column if not exists sms_registration    text,   -- 'none'|'provisioning'|'pending_review'|'approved'|'rejected'
  add column if not exists sms_registration_detail text; -- human-readable status/why

comment on column public.channels.sms_registration is
  'A2P 10DLC (or equiv) carrier-registration lifecycle for SMS; async + can be rejected.';
