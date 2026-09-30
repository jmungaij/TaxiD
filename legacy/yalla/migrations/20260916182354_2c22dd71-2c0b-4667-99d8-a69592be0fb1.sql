-- Canonical client fingerprint for unauthenticated intake paths.
CREATE OR REPLACE FUNCTION public.public_client_fingerprint(_salt text DEFAULT 'yalla-intake')
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_headers json;
  v_raw text;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::json;
  EXCEPTION WHEN others THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    v_raw := coalesce(
      nullif(btrim(split_part(coalesce(v_headers ->> 'cf-connecting-ip', ''), ',', 1)), ''),
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-real-ip', ''), ',', 1)), ''),
      nullif(btrim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), '')
    );
    -- User agent joins the fingerprint so several devices behind one NAT are
    -- not punished for each other, while a single scripted client stays one bucket.
    IF v_raw IS NOT NULL THEN
      v_raw := v_raw || '|' || left(coalesce(v_headers ->> 'user-agent', ''), 200);
    END IF;
  END IF;

  IF v_raw IS NULL THEN
    BEGIN
      v_raw := host(inet_client_addr());
    EXCEPTION WHEN others THEN
      v_raw := NULL;
    END;
  END IF;

  IF v_raw IS NULL OR length(v_raw) = 0 THEN
    -- Unknown origin is one shared bucket, deliberately not an exemption.
    RETURN 'unknown';
  END IF;

  RETURN left(md5(coalesce(_salt, 'yalla-intake') || ':' || lower(v_raw)), 16);
END;
$function$;

REVOKE ALL ON FUNCTION public.public_client_fingerprint(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_client_fingerprint(text) TO anon, authenticated, service_role;

-- Rolling counter ledger shared by public intake surfaces.
CREATE TABLE IF NOT EXISTS public.public_intake_counters (
  scope text NOT NULL,
  window_start timestamptz NOT NULL,
  hits integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, window_start)
);

GRANT ALL ON public.public_intake_counters TO service_role;
ALTER TABLE public.public_intake_counters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security staff read intake counters" ON public.public_intake_counters;
CREATE POLICY "security staff read intake counters"
  ON public.public_intake_counters FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE OR REPLACE FUNCTION public.public_intake_bump(_scope text, _window timestamptz, _limit integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_hits integer;
BEGIN
  INSERT INTO public.public_intake_counters AS c (scope, window_start, hits)
  VALUES (_scope, _window, 1)
  ON CONFLICT (scope, window_start)
  DO UPDATE SET hits = c.hits + 1, updated_at = now()
  RETURNING c.hits INTO v_hits;

  DELETE FROM public.public_intake_counters WHERE window_start < now() - interval '7 days';
  RETURN v_hits <= _limit;
END;
$function$;

REVOKE ALL ON FUNCTION public.public_intake_bump(text, timestamptz, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.public_intake_bump(text, timestamptz, integer) TO service_role;

-- Every application records the fingerprint that submitted it (server-derived).
ALTER TABLE public.partner_applications
  ADD COLUMN IF NOT EXISTS client_fingerprint text;

CREATE OR REPLACE FUNCTION public.partner_application_stamp_fingerprint()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Client-supplied values are ignored: the fingerprint is always server-derived.
  NEW.client_fingerprint := public.public_client_fingerprint('yalla-partner-intake');
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_partner_application_stamp_fingerprint ON public.partner_applications;
CREATE TRIGGER trg_partner_application_stamp_fingerprint
  BEFORE INSERT ON public.partner_applications
  FOR EACH ROW EXECUTE FUNCTION public.partner_application_stamp_fingerprint();

CREATE INDEX IF NOT EXISTS partner_applications_fingerprint_idx
  ON public.partner_applications (client_fingerprint, created_at DESC);

-- Velocity-aware intake gate: email throttling alone no longer decides.
CREATE OR REPLACE FUNCTION public.partner_application_intake_within_limit(_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text := lower(btrim(coalesce(_email, '')));
  v_fp text;
  v_hour timestamptz := date_trunc('hour', now());
  v_day timestamptz := date_trunc('day', now());
BEGIN
  IF v_email = '' OR length(v_email) > 320 THEN
    RETURN false;
  END IF;

  -- Existing ceilings: per email address and platform wide.
  IF (SELECT count(*) FROM public.partner_applications
       WHERE lower(btrim(contact_email)) = v_email
         AND created_at > now() - interval '1 hour') >= 3 THEN
    RETURN false;
  END IF;
  IF (SELECT count(*) FROM public.partner_applications
       WHERE created_at > now() - interval '1 hour') >= 60 THEN
    RETURN false;
  END IF;

  v_fp := public.public_client_fingerprint('yalla-partner-intake');

  -- Rotating email addresses from one client is the abuse pattern this closes:
  -- the same fingerprint may not open more than 3 distinct applicant identities
  -- in a day, whatever addresses it uses.
  IF (SELECT count(DISTINCT lower(btrim(contact_email)))
        FROM public.partner_applications
       WHERE client_fingerprint = v_fp
         AND created_at > now() - interval '24 hours'
         AND lower(btrim(contact_email)) <> v_email) >= 3 THEN
    RETURN false;
  END IF;

  -- Submission velocity per client, independent of the address used.
  IF NOT public.public_intake_bump('partner:fp:' || v_fp || ':hour', v_hour, 3) THEN
    RETURN false;
  END IF;
  IF NOT public.public_intake_bump('partner:fp:' || v_fp || ':day', v_day, 8) THEN
    RETURN false;
  END IF;
  IF NOT public.public_intake_bump('partner:global:hour', v_hour, 60) THEN
    RETURN false;
  END IF;

  RETURN true;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.partner_application_intake_within_limit(text) TO anon, authenticated, service_role;