-- Shared, server-computed abuse guard for anonymous public intake tables.
-- Anonymous inserts through SECURITY DEFINER submit RPCs previously bypassed
-- every rate ceiling, because the guards lived only in the partner policy.
CREATE OR REPLACE FUNCTION public.public_intake_rate_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_channel text := coalesce(TG_ARGV[0], TG_TABLE_NAME);
  v_email text := lower(btrim(coalesce(NEW.contact_email, '')));
  v_fp text;
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
  v_email_hits integer;
BEGIN
  -- Signed-in callers (staff entry, admin backfill) are governed by RLS/permission
  -- checks, not by anonymous-visitor throttles.
  IF auth.uid() IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF v_email = '' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'INTAKE_REJECTED_INVALID_CONTACT_EMAIL';
  END IF;

  EXECUTE format(
    'SELECT count(*) FROM public.%I WHERE lower(btrim(contact_email)) = $1 AND created_at > now() - interval ''1 hour''',
    TG_TABLE_NAME
  ) INTO v_email_hits USING v_email;
  IF v_email_hits >= 3 THEN
    RAISE EXCEPTION 'INTAKE_RATE_LIMITED';
  END IF;

  v_fp := public.public_client_fingerprint('yalla-' || v_channel);

  IF NOT public.public_intake_bump(v_channel || ':fp:' || v_fp || ':hour', v_hour, 3) THEN
    RAISE EXCEPTION 'INTAKE_RATE_LIMITED';
  END IF;
  IF NOT public.public_intake_bump(v_channel || ':fp:' || v_fp || ':day', v_day, 8) THEN
    RAISE EXCEPTION 'INTAKE_RATE_LIMITED';
  END IF;
  IF NOT public.public_intake_bump(v_channel || ':global:hour', v_hour, 60) THEN
    RAISE EXCEPTION 'INTAKE_RATE_LIMITED';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.public_intake_rate_guard() FROM PUBLIC;

DROP TRIGGER IF EXISTS driver_applications_intake_rate_guard ON public.driver_applications;
CREATE TRIGGER driver_applications_intake_rate_guard
BEFORE INSERT ON public.driver_applications
FOR EACH ROW EXECUTE FUNCTION public.public_intake_rate_guard('driver-intake');

DROP TRIGGER IF EXISTS carrier_applications_intake_rate_guard ON public.carrier_applications;
CREATE TRIGGER carrier_applications_intake_rate_guard
BEFORE INSERT ON public.carrier_applications
FOR EACH ROW EXECUTE FUNCTION public.public_intake_rate_guard('carrier-intake');

-- Partner intake: pin the fingerprint to the server-computed value so the
-- distinct-identity ceiling cannot be evaded by supplying a random value.
DROP POLICY IF EXISTS partner_applications_insert ON public.partner_applications;
CREATE POLICY partner_applications_insert
ON public.partner_applications
FOR INSERT
TO anon, authenticated
WITH CHECK (
  ((submitted_by IS NULL) OR (submitted_by = auth.uid()))
  AND status = 'submitted'
  AND review_notes IS NULL
  AND reviewed_by IS NULL
  AND reviewed_at IS NULL
  AND partner_id IS NULL
  AND length(btrim(organisation_name)) BETWEEN 2 AND 200
  AND length(btrim(contact_name)) BETWEEN 2 AND 150
  AND btrim(contact_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
  AND length(btrim(contact_email)) <= 254
  AND length(btrim(contact_phone)) BETWEEN 7 AND 30
  AND length(btrim(country)) BETWEEN 2 AND 100
  AND (city IS NULL OR length(city) <= 120)
  AND (website IS NULL OR length(website) <= 500)
  AND (category IS NULL OR length(category) <= 120)
  AND (requirements IS NULL OR length(requirements) <= 5000)
  AND (intent_bring IS NULL OR length(intent_bring) <= 2000)
  AND (network_category IS NULL OR length(network_category) <= 120)
  AND (maturity_level IS NULL OR length(maturity_level) <= 60)
  AND (lifecycle_stage IS NULL OR length(lifecycle_stage) <= 60)
  AND (ab_variant IS NULL OR length(ab_variant) <= 60)
  AND (session_id IS NULL OR length(session_id) <= 128)
  AND (monthly_volume_estimate IS NULL OR (monthly_volume_estimate >= 0 AND monthly_volume_estimate <= 10000000))
  AND client_fingerprint IS NOT DISTINCT FROM public.public_client_fingerprint('yalla-partner-intake')
  AND public.partner_application_intake_within_limit(contact_email)
);
