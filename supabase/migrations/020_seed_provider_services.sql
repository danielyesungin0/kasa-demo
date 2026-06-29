-- ============================================================
-- 020_seed_provider_services.sql
-- Phase 3 — seed Shen's service catalog (provider_services), the list the Book
-- sheet picks from and the source of per-service DURATION used by the
-- availability engine. Empty until now; the legacy `services` table is also
-- empty. Durations align with the seeded appointments (019).
--
-- Real (non-demo) catalog: these are Shen's actual offerings, not throwaway demo
-- rows, so they stay. square_variation_id is null until the Square catalog is
-- linked (Phase 4) — booking writes work locally without it. Idempotent on
-- (stylist_id, service_key).
-- ============================================================

-- Needed for the idempotent upsert below (one service_key per stylist).
create unique index if not exists provider_services_stylist_key_uniq
  on public.provider_services (stylist_id, service_key);

do $$
declare v_stylist uuid;
begin
  select id into v_stylist from public.stylists order by created_at asc limit 1;
  if v_stylist is null then return; end if;

  insert into public.provider_services
    (stylist_id, service_key, name, category, price_cents, duration_minutes,
     visible_in_chat, active, chat_description, aliases)
  values
    (v_stylist, 'cut',          'Haircut',            'Cuts',  9000,   60, true, true,
     'Wash, cut, and style.', array['cut','haircut','trim']),
    (v_stylist, 'gloss',        'Gloss / Toner',      'Color', 8500,   60, true, true,
     'Adds shine and refreshes tone.', array['gloss','toner','shine']),
    (v_stylist, 'root',         'Root Touch-Up',      'Color', 13000,  90, true, true,
     'Color regrowth at the roots.', array['roots','root touch up','color']),
    (v_stylist, 'single',       'Single-Process Color','Color',15000, 120, true, true,
     'All-over color.', array['color','single process']),
    (v_stylist, 'balayage',     'Balayage',           'Color', 28000, 210, true, true,
     'Hand-painted dimensional color.', array['balayage','highlights','painting']),
    (v_stylist, 'cut_color',    'Cut + Color',        'Combo', 22000, 180, true, true,
     'Haircut with all-over color.', array['cut and color','color and cut']),
    (v_stylist, 'blowout',      'Blowout',            'Styling', 6500, 45, true, true,
     'Wash and style.', array['blowout','style','blow dry']),
    (v_stylist, 'consult',      'Color Consultation', 'Consult', 0,    30, true, true,
     'In-person consult before a big change.', array['consult','consultation'])
  on conflict (stylist_id, service_key) do update
    set name = excluded.name, category = excluded.category,
        price_cents = excluded.price_cents, duration_minutes = excluded.duration_minutes,
        visible_in_chat = excluded.visible_in_chat, active = excluded.active,
        chat_description = excluded.chat_description, aliases = excluded.aliases;
end $$;
