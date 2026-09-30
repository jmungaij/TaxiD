-- ============================================================
-- Recruitment 360 — Fulfilment spine: validation → interview →
-- evaluation → final selection → offer → acceptance →
-- pre-employment checks → onboarding → Staff Register (exactly once)
-- plus idempotent candidate communication jobs.
-- ============================================================

-- 1. Pre-employment checks -----------------------------------------------
CREATE TABLE IF NOT EXISTS public.rec_preemployment_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  offer_id uuid REFERENCES public.rec_offers(id) ON DELETE SET NULL,
  onboarding_case_id uuid REFERENCES public.rec_onboarding_cases(id) ON DELETE SET NULL,
  check_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  is_blocking boolean NOT NULL DEFAULT true,
  provider text,
  reference text,
  notes text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_preemp_status_chk CHECK (status IN ('pending','in_progress','passed','failed','waived')),
  CONSTRAINT rec_preemp_unique UNIQUE (application_id, check_type)
);
GRANT SELECT, INSERT, UPDATE ON public.rec_preemployment_checks TO authenticated;
GRANT ALL ON public.rec_preemployment_checks TO service_role;
ALTER TABLE public.rec_preemployment_checks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recruiters read pre-employment checks" ON public.rec_preemployment_checks
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());
CREATE POLICY "recruiters manage pre-employment checks" ON public.rec_preemployment_checks
  FOR UPDATE TO authenticated USING (public.rec_can_write()) WITH CHECK (public.rec_can_write());

-- 2. Idempotent notification jobs ---------------------------------------
CREATE TABLE IF NOT EXISTS public.rec_notification_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  transition_key text NOT NULL,
  channel text NOT NULL DEFAULT 'email',
  template_key text NOT NULL,
  recipient text NOT NULL,
  subject text,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued',
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text,
  delivered_at timestamptz,
  last_error text,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rec_notif_channel_chk CHECK (channel IN ('email','sms','in_app')),
  CONSTRAINT rec_notif_status_chk CHECK (status IN ('queued','sending','sent','delivered','failed','suppressed')),
  CONSTRAINT rec_notif_once UNIQUE (application_id, transition_key, channel)
);
GRANT SELECT ON public.rec_notification_jobs TO authenticated;
GRANT ALL ON public.rec_notification_jobs TO service_role;
ALTER TABLE public.rec_notification_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recruiters read notification jobs" ON public.rec_notification_jobs
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());

CREATE TABLE IF NOT EXISTS public.rec_notification_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.rec_notification_jobs(id) ON DELETE CASCADE,
  attempt integer NOT NULL,
  outcome text NOT NULL,
  provider text,
  provider_message_id text,
  error text,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_notification_deliveries TO authenticated;
GRANT ALL ON public.rec_notification_deliveries TO service_role;
ALTER TABLE public.rec_notification_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recruiters read notification deliveries" ON public.rec_notification_deliveries
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());

CREATE OR REPLACE FUNCTION public.rec_block_delivery_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_notification_deliveries is append-only';
END; $$;
DROP TRIGGER IF EXISTS rec_delivery_append_only ON public.rec_notification_deliveries;
CREATE TRIGGER rec_delivery_append_only BEFORE UPDATE OR DELETE ON public.rec_notification_deliveries
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_delivery_mutation();

-- 3. Exactly-once staff provisioning ledger -----------------------------
CREATE TABLE IF NOT EXISTS public.rec_staff_provisioning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE REFERENCES public.rec_applications(id) ON DELETE CASCADE,
  onboarding_case_id uuid NOT NULL REFERENCES public.rec_onboarding_cases(id) ON DELETE CASCADE,
  staff_member_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE RESTRICT,
  staff_no text NOT NULL,
  provisioned_by uuid DEFAULT auth.uid(),
  provisioned_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.rec_staff_provisioning TO authenticated;
GRANT ALL ON public.rec_staff_provisioning TO service_role;
ALTER TABLE public.rec_staff_provisioning ENABLE ROW LEVEL SECURITY;
CREATE POLICY "recruiters read staff provisioning" ON public.rec_staff_provisioning
  FOR SELECT TO authenticated USING (public.rec_is_recruiter());

CREATE OR REPLACE FUNCTION public.rec_block_provisioning_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'rec_staff_provisioning is immutable (exactly-once hire ledger)';
END; $$;
DROP TRIGGER IF EXISTS rec_provisioning_immutable ON public.rec_staff_provisioning;
CREATE TRIGGER rec_provisioning_immutable BEFORE UPDATE OR DELETE ON public.rec_staff_provisioning
  FOR EACH ROW EXECUTE FUNCTION public.rec_block_provisioning_mutation();

DROP TRIGGER IF EXISTS rec_preemp_touch ON public.rec_preemployment_checks;
CREATE TRIGGER rec_preemp_touch BEFORE UPDATE ON public.rec_preemployment_checks
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();
DROP TRIGGER IF EXISTS rec_notif_touch ON public.rec_notification_jobs;
CREATE TRIGGER rec_notif_touch BEFORE UPDATE ON public.rec_notification_jobs
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();

-- 4. Notification enqueue / delivery RPCs -------------------------------
CREATE OR REPLACE FUNCTION public.rec_enqueue_notification(
  p_application_id uuid,
  p_transition_key text,
  p_template_key text,
  p_channel text DEFAULT 'email',
  p_subject text DEFAULT NULL,
  p_body text DEFAULT NULL,
  p_payload jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_app record; v_cand record; v_recipient text; v_id uuid; v_created boolean := false;
BEGIN
  SELECT * INTO v_app FROM public.rec_applications WHERE id = p_application_id;
  IF v_app.id IS NULL THEN RAISE EXCEPTION 'application not found'; END IF;
  SELECT * INTO v_cand FROM public.rec_candidates WHERE id = v_app.candidate_id;

  v_recipient := CASE WHEN p_channel = 'sms' THEN COALESCE(v_cand.phone, '') ELSE COALESCE(v_cand.email, '') END;
  IF v_recipient = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_recipient_for_channel', 'channel', p_channel);
  END IF;

  INSERT INTO public.rec_notification_jobs (
    application_id, candidate_id, transition_key, channel, template_key, recipient, subject, body, payload
  ) VALUES (
    p_application_id, v_app.candidate_id, p_transition_key, p_channel, p_template_key,
    v_recipient, p_subject, p_body, COALESCE(p_payload, '{}'::jsonb)
  )
  ON CONFLICT (application_id, transition_key, channel) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NOT NULL THEN
    v_created := true;
  ELSE
    SELECT id INTO v_id FROM public.rec_notification_jobs
     WHERE application_id = p_application_id AND transition_key = p_transition_key AND channel = p_channel;
  END IF;

  RETURN jsonb_build_object('ok', true, 'job_id', v_id, 'created', v_created, 'deduplicated', NOT v_created);
END; $$;

CREATE OR REPLACE FUNCTION public.rec_notification_claim(p_limit integer DEFAULT 20)
RETURNS SETOF public.rec_notification_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized: notification worker only';
  END IF;
  RETURN QUERY
  UPDATE public.rec_notification_jobs j
     SET status = 'sending', attempts = j.attempts + 1, claimed_at = now(), updated_at = now()
   WHERE j.id IN (
     SELECT id FROM public.rec_notification_jobs
      WHERE status IN ('queued','failed') AND attempts < 5
      ORDER BY created_at
      LIMIT GREATEST(1, LEAST(p_limit, 100))
      FOR UPDATE SKIP LOCKED
   )
  RETURNING j.*;
END; $$;

CREATE OR REPLACE FUNCTION public.rec_notification_record_delivery(
  p_job_id uuid,
  p_outcome text,
  p_provider text DEFAULT NULL,
  p_provider_message_id text DEFAULT NULL,
  p_error text DEFAULT NULL,
  p_detail jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_job record;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorized: notification worker only';
  END IF;
  IF p_outcome NOT IN ('sent','delivered','failed','suppressed') THEN
    RAISE EXCEPTION 'invalid outcome %', p_outcome;
  END IF;
  SELECT * INTO v_job FROM public.rec_notification_jobs WHERE id = p_job_id;
  IF v_job.id IS NULL THEN RAISE EXCEPTION 'notification job not found'; END IF;

  INSERT INTO public.rec_notification_deliveries (job_id, attempt, outcome, provider, provider_message_id, error, detail)
  VALUES (p_job_id, v_job.attempts, p_outcome, p_provider, p_provider_message_id, p_error, COALESCE(p_detail,'{}'::jsonb));

  UPDATE public.rec_notification_jobs
     SET status = p_outcome,
         provider_message_id = COALESCE(p_provider_message_id, provider_message_id),
         delivered_at = CASE WHEN p_outcome IN ('sent','delivered') THEN now() ELSE delivered_at END,
         last_error = CASE WHEN p_outcome = 'failed' THEN p_error ELSE NULL END,
         updated_at = now()
   WHERE id = p_job_id;

  IF p_outcome IN ('sent','delivered') AND v_job.application_id IS NOT NULL THEN
    INSERT INTO public.rec_communications (candidate_id, application_id, channel, direction, subject, body, template_key, status, sent_at)
    VALUES (v_job.candidate_id, v_job.application_id, v_job.channel, 'outbound', v_job.subject, v_job.body, v_job.template_key, p_outcome, now());
  END IF;

  INSERT INTO public.rec_audit_events (actor_id, action, object_type, object_id, new_state, source)
  VALUES (NULL, 'notification.' || p_outcome, 'rec_notification_job', p_job_id,
          jsonb_build_object('transition_key', v_job.transition_key, 'channel', v_job.channel, 'attempt', v_job.attempts),
          'rec_notification_worker');

  RETURN jsonb_build_object('ok', true, 'status', p_outcome);
END; $$;