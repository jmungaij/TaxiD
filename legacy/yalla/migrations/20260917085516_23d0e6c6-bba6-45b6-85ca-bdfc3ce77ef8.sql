-- Correct the previous migration: restore the full original guard checks and make the
-- MIME allowlist mandatory (storage always supplies a mimetype, so the null escape
-- only served forged-content uploads).

drop policy if exists "public applicants upload recruitment docs" on storage.objects;
create policy "public applicants upload recruitment docs"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'recruitment-applications'
  and (storage.foldername(name))[1] = 'public-applications'
  and array_length(storage.foldername(name), 1) = 3
  and lower(regexp_replace(name, '^.*\.', '')) = any (array['pdf','doc','docx','png','jpg','jpeg','webp','heic','heif','txt'])
  and lower(coalesce(metadata->>'mimetype','')) = any (array[
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png','image/jpeg','image/webp','image/heic','image/heif','text/plain'])
  and (
    metadata is null or (metadata->>'size') is null
    or (metadata->>'size')::bigint <= 10485760
  )
  and public.rec_public_upload_session_allow(
        (storage.foldername(name))[2],
        (storage.foldername(name))[3])
);

drop policy if exists "portal inbox isolated anonymous upload" on storage.objects;
create policy "portal inbox isolated anonymous upload"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'crm-portal-inbox'
  and (storage.foldername(name))[1] = 'portal-inbox'
  and public.contract_portal_upload_allowed(name)
  and lower(coalesce(metadata->>'mimetype','')) = any (array[
        'application/pdf','application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png','image/jpeg','image/webp','image/heic','image/heif'])
);