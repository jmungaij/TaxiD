CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/fa0b192b-48f8-4931-bfa6-a67c8f6c508f/taxid-restore-phase9a.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> 'e4a9e24baf32d26ec1dca232c8827ca0e8325d4ffe1e5cf23218b7931cfbb8ae' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;
GRANT SELECT ON public.social_accounts TO anon;