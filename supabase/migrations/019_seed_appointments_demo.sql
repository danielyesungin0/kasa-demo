-- ============================================================
-- 019_seed_appointments_demo.sql
-- Phase 3 — realistic SEED appointments so the Calendar (and Today) render
-- true-to-life and the Book sheet has real conflicts to respect.
--
-- Mapped to the demo-seed clients; spread across today + the next few days in
-- America/New_York studio hours. DEMO data — marked source='kasa' and matched
-- to demo clients (themselves tagged demo-seed), so Phase 5 cleanup removes it
-- when the demo clients are deleted (FK on delete). Idempotent: clears prior
-- demo appointments for these clients first.
-- ============================================================

-- Relax the legacy text NOT NULL service_id that migration 018 missed (011's
-- `add column if not exists service_id uuid` was a no-op since the old bookings
-- column existed). Must run before the insert below. Idempotent.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema='public' and table_name='appointments'
               and column_name='service_id') then
    alter table public.appointments alter column service_id drop not null;
  end if;
end $$;

do $$
declare
  v_stylist uuid;
  v_today   date := (now() at time zone 'America/New_York')::date;
begin
  select id into v_stylist from public.stylists order by created_at asc limit 1;
  if v_stylist is null then return; end if;

  -- Reset prior demo appointments for the demo clients (idempotent).
  delete from public.appointments
  where stylist_id = v_stylist
    and client_id in (select id from public.clients where 'demo-seed' = any(tags));

  -- Helper inline: insert one appt by client name + day offset + start/end hour.
  -- (Times are NY wall-clock; stored as timestamptz.)
  insert into public.appointments (stylist_id, client_id, starts_at, ends_at, status, source)
  select v_stylist, c.id,
         ((v_today + off) + st::time) at time zone 'America/New_York',
         ((v_today + off) + et::time) at time zone 'America/New_York',
         'booked', 'square'
  from (values
    ('Sofia Romano', 0, '10:00', '11:00'),  -- today 10–11 gloss
    ('Rachel Kim',   0, '14:00', '15:00'),  -- today 2–3 cut
    ('Hana Lee',     1, '11:00', '12:30'),  -- tomorrow 11–12:30 root touch-up
    ('Mina Park',    2, '13:00', '14:00'),  -- +2d gloss
    ('Emily Chen',   3, '15:00', '18:30')   -- +3d full balayage (3.5h)
  ) as seed(name, off, st, et)
  join public.clients c on c.stylist_id = v_stylist and c.name = seed.name;

  raise notice 'Seeded demo appointments around %', v_today;
end $$;
