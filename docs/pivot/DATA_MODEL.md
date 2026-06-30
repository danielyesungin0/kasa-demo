# Kasa Data Model — Tattoo Intake (MVP)

Postgres (Supabase). MVP-friendly: a handful of tables, owner-scoped RLS for
artist data, **public insert** for client submissions (the intake is unauthed).
Reuses the existing Supabase project + Storage.

## Entities (overview)
- `artists` — the user/account (1:1 with a Supabase auth user)
- `artist_profiles` — public profile shown at kasa.ink/<handle>
- `intake_forms` — per-artist intake configuration (one active form per artist)
- `intake_questions` — optional custom questions (beyond the standard steps)
- `policies` — deposit / cancellation / consent text per artist
- `tattoo_requests` — a client submission (the core row)
- `request_images` — uploaded reference + placement photos (Storage refs)
- `ai_summaries` — the generated brief + extracted fields + flags
- `request_status_events` — status history (audit + board moves)
- `artist_notes` — private notes on a request
- `suggested_replies` — AI-suggested reply variants per request
- `client_contacts` — lightweight client identity (dedupe repeat clients)

## Schema (MVP DDL sketch)

```sql
-- ARTIST ACCOUNT ----------------------------------------------------------
create table artists (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid unique references auth.users(id) on delete cascade,
  handle      text unique not null,        -- kasa.ink/<handle>
  email       text,
  created_at  timestamptz not null default now()
);

-- PUBLIC PROFILE (shown on the link page) ---------------------------------
create table artist_profiles (
  artist_id      uuid primary key references artists(id) on delete cascade,
  display_name   text not null,
  instagram      text,
  studio         text,
  location       text,
  bio            text,
  style_tags     text[] default '{}',      -- fineline, blackwork, ornamental...
  booking_status text,                      -- "Books open for July & August"
  avatar_url     text,
  accent         text,                      -- optional per-artist accent color
  updated_at     timestamptz not null default now()
);

-- INTAKE CONFIG -----------------------------------------------------------
-- A single config row per artist (toggles for the standard steps). Keeping it
-- one row (not a question-per-row engine) keeps MVP simple; custom questions go
-- in intake_questions.
create table intake_forms (
  artist_id              uuid primary key references artists(id) on delete cascade,
  request_types          text[] default '{custom,flash,cover-up,consultation}',
  require_placement_photo boolean default true,
  require_references      boolean default true,
  ask_budget             boolean default true,
  ask_first_tattoo       boolean default true,
  ask_allergies          boolean default false,
  ask_cover_up           boolean default true,
  ask_preferred_dates    boolean default true,
  ask_traveling          boolean default true,
  ask_exact_size         boolean default true,
  ask_general_size       boolean default true,
  require_deposit_ack    boolean default true,
  require_age_confirm    boolean default true,
  updated_at             timestamptz not null default now()
);

create table intake_questions (        -- optional custom questions
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references artists(id) on delete cascade,
  label       text not null,
  type        text not null default 'text',   -- text | choice | boolean
  options     text[],                          -- for choice
  required    boolean default false,
  sort        int default 0
);

create table policies (
  artist_id        uuid primary key references artists(id) on delete cascade,
  deposit_text     text,
  cancellation_text text,
  consent_text     text,
  min_price        int,        -- cents
  hourly_rate      int,        -- cents, optional
  budget_ranges    text[] default '{"<$200","$200–500","$500–1000","$1000+"}',
  updated_at       timestamptz not null default now()
);

-- CLIENT + REQUEST --------------------------------------------------------
create table client_contacts (
  id          uuid primary key default gen_random_uuid(),
  artist_id   uuid not null references artists(id) on delete cascade,
  name        text,
  email       text,
  phone       text,
  instagram   text,
  created_at  timestamptz not null default now(),
  unique (artist_id, email)        -- soft dedupe of repeat clients
);

create table tattoo_requests (
  id            uuid primary key default gen_random_uuid(),
  artist_id     uuid not null references artists(id) on delete cascade,
  client_id     uuid references client_contacts(id) on delete set null,
  -- denormalized client basics (the submission is the source of truth)
  client_name   text not null,
  client_email  text,
  client_phone  text,
  client_instagram text,
  pronouns      text,
  age_confirmed boolean default false,
  -- request content
  request_type  text,            -- custom | flash | cover-up | consultation
  concept       text,            -- free text idea
  style         text,            -- style direction
  meaning       text,            -- optional
  placement     text,            -- body area
  placement_notes text,
  size_value    text,            -- "48cm x 18cm" or "palm-sized"
  size_system   text,            -- cm | in | guided
  preferred_dates text,
  flexible_timing boolean,
  traveling     boolean,
  budget        text,            -- range string or "not sure"
  is_first_tattoo boolean,
  allergies     text,
  -- raw + housekeeping
  answers       jsonb,           -- full raw submission incl. custom questions
  status        text not null default 'new',  -- see statuses below
  priority      text default 'normal',         -- low | normal | high
  submitted_at  timestamptz not null default now()
);
-- statuses: new | needs_info | ready_to_quote | deposit_needed |
--           booked_external | declined | archived

create table request_images (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references tattoo_requests(id) on delete cascade,
  url         text not null,        -- Supabase Storage public URL
  kind        text default 'reference', -- reference | placement
  category    text,                  -- style | composition | subject | placement | past_work | color
  sort        int default 0
);

-- AI ----------------------------------------------------------------------
create table ai_summaries (
  request_id    uuid primary key references tattoo_requests(id) on delete cascade,
  brief         text,            -- the human paragraph
  extracted     jsonb,           -- normalized fields the AI pulled
  missing_info  text[] default '{}',
  risk_flags    text[] default '{}',   -- under_18 | ai_art | scope_budget | vague
  next_action   text,
  model         text,
  created_at    timestamptz not null default now()
);

create table suggested_replies (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references tattoo_requests(id) on delete cascade,
  body        text not null,
  tone        text,             -- matches artist's configured tone
  sort        int default 0
);

-- WORKFLOW ----------------------------------------------------------------
create table request_status_events (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references tattoo_requests(id) on delete cascade,
  from_status text,
  to_status   text not null,
  created_at  timestamptz not null default now()
);

create table artist_notes (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references tattoo_requests(id) on delete cascade,
  body        text not null,
  created_at  timestamptz not null default now()
);
```

## RLS posture (MVP)
- **Artist-owned tables** (`artist_profiles`, `intake_forms`, `policies`,
  `tattoo_requests` read, `ai_summaries`, notes, etc.): RLS `using (artist_id in
  (select id from artists where user_id = auth.uid()))`. (Same pattern the old app
  used — needs GRANTs to `authenticated`, see the old RLS lesson.)
- **Public read** of `artist_profiles` + `intake_forms` + `policies` for the
  intake page (anon can read an artist's public config by handle).
- **Public INSERT** into `tattoo_requests` + `request_images` + `client_contacts`
  (the client is unauthed). Lock down with: insert-only, no select, rate-limited
  via an Edge Function (`submit-request`) rather than raw client insert — safer
  than open anon insert on the table. **Recommended: submissions go through an
  Edge Function, not direct anon insert.**
- `ai_summaries` / `suggested_replies` written by the `generate-brief` Edge
  Function (service role).

## Storage
- Bucket `request-images` (public read so the brief/detail can render; write via
  the submit Edge Function or signed upload). Namespaced `<artist>/<request>/…`.

## Notes
- `answers jsonb` keeps the raw submission verbatim (source of truth) so the AI
  and the "raw submission" view never lose anything, even as the form evolves.
- Statuses are a string enum (simple) + `request_status_events` for history/board
  analytics later.
- `client_contacts` is intentionally light — dedupe + "returning client" later;
  not a CRM.
