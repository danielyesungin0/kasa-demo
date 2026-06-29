-- ============================================================
-- 021_square_oauth_nonce.sql
-- Phase 4 — Square OAuth connect flow needs a one-time nonce per stylist:
-- square-oauth-start writes it, square-oauth-callback verifies + clears it
-- (CSRF / replay guard on the redirect, which carries no app JWT).
-- ============================================================

alter table public.stylists
  add column if not exists square_oauth_nonce text;
