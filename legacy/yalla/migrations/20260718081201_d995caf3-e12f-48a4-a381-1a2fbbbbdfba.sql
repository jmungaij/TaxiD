
-- 1. Environment-aware promotion policy
CREATE TABLE public.payment_orchestrator_env_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL UNIQUE CHECK (environment IN ('development','testing','sandbox','production')),
  approval_mode text NOT NULL DEFAULT 'autonomous' CHECK (approval_mode IN ('autonomous','approval_required','dual_approval','emergency_override')),
  required_approver_count int NOT NULL DEFAULT 1,
  approver_roles text[] NOT NULL DEFAULT ARRAY['admin','super_admin'],
  approval_ttl_minutes int NOT NULL DEFAULT 60,
  emergency_override_role text NOT NULL DEFAULT 'super_admin',
  notification_channels text[] NOT NULL DEFAULT ARRAY['slack'],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_orchestrator_env_policy TO authenticated;
GRANT ALL ON public.payment_orchestrator_env_policy TO service_role;
ALTER TABLE public.payment_orchestrator_env_policy ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage env policy" ON public.payment_orchestrator_env_policy
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

INSERT INTO public.payment_orchestrator_env_policy (environment, approval_mode)
VALUES ('development','autonomous'),('testing','autonomous'),('sandbox','autonomous'),('production','approval_required');

-- 2. Signed approvals for production promotion
CREATE TABLE public.payment_orchestrator_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  correlation_id text NOT NULL,
  rollout_stage int NOT NULL,
  from_percent numeric NOT NULL,
  to_percent numeric NOT NULL,
  approver_user_id uuid REFERENCES auth.users(id),
  approver_role text,
  approval_timestamp timestamptz NOT NULL DEFAULT now(),
  approval_expiration timestamptz NOT NULL,
  readiness_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  reliability_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence_score numeric,
  signature text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired','consumed')),
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payment_orchestrator_approvals (status, approval_expiration);
CREATE INDEX ON public.payment_orchestrator_approvals (correlation_id);
GRANT SELECT, INSERT, UPDATE ON public.payment_orchestrator_approvals TO authenticated;
GRANT ALL ON public.payment_orchestrator_approvals TO service_role;
ALTER TABLE public.payment_orchestrator_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read approvals" ON public.payment_orchestrator_approvals
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "admins write approvals" ON public.payment_orchestrator_approvals
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "admins update pending approvals" ON public.payment_orchestrator_approvals
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 3. Manual overrides (immutable-once-inserted)
CREATE TABLE public.payment_manual_overrides (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_user_id uuid NOT NULL REFERENCES auth.users(id),
  operator_role text NOT NULL,
  action text NOT NULL CHECK (action IN ('force_promote','force_rollback','pause','resume','kill_switch_on','kill_switch_off')),
  from_percent numeric,
  to_percent numeric,
  justification text NOT NULL,
  signature text NOT NULL,
  expires_at timestamptz,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payment_manual_overrides (created_at DESC);
GRANT SELECT, INSERT ON public.payment_manual_overrides TO authenticated;
GRANT ALL ON public.payment_manual_overrides TO service_role;
ALTER TABLE public.payment_manual_overrides ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read overrides" ON public.payment_manual_overrides
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));
CREATE POLICY "super_admin write overrides" ON public.payment_manual_overrides
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(),'super_admin') AND operator_user_id = auth.uid());

-- 4. Reliability forecasts
CREATE TABLE public.payment_reliability_forecasts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  component text NOT NULL,
  current_status text,
  predicted_status text,
  probability numeric,
  eta_minutes int,
  likely_cause text,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payment_reliability_forecasts (component, computed_at DESC);
GRANT SELECT ON public.payment_reliability_forecasts TO authenticated;
GRANT ALL ON public.payment_reliability_forecasts TO service_role;
ALTER TABLE public.payment_reliability_forecasts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read forecasts" ON public.payment_reliability_forecasts
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

-- 5. Notification channels
CREATE TABLE public.payment_notification_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  channel_type text NOT NULL CHECK (channel_type IN ('slack','webhook','email')),
  target text NOT NULL,
  event_filter text[] NOT NULL DEFAULT ARRAY['*'],
  min_severity text NOT NULL DEFAULT 'info' CHECK (min_severity IN ('info','warn','critical')),
  active boolean NOT NULL DEFAULT true,
  secret_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_notification_channels TO authenticated;
GRANT ALL ON public.payment_notification_channels TO service_role;
ALTER TABLE public.payment_notification_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage channels" ON public.payment_notification_channels
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'))
  WITH CHECK (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

-- 6. Notification dispatch audit
CREATE TABLE public.payment_notification_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid REFERENCES public.payment_notification_channels(id),
  channel_type text NOT NULL,
  event_type text NOT NULL,
  correlation_id text,
  severity text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  response_code int,
  response_body text,
  attempt_count int NOT NULL DEFAULT 0,
  dispatched_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.payment_notification_dispatches (created_at DESC);
CREATE INDEX ON public.payment_notification_dispatches (event_type, status);
GRANT SELECT ON public.payment_notification_dispatches TO authenticated;
GRANT ALL ON public.payment_notification_dispatches TO service_role;
ALTER TABLE public.payment_notification_dispatches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read dispatches" ON public.payment_notification_dispatches
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'finance_admin'));

-- 7. Extend orchestrator decisions
ALTER TABLE public.payment_orchestrator_decisions
  ADD COLUMN IF NOT EXISTS confidence_score numeric,
  ADD COLUMN IF NOT EXISTS confidence_breakdown jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_dry_run boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rollback_simulation jsonb,
  ADD COLUMN IF NOT EXISTS approval_id uuid REFERENCES public.payment_orchestrator_approvals(id),
  ADD COLUMN IF NOT EXISTS environment text NOT NULL DEFAULT 'production',
  ADD COLUMN IF NOT EXISTS forecast_evidence jsonb;
