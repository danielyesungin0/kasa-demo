-- ============================================================
-- 005_last_synced_at.sql
-- Adds a "last synced" timestamp so the dashboard/settings can show when
-- the provider's Square catalog was last pulled into provider_services.
--
-- Run in Supabase SQL Editor BEFORE deploying the code that writes it.
-- Additive + nullable — cannot break existing rows. Idempotent.
-- ============================================================

alter table public.stylists
  add column if not exists last_synced_at timestamptz;
