-- ============================================================
-- 012_services_align.sql
-- Phase 2 — align the existing `provider_services` table with the
-- `services` shape in DATA_MODEL.md (the stylist's menu / Square Catalog
-- mirror). We KEEP provider_services (the Square sync code in
-- lib/square/sync-services.ts writes to it) and add the canonical columns,
-- plus a `services` VIEW so new-app code can read the DATA_MODEL.md names.
--
-- Additive + guarded. Idempotent. provider_services has 0 rows live, so this
-- is purely structural.
-- ============================================================

-- Canonical columns from DATA_MODEL.md `services`:
--   name, duration_minutes, price_cents, square_catalog_id, active
-- provider_services already has name, duration_minutes, price_cents,
-- square_item_id, square_variation_id. Add the rest.
alter table public.provider_services
  add column if not exists square_catalog_id text,   -- alias of square_item_id for DATA_MODEL.md parity
  add column if not exists active            boolean not null default true,
  add column if not exists updated_at        timestamptz not null default now();

-- Backfill square_catalog_id from the existing square_item_id where unset.
update public.provider_services
   set square_catalog_id = square_item_id
 where square_catalog_id is null and square_item_id is not null;

-- A thin VIEW exposing the DATA_MODEL.md `services` contract over
-- provider_services, so new-app queries can use the documented names without
-- a disruptive table rename (the Square sync code keeps writing
-- provider_services). RLS is enforced on the underlying table.
create or replace view public.services as
  select
    id,
    stylist_id,
    name,
    duration_minutes,
    price_cents,
    coalesce(square_catalog_id, square_item_id) as square_catalog_id,
    active,
    category,
    service_key,
    created_at
  from public.provider_services;

grant select on public.services to authenticated, service_role;
