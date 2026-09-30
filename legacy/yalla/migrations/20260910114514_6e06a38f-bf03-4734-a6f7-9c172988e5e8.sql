CREATE TABLE public.provider_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id uuid NOT NULL,
  doc_kind text NOT NULL CHECK (doc_kind IN ('OPERATING_LICENCE','INSURANCE','VEHICLE_INSPECTION','IDENTIFICATION','TAX_COMPLIANCE')),
  title text,
  reference_no text,
  expires_on date,
  object_path text NOT NULL,
  file_name text,
  mime_type text,
  size_bytes bigint,
  status text NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED','VERIFIED','REJECTED','SUPERSEDED')),
  review_note text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_provider_documents_owner ON public.provider_documents (provider_user_id, doc_kind, status);

GRANT SELECT, INSERT, UPDATE ON public.provider_documents TO authenticated;
GRANT ALL ON public.provider_documents TO service_role;

ALTER TABLE public.provider_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY provider_documents_own_read ON public.provider_documents
  FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid()
         OR public.has_role(auth.uid(),'admin')
         OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'operations_admin'));

CREATE POLICY provider_documents_own_insert ON public.provider_documents
  FOR INSERT TO authenticated
  WITH CHECK (provider_user_id = auth.uid());

CREATE POLICY provider_documents_own_update ON public.provider_documents
  FOR UPDATE TO authenticated
  USING (provider_user_id = auth.uid()
         OR public.has_role(auth.uid(),'admin')
         OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'operations_admin'))
  WITH CHECK (provider_user_id = auth.uid()
         OR public.has_role(auth.uid(),'admin')
         OR public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'operations_admin'));

CREATE OR REPLACE FUNCTION public._provider_documents_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_provider_documents_touch BEFORE UPDATE ON public.provider_documents
FOR EACH ROW EXECUTE FUNCTION public._provider_documents_touch();

-- Staff verification decision
CREATE OR REPLACE FUNCTION public.provider_document_decide(_document_id uuid, _decision text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_actor uuid := auth.uid(); v_status text;
BEGIN
  IF v_actor IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT (public.has_role(v_actor,'admin') OR public.has_role(v_actor,'super_admin') OR public.has_role(v_actor,'operations_admin')) THEN
    RAISE EXCEPTION 'DOCUMENT_REVIEW_NOT_PERMITTED';
  END IF;
  IF _decision NOT IN ('VERIFIED','REJECTED') THEN RAISE EXCEPTION 'INVALID_DECISION'; END IF;
  IF _decision = 'REJECTED' AND coalesce(btrim(_note),'') = '' THEN RAISE EXCEPTION 'REJECTION_REASON_REQUIRED'; END IF;

  UPDATE public.provider_documents
     SET status = _decision, review_note = _note, reviewed_by = v_actor, reviewed_at = now()
   WHERE id = _document_id
   RETURNING status INTO v_status;

  IF v_status IS NULL THEN RAISE EXCEPTION 'DOCUMENT_NOT_FOUND'; END IF;
  RETURN jsonb_build_object('id', _document_id, 'status', v_status);
END; $$;

REVOKE ALL ON FUNCTION public.provider_document_decide(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.provider_document_decide(uuid, text, text) TO authenticated;

-- Compliance gate: no listing goes live without verified mandatory documents
CREATE OR REPLACE FUNCTION public._provider_capacity_requires_documents()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_missing text[];
BEGIN
  IF NEW.status <> 'PUBLISHED' OR coalesce(OLD.status,'') = 'PUBLISHED' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(k) INTO v_missing
  FROM unnest(ARRAY['OPERATING_LICENCE','INSURANCE','VEHICLE_INSPECTION']) AS k
  WHERE NOT EXISTS (
    SELECT 1 FROM public.provider_documents d
     WHERE d.provider_user_id = NEW.provider_user_id
       AND d.doc_kind = k
       AND d.status = 'VERIFIED'
       AND (d.expires_on IS NULL OR d.expires_on >= current_date)
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION 'PROVIDER_DOCUMENTS_REQUIRED: %', array_to_string(v_missing, ', ');
  END IF;

  RETURN NEW;
END; $$;

CREATE TRIGGER trg_provider_capacity_requires_documents
BEFORE UPDATE ON public.provider_capacity
FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_requires_documents();

-- Retire the temporary test listings
UPDATE public.provider_capacity
   SET status = 'RETIRED', retired_at = now(), decision_reason = 'Replaced by real operator capacity'
 WHERE is_test = true AND status <> 'RETIRED';