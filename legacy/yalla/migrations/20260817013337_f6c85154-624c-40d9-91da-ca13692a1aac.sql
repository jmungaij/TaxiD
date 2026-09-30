-- =====================================================================
-- Recruitment 360 — Forensic Candidate Migration & Intelligence Engine
-- Domain: recruitment (see docs/DOMAINS.md)
-- Part 1: structure, provenance, RLS
-- =====================================================================

CREATE TABLE public.rec_migration_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_no text NOT NULL UNIQUE,
  name text NOT NULL,
  source_kind text NOT NULL DEFAULT 'unknown'
    CHECK (source_kind IN ('external_ats','job_board','previous_system','email_applications','historical_archive','agency','manual_collection','other','unknown')),
  source_platform text,
  source_organization text,
  original_campaign text,
  import_date date,
  owner_staff_id uuid REFERENCES public.staff_members(id) ON DELETE SET NULL,
  notes text,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','ingesting','processing','review','importing','imported','partially_imported','rolled_back','failed','cancelled')),
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  totals jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  rollback_available boolean NOT NULL DEFAULT true,
  rolled_back_at timestamptz,
  rolled_back_by uuid,
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rec_migration_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.rec_migration_batches(id) ON DELETE CASCADE,
  original_file_name text NOT NULL,
  storage_path text NOT NULL,
  mime_type text,
  size_bytes bigint,
  sha256 text NOT NULL,
  file_kind text NOT NULL DEFAULT 'unknown'
    CHECK (file_kind IN ('structured','document','archive','unknown')),
  doc_type text NOT NULL DEFAULT 'cv'
    CHECK (doc_type IN ('cv','cover_letter','certificate','identification','portfolio','reference','other')),
  status text NOT NULL DEFAULT 'stored'
    CHECK (status IN ('stored','queued','parsing','parsed','failed','skipped')),
  parse_error text,
  extracted_text text,
  page_count integer,
  attempts integer NOT NULL DEFAULT 0,
  uploaded_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, sha256, original_file_name)
);
CREATE INDEX idx_rec_migration_files_batch ON public.rec_migration_files (batch_id, status);
CREATE INDEX idx_rec_migration_files_hash ON public.rec_migration_files (sha256);

CREATE TABLE public.rec_migration_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.rec_migration_batches(id) ON DELETE CASCADE,
  source_row_key text NOT NULL,
  source_row_no integer,
  source_platform text,
  source_candidate_ref text,
  source_application_ref text,
  source_vacancy_ref text,
  source_status text,
  source_applied_at timestamptz,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction jsonb NOT NULL DEFAULT '{}'::jsonb,
  extraction_confidence numeric,
  state text NOT NULL DEFAULT 'UPLOADED'
    CHECK (state IN ('UPLOADED','VALIDATING','QUEUED','PARSING','PARSED','IDENTITY_MATCHING','DUPLICATE_REVIEW','VACANCY_MAPPING','MATCHING','READY_FOR_REVIEW','APPROVED','REJECTED','IMPORTED','FAILED','EXCEPTION','ROLLED_BACK')),
  exception_code text,
  exception_reason text,
  candidate_id uuid REFERENCES public.rec_candidates(id) ON DELETE SET NULL,
  identity_match_kind text CHECK (identity_match_kind IN ('new','exact','probable','possible')),
  identity_similarity numeric,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  vacancy_map_kind text CHECK (vacancy_map_kind IN ('existing','historical','unmatched')),
  match_score numeric,
  match_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  review_decision text CHECK (review_decision IN ('import','import_after_review','do_not_import')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  imported_candidate_id uuid,
  imported_application_id uuid,
  imported_at timestamptz,
  import_outcome text,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, source_row_key)
);
CREATE INDEX idx_rec_migration_records_batch_state ON public.rec_migration_records (batch_id, state);
CREATE INDEX idx_rec_migration_records_candidate ON public.rec_migration_records (candidate_id);
CREATE INDEX idx_rec_migration_records_vacancy ON public.rec_migration_records (vacancy_id);

CREATE TABLE public.rec_migration_record_files (
  record_id uuid NOT NULL REFERENCES public.rec_migration_records(id) ON DELETE CASCADE,
  file_id uuid NOT NULL REFERENCES public.rec_migration_files(id) ON DELETE CASCADE,
  doc_type text NOT NULL DEFAULT 'cv',
  match_method text NOT NULL DEFAULT 'manual',
  match_confidence numeric,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (record_id, file_id)
);

CREATE TABLE public.rec_migration_duplicates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid NOT NULL REFERENCES public.rec_migration_batches(id) ON DELETE CASCADE,
  record_id uuid NOT NULL REFERENCES public.rec_migration_records(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  classification text NOT NULL CHECK (classification IN ('exact','probable','possible','different')),
  similarity numeric NOT NULL DEFAULT 0,
  signals jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolution text NOT NULL DEFAULT 'pending' CHECK (resolution IN ('pending','merged','kept_separate')),
  resolved_by uuid,
  resolved_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (record_id, candidate_id)
);
CREATE INDEX idx_rec_migration_dupes_batch ON public.rec_migration_duplicates (batch_id, resolution);

