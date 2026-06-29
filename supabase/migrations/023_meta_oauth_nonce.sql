-- ============================================================
-- 023_meta_oauth_nonce.sql
-- Instagram (Meta) OAuth needs a one-time nonce per stylist, mirroring Square:
-- instagram-oauth-start writes it, instagram-oauth-callback verifies + clears it
-- (CSRF/replay guard on Meta's redirect, which carries no app JWT).
-- ============================================================

alter table public.stylists
  add column if not exists meta_oauth_nonce text;
