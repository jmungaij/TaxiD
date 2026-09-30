
ALTER TABLE public.doc_verification_attempts
  ADD COLUMN IF NOT EXISTS client_fingerprint text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS relyable boolean;

CREATE INDEX IF NOT EXISTS doc_verification_attempts_fp_idx
  ON public.doc_verification_attempts (client_fingerprint, created_at DESC);

-- Per-client rate limit for the public verifier (independent of the per-document
-- limit already enforced inside doc_verify_public).
CREATE OR REPLACE FUNCTION public.doc_verification_rate_check(_fingerprint text, _limit integer DEFAULT 30, _window_seconds integer DEFAULT 600)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT coalesce(count(*), 0) < greatest(_limit, 1)
  FROM public.doc_verification_attempts
  WHERE _fingerprint IS NOT NULL
    AND client_fingerprint = _fingerprint
    AND created_at > now() - make_interval(secs => greatest(_window_seconds, 1));
$$;

REVOKE ALL ON FUNCTION public.doc_verification_rate_check(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.doc_verification_rate_check(text, integer, integer) TO service_role;

-- Auditable outcome log written by the verification service only.
CREATE OR REPLACE FUNCTION public.doc_log_verification_access(
  _doc_number text,
  _outcome text,
  _state text,
  _relyable boolean,
  _mark_id uuid DEFAULT NULL,
  _client_ref text DEFAULT NULL,
  _fingerprint text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.doc_forensics_authorized() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.doc_verification_attempts
    (doc_number, outcome, mark_id, client_ref, client_fingerprint, state, relyable)
  VALUES (left(coalesce(_doc_number, ''), 64), left(coalesce(_outcome, 'unknown'), 32), _mark_id,
          left(coalesce(_client_ref, ''), 64), left(coalesce(_fingerprint, ''), 128),
          left(coalesce(_state, ''), 48), _relyable);
END; $$;

REVOKE ALL ON FUNCTION public.doc_log_verification_access(text, text, text, boolean, uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.doc_log_verification_access(text, text, text, boolean, uuid, text, text) TO service_role;

-- Evidence export audit trail.
CREATE TABLE IF NOT EXISTS public.doc_evidence_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_id uuid NOT NULL REFERENCES public.doc_security_marks(id) ON DELETE CASCADE,
  doc_number text NOT NULL,
  manifest_sha256 text NOT NULL,
  body_sha256 text NOT NULL,
  proof jsonb NOT NULL DEFAULT '{}'::jsonb,
  exported_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.doc_evidence_exports TO authenticated;
GRANT ALL ON public.doc_evidence_exports TO service_role;
ALTER TABLE public.doc_evidence_exports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "evidence exports readable by document authority" ON public.doc_evidence_exports;
CREATE POLICY "evidence exports readable by document authority"
  ON public.doc_evidence_exports FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[]));

CREATE OR REPLACE FUNCTION public.doc_log_evidence_export(
  _mark_id uuid,
  _doc_number text,
  _manifest_sha256 text,
  _body_sha256 text,
  _proof jsonb,
  _exported_by uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.doc_forensics_authorized() THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;
  INSERT INTO public.doc_evidence_exports
    (mark_id, doc_number, manifest_sha256, body_sha256, proof, exported_by)
  VALUES (_mark_id, _doc_number, _manifest_sha256, _body_sha256, coalesce(_proof, '{}'::jsonb), _exported_by)
  RETURNING id INTO v_id;
  RETURN v_id;
END; $$;

REVOKE ALL ON FUNCTION public.doc_log_evidence_export(uuid, text, text, text, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.doc_log_evidence_export(uuid, text, text, text, jsonb, uuid) TO service_role;
