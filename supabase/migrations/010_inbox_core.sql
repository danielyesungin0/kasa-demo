-- ============================================================
-- 010_inbox_core.sql
-- Phase 2 — the NET-NEW inbox data model (the heart of the new app).
-- Tables: channels, clients, client_identities, conversations, messages,
-- webhook_events. See DATA_MODEL.md + INTEGRATIONS.md.
--
-- All owner-scoped by stylist_id with RLS (a stylist sees only her rows).
-- Idempotent — safe to re-run.
-- ============================================================

-- ── enums (guarded creation) ────────────────────────────────────────────────
do $$ begin
  create type channel_type as enum ('instagram','sms','wechat','kakao');
exception when duplicate_object then null; end $$;

do $$ begin
  create type client_value as enum ('high','regular','new');
exception when duplicate_object then null; end $$;

do $$ begin
  create type conversation_intent as enum ('none','booking');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_direction as enum ('in','out','note');
exception when duplicate_object then null; end $$;

do $$ begin
  create type message_status as enum ('sent','delivered','failed');
exception when duplicate_object then null; end $$;

-- ── channels (per-stylist connection to a platform) ─────────────────────────
create table if not exists public.channels (
  id                  uuid primary key default gen_random_uuid(),
  stylist_id          uuid not null references public.stylists(id) on delete cascade,
  type                channel_type not null,
  connected           boolean not null default false,
  external_account_id text,                 -- IG page id / Twilio number / WeChat appid / Kakao channel id
  credentials_ref     text,                 -- pointer to a secret, NEVER the secret itself
  status              text not null default 'disconnected',
  last_sync_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (stylist_id, type)
);
alter table public.channels enable row level security;
grant all on public.channels to service_role;
drop policy if exists "channels_own" on public.channels;
create policy "channels_own" on public.channels
  for all using (stylist_id in (select id from public.stylists where user_id = auth.uid()));

-- ── clients ─────────────────────────────────────────────────────────────────
create table if not exists public.clients (
  id               uuid primary key default gen_random_uuid(),
  stylist_id       uuid not null references public.stylists(id) on delete cascade,
  name             text not null,
  value            client_value not null default 'new',
  since            text,
  visits           integer not null default 0,
  last_appt_at     timestamptz,
  preferences      text,
  notes            text,
  tags             text[] not null default '{}',
  phone            text,
  email            text,
  instagram_handle text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.clients enable row level security;
grant all on public.clients to service_role;
drop policy if exists "clients_own" on public.clients;
create policy "clients_own" on public.clients
  for all using (stylist_id in (select id from public.stylists where user_id = auth.uid()));
create index if not exists clients_stylist on public.clients (stylist_id);

-- ── client_identities (one client → many platform handles) ──────────────────
create table if not exists public.client_identities (
  id               uuid primary key default gen_random_uuid(),
  client_id        uuid not null references public.clients(id) on delete cascade,
  channel_type     channel_type not null,
  external_user_id text not null,           -- IG-scoped id / phone E.164 / WeChat openid / Kakao user key
  display_handle   text,
  created_at       timestamptz not null default now(),
  unique (channel_type, external_user_id)   -- powers duplicate-merge
);
alter table public.client_identities enable row level security;
grant all on public.client_identities to service_role;
drop policy if exists "client_identities_own" on public.client_identities;
create policy "client_identities_own" on public.client_identities
  for all using (
    client_id in (
      select c.id from public.clients c
      join public.stylists s on s.id = c.stylist_id
      where s.user_id = auth.uid()
    )
  );

-- ── conversations (one thread per client per channel) ───────────────────────
create table if not exists public.conversations (
  id                 uuid primary key default gen_random_uuid(),
  stylist_id         uuid not null references public.stylists(id) on delete cascade,
  client_id          uuid not null references public.clients(id) on delete cascade,
  channel_type       channel_type not null,
  external_thread_id text,
  last_message_at    timestamptz,
  unread             boolean not null default false,
  archived           boolean not null default false,
  window_expires_at  timestamptz,           -- when the channel's reply window closes (IG 24h / WeChat 48h)
  intent             conversation_intent not null default 'none',  -- set by parse-intent
  intent_payload     jsonb,                 -- {service_guess, preferred, candidate_times, confidence}
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (client_id, channel_type)
);
alter table public.conversations enable row level security;
grant all on public.conversations to service_role;
drop policy if exists "conversations_own" on public.conversations;
create policy "conversations_own" on public.conversations
  for all using (stylist_id in (select id from public.stylists where user_id = auth.uid()));
create index if not exists conversations_stylist_last on public.conversations (stylist_id, last_message_at desc);

-- ── messages ────────────────────────────────────────────────────────────────
create table if not exists public.messages (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.conversations(id) on delete cascade,
  direction          message_direction not null,
  body               text,
  media              jsonb,                 -- image refs etc.
  channel_message_id text,                  -- provider id, for dedupe
  status             message_status,
  sent_at            timestamptz not null default now(),
  created_at         timestamptz not null default now()
);
alter table public.messages enable row level security;
grant all on public.messages to service_role;
drop policy if exists "messages_own" on public.messages;
create policy "messages_own" on public.messages
  for all using (
    conversation_id in (
      select cv.id from public.conversations cv
      join public.stylists s on s.id = cv.stylist_id
      where s.user_id = auth.uid()
    )
  );
create index if not exists messages_conversation_time on public.messages (conversation_id, sent_at);
-- dedupe inbound provider messages (allow many NULLs)
create unique index if not exists messages_channel_message_id_key
  on public.messages (channel_message_id) where channel_message_id is not null;

-- ── webhook_events (raw inbound payloads for debugging ingestion) ───────────
create table if not exists public.webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           text not null,         -- 'twilio' | 'meta' | 'wechat' | 'kakao' | 'square'
  signature_verified boolean not null default false,
  payload            jsonb,
  created_at         timestamptz not null default now()
);
alter table public.webhook_events enable row level security;
grant all on public.webhook_events to service_role;
-- service-role only (webhooks write these); no public/authed policy on purpose.

-- ── Realtime (app updates live: new message in, booking confirmed, etc.) ────
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.conversations;
exception when duplicate_object then null; end $$;
