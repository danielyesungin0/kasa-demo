-- ============================================================
-- 017_auth_stylist_provisioning.sql
-- Phase 3 onboarding — two auth-related fixes flagged during the auth build:
--
-- 1) Drop the DUPLICATE stylists RLS policy. There were two identical ALL
--    policies ("own row" + "stylists_own", both user_id = auth.uid()). Keep
--    one. No behavior change; removes redundancy/confusion.
--
-- 2) Auto-provision a stylists row for every new auth user. A brand-new
--    auth.uid() has no stylists row, so RLS returns empty and the app sees
--    nothing. A trigger on auth.users creates the owned row on signup (any
--    method: email/Google/Apple), so real new signups work. Idempotent guards.
--
-- Safe + idempotent.
-- ============================================================

-- 1) Remove the redundant duplicate policy (keep stylists_own).
drop policy if exists "own row" on public.stylists;

-- 2) Provision a stylists row on new auth user.
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- One stylist row per auth user; do nothing if it somehow exists already.
  insert into public.stylists (user_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

do $$ begin
  create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_auth_user();
exception when duplicate_object then null; end $$;
