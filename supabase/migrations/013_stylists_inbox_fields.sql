-- ============================================================
-- 013_stylists_inbox_fields.sql
-- Phase 2 — add the stylist fields the new inbox app needs that aren't on
-- the live table yet (DATA_MODEL.md): timezone, business_name, location,
-- push-token fields, and a maintained updated_at.
--
-- Additive + guarded. Idempotent. Does not touch existing data.
-- ============================================================

alter table public.stylists
  add column if not exists timezone       text not null default 'America/New_York',
  add column if not exists business_name  text,
  add column if not exists location       text,
  add column if not exists expo_push_token text,   -- Expo Notifications (dev → APNs/FCM later)
  add column if not exists updated_at     timestamptz not null default now();

-- Keep updated_at fresh on write (shared trigger fn).
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

do $$ begin
  create trigger stylists_set_updated_at
    before update on public.stylists
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

-- Apply the same touch trigger to the other mutable inbox tables.
do $$ begin
  create trigger clients_set_updated_at
    before update on public.clients
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger conversations_set_updated_at
    before update on public.conversations
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger channels_set_updated_at
    before update on public.channels
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;

do $$ begin
  create trigger appointments_set_updated_at
    before update on public.appointments
    for each row execute function public.set_updated_at();
exception when duplicate_object then null; end $$;
