-- ============================================================
-- 011_appointments_from_bookings.sql
-- Phase 2 — evolve the existing `bookings` table into `appointments`
-- (DATA_MODEL.md). One source of truth for Square-mirrored appointments.
--
-- Strategy: RENAME bookings → appointments (preserves the 1 test row + RLS),
-- then ADD the new columns the inbox app needs. Guarded so it is safe whether
-- or not the rename has already happened. Idempotent.
-- ============================================================

do $$
begin
  -- Rename only if the old table exists and the new one doesn't yet.
  if exists (select 1 from pg_tables where schemaname='public' and tablename='bookings')
     and not exists (select 1 from pg_tables where schemaname='public' and tablename='appointments')
  then
    alter table public.bookings rename to appointments;
  end if;
end $$;

-- If neither existed (fresh from-zero build), create appointments outright.
create table if not exists public.appointments (
  id                uuid primary key default gen_random_uuid(),
  stylist_id        uuid references public.stylists(id) on delete cascade,
  square_booking_id text,
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  status            text not null default 'booked',
  created_at        timestamptz default now()
);

-- New columns from DATA_MODEL.md (guarded; no-op if already present).
alter table public.appointments
  add column if not exists client_id             uuid references public.clients(id) on delete set null,
  add column if not exists service_id            uuid,  -- FK added in 012 once services table is stable
  add column if not exists source                text not null default 'kasa',  -- 'kasa' | 'square'
  add column if not exists origin_conversation_id uuid references public.conversations(id) on delete set null,
  add column if not exists updated_at            timestamptz not null default now();

-- The legacy denormalized customer_* / service_* columns from the old
-- client-facing flow are intentionally LEFT IN PLACE for now (the 1 test row
-- uses them). They become redundant once client_id/service_id are populated;
-- a later cleanup migration can drop them once nothing reads them.

-- Normalize status default from the old 'confirmed' to the new 'booked'
-- vocabulary going forward (existing rows untouched).
alter table public.appointments alter column status set default 'booked';

alter table public.appointments enable row level security;
grant all on public.appointments to service_role;
drop policy if exists "bookings_own" on public.appointments;   -- old policy name if it carried over
drop policy if exists "appointments_own" on public.appointments;
create policy "appointments_own" on public.appointments
  for all using (stylist_id in (select id from public.stylists where user_id = auth.uid()));

create index if not exists appointments_stylist_start on public.appointments (stylist_id, starts_at);

-- Realtime so the calendar updates live when a booking is confirmed.
do $$ begin
  alter publication supabase_realtime add table public.appointments;
exception when duplicate_object then null; end $$;
