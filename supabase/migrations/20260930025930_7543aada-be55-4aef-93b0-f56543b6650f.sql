CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/d60a0d96-a51b-47eb-9235-be465cbec817/taxid-restore-phase10b.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> '2c3cf1b7727e6f27ba5c635c0e59073d1f54eb828d347f73ca64984ed2b625fd' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;