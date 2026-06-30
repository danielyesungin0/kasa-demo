-- 024 — Storage bucket for OUTBOUND message media (photos/videos/audio the
-- stylist sends from the app). Instagram's Messaging API can only send media by
-- URL, so we upload here first, then send Instagram the public URL.
--
-- Public read: Instagram's servers fetch the URL unauthenticated to deliver it.
-- Writes are restricted to authenticated stylists (RLS below). Files are namespaced
-- by stylist for tidiness.

insert into storage.buckets (id, name, public)
values ('message-media', 'message-media', true)
on conflict (id) do nothing;

-- Authenticated users can upload into the bucket.
drop policy if exists "stylist upload message media" on storage.objects;
create policy "stylist upload message media"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'message-media');

-- Authenticated users can read/update/delete their own uploads.
drop policy if exists "stylist manage message media" on storage.objects;
create policy "stylist manage message media"
  on storage.objects for select to authenticated
  using (bucket_id = 'message-media');

-- Public (anon) read so Instagram's CDN can fetch the file to deliver it.
drop policy if exists "public read message media" on storage.objects;
create policy "public read message media"
  on storage.objects for select to anon
  using (bucket_id = 'message-media');
