CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/92df6e98-a411-4fe2-bf2c-4980e2290d53/taxid-restore-phase3.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> '1e0e4c13ac85a664512991e1417f7fb704f2fdd9e0214233c5ddb87730eb8b4c' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;