-- ============================================================
-- 003_provider_services_sync.sql
-- Pass 1: dedup constraint for Square sync upserts into provider_services.
--
-- Run this in Supabase SQL Editor BEFORE deploying the Pass 1 code — the
-- sync upsert uses onConflict: "stylist_id,square_variation_id", which
-- requires this unique index to exist.
--
-- Safe to run: provider_services is empty at the time of this migration
-- (nothing wrote to it before Pass 1), so there are no existing duplicates
-- that could make the unique index creation fail.
--
-- Idempotent — safe to re-run.
-- ============================================================

-- Dedup key for sync upserts: one row per (provider, Square variation).
-- A NORMAL unique index (not partial): Postgres permits multiple NULLs in a
-- unique index, so manually-added services with a NULL square_variation_id
-- don't collide, and PostgREST/Supabase upsert onConflict matches this index
-- reliably (a partial index can fail to match in onConflict).
create unique index if not exists provider_services_stylist_variation_key
  on public.provider_services (stylist_id, square_variation_id);
