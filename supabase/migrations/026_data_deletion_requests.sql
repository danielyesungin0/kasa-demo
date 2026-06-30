-- 026 — Data deletion requests log (Meta app-review requirement).
-- Records inbound Meta "data deletion callback" requests so we can process +
-- show a status page. Service-role only (the endpoint runs with the service key;
-- there's no end-user access to this table).
create table if not exists public.data_deletion_requests (
  id                uuid primary key default gen_random_uuid(),
  external_user_id  text not null,              -- the provider-scoped user id from Meta
  confirmation_code text not null,
  status            text not null default 'received', -- received | processing | done
  created_at        timestamptz not null default now()
);
alter table public.data_deletion_requests enable row level security;
grant all on public.data_deletion_requests to service_role;
-- No authenticated/anon grants: only the service-role function writes/reads this.
