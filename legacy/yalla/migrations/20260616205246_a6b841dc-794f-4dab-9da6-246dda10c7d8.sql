
CREATE TABLE public.admin_email_test_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  triggered_by_email TEXT,
  template_name TEXT,
  recipient_email TEXT,
  subject TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  edge_response JSONB,
  rendered_html TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'pending',
  delivery_message_id TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.admin_email_test_runs TO authenticated;
GRANT ALL ON public.admin_email_test_runs TO service_role;
ALTER TABLE public.admin_email_test_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage email test runs"
  ON public.admin_email_test_runs FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE INDEX idx_admin_email_test_runs_created ON public.admin_email_test_runs (created_at DESC);
