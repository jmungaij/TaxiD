CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/8f65f717-4c6b-42b5-a198-2dd1f0a98d24/taxid-restore-phase9b.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> '966570fcba52cf5ce8337f9bdcda9e13dca04145590410ceb109f706b12d90d5' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;