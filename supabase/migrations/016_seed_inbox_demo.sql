-- ============================================================
-- 016_seed_inbox_demo.sql
-- Phase 3 — realistic SEED data for the inbox UI, mirroring the prototype
-- (design/reference.html: Emily, Mina, Rachel, Hana, Sofia). Lets the
-- Realtime-wired Inbox/Thread render true-to-life while we build screens.
--
-- DEMO/SEED data — clearly tagged so Phase 5 cleanup can find + remove it.
-- Every seeded client carries the tag 'demo-seed'. Idempotent: re-running
-- deletes prior demo-seed rows (cascades to conversations + messages) and
-- recreates them, so it never duplicates.
-- ============================================================

do $$
declare
  v_stylist uuid;
  v_client  uuid;
  v_convo   uuid;
  v_now     timestamptz := now();
begin
  select id into v_stylist from public.stylists order by created_at asc limit 1;
  if v_stylist is null then
    raise notice 'No stylist row — skipping inbox demo seed.';
    return;
  end if;

  -- Idempotent reset: remove any prior demo-seed clients (cascades).
  delete from public.clients where stylist_id = v_stylist and 'demo-seed' = any(tags);

  -- ── Emily Chen — Instagram, booking intent (the nudge case) ──────────────
  insert into public.clients (stylist_id, name, value, since, visits, preferences, notes, tags, phone, email, instagram_handle)
  values (v_stylist, 'Emily Chen', 'high', '2023', 7,
          'Likes warm brunette tones, prefers evenings, low-maintenance color',
          'Allergic to ammonia-based lighteners — use clay-based. Likes a quiet, low-chat appointment.',
          array['Color client','Evening preference','demo-seed'],
          '9175550142', 'emily.chen@gmail.com', '@emilychen')
  returning id into v_client;
  insert into public.client_identities (client_id, channel_type, external_user_id, display_handle)
  values (v_client, 'instagram', 'ig_emilychen_001', '@emilychen');
  insert into public.conversations (stylist_id, client_id, channel_type, external_thread_id, last_message_at, unread, window_expires_at, intent, intent_payload)
  values (v_stylist, v_client, 'instagram', 'th_emily_ig', v_now - interval '8 minutes', true,
          v_now + interval '23 hours', 'booking',
          '{"service_guess":"Full balayage","preferred":"Friday after work","candidate_times":[],"confidence":0.72}'::jsonb)
  returning id into v_convo;
  insert into public.messages (conversation_id, direction, body, channel_message_id, status, sent_at) values
    (v_convo, 'in', 'Hi Shen!! 🤎 do you have anything friday after work?', 'm_emily_1', 'delivered', v_now - interval '10 minutes'),
    (v_convo, 'in', 'I want something like this but maybe a little darker for fall', 'm_emily_2', 'delivered', v_now - interval '8 minutes');

  -- ── Mina Park — WeChat, pre-booking inquiry ──────────────────────────────
  insert into public.clients (stylist_id, name, value, since, visits, preferences, notes, tags, phone, email)
  values (v_stylist, 'Mina Park', 'regular', '2024', 4,
          'Glossy dark brunette, comes every 6 weeks',
          'Usually books gloss + trim together. Prefers Saturdays.',
          array['Gloss regular','demo-seed'], '6465550177', 'mina.p@outlook.com')
  returning id into v_client;
  insert into public.client_identities (client_id, channel_type, external_user_id, display_handle)
  values (v_client, 'wechat', 'wx_openid_mina_002', 'Mina');
  insert into public.conversations (stylist_id, client_id, channel_type, external_thread_id, last_message_at, unread, window_expires_at, intent)
  values (v_stylist, v_client, 'wechat', 'th_mina_wx', v_now - interval '40 minutes', true,
          v_now + interval '47 hours', 'none')
  returning id into v_convo;
  insert into public.messages (conversation_id, direction, body, channel_message_id, status, sent_at) values
    (v_convo, 'in', 'Heyy! thinking about switching it up a bit', 'm_mina_1', 'delivered', v_now - interval '50 minutes'),
    (v_convo, 'in', 'Can I send some inspo pics? 😊', 'm_mina_2', 'delivered', v_now - interval '40 minutes');

  -- ── Rachel Kim — SMS, reschedule (no window limit) ───────────────────────
  insert into public.clients (stylist_id, name, value, since, visits, preferences, notes, tags, phone, email)
  values (v_stylist, 'Rachel Kim', 'regular', '2024', 5,
          'Lob, blunt ends, no layers',
          'Has a standing-ish 6-week cut. Flexible on timing, just give options.',
          array['Cut client','demo-seed'], '3475550163', 'rachelk@gmail.com')
  returning id into v_client;
  insert into public.client_identities (client_id, channel_type, external_user_id, display_handle)
  values (v_client, 'sms', '13475550163', 'Rachel Kim');
  insert into public.conversations (stylist_id, client_id, channel_type, last_message_at, unread, window_expires_at, intent, intent_payload)
  values (v_stylist, v_client, 'sms', v_now - interval '1 hour', true, null, 'booking',
          '{"service_guess":"Cut & blow-dry","preferred":"next week","candidate_times":[],"confidence":0.6}'::jsonb)
  returning id into v_convo;
  insert into public.messages (conversation_id, direction, body, channel_message_id, status, sent_at) values
    (v_convo, 'in', 'Hi Shen, can we move my appointment to next week? something came up at work 🙈', 'm_rachel_1', 'delivered', v_now - interval '70 minutes'),
    (v_convo, 'in', 'sorry for the short notice!', 'm_rachel_2', 'delivered', v_now - interval '1 hour');

  -- ── Hana Lee — Instagram, booking (bilingual) ────────────────────────────
  insert into public.clients (stylist_id, name, value, since, visits, preferences, notes, tags, instagram_handle)
  values (v_stylist, 'Hana Lee', 'regular', '2023', 4,
          'Natural black-brown roots, keeps it simple',
          'Writes in mixed Korean/English. Warm and easygoing.',
          array['Root touch-up','demo-seed'], '@hana.leee')
  returning id into v_client;
  insert into public.client_identities (client_id, channel_type, external_user_id, display_handle)
  values (v_client, 'instagram', 'ig_hanaleee_004', '@hana.leee');
  insert into public.conversations (stylist_id, client_id, channel_type, last_message_at, unread, window_expires_at, intent, intent_payload)
  values (v_stylist, v_client, 'instagram', v_now - interval '2 hours', true,
          v_now + interval '22 hours', 'booking',
          '{"service_guess":"Root touch-up","preferred":"Saturday","candidate_times":["Sat 10:30 AM","Sat 2:00 PM"],"confidence":0.9}'::jsonb)
  returning id into v_convo;
  insert into public.messages (conversation_id, direction, body, channel_message_id, status, sent_at) values
    (v_convo, 'in', '안녕하세요 Shen! 잘 지내셨어요? 😊', 'm_hana_1', 'delivered', v_now - interval '2 hours 2 minutes'),
    (v_convo, 'in', '토요일에 예약 가능할까요? root touch up 하고 싶어요', 'm_hana_2', 'delivered', v_now - interval '2 hours');

  -- ── Sofia Romano — SMS, already booked (read) ────────────────────────────
  insert into public.clients (stylist_id, name, value, since, visits, preferences, notes, tags, phone)
  values (v_stylist, 'Sofia Romano', 'high', '2022', 9,
          'Glossy brunette, books like clockwork',
          'Easy to book directly — knows exactly what she wants.',
          array['VIP','demo-seed'], '3325550144')
  returning id into v_client;
  insert into public.client_identities (client_id, channel_type, external_user_id, display_handle)
  values (v_client, 'sms', '13325550144', 'Sofia Romano');
  insert into public.conversations (stylist_id, client_id, channel_type, last_message_at, unread, window_expires_at, intent)
  values (v_stylist, v_client, 'sms', v_now - interval '3 hours', false, null, 'none')
  returning id into v_convo;
  insert into public.messages (conversation_id, direction, body, channel_message_id, status, sent_at) values
    (v_convo, 'out', 'I have Thursday at 2 open if you want your gloss + trim 💛', 'm_sofia_1', 'sent', v_now - interval '3 hours 20 minutes'),
    (v_convo, 'in', 'Thursday at 2 works perfectly, let''s do the gloss + trim 😊', 'm_sofia_2', 'delivered', v_now - interval '3 hours');

  raise notice 'Inbox demo seed complete for stylist %', v_stylist;
end $$;
