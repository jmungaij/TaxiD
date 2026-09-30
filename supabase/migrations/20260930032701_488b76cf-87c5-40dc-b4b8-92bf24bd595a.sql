CREATE EXTENSION IF NOT EXISTS http WITH SCHEMA extensions;
DO $restore$
DECLARE v_sql text;
BEGIN
  SELECT content INTO v_sql FROM extensions.http_get('https://id-preview--40d1c614-2bfb-40a3-93bf-d60ac1f81022.lovable.app/__l5e/assets-v1/a53cf30f-2311-4de5-9fc2-be7bd427e4cd/taxid-restore-phase11b.sql');
  IF encode(extensions.digest(convert_to(v_sql,'UTF8'),'sha256'),'hex') <> '099b74093065f08ee6c76c082b1c8acdb3be303233b993299bdbbf00bf7423ce' THEN
    RAISE EXCEPTION 'Restore script fingerprint mismatch';
  END IF;
  EXECUTE v_sql;
END $restore$;
DROP EXTENSION IF EXISTS http;
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS application_status text NOT NULL DEFAULT 'approved';
ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS activation_date date;