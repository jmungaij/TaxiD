-- 1. Delivery log observability columns
ALTER TABLE public.email_send_log
  ADD COLUMN IF NOT EXISTS provider TEXT,
  ADD COLUMN IF NOT EXISTS provider_message_id TEXT,
  ADD COLUMN IF NOT EXISTS route TEXT,
  ADD COLUMN IF NOT EXISTS subject TEXT,
  ADD COLUMN IF NOT EXISTS attempt INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS email_send_log_recipient_idx ON public.email_send_log (lower(recipient_email));
CREATE INDEX IF NOT EXISTS email_send_log_route_idx ON public.email_send_log (route);
CREATE INDEX IF NOT EXISTS email_send_log_created_idx ON public.email_send_log (created_at DESC);

-- 2. Dead letter store (queryable mirror of the pgmq DLQ)
CREATE TABLE IF NOT EXISTS public.email_dead_letters (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  queue TEXT NOT NULL,
  message_id TEXT,
  template_name TEXT,
  recipient_email TEXT,
  route TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  reprocessed_at TIMESTAMPTZ,
  reprocessed_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT ON public.email_dead_letters TO authenticated;
GRANT ALL ON public.email_dead_letters TO service_role;
ALTER TABLE public.email_dead_letters ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_dead_letters_admin_read" ON public.email_dead_letters;
CREATE POLICY "email_dead_letters_admin_read" ON public.email_dead_letters
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

-- 3. Versioned template system
CREATE TABLE IF NOT EXISTS public.email_templates (
  name TEXT NOT NULL PRIMARY KEY,
  display_name TEXT NOT NULL,
  description TEXT,
  active_version INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_template_versions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  template_name TEXT NOT NULL REFERENCES public.email_templates(name) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  subject TEXT NOT NULL,
  html_body TEXT NOT NULL,
  text_body TEXT,
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (template_name, version)
);

GRANT SELECT, INSERT, UPDATE ON public.email_templates TO authenticated;
GRANT ALL ON public.email_templates TO service_role;
GRANT SELECT, INSERT ON public.email_template_versions TO authenticated;
GRANT ALL ON public.email_template_versions TO service_role;

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_template_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "email_templates_admin_all" ON public.email_templates;
CREATE POLICY "email_templates_admin_all" ON public.email_templates
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

DROP POLICY IF EXISTS "email_template_versions_admin_read" ON public.email_template_versions;
CREATE POLICY "email_template_versions_admin_read" ON public.email_template_versions
  FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','compliance_admin']::app_role[]));

DROP POLICY IF EXISTS "email_template_versions_admin_insert" ON public.email_template_versions;
CREATE POLICY "email_template_versions_admin_insert" ON public.email_template_versions
  FOR INSERT TO authenticated
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]));

-- Seed the two managed templates (content overrides are optional)
INSERT INTO public.email_templates (name, display_name, description)
VALUES
  ('contact-confirmation', 'Enquiry confirmation (user)', 'Sent to a visitor after they submit a contact or enquiry form.'),
  ('staff-access-credentials', 'Staff access credentials', 'Sent to a staff member with their sign-in details for the staff gateway.')
ON CONFLICT (name) DO NOTHING;

-- 4. Admin reprocess helper: re-queues a dead-lettered email
CREATE OR REPLACE FUNCTION public.email_dlq_reprocess(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row public.email_dead_letters;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  SELECT * INTO v_row FROM public.email_dead_letters WHERE id = p_id FOR UPDATE;
  IF v_row.id IS NULL THEN
    RAISE EXCEPTION 'dead letter not found';
  END IF;
  IF v_row.status = 'reprocessed' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_reprocessed');
  END IF;

  PERFORM public.enqueue_email(
    COALESCE(v_row.queue, 'transactional_emails'),
    v_row.payload || jsonb_build_object('queued_at', now(), 'reprocessed_from', v_row.id)
  );

  UPDATE public.email_dead_letters
     SET status = 'reprocessed',
         reprocessed_at = now(),
         reprocessed_by = auth.uid()
   WHERE id = p_id;

  RETURN jsonb_build_object('ok', true, 'queue', COALESCE(v_row.queue, 'transactional_emails'));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.email_dlq_reprocess(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.email_dlq_reprocess(UUID) TO authenticated, service_role;