-- ============================================================
-- 022_grant_authenticated_app_tables.sql
-- CRITICAL FIX: the `authenticated` role had NO table-level privileges on the
-- app tables. RLS policies were defined, but RLS only filters rows AFTER a base
-- GRANT — without the GRANT, every query from a signed-in stylist failed with
-- "permission denied for table ..." (42501). This silently broke the whole app
-- for the authenticated user: the Square connect short-circuit read nothing (so
-- it kept launching OAuth), inbox/calendar/clients reads, booking writes, etc.
--
-- Grant the standard CRUD privileges to `authenticated` (and `anon` where the
-- app reads pre-auth — none here, so authenticated only). RLS continues to scope
-- every row to the owning stylist via the existing policies; these grants just
-- let the role attempt access so RLS can do its job.
-- ============================================================

grant select, insert, update, delete on
  public.stylists,
  public.clients,
  public.client_identities,
  public.conversations,
  public.messages,
  public.channels,
  public.appointments,
  public.provider_services
to authenticated;

-- Sequences (for any serial/identity columns) so inserts can get defaults.
grant usage, select on all sequences in schema public to authenticated;

-- Make future tables inherit the grant too (defensive; matches Supabase default
-- intent for the authenticated role).
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
