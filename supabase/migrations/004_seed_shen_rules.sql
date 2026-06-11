-- ============================================================
-- 004_seed_shen_rules.sql
-- Pass 2A: seed Shen's per-provider unsupported rules (bleach/bleaching)
-- so the chat routes bleach to handoff from HER rules, not the global
-- hardcoded list. Augment model: the global list still applies to terms
-- Shen hasn't configured.
--
-- Run in Supabase SQL Editor BEFORE deploying Pass 2A code.
-- Idempotent — safe to re-run.
-- ============================================================

-- Defensive grants (002 set these; harmless to re-run).
grant all on public.unsupported_rules to service_role;
grant all on public.provider_services to service_role;

-- Seed bleach + bleaching as handoff-type unsupported rules for Shen only.
do $$
declare v_id uuid;
begin
  select id into v_id from public.stylists where slug = 'shen' limit 1;
  if v_id is null then
    raise notice 'No shen stylist row — skipping unsupported_rules seed.';
    return;
  end if;

  insert into public.unsupported_rules (stylist_id, trigger_term, response_type)
  select v_id, term, 'handoff'
  from (values ('bleach'), ('bleaching')) as t(term)
  where not exists (
    select 1 from public.unsupported_rules
    where stylist_id = v_id and trigger_term = t.term
  );
end;
$$;
