-- ============================================================
-- 001_booking_mvp.sql
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query)
-- ============================================================

-- ── 1. Fix stylists table permissions (if not already done) ──────────────────
grant all on public.stylists to service_role;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'stylists_user_id_key' and conrelid = 'public.stylists'::regclass
  ) then
    alter table public.stylists add constraint stylists_user_id_key unique (user_id);
  end if;
end;
$$;

-- ── 2. stylist_availability ──────────────────────────────────────────────────
create table if not exists public.stylist_availability (
  id           uuid primary key default gen_random_uuid(),
  stylist_id   uuid references public.stylists(id) on delete cascade,
  day_of_week  integer not null check (day_of_week between 0 and 6),
  start_time   text not null,   -- "10:00"
  end_time     text not null,   -- "19:30"
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

alter table public.stylist_availability enable row level security;
grant all on public.stylist_availability to service_role;

create policy "stylist_availability_own" on public.stylist_availability
  for all using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );

-- ── 3. blocked_times ─────────────────────────────────────────────────────────
create table if not exists public.blocked_times (
  id          uuid primary key default gen_random_uuid(),
  stylist_id  uuid references public.stylists(id) on delete cascade,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  reason      text,
  created_at  timestamptz default now()
);

alter table public.blocked_times enable row level security;
grant all on public.blocked_times to service_role;

create policy "blocked_times_own" on public.blocked_times
  for all using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );

-- ── 4. bookings ──────────────────────────────────────────────────────────────
create table if not exists public.bookings (
  id                 uuid primary key default gen_random_uuid(),
  stylist_id         uuid references public.stylists(id) on delete cascade,
  square_booking_id  text,
  customer_name      text not null,
  customer_phone     text not null,
  customer_email     text,
  service_id         text not null,
  service_name       text not null,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  status             text not null default 'confirmed',
  notes              text,
  created_at         timestamptz default now()
);

alter table public.bookings enable row level security;
grant all on public.bookings to service_role;

create policy "bookings_own" on public.bookings
  for all using (
    stylist_id in (select id from public.stylists where user_id = auth.uid())
  );

-- ── 5. Seed default availability for Shen Hair Studio ────────────────────────
-- We target the single stylist row that exists; adjust the subquery if you
-- have multiple rows.  This is idempotent — re-running skips if rows exist.

do $$
declare
  v_stylist_id uuid;
begin
  select id into v_stylist_id from public.stylists limit 1;
  if v_stylist_id is null then
    raise notice 'No stylist row found — skipping availability seed.';
    return;
  end if;

  -- Only insert if no availability rows exist yet for this stylist
  if exists (
    select 1 from public.stylist_availability where stylist_id = v_stylist_id
  ) then
    raise notice 'Availability already seeded — skipping.';
    return;
  end if;

  -- 0 = Sun, 1 = Mon, 2 = Tue, 3 = Wed, 4 = Thu, 5 = Fri, 6 = Sat
  insert into public.stylist_availability (stylist_id, day_of_week, start_time, end_time, is_active) values
    (v_stylist_id, 0, '12:00', '19:00', true),   -- Sunday
    (v_stylist_id, 1, '10:00', '19:30', false),  -- Monday (closed)
    (v_stylist_id, 2, '10:00', '19:30', true),   -- Tuesday
    (v_stylist_id, 3, '10:00', '19:30', false),  -- Wednesday (closed)
    (v_stylist_id, 4, '10:00', '19:30', true),   -- Thursday
    (v_stylist_id, 5, '10:00', '19:30', true),   -- Friday
    (v_stylist_id, 6, '10:00', '19:30', true);   -- Saturday
end;
$$;

-- ── 6. Seed mock busy blocks ──────────────────────────────────────────────────
-- Uses the nearest upcoming occurrence of each weekday from today.
-- All times are America/New_York. Adjust the dates if needed.

do $$
declare
  v_stylist_id uuid;
begin
  select id into v_stylist_id from public.stylists limit 1;
  if v_stylist_id is null then
    raise notice 'No stylist row — skipping blocked_times seed.';
    return;
  end if;

  if exists (
    select 1 from public.blocked_times where stylist_id = v_stylist_id
  ) then
    raise notice 'blocked_times already seeded — skipping.';
    return;
  end if;

  insert into public.blocked_times (stylist_id, starts_at, ends_at, reason) values
    -- Tuesday 2026-05-05
    (v_stylist_id, '2026-05-05 10:00:00-04', '2026-05-05 11:00:00-04', 'Short Hair Cut'),
    (v_stylist_id, '2026-05-05 12:00:00-04', '2026-05-05 13:00:00-04', 'Short Hair Cut'),
    (v_stylist_id, '2026-05-05 14:30:00-04', '2026-05-05 15:45:00-04', 'Medium/Long Hair Cut'),
    -- Thursday 2026-05-07
    (v_stylist_id, '2026-05-07 10:30:00-04', '2026-05-07 11:30:00-04', 'Short Hair Cut'),
    (v_stylist_id, '2026-05-07 14:00:00-04', '2026-05-07 15:30:00-04', 'Milbon Treatment'),
    -- Friday 2026-05-08
    (v_stylist_id, '2026-05-08 12:00:00-04', '2026-05-08 13:00:00-04', 'Short Hair Cut'),
    (v_stylist_id, '2026-05-08 15:15:00-04', '2026-05-08 16:30:00-04', 'Medium/Long Hair Cut'),
    -- Saturday 2026-05-09
    (v_stylist_id, '2026-05-09 11:30:00-04', '2026-05-09 13:00:00-04', 'Hair Cut + Down Perm'),
    (v_stylist_id, '2026-05-09 14:00:00-04', '2026-05-09 16:30:00-04', 'Keratin Treatment'),
    (v_stylist_id, '2026-05-09 17:15:00-04', '2026-05-09 18:30:00-04', 'Medium/Long Hair Cut');
end;
$$;
