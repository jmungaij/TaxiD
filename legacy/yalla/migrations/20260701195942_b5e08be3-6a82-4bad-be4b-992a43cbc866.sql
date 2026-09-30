
-- ============================================================================
-- Corporate KYB: secure documents + admin verification schema
-- ============================================================================

-- 1) Documents table -----------------------------------------------------------
CREATE TABLE public.corporate_registration_documents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id       uuid NOT NULL REFERENCES public.corporate_registration_drafts(id) ON DELETE CASCADE,
  session_key    text NOT NULL,
  slot_key       text NOT NULL,               -- e.g. certificate_of_incorporation, single_business_permit
  storage_path   text NOT NULL,               -- path inside `corporate-kyb` bucket
  original_name  text NOT NULL,
  mime           text NOT NULL,
  size_bytes     bigint NOT NULL,
  scan_status    text NOT NULL DEFAULT 'pending'
                 CHECK (scan_status IN ('pending','clean','infected','error')),
  scan_result    jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocr_text       text,
  extracted      jsonb NOT NULL DEFAULT '{}'::jsonb,   -- e.g. { expiry_date, business_name }
  validation     jsonb NOT NULL DEFAULT '{}'::jsonb,   -- { ok: bool, errors: [] }
  admin_decision text CHECK (admin_decision IN ('approved','rejected')),
  admin_reason   text,
  admin_reviewer uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_reviewed_at timestamptz,
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, slot_key)
);
CREATE INDEX idx_corp_reg_docs_draft ON public.corporate_registration_documents(draft_id);
CREATE INDEX idx_corp_reg_docs_scan ON public.corporate_registration_documents(scan_status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_registration_documents TO authenticated;
GRANT ALL ON public.corporate_registration_documents TO service_role;

ALTER TABLE public.corporate_registration_documents ENABLE ROW LEVEL SECURITY;

-- Only admins may read documents directly via the Data API. Anonymous applicants
-- interact through the corporate-kyb-doc edge function (service role).
CREATE POLICY "Admins can read corp KYB documents"
  ON public.corporate_registration_documents FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update corp KYB documents"
  ON public.corporate_registration_documents FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2) Admin review audit trail --------------------------------------------------
CREATE TABLE public.corporate_registration_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id     uuid NOT NULL REFERENCES public.corporate_registration_drafts(id) ON DELETE CASCADE,
  document_id  uuid REFERENCES public.corporate_registration_documents(id) ON DELETE CASCADE,
  reviewer_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scope        text NOT NULL CHECK (scope IN ('document','draft')),
  decision     text NOT NULL CHECK (decision IN ('approved','rejected','requested_changes')),
  reason       text,
  evidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corp_reg_reviews_draft ON public.corporate_registration_reviews(draft_id);
CREATE INDEX idx_corp_reg_reviews_reviewer ON public.corporate_registration_reviews(reviewer_id);

GRANT SELECT, INSERT ON public.corporate_registration_reviews TO authenticated;
GRANT ALL ON public.corporate_registration_reviews TO service_role;

ALTER TABLE public.corporate_registration_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read reviews"
  ON public.corporate_registration_reviews FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert their own reviews"
  ON public.corporate_registration_reviews FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') AND reviewer_id = auth.uid());

-- 3) Extend drafts with validation + decision state ---------------------------
ALTER TABLE public.corporate_registration_drafts
  ADD COLUMN IF NOT EXISTS validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision text
    CHECK (decision IN ('pending','approved','rejected','changes_requested')),
  ADD COLUMN IF NOT EXISTS decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS decided_at timestamptz,
  ADD COLUMN IF NOT EXISTS decision_reason text;

-- Admins can list submitted registrations directly (existing policies only
-- allow the anonymous applicant via session_key). Session_key-scoped access
-- keeps the existing behavior.
DROP POLICY IF EXISTS "Admins can read all corporate registration drafts" ON public.corporate_registration_drafts;
CREATE POLICY "Admins can read all corporate registration drafts"
  ON public.corporate_registration_drafts FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admins can update corporate registration drafts" ON public.corporate_registration_drafts;
CREATE POLICY "Admins can update corporate registration drafts"
  ON public.corporate_registration_drafts FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 4) Storage policies for `corporate-kyb` bucket ------------------------------
-- Bucket is private. Applicants upload via short-lived signed URLs minted by
-- the edge function (service role). Admins can read directly for verification.

DROP POLICY IF EXISTS "Admins can read corporate KYB objects" ON storage.objects;
CREATE POLICY "Admins can read corporate KYB objects"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'corporate-kyb' AND public.has_role(auth.uid(), 'admin'));

-- 5) updated_at trigger for the documents table -------------------------------
CREATE OR REPLACE FUNCTION public.tg_corp_reg_documents_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_corp_reg_documents_updated_at ON public.corporate_registration_documents;
CREATE TRIGGER trg_corp_reg_documents_updated_at
  BEFORE UPDATE ON public.corporate_registration_documents
  FOR EACH ROW EXECUTE FUNCTION public.tg_corp_reg_documents_updated_at();
