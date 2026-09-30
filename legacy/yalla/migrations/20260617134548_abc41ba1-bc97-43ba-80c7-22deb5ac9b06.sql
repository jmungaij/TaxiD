
-- ============== Phase 1: Admin Identity + Document Review Queue ==============

-- 0. Helper: ensure compliance_admin role exists in app_role enum (no-op if present)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
                 WHERE t.typname = 'app_role' AND e.enumlabel = 'compliance_admin') THEN
    ALTER TYPE public.app_role ADD VALUE 'compliance_admin';
  END IF;
EXCEPTION WHEN undefined_object THEN
  -- app_role doesn't exist; skip silently
  NULL;
END$$;

-- Shared updated_at trigger fn (idempotent)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

-- =========================================================================
-- 1. admin_sessions
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ip_address INET,
  user_agent TEXT,
  device_id TEXT,
  device_label TEXT,
  country TEXT,
  city TEXT,
  risk_score NUMERIC(5,2) DEFAULT 0,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON public.admin_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_active ON public.admin_sessions(user_id) WHERE revoked_at IS NULL;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_sessions TO authenticated;
GRANT ALL ON public.admin_sessions TO service_role;
ALTER TABLE public.admin_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage all sessions" ON public.admin_sessions FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users view own sessions" ON public.admin_sessions FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_admin_sessions_updated BEFORE UPDATE ON public.admin_sessions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 2. admin_login_attempts
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_login_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  ip_address INET,
  user_agent TEXT,
  country TEXT,
  success BOOLEAN NOT NULL DEFAULT false,
  failure_reason TEXT,
  risk_score NUMERIC(5,2) DEFAULT 0,
  mfa_used BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_email ON public.admin_login_attempts(lower(email));
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_user ON public.admin_login_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_admin_login_attempts_time ON public.admin_login_attempts(created_at DESC);

GRANT SELECT, INSERT ON public.admin_login_attempts TO authenticated;
GRANT ALL ON public.admin_login_attempts TO service_role;
ALTER TABLE public.admin_login_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins view all login attempts" ON public.admin_login_attempts FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users view own login attempts" ON public.admin_login_attempts FOR SELECT TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "system inserts attempts" ON public.admin_login_attempts FOR INSERT TO authenticated
  WITH CHECK (true);

-- =========================================================================
-- 3. admin_device_registry
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_device_registry (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  device_fingerprint TEXT NOT NULL,
  device_label TEXT,
  os TEXT,
  browser TEXT,
  trusted BOOLEAN NOT NULL DEFAULT false,
  trusted_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, device_fingerprint)
);
CREATE INDEX IF NOT EXISTS idx_admin_devices_user ON public.admin_device_registry(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_device_registry TO authenticated;
GRANT ALL ON public.admin_device_registry TO service_role;
ALTER TABLE public.admin_device_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage all devices" ON public.admin_device_registry FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin') OR public.has_role(auth.uid(), 'admin'));
CREATE POLICY "users view own devices" ON public.admin_device_registry FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER trg_admin_devices_updated BEFORE UPDATE ON public.admin_device_registry
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 4. admin_mfa_devices
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_mfa_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  factor_type TEXT NOT NULL CHECK (factor_type IN ('totp','sms','email')),
  label TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  enrolled_at TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_mfa_user ON public.admin_mfa_devices(user_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_mfa_devices TO authenticated;
GRANT ALL ON public.admin_mfa_devices TO service_role;
ALTER TABLE public.admin_mfa_devices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own mfa" ON public.admin_mfa_devices FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "super_admins view all mfa" ON public.admin_mfa_devices FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER trg_admin_mfa_updated BEFORE UPDATE ON public.admin_mfa_devices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 5. admin_backup_codes
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.admin_backup_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_admin_backup_codes_user ON public.admin_backup_codes(user_id);

GRANT SELECT, INSERT, UPDATE ON public.admin_backup_codes TO authenticated;
GRANT ALL ON public.admin_backup_codes TO service_role;
ALTER TABLE public.admin_backup_codes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own backup codes" ON public.admin_backup_codes FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- =========================================================================
-- 6. document_review_queue
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.document_review_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID REFERENCES public.drivers(id) ON DELETE CASCADE,
  driver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  document_type TEXT NOT NULL,
  kyc_stage TEXT NOT NULL DEFAULT 'initial' CHECK (kyc_stage IN ('initial','enhanced','renewal','periodic_review','reverification')),
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('draft','submitted','pending_review','under_investigation','approved','rejected','expired','suspended','fraud_review','resubmission_required')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','critical')),
  file_url TEXT,
  file_meta JSONB DEFAULT '{}'::jsonb,
  ocr_payload JSONB DEFAULT '{}'::jsonb,
  ai_flags JSONB DEFAULT '[]'::jsonb,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_at TIMESTAMPTZ,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_reason TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drq_status ON public.document_review_queue(status);
CREATE INDEX IF NOT EXISTS idx_drq_stage ON public.document_review_queue(kyc_stage);
CREATE INDEX IF NOT EXISTS idx_drq_driver ON public.document_review_queue(driver_id);
CREATE INDEX IF NOT EXISTS idx_drq_assigned ON public.document_review_queue(assigned_to);
CREATE INDEX IF NOT EXISTS idx_drq_submitted ON public.document_review_queue(submitted_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_review_queue TO authenticated;
GRANT ALL ON public.document_review_queue TO service_role;
ALTER TABLE public.document_review_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage doc queue" ON public.document_review_queue FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  );
CREATE POLICY "drivers view own queue" ON public.document_review_queue FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid());

CREATE TRIGGER trg_drq_updated BEFORE UPDATE ON public.document_review_queue
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 7. document_review_actions  (append-only log)
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.document_review_actions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.document_review_queue(id) ON DELETE CASCADE,
  action_type TEXT NOT NULL CHECK (action_type IN ('approve','reject','request_resubmission','escalate','assign','reassign','note','flag_fraud','expire')),
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  payload JSONB DEFAULT '{}'::jsonb,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dra_queue ON public.document_review_actions(queue_id);
CREATE INDEX IF NOT EXISTS idx_dra_time ON public.document_review_actions(created_at DESC);

GRANT SELECT, INSERT ON public.document_review_actions TO authenticated;
GRANT ALL ON public.document_review_actions TO service_role;
ALTER TABLE public.document_review_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage doc actions" ON public.document_review_actions FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  );

-- =========================================================================
-- 8. document_review_notes
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.document_review_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.document_review_queue(id) ON DELETE CASCADE,
  author_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  internal BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_drn_queue ON public.document_review_notes(queue_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_review_notes TO authenticated;
GRANT ALL ON public.document_review_notes TO service_role;
ALTER TABLE public.document_review_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage doc notes" ON public.document_review_notes FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  );

-- =========================================================================
-- 9. document_escalations
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.document_escalations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id UUID NOT NULL REFERENCES public.document_review_queue(id) ON DELETE CASCADE,
  opened_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','closed')),
  reason TEXT NOT NULL,
  resolution TEXT,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_de_queue ON public.document_escalations(queue_id);
CREATE INDEX IF NOT EXISTS idx_de_status ON public.document_escalations(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.document_escalations TO authenticated;
GRANT ALL ON public.document_escalations TO service_role;
ALTER TABLE public.document_escalations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage escalations" ON public.document_escalations FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  );

CREATE TRIGGER trg_de_updated BEFORE UPDATE ON public.document_escalations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================================
-- 10. driver_compliance_scores
-- =========================================================================
CREATE TABLE IF NOT EXISTS public.driver_compliance_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id UUID NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  driver_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (overall_score BETWEEN 0 AND 100),
  documents_score NUMERIC(5,2) DEFAULT 0,
  freshness_score NUMERIC(5,2) DEFAULT 0,
  training_score NUMERIC(5,2) DEFAULT 0,
  incident_score NUMERIC(5,2) DEFAULT 0,
  rating_score NUMERIC(5,2) DEFAULT 0,
  verification_score NUMERIC(5,2) DEFAULT 0,
  band TEXT GENERATED ALWAYS AS (
    CASE
      WHEN overall_score >= 80 THEN 'green'
      WHEN overall_score >= 50 THEN 'yellow'
      ELSE 'red'
    END
  ) STORED,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (driver_id)
);
CREATE INDEX IF NOT EXISTS idx_dcs_band ON public.driver_compliance_scores(band);
CREATE INDEX IF NOT EXISTS idx_dcs_overall ON public.driver_compliance_scores(overall_score);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_compliance_scores TO authenticated;
GRANT ALL ON public.driver_compliance_scores TO service_role;
ALTER TABLE public.driver_compliance_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins manage scores" ON public.driver_compliance_scores FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'admin') OR
    public.has_role(auth.uid(), 'compliance_admin')
  );
CREATE POLICY "driver views own score" ON public.driver_compliance_scores FOR SELECT TO authenticated
  USING (driver_user_id = auth.uid());

CREATE TRIGGER trg_dcs_updated BEFORE UPDATE ON public.driver_compliance_scores
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
