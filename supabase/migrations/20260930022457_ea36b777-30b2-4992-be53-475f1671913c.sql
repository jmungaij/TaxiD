CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/5d7d3572-16ec-4c8d-bad3-3f3108c750e2/taxid-restore-phase6.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> '37e853f95d615b293f98e89cdd40694e5e693c816a3f1c2aef560d6429b9a82c' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;