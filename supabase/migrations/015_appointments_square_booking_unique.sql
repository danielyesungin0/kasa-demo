-- ============================================================
-- 015_appointments_square_booking_unique.sql
-- Phase 2 (code) step 3 — support the idempotent local mirror in
-- square-create-booking: upsert(onConflict: "square_booking_id").
--
-- A PARTIAL unique index so the constraint applies only to rows that actually
-- carry a Square booking id. Rows with NULL square_booking_id (manual entries,
-- or pre-Square test rows) don't collide. This guarantees one appointments row
-- per Square booking even under retries / concurrent double-taps.
--
-- Idempotent — safe to re-run.
-- ============================================================

create unique index if not exists appointments_square_booking_id_key
  on public.appointments (square_booking_id)
  where square_booking_id is not null;
