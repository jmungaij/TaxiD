
CREATE OR REPLACE FUNCTION public._identity_risk_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'identity_risk_assessments is append-only';
END;
$$;
REVOKE ALL ON FUNCTION public._identity_risk_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._identity_risk_append_only() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public._identity_risk_append_only() TO service_role;
