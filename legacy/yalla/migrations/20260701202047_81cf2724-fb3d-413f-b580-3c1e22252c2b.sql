-- ============================================================================
-- Corporate KYB: notifications, document versioning, rescan tracking, OCR conf
-- ============================================================================

-- 1) Document versions (immutable history) -----------------------------------
CREATE TABLE public.corporate_registration_document_versions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id        uuid NOT NULL REFERENCES public.corporate_registration_documents(id) ON DELETE CASCADE,
  draft_id           uuid NOT NULL REFERENCES public.corporate_registration_drafts(id) ON DELETE CASCADE,
  slot_key           text NOT NULL,
  version            integer NOT NULL,
  storage_path       text NOT NULL,
  original_name      text NOT NULL,
  mime               text NOT NULL,
  size_bytes         bigint NOT NULL,
  scan_status        text NOT NULL DEFAULT 'pending',
  scan_result        jsonb NOT NULL DEFAULT '{}'::jsonb,
  extracted          jsonb NOT NULL DEFAULT '{}'::jsonb,
  ocr_confidence     jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation         jsonb NOT NULL DEFAULT '{}'::jsonb,
  admin_decision     text CHECK (admin_decision IN ('approved','rejected')),
  admin_reason       text,
  admin_reviewer     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_reviewed_at  timestamptz,
  review_id          uuid REFERENCES public.corporate_registration_reviews(id) ON DELETE SET NULL,
  superseded_at      timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version)
);
CREATE INDEX idx_corp_doc_versions_doc     ON public.corporate_registration_document_versions(document_id);
CREATE INDEX idx_corp_doc_versions_draft   ON public.corporate_registration_document_versions(draft_id);
CREATE INDEX idx_corp_doc_versions_review  ON public.corporate_registration_document_versions(review_id);

GRANT SELECT, INSERT, UPDATE ON public.corporate_registration_document_versions TO authenticated;
GRANT ALL ON public.corporate_registration_document_versions TO service_role;

ALTER TABLE public.corporate_registration_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read corp KYB doc versions"
  ON public.corporate_registration_document_versions FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 2) Applicant notifications --------------------------------------------------
CREATE TABLE public.corporate_registration_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id    uuid NOT NULL REFERENCES public.corporate_registration_drafts(id) ON DELETE CASCADE,
  session_key text NOT NULL,
  kind        text NOT NULL CHECK (kind IN (
                'draft_approved','draft_rejected','draft_changes_requested',
                'document_approved','document_rejected','rescan_failed'
              )),
  title       text NOT NULL,
  message     text,
  reason      text,
  evidence    jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_id   uuid REFERENCES public.corporate_registration_reviews(id) ON DELETE SET NULL,
  document_id uuid REFERENCES public.corporate_registration_documents(id) ON DELETE SET NULL,
  slot_key    text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_corp_notif_session ON public.corporate_registration_notifications(session_key, created_at DESC);
CREATE INDEX idx_corp_notif_draft   ON public.corporate_registration_notifications(draft_id);

GRANT SELECT, INSERT, UPDATE ON public.corporate_registration_notifications TO authenticated;
GRANT ALL ON public.corporate_registration_notifications TO service_role;

ALTER TABLE public.corporate_registration_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read corp KYB notifications"
  ON public.corporate_registration_notifications FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- (Anonymous applicants read via the edge function using session_key.)

-- 3) Rescan run tracking ------------------------------------------------------
CREATE TABLE public.corporate_registration_rescan_runs (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at         timestamptz NOT NULL DEFAULT now(),
  finished_at        timestamptz,
  scanned_count      integer NOT NULL DEFAULT 0,
  changed_count      integer NOT NULL DEFAULT 0,
  newly_failed_count integer NOT NULL DEFAULT 0,
  detail             jsonb NOT NULL DEFAULT '{}'::jsonb
);
GRANT SELECT ON public.corporate_registration_rescan_runs TO authenticated;
GRANT ALL ON public.corporate_registration_rescan_runs TO service_role;
ALTER TABLE public.corporate_registration_rescan_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read rescan runs"
  ON public.corporate_registration_rescan_runs FOR SELECT
  TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- 4) Extend documents with version pointers + OCR confidence + rescan meta ---
ALTER TABLE public.corporate_registration_documents
  ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ocr_confidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS ocr_provider text,
  ADD COLUMN IF NOT EXISTS last_scanned_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_rescan_run_id uuid REFERENCES public.corporate_registration_rescan_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reupload_required boolean NOT NULL DEFAULT false;

-- Widen decision enum to include changes_requested was already added; ensure it
-- exists as a value in the CHECK by relaxing the column check.
ALTER TABLE public.corporate_registration_documents
  DROP CONSTRAINT IF EXISTS corporate_registration_documents_admin_decision_check;
ALTER TABLE public.corporate_registration_documents
  ADD CONSTRAINT corporate_registration_documents_admin_decision_check
    CHECK (admin_decision IN ('approved','rejected','changes_requested') OR admin_decision IS NULL);

-- 5) Reviews: link to document_version_id so re-uploads preserve history -----
ALTER TABLE public.corporate_registration_reviews
  ADD COLUMN IF NOT EXISTS document_version_id uuid REFERENCES public.corporate_registration_document_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_corp_reviews_corr ON public.corporate_registration_reviews(correlation_id);

-- 6) Schedule the rescan monitor to run every 15 minutes ---------------------
-- Uses existing pg_cron + pg_net extensions (already enabled for dlq monitor).
DO $$
DECLARE
  jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'corporate-kyb-rescan-every-15m';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END $$;

SELECT cron.schedule(
  'corporate-kyb-rescan-every-15m',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url:='https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/corporate-kyb-rescan',
    headers:='{"Content-Type":"application/json","apikey":"sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ"}'::jsonb,
    body:=jsonb_build_object('trigger','pg_cron','at', now())
  );
  $$
);
