-- 1) Application context
ALTER TABLE public.partner_applications
  ADD COLUMN IF NOT EXISTS intent_bring text,
  ADD COLUMN IF NOT EXISTS network_category text,
  ADD COLUMN IF NOT EXISTS maturity_level text,
  ADD COLUMN IF NOT EXISTS lifecycle_stage text,
  ADD COLUMN IF NOT EXISTS ab_variant text,
  ADD COLUMN IF NOT EXISTS session_id text;

-- 2) Intent profiles
CREATE TABLE IF NOT EXISTS public.partner_intent_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_email text NOT NULL,
  organisation_name text,
  contact_name text,
  contact_phone text,
  country text,
  city text,
  partner_type text,
  commercial_model text,
  intent_bring text,
  network_category text,
  maturity_level text,
  lifecycle_stage text,
  ab_variant text,
  session_id text,
  last_application_id uuid REFERENCES public.partner_applications(id) ON DELETE SET NULL,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  application_count integer NOT NULL DEFAULT 0,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_intent_profiles_email_key
  ON public.partner_intent_profiles (lower(contact_email));

GRANT SELECT ON public.partner_intent_profiles TO authenticated;
GRANT ALL ON public.partner_intent_profiles TO service_role;
ALTER TABLE public.partner_intent_profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_intent_profiles_staff_read ON public.partner_intent_profiles;
CREATE POLICY partner_intent_profiles_staff_read ON public.partner_intent_profiles
  FOR SELECT TO authenticated USING (public.yp_is_staff());

DROP TRIGGER IF EXISTS yp_touch_partner_intent_profiles ON public.partner_intent_profiles;
CREATE TRIGGER yp_touch_partner_intent_profiles BEFORE UPDATE ON public.partner_intent_profiles
  FOR EACH ROW EXECUTE FUNCTION public.yp_touch_updated_at();

-- 3) Lifecycle signals
CREATE TABLE IF NOT EXISTS public.partner_lifecycle_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  lifecycle_stage text NOT NULL,
  maturity_level text,
  network_category text,
  intent_bring text,
  ab_variant text,
  page_source text,
  work_item_id uuid REFERENCES public.partner_work_items(id) ON DELETE SET NULL,
  profile_id uuid REFERENCES public.partner_intent_profiles(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_lifecycle_signals_session
  ON public.partner_lifecycle_signals (session_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS partner_lifecycle_signals_dedupe
  ON public.partner_lifecycle_signals (session_id, lifecycle_stage);

GRANT SELECT ON public.partner_lifecycle_signals TO authenticated;
GRANT ALL ON public.partner_lifecycle_signals TO service_role;
ALTER TABLE public.partner_lifecycle_signals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_lifecycle_signals_staff_read ON public.partner_lifecycle_signals;
CREATE POLICY partner_lifecycle_signals_staff_read ON public.partner_lifecycle_signals
  FOR SELECT TO authenticated USING (public.yp_is_staff());

-- 4) Partner desk notifications
CREATE TABLE IF NOT EXISTS public.partner_staff_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  severity text NOT NULL DEFAULT 'info',
  work_item_id uuid REFERENCES public.partner_work_items(id) ON DELETE CASCADE,
  signal_id uuid REFERENCES public.partner_lifecycle_signals(id) ON DELETE CASCADE,
  profile_id uuid REFERENCES public.partner_intent_profiles(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  session_id text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  acknowledged_by uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT partner_staff_notifications_kind_chk CHECK (
    kind = ANY (ARRAY['lifecycle_stage_changed','intent_profile_created','intent_profile_updated','application_received'])
  ),
  CONSTRAINT partner_staff_notifications_severity_chk CHECK (
    severity = ANY (ARRAY['info','warning','critical'])
  )
);
CREATE INDEX IF NOT EXISTS idx_partner_staff_notifications_recent
  ON public.partner_staff_notifications (created_at DESC);

GRANT SELECT, UPDATE ON public.partner_staff_notifications TO authenticated;
GRANT ALL ON public.partner_staff_notifications TO service_role;
ALTER TABLE public.partner_staff_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS partner_staff_notifications_staff_read ON public.partner_staff_notifications;
CREATE POLICY partner_staff_notifications_staff_read ON public.partner_staff_notifications
  FOR SELECT TO authenticated USING (public.yp_is_staff());
DROP POLICY IF EXISTS partner_staff_notifications_staff_ack ON public.partner_staff_notifications;
CREATE POLICY partner_staff_notifications_staff_ack ON public.partner_staff_notifications
  FOR UPDATE TO authenticated USING (public.yp_is_staff()) WITH CHECK (public.yp_is_staff());

-- 5) Public lifecycle signal routine
CREATE OR REPLACE FUNCTION public.partner_lifecycle_signal(
  p_session_id text,
  p_stage text,
  p_level text DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_bring text DEFAULT NULL,
  p_variant text DEFAULT NULL,
  p_page text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session text := nullif(btrim(coalesce(p_session_id, '')), '');
  v_stage text := nullif(btrim(coalesce(p_stage, '')), '');
  v_recent integer;
  v_existing uuid;
  v_work_id uuid;
  v_signal_id uuid;
  v_code text;
BEGIN
  IF v_session IS NULL OR v_stage IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'session_and_stage_required');
  END IF;
  IF length(v_session) > 120 OR length(v_stage) > 60 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_input');
  END IF;

  -- Dedupe: one signal per session per stage.
  SELECT id INTO v_existing FROM public.partner_lifecycle_signals
   WHERE session_id = v_session AND lifecycle_stage = v_stage;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'deduped', true, 'signal_id', v_existing);
  END IF;

  -- Rate limit: a session may raise at most 12 stage signals per hour.
  SELECT count(*) INTO v_recent FROM public.partner_lifecycle_signals
   WHERE session_id = v_session AND created_at > now() - interval '1 hour';
  IF v_recent >= 12 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'rate_limited');
  END IF;

  v_code := 'YPL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));

  INSERT INTO public.partner_work_items (
    work_code, queue, title, detail, priority, sla_minutes, dedupe_key
  ) VALUES (
    v_code,
    'onboarding',
    'Partner interest at lifecycle stage: ' || v_stage,
    concat_ws(' · ',
      'Stage: ' || v_stage,
      CASE WHEN nullif(btrim(coalesce(p_level, '')), '') IS NOT NULL THEN 'Maturity level: ' || p_level END,
      CASE WHEN nullif(btrim(coalesce(p_category, '')), '') IS NOT NULL THEN 'Category: ' || p_category END,
      CASE WHEN nullif(btrim(coalesce(p_bring, '')), '') IS NOT NULL THEN 'Brings: ' || p_bring END,
      CASE WHEN nullif(btrim(coalesce(p_variant, '')), '') IS NOT NULL THEN 'Messaging variant: ' || p_variant END,
      'Session: ' || v_session
    ),
    'low',
    480,
    'yp-lifecycle:' || v_session || ':' || v_stage
  )
  ON CONFLICT (dedupe_key) DO NOTHING
  RETURNING id INTO v_work_id;

  IF v_work_id IS NULL THEN
    SELECT id INTO v_work_id FROM public.partner_work_items
     WHERE dedupe_key = 'yp-lifecycle:' || v_session || ':' || v_stage;
  END IF;

  INSERT INTO public.partner_lifecycle_signals (
    session_id, lifecycle_stage, maturity_level, network_category,
    intent_bring, ab_variant, page_source, work_item_id, created_by
  ) VALUES (
    v_session, v_stage,
    nullif(btrim(coalesce(p_level, '')), ''),
    nullif(btrim(coalesce(p_category, '')), ''),
    nullif(btrim(coalesce(p_bring, '')), ''),
    nullif(btrim(coalesce(p_variant, '')), ''),
    nullif(btrim(coalesce(p_page, '')), ''),
    v_work_id, auth.uid()
  )
  RETURNING id INTO v_signal_id;

  INSERT INTO public.partner_staff_notifications (
    kind, title, body, work_item_id, signal_id, session_id, context
  ) VALUES (
    'lifecycle_stage_changed',
    'Partner visitor moved to stage: ' || v_stage,
    concat_ws(' · ',
      CASE WHEN p_bring IS NOT NULL THEN 'Brings ' || p_bring END,
      CASE WHEN p_category IS NOT NULL THEN 'Category ' || p_category END,
      CASE WHEN p_level IS NOT NULL THEN 'Level ' || p_level END
    ),
    v_work_id, v_signal_id, v_session,
    jsonb_strip_nulls(jsonb_build_object(
      'stage', v_stage, 'level', p_level, 'category', p_category,
      'bring', p_bring, 'variant', p_variant, 'page', p_page
    ))
  );

  RETURN jsonb_build_object('ok', true, 'signal_id', v_signal_id, 'work_item_id', v_work_id);
END;
$$;

REVOKE ALL ON FUNCTION public.partner_lifecycle_signal(text, text, text, text, text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.partner_lifecycle_signal(text, text, text, text, text, text, text) TO anon, authenticated, service_role;

-- 6) Public intent-profile upsert
CREATE OR REPLACE FUNCTION public.partner_profile_upsert(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(nullif(btrim(coalesce(p_payload->>'contact_email', '')), ''));
  v_id uuid;
  v_created boolean := false;
BEGIN
  IF v_email IS NULL OR position('@' in v_email) < 2 OR length(v_email) > 200 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'valid_contact_email_required');
  END IF;

  SELECT id INTO v_id FROM public.partner_intent_profiles WHERE lower(contact_email) = v_email;

  IF v_id IS NULL THEN
    INSERT INTO public.partner_intent_profiles (
      contact_email, organisation_name, contact_name, contact_phone, country, city,
      partner_type, commercial_model, intent_bring, network_category, maturity_level,
      lifecycle_stage, ab_variant, session_id, last_application_id, application_count
    ) VALUES (
      v_email,
      left(nullif(btrim(coalesce(p_payload->>'organisation_name','')), ''), 200),
      left(nullif(btrim(coalesce(p_payload->>'contact_name','')), ''), 200),
      left(nullif(btrim(coalesce(p_payload->>'contact_phone','')), ''), 60),
      left(nullif(btrim(coalesce(p_payload->>'country','')), ''), 8),
      left(nullif(btrim(coalesce(p_payload->>'city','')), ''), 120),
      left(nullif(btrim(coalesce(p_payload->>'partner_type','')), ''), 60),
      left(nullif(btrim(coalesce(p_payload->>'commercial_model','')), ''), 60),
      left(nullif(btrim(coalesce(p_payload->>'intent_bring','')), ''), 60),
      left(nullif(btrim(coalesce(p_payload->>'network_category','')), ''), 80),
      left(nullif(btrim(coalesce(p_payload->>'maturity_level','')), ''), 60),
      left(nullif(btrim(coalesce(p_payload->>'lifecycle_stage','')), ''), 60),
      left(nullif(btrim(coalesce(p_payload->>'ab_variant','')), ''), 40),
      left(nullif(btrim(coalesce(p_payload->>'session_id','')), ''), 120),
      nullif(p_payload->>'application_id','')::uuid,
      CASE WHEN nullif(p_payload->>'application_id','') IS NULL THEN 0 ELSE 1 END
    )
    RETURNING id INTO v_id;
    v_created := true;
  ELSE
    UPDATE public.partner_intent_profiles SET
      organisation_name = coalesce(left(nullif(btrim(coalesce(p_payload->>'organisation_name','')), ''), 200), organisation_name),
      contact_name = coalesce(left(nullif(btrim(coalesce(p_payload->>'contact_name','')), ''), 200), contact_name),
      contact_phone = coalesce(left(nullif(btrim(coalesce(p_payload->>'contact_phone','')), ''), 60), contact_phone),
      country = coalesce(left(nullif(btrim(coalesce(p_payload->>'country','')), ''), 8), country),
      city = coalesce(left(nullif(btrim(coalesce(p_payload->>'city','')), ''), 120), city),
      partner_type = coalesce(left(nullif(btrim(coalesce(p_payload->>'partner_type','')), ''), 60), partner_type),
      commercial_model = coalesce(left(nullif(btrim(coalesce(p_payload->>'commercial_model','')), ''), 60), commercial_model),
      intent_bring = coalesce(left(nullif(btrim(coalesce(p_payload->>'intent_bring','')), ''), 60), intent_bring),
      network_category = coalesce(left(nullif(btrim(coalesce(p_payload->>'network_category','')), ''), 80), network_category),
      maturity_level = coalesce(left(nullif(btrim(coalesce(p_payload->>'maturity_level','')), ''), 60), maturity_level),
      lifecycle_stage = coalesce(left(nullif(btrim(coalesce(p_payload->>'lifecycle_stage','')), ''), 60), lifecycle_stage),
      ab_variant = coalesce(left(nullif(btrim(coalesce(p_payload->>'ab_variant','')), ''), 40), ab_variant),
      session_id = coalesce(left(nullif(btrim(coalesce(p_payload->>'session_id','')), ''), 120), session_id),
      last_application_id = coalesce(nullif(p_payload->>'application_id','')::uuid, last_application_id),
      application_count = application_count + CASE WHEN nullif(p_payload->>'application_id','') IS NULL THEN 0 ELSE 1 END
    WHERE id = v_id;
  END IF;

  INSERT INTO public.partner_staff_notifications (
    kind, title, body, profile_id, application_id, session_id, context
  ) VALUES (
    CASE WHEN v_created THEN 'intent_profile_created' ELSE 'intent_profile_updated' END,
    CASE WHEN v_created THEN 'New partner profile: ' ELSE 'Partner profile updated: ' END
      || coalesce(nullif(btrim(coalesce(p_payload->>'organisation_name','')), ''), v_email),
    concat_ws(' · ',
      CASE WHEN p_payload->>'intent_bring' IS NOT NULL THEN 'Brings ' || (p_payload->>'intent_bring') END,
      CASE WHEN p_payload->>'network_category' IS NOT NULL THEN 'Category ' || (p_payload->>'network_category') END,
      CASE WHEN p_payload->>'maturity_level' IS NOT NULL THEN 'Level ' || (p_payload->>'maturity_level') END,
      CASE WHEN p_payload->>'lifecycle_stage' IS NOT NULL THEN 'Stage ' || (p_payload->>'lifecycle_stage') END
    ),
    v_id,
    nullif(p_payload->>'application_id','')::uuid,
    left(nullif(btrim(coalesce(p_payload->>'session_id','')), ''), 120),
    jsonb_strip_nulls(jsonb_build_object(
      'intent_bring', p_payload->>'intent_bring',
      'network_category', p_payload->>'network_category',
      'maturity_level', p_payload->>'maturity_level',
      'lifecycle_stage', p_payload->>'lifecycle_stage',
      'ab_variant', p_payload->>'ab_variant'
    ))
  );

  RETURN jsonb_build_object('ok', true, 'profile_id', v_id, 'created', v_created);
END;
$$;

REVOKE ALL ON FUNCTION public.partner_profile_upsert(jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.partner_profile_upsert(jsonb) TO anon, authenticated, service_role;