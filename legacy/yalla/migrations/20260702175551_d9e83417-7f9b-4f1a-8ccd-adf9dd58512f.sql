
CREATE TABLE IF NOT EXISTS public.corporate_registration_conflict_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid REFERENCES public.corporate_registration_drafts(id) ON DELETE SET NULL,
  session_key text,
  user_id uuid,
  op text NOT NULL,
  reason text NOT NULL DEFAULT 'already_submitted',
  correlation_id text,
  request_ip text,
  user_agent text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.corporate_registration_conflict_log TO authenticated;
GRANT ALL ON public.corporate_registration_conflict_log TO service_role;

ALTER TABLE public.corporate_registration_conflict_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view conflict log"
  ON public.corporate_registration_conflict_log
  FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'corporate_admin'));

CREATE INDEX IF NOT EXISTS idx_corp_reg_conflict_log_created ON public.corporate_registration_conflict_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_corp_reg_conflict_log_draft ON public.corporate_registration_conflict_log (draft_id);
CREATE INDEX IF NOT EXISTS idx_corp_reg_conflict_log_cid ON public.corporate_registration_conflict_log (correlation_id);
