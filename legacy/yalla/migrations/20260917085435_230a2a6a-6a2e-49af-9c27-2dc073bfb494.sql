-- SEC-2026-09-17: file-content enforcement on the two public upload inboxes.
-- Extension checks in the guard functions are not enough: set MIME allowlists at the
-- storage policy layer so executables/scripts/archives are refused even with a
-- forged file name.

drop policy if exists "portal inbox isolated anonymous upload" on storage.objects;
create policy "portal inbox isolated anonymous upload"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'crm-portal-inbox'
  and (storage.foldername(name))[1] = 'portal-inbox'
  and public.contract_portal_upload_allowed(name)
  and coalesce(metadata->>'mimetype', '') = any (array[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png','image/jpeg','image/webp','image/heic','image/heif'
      ])
);

drop policy if exists "public applicants upload recruitment docs" on storage.objects;
create policy "public applicants upload recruitment docs"
on storage.objects for insert to anon, authenticated
with check (
  bucket_id = 'recruitment-applications'
  and (storage.foldername(name))[1] = 'public-applications'
  and public.rec_public_upload_session_allow(
        (storage.foldername(name))[2],
        (storage.foldername(name))[3])
  and coalesce(metadata->>'mimetype', '') = any (array[
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/png','image/jpeg','image/webp','image/heic','image/heif'
      ])
);