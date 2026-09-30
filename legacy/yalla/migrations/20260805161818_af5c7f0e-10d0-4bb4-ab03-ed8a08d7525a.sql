CREATE TABLE public.corporate_admin_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id uuid NOT NULL,
  corporate_id uuid NOT NULL,
  reason text,
  correlation_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 minutes'),
  ended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_admin_sessions_admin_idx ON public.corporate_admin_sessions (admin_user_id, started_at DESC);
CREATE INDEX corporate_admin_sessions_corp_idx ON public.corporate_admin_sessions (corporate_id, started_at DESC);

GRANT SELECT ON public.corporate_admin_sessions TO authenticated;
GRANT ALL ON public.corporate_admin_sessions TO service_role;
ALTER TABLE public.corporate_admin_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read manage-as sessions"
  ON public.corporate_admin_sessions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'compliance_admin')
    OR admin_user_id = auth.uid()
  );

CREATE TABLE public.corporate_admin_actions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id uuid NOT NULL,
  corporate_id uuid,
  session_id uuid REFERENCES public.corporate_admin_sessions(id) ON DELETE SET NULL,
  action text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text NOT NULL DEFAULT 'applied',
  error_reason text,
  correlation_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_admin_actions_corp_idx ON public.corporate_admin_actions (corporate_id, created_at DESC);
CREATE INDEX corporate_admin_actions_admin_idx ON public.corporate_admin_actions (admin_user_id, created_at DESC);

GRANT SELECT ON public.corporate_admin_actions TO authenticated;
GRANT ALL ON public.corporate_admin_actions TO service_role;
ALTER TABLE public.corporate_admin_actions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins read corporate admin actions"
  ON public.corporate_admin_actions FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'compliance_admin')
    OR public.has_role(auth.uid(), 'finance_admin')
  );