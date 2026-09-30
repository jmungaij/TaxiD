CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/f66e77da-80c7-48df-96fd-d43b5165f490/taxid-restore-phase8.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> '616b3003273f735bfeb009a9d8b07086581ac4282020c28a41ac1e80c1446a5c' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;