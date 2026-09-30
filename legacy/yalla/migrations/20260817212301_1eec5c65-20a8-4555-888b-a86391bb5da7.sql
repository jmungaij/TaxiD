-- ============================================================================
-- Recruitment 360 — Communications & Official Letter Engine (domain spine)
-- State machine first: a communication is a governed record whose document,
-- dispatch and delivery are separate transactions reconciled against provider
-- events. Nothing here trusts the client.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.rec_comm_ref_seq;

-- ---------------------------------------------------------------- templates
CREATE TABLE public.rec_letter_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_key text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  comm_type text NOT NULL,
  title text NOT NULL,
  subject text NOT NULL,
  body_markdown text NOT NULL,
  variables text[] NOT NULL DEFAULT '{}',
  classification text NOT NULL DEFAULT 'confidential',
  watermark_text text NOT NULL DEFAULT 'YALLA MOBILITY',
  requires_approval boolean NOT NULL DEFAULT true,
  approver_roles text[] NOT NULL DEFAULT ARRAY['recruiter'],
  status text NOT NULL DEFAULT 'draft',
  content_hash text,
  created_by uuid DEFAULT auth.uid(),
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_letter_templates_key_version UNIQUE (template_key, version),
  CONSTRAINT rec_letter_templates_status_chk CHECK (status IN ('draft','active','retired')),
  CONSTRAINT rec_letter_templates_class_chk CHECK (classification IN ('internal','confidential','strictly_confidential')),
  CONSTRAINT rec_letter_templates_type_chk CHECK (comm_type IN (
    'interview_invitation','reschedule_notice','interview_cancellation','regret',
    'appointment_letter','offer_letter','onboarding_pack','preemployment_request'))
);

GRANT SELECT, INSERT, UPDATE ON public.rec_letter_templates TO authenticated;
GRANT ALL ON public.rec_letter_templates TO service_role;
ALTER TABLE public.rec_letter_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read letter templates" ON public.rec_letter_templates
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write letter templates" ON public.rec_letter_templates
  FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update letter templates" ON public.rec_letter_templates
  FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- An active template version is frozen: issued documents must remain reproducible.
CREATE OR REPLACE FUNCTION public.rec_letter_template_freeze()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'active' AND (
       NEW.body_markdown <> OLD.body_markdown OR NEW.subject <> OLD.subject
       OR NEW.watermark_text <> OLD.watermark_text OR NEW.classification <> OLD.classification) THEN
    RAISE EXCEPTION 'template_version_frozen: publish a new version of % instead', OLD.template_key;
  END IF;
  IF NEW.status = 'active' AND OLD.status <> 'active' THEN
    NEW.activated_at := now();
    NEW.content_hash := md5(NEW.subject || '|' || NEW.body_markdown);
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_rec_letter_template_freeze BEFORE UPDATE ON public.rec_letter_templates
  FOR EACH ROW EXECUTE FUNCTION public.rec_letter_template_freeze();

-- ---------------------------------------------------------------- requests
CREATE TABLE public.rec_comm_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_ref text NOT NULL UNIQUE,
  comm_type text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  state_reason text,
  revision integer NOT NULL DEFAULT 1,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  interview_id uuid REFERENCES public.rec_interviews(id) ON DELETE SET NULL,
  offer_id uuid REFERENCES public.rec_offers(id) ON DELETE SET NULL,
  onboarding_case_id uuid REFERENCES public.rec_onboarding_cases(id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES public.rec_letter_templates(id),
  template_key text NOT NULL,
  template_version integer NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  event_at timestamptz,
  event_timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  business_key text NOT NULL UNIQUE,
  idempotency_key text NOT NULL UNIQUE,
  requires_approval boolean NOT NULL DEFAULT true,
  requested_by uuid DEFAULT auth.uid(),
  approved_by uuid,
  approved_at timestamptz,
  approval_note text,
  supersedes_id uuid REFERENCES public.rec_comm_requests(id) ON DELETE SET NULL,
  superseded_by_id uuid REFERENCES public.rec_comm_requests(id) ON DELETE SET NULL,
  queued_at timestamptz,
  provider_accepted_at timestamptz,
  delivered_at timestamptz,
  failed_at timestamptz,
  cancelled_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_comm_state_chk CHECK (state IN (
    'draft','pending_approval','approved','generating','generated','queued',
    'provider_accepted','delivered','failed','retry_pending','cancelled','superseded','archived'))
);

CREATE INDEX idx_rec_comm_requests_state ON public.rec_comm_requests (state, created_at DESC);
CREATE INDEX idx_rec_comm_requests_app ON public.rec_comm_requests (application_id, comm_type, revision);
CREATE INDEX idx_rec_comm_requests_interview ON public.rec_comm_requests (interview_id);

GRANT SELECT ON public.rec_comm_requests TO authenticated;
GRANT ALL ON public.rec_comm_requests TO service_role;
ALTER TABLE public.rec_comm_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read comm requests" ON public.rec_comm_requests
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- ---------------------------------------------------------- data snapshots
CREATE TABLE public.rec_comm_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL UNIQUE REFERENCES public.rec_comm_requests(id) ON DELETE CASCADE,
  template_key text NOT NULL,
  template_version integer NOT NULL,
  rendered_subject text NOT NULL,
  rendered_body text NOT NULL,
  data_snapshot jsonb NOT NULL,
  branding jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_comm_snapshots TO authenticated;
GRANT ALL ON public.rec_comm_snapshots TO service_role;
ALTER TABLE public.rec_comm_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read comm snapshots" ON public.rec_comm_snapshots
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- ------------------------------------------------------------- documents
CREATE TABLE public.rec_comm_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rec_comm_requests(id) ON DELETE CASCADE,
  document_ref text NOT NULL,
  verification_code text NOT NULL,
  storage_bucket text NOT NULL DEFAULT 'recruitment-documents',
  storage_path text NOT NULL,
  media_type text NOT NULL DEFAULT 'application/pdf',
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  signature text,
  classification text NOT NULL,
  watermark_text text NOT NULL,
  page_count integer NOT NULL DEFAULT 1,
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid,
  CONSTRAINT rec_comm_documents_request_once UNIQUE (request_id)
);

CREATE UNIQUE INDEX idx_rec_comm_documents_verify ON public.rec_comm_documents (document_ref, verification_code);

GRANT SELECT ON public.rec_comm_documents TO authenticated;
GRANT ALL ON public.rec_comm_documents TO service_role;
ALTER TABLE public.rec_comm_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read comm documents" ON public.rec_comm_documents
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- Issued documents and their snapshots are immutable historical records.
CREATE OR REPLACE FUNCTION public.rec_comm_block_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'immutable_record: % rows cannot be altered or deleted', TG_TABLE_NAME;
END $$;

CREATE TRIGGER trg_rec_comm_documents_immutable BEFORE UPDATE OR DELETE ON public.rec_comm_documents
  FOR EACH ROW EXECUTE FUNCTION public.rec_comm_block_mutation();
CREATE TRIGGER trg_rec_comm_snapshots_immutable BEFORE UPDATE OR DELETE ON public.rec_comm_snapshots
  FOR EACH ROW EXECUTE FUNCTION public.rec_comm_block_mutation();

-- ------------------------------------------------------- dispatch attempts
CREATE TABLE public.rec_comm_dispatch_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rec_comm_requests(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  outcome text NOT NULL,
  provider text,
  provider_message_id text,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_comm_attempt_once UNIQUE (request_id, attempt),
  CONSTRAINT rec_comm_attempt_outcome_chk CHECK (outcome IN ('provider_accepted','suppressed','failed'))
);

GRANT SELECT ON public.rec_comm_dispatch_attempts TO authenticated;
GRANT ALL ON public.rec_comm_dispatch_attempts TO service_role;
ALTER TABLE public.rec_comm_dispatch_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read comm attempts" ON public.rec_comm_dispatch_attempts
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE TRIGGER trg_rec_comm_attempts_immutable BEFORE UPDATE OR DELETE ON public.rec_comm_dispatch_attempts
  FOR EACH ROW EXECUTE FUNCTION public.rec_comm_block_mutation();

-- --------------------------------------------------------- provider events
CREATE TABLE public.rec_comm_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid REFERENCES public.rec_comm_requests(id) ON DELETE CASCADE,
  provider text NOT NULL,
  provider_message_id text,
  provider_event_id text NOT NULL,
  event_type text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_comm_provider_event_once UNIQUE (provider, provider_event_id),
  CONSTRAINT rec_comm_provider_event_type_chk CHECK (event_type IN (
    'queued','accepted','sent','delivered','opened','bounced','complaint','failed','suppressed'))
);

GRANT SELECT ON public.rec_comm_provider_events TO authenticated;
GRANT ALL ON public.rec_comm_provider_events TO service_role;
ALTER TABLE public.rec_comm_provider_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read comm provider events" ON public.rec_comm_provider_events
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE TRIGGER trg_rec_comm_provider_events_immutable BEFORE UPDATE OR DELETE ON public.rec_comm_provider_events
  FOR EACH ROW EXECUTE FUNCTION public.rec_comm_block_mutation();

-- ------------------------------------------------------- candidate actions
CREATE TABLE public.rec_comm_candidate_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.rec_comm_requests(id) ON DELETE CASCADE,
  interview_id uuid REFERENCES public.rec_interviews(id) ON DELETE SET NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  action text,
  note text,
  proposed_at timestamptz,
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_comm_candidate_action_chk CHECK (action IS NULL OR action IN ('confirmed','reschedule_requested','declined'))
);

GRANT SELECT ON public.rec_comm_candidate_actions TO authenticated;
GRANT ALL ON public.rec_comm_candidate_actions TO service_role;
ALTER TABLE public.rec_comm_candidate_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read candidate actions" ON public.rec_comm_candidate_actions
  FOR SELECT TO authenticated USING (public.rec_can_read());

-- --------------------------------------------------------- reconciliation
CREATE TABLE public.rec_comm_reconciliation_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  scanned integer NOT NULL DEFAULT 0,
  findings integer NOT NULL DEFAULT 0,
  repaired integer NOT NULL DEFAULT 0,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE public.rec_comm_reconciliation_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL REFERENCES public.rec_comm_reconciliation_runs(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.rec_comm_requests(id) ON DELETE CASCADE,
  finding_code text NOT NULL,
  severity text NOT NULL DEFAULT 'warning',
  observed_state text,
  action_taken text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rec_comm_reconciliation_runs TO authenticated;
GRANT SELECT ON public.rec_comm_reconciliation_findings TO authenticated;
GRANT ALL ON public.rec_comm_reconciliation_runs TO service_role;
GRANT ALL ON public.rec_comm_reconciliation_findings TO service_role;
ALTER TABLE public.rec_comm_reconciliation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_comm_reconciliation_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rec staff read recon runs" ON public.rec_comm_reconciliation_runs
  FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff read recon findings" ON public.rec_comm_reconciliation_findings
  FOR SELECT TO authenticated USING (public.rec_can_read());