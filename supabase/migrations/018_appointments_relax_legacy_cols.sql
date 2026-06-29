-- ============================================================
-- 018_appointments_relax_legacy_cols.sql
-- Phase 3 — make the legacy denormalized columns on `appointments` nullable.
--
-- appointments was renamed from `bookings` (migration 011), which carried
-- customer_name / customer_phone / service_id / service_name as NOT NULL from
-- the old client-facing flow. The new app inserts appointments with
-- client_id / service_id (uuid) instead, so those legacy NOT NULLs block every
-- new insert — including square-create-booking's mirror and the calendar seed.
--
-- Drop the NOT NULL constraints (keep the columns for the 1 migrated test row
-- until a later cleanup drops them entirely). Idempotent.
-- ============================================================

do $$
begin
  -- service_id was text NOT NULL in the old schema; the new code adds a uuid
  -- service_id (011) and uses provider_services. Relax the old text column.
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='appointments'
               and column_name='customer_name') then
    alter table public.appointments alter column customer_name drop not null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='appointments'
               and column_name='customer_phone') then
    alter table public.appointments alter column customer_phone drop not null;
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='appointments'
               and column_name='service_name') then
    alter table public.appointments alter column service_name drop not null;
  end if;
  -- The old `bookings` table had service_id as text NOT NULL; migration 011's
  -- `add column if not exists service_id uuid` was a no-op (column already
  -- existed), so the legacy text NOT NULL persists and blocks new inserts.
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='appointments'
               and column_name='service_id') then
    alter table public.appointments alter column service_id drop not null;
  end if;
end $$;