CREATE TABLE public.rec_migration_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  source_kind text NOT NULL DEFAULT 'unknown',
  source_platform text,
  mapping jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rec_migration_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id uuid REFERENCES public.rec_migration_batches(id) ON DELETE CASCADE,
  record_id uuid REFERENCES public.rec_migration_records(id) ON DELETE CASCADE,
  action text NOT NULL,
  actor_id uuid DEFAULT auth.uid(),
  before_state jsonb,
  after_state jsonb,
  reason text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rec_migration_events_batch ON public.rec_migration_events (batch_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Provenance on existing recruitment records (never rewrite history)
-- ---------------------------------------------------------------------
ALTER TABLE public.rec_candidates
  ADD COLUMN IF NOT EXISTS migration_batch_id uuid REFERENCES public.rec_migration_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_platform text,
  ADD COLUMN IF NOT EXISTS source_candidate_ref text,
  ADD COLUMN IF NOT EXISTS created_by_migration boolean NOT NULL DEFAULT false;

ALTER TABLE public.rec_applications
  ADD COLUMN IF NOT EXISTS migration_batch_id uuid REFERENCES public.rec_migration_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_platform text,
  ADD COLUMN IF NOT EXISTS source_application_ref text,
  ADD COLUMN IF NOT EXISTS source_vacancy_ref text,
  ADD COLUMN IF NOT EXISTS source_status text,
  ADD COLUMN IF NOT EXISTS source_applied_at timestamptz,
  ADD COLUMN IF NOT EXISTS created_by_migration boolean NOT NULL DEFAULT false;

ALTER TABLE public.rec_candidate_documents
  ADD COLUMN IF NOT EXISTS migration_batch_id uuid REFERENCES public.rec_migration_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS original_file_name text,
  ADD COLUMN IF NOT EXISTS file_hash text,
  ADD COLUMN IF NOT EXISTS version_no integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS is_preferred boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_by_migration boolean NOT NULL DEFAULT false;

ALTER TABLE public.rec_vacancies
  ADD COLUMN IF NOT EXISTS is_historical boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS migration_batch_id uuid REFERENCES public.rec_migration_batches(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_vacancy_ref text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_rec_candidate_documents_hash
  ON public.rec_candidate_documents (candidate_id, file_hash) WHERE file_hash IS NOT NULL;

-- ---------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_migration_batches TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_migration_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_migration_records TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_migration_record_files TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_migration_duplicates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rec_migration_mappings TO authenticated;
GRANT SELECT, INSERT ON public.rec_migration_events TO authenticated;
GRANT ALL ON public.rec_migration_batches TO service_role;
GRANT ALL ON public.rec_migration_files TO service_role;
GRANT ALL ON public.rec_migration_records TO service_role;
GRANT ALL ON public.rec_migration_record_files TO service_role;
GRANT ALL ON public.rec_migration_duplicates TO service_role;
GRANT ALL ON public.rec_migration_mappings TO service_role;
GRANT ALL ON public.rec_migration_events TO service_role;

-- ---------------------------------------------------------------------
-- RLS — staff read, staff write, admin delete
-- ---------------------------------------------------------------------
ALTER TABLE public.rec_migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_migration_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_migration_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_migration_record_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_migration_duplicates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_migration_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rec_migration_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rec staff read migration batches" ON public.rec_migration_batches FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write migration batches" ON public.rec_migration_batches FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update migration batches" ON public.rec_migration_batches FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete migration batches" ON public.rec_migration_batches FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read migration files" ON public.rec_migration_files FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write migration files" ON public.rec_migration_files FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update migration files" ON public.rec_migration_files FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete migration files" ON public.rec_migration_files FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read migration records" ON public.rec_migration_records FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write migration records" ON public.rec_migration_records FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update migration records" ON public.rec_migration_records FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete migration records" ON public.rec_migration_records FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read migration record files" ON public.rec_migration_record_files FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write migration record files" ON public.rec_migration_record_files FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update migration record files" ON public.rec_migration_record_files FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete migration record files" ON public.rec_migration_record_files FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read migration dupes" ON public.rec_migration_duplicates FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write migration dupes" ON public.rec_migration_duplicates FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update migration dupes" ON public.rec_migration_duplicates FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete migration dupes" ON public.rec_migration_duplicates FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read migration mappings" ON public.rec_migration_mappings FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff write migration mappings" ON public.rec_migration_mappings FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());
CREATE POLICY "rec staff update migration mappings" ON public.rec_migration_mappings FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());
CREATE POLICY "rec admin delete migration mappings" ON public.rec_migration_mappings FOR DELETE TO authenticated USING (public.is_platform_admin());

CREATE POLICY "rec staff read migration events" ON public.rec_migration_events FOR SELECT TO authenticated USING (public.rec_can_read());
CREATE POLICY "rec staff append migration events" ON public.rec_migration_events FOR INSERT TO authenticated WITH CHECK (public.rec_can_write());

-- Append-only audit trail
CREATE OR REPLACE FUNCTION public.rec_block_migration_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_migration_events is append-only';
END;
$$;
CREATE TRIGGER trg_rec_migration_events_immutable
  BEFORE UPDATE OR DELETE ON public.rec_migration_events
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_migration_audit_mutation();

-- Raw payload immutability: the original source evidence never changes.
CREATE OR REPLACE FUNCTION public.rec_migration_protect_raw()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.raw_payload IS DISTINCT FROM OLD.raw_payload THEN
    RAISE EXCEPTION 'raw_payload is immutable historical evidence';
  END IF;
  IF NEW.source_applied_at IS DISTINCT FROM OLD.source_applied_at
     OR NEW.source_status IS DISTINCT FROM OLD.source_status
     OR NEW.source_row_key IS DISTINCT FROM OLD.source_row_key THEN
    RAISE EXCEPTION 'source provenance fields are immutable';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_rec_migration_records_protect
  BEFORE UPDATE ON public.rec_migration_records
  FOR EACH ROW EXECUTE FUNCTION public.rec_migration_protect_raw();

CREATE TRIGGER trg_rec_migration_batches_touch BEFORE UPDATE ON public.rec_migration_batches
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
CREATE TRIGGER trg_rec_migration_files_touch BEFORE UPDATE ON public.rec_migration_files
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
CREATE TRIGGER trg_rec_migration_mappings_touch BEFORE UPDATE ON public.rec_migration_mappings
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();