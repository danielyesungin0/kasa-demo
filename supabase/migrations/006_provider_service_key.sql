-- ============================================================
-- 006_provider_service_key.sql
-- Adds a stable svc-* "service_key" to provider_services so the client can
-- render tappable service cards whose id matches the service_catalog keys
-- that /api/availability and /api/bookings already look up. Without this,
-- cards would carry the row UUID, which those routes can't resolve to a
-- Square variation — bookings would silently skip Square.
--
-- Run in Supabase SQL Editor BEFORE deploying the code that writes/reads it.
-- After deploy, RE-SYNC once (/setup?continue=true) to populate this column
-- on existing rows. Additive + nullable — cannot break existing rows.
-- Idempotent.
-- ============================================================

alter table public.provider_services
  add column if not exists service_key text;
