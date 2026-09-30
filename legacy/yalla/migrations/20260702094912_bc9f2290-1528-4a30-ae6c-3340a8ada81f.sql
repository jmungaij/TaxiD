
-- Corporate KYB audit log: records who did what (ack, rescan, etc.)
CREATE TABLE public.corporate_kyb_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,                       -- 'notification_ack' | 'rescan_manual' | 'rescan_throttled' | 'notification_ack_failed'
  actor_kind TEXT NOT NULL,                   -- 'admin' | 'applicant' | 'system'
  actor_id UUID,                              -- admin user id if applicable
  actor_session_key TEXT,                     -- applicant session key if applicable
  draft_id UUID,
  document_id UUID,
  notification_id UUID,
  outcome TEXT NOT NULL,                      -- 'ok' | 'failed' | 'throttled'
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX corporate_kyb_audit_log_draft_idx    ON public.corporate_kyb_audit_log(draft_id, created_at DESC);
CREATE INDEX corporate_kyb_audit_log_actor_idx    ON public.corporate_kyb_audit_log(actor_id, created_at DESC);
CREATE INDEX corporate_kyb_audit_log_action_idx   ON public.corporate_kyb_audit_log(action, created_at DESC);

GRANT SELECT ON public.corporate_kyb_audit_log TO authenticated;
GRANT ALL   ON public.corporate_kyb_audit_log TO service_role;
ALTER TABLE public.corporate_kyb_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read corp kyb audit log"
  ON public.corporate_kyb_audit_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- Notification ack retry/backoff state on the notifications table.
ALTER TABLE public.corporate_registration_notifications
  ADD COLUMN IF NOT EXISTS ack_attempts INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ack_last_error TEXT,
  ADD COLUMN IF NOT EXISTS ack_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ack_next_retry_at TIMESTAMPTZ;

-- Cooldowns for manual rescans (per draft / per document / per admin).
CREATE TABLE public.corporate_kyb_rescan_cooldowns (
  scope TEXT NOT NULL,          -- 'draft' | 'document' | 'admin'
  key   TEXT NOT NULL,          -- draft_id / document_id / admin user id
  last_run_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  run_count_1m INT NOT NULL DEFAULT 1,
  window_started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
GRANT SELECT ON public.corporate_kyb_rescan_cooldowns TO authenticated;
GRANT ALL   ON public.corporate_kyb_rescan_cooldowns TO service_role;
ALTER TABLE public.corporate_kyb_rescan_cooldowns ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins can read rescan cooldowns"
  ON public.corporate_kyb_rescan_cooldowns FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));
