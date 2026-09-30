
-- ============ recovery request ledger (append-only, non-enumerating) ============
CREATE TABLE IF NOT EXISTS public.identity_recovery_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash text NOT NULL,
  email_domain text,
  outcome text NOT NULL CHECK (outcome IN ('ACCEPTED','RATE_LIMITED','INVALID_EMAIL')),
  correlation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS identity_recovery_occurred ON public.identity_recovery_requests (occurred_at DESC);
GRANT SELECT ON public.identity_recovery_requests TO authenticated;
GRANT ALL ON public.identity_recovery_requests TO service_role;
ALTER TABLE public.identity_recovery_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS identity_recovery_staff_read ON public.identity_recovery_requests;
CREATE POLICY identity_recovery_staff_read ON public.identity_recovery_requests
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
         OR public.has_role(auth.uid(), 'compliance_admin'));

CREATE OR REPLACE FUNCTION public.identity_recovery_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'identity_recovery_requests is append-only';
END;
$$;
DROP TRIGGER IF EXISTS trg_identity_recovery_append_only ON public.identity_recovery_requests;
CREATE TRIGGER trg_identity_recovery_append_only
BEFORE UPDATE OR DELETE ON public.identity_recovery_requests
FOR EACH ROW EXECUTE FUNCTION public.identity_recovery_append_only();

CREATE TABLE IF NOT EXISTS public.identity_recovery_rate (
  bucket text PRIMARY KEY,
  window_start timestamptz NOT NULL DEFAULT date_trunc('hour', now()),
  hits integer NOT NULL DEFAULT 0
);
GRANT ALL ON public.identity_recovery_rate TO service_role;
ALTER TABLE public.identity_recovery_rate ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS identity_recovery_rate_staff_read ON public.identity_recovery_rate;
CREATE POLICY identity_recovery_rate_staff_read ON public.identity_recovery_rate
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
         OR public.has_role(auth.uid(), 'compliance_admin'));

-- Decides whether a recovery email may be requested. Never reveals account existence.
CREATE OR REPLACE FUNCTION public.identity_recovery_begin(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(coalesce(_email, '')));
  v_hash text;
  v_domain text;
  v_hits integer;
  v_id uuid;
BEGIN
  IF v_email = '' OR v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' THEN
    INSERT INTO public.identity_recovery_requests (email_hash, email_domain, outcome)
    VALUES (md5('yalla-recovery:' || v_email), NULL, 'INVALID_EMAIL')
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('outcome','INVALID_EMAIL','allowed',false,'correlation_id',v_id);
  END IF;

  v_hash := md5('yalla-recovery:' || v_email);
  v_domain := split_part(v_email, '@', 2);

  INSERT INTO public.identity_recovery_rate (bucket, window_start, hits)
  VALUES (v_hash, date_trunc('hour', now()), 1)
  ON CONFLICT (bucket) DO UPDATE
    SET hits = CASE WHEN public.identity_recovery_rate.window_start < date_trunc('hour', now())
                    THEN 1 ELSE public.identity_recovery_rate.hits + 1 END,
        window_start = CASE WHEN public.identity_recovery_rate.window_start < date_trunc('hour', now())
                    THEN date_trunc('hour', now()) ELSE public.identity_recovery_rate.window_start END
  RETURNING hits INTO v_hits;

  IF v_hits > 5 THEN
    INSERT INTO public.identity_recovery_requests (email_hash, email_domain, outcome, metadata)
    VALUES (v_hash, v_domain, 'RATE_LIMITED', jsonb_build_object('hits', v_hits))
    RETURNING id INTO v_id;
    RETURN jsonb_build_object('outcome','RATE_LIMITED','allowed',false,'correlation_id',v_id);
  END IF;

  INSERT INTO public.identity_recovery_requests (email_hash, email_domain, outcome, metadata)
  VALUES (v_hash, v_domain, 'ACCEPTED', jsonb_build_object('hits', v_hits))
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('outcome','ACCEPTED','allowed',true,'correlation_id',v_id);
END;
$$;
REVOKE ALL ON FUNCTION public.identity_recovery_begin(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_recovery_begin(text) TO anon, authenticated, service_role;

-- ============ second-factor activity on the caller's own account ============
CREATE OR REPLACE FUNCTION public.identity_record_mfa_event(
  _event_type text,
  _method text DEFAULT 'totp',
  _success boolean DEFAULT true,
  _reason text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  IF _event_type NOT IN ('mfa_enrolled','mfa_verified','mfa_failed','mfa_removed','step_up_verified','step_up_failed') THEN
    RAISE EXCEPTION 'unsupported event type';
  END IF;

  INSERT INTO public.authentication_events (user_id, event_type, method, success, failure_reason, metadata)
  VALUES (v_uid, _event_type, coalesce(_method,'totp'), coalesce(_success,true),
          CASE WHEN coalesce(_success,true) THEN NULL ELSE left(coalesce(_reason,'unspecified'), 200) END,
          jsonb_build_object('source','security_centre'))
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.identity_record_mfa_event(text, text, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.identity_record_mfa_event(text, text, boolean, text) TO authenticated, service_role;
