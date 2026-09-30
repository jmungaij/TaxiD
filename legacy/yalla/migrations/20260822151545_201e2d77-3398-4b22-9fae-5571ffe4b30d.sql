-- YALLA PARTNERS — profile history, lifecycle audit, live signals
CREATE TABLE IF NOT EXISTS public.partner_profile_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.partner_intent_profiles(id) ON DELETE CASCADE,
  contact_email text NOT NULL,
  change_kind text NOT NULL CHECK (change_kind IN ('created','updated','reverted')),
  intent_bring text,
  network_category text,
  maturity_level text,
  lifecycle_stage text,
  commercial_model text,
  partner_type text,
  ab_variant text,
  session_id text,
  changed_fields text[] NOT NULL DEFAULT '{}',
  changed_by uuid,
  reverted_from_history_id uuid REFERENCES public.partner_profile_history(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_profile_history_profile_idx
  ON public.partner_profile_history(profile_id, created_at DESC);

GRANT SELECT ON public.partner_profile_history TO authenticated;
GRANT ALL ON public.partner_profile_history TO service_role;
ALTER TABLE public.partner_profile_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_profile_history_staff_read ON public.partner_profile_history;
CREATE POLICY partner_profile_history_staff_read ON public.partner_profile_history
  FOR SELECT TO authenticated USING (public.yp_is_staff());

CREATE OR REPLACE FUNCTION public._partner_profile_history_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_fields text[] := '{}';
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.intent_bring IS DISTINCT FROM OLD.intent_bring THEN v_fields := v_fields || 'intent_bring'; END IF;
    IF NEW.network_category IS DISTINCT FROM OLD.network_category THEN v_fields := v_fields || 'network_category'; END IF;
    IF NEW.maturity_level IS DISTINCT FROM OLD.maturity_level THEN v_fields := v_fields || 'maturity_level'; END IF;
    IF NEW.lifecycle_stage IS DISTINCT FROM OLD.lifecycle_stage THEN v_fields := v_fields || 'lifecycle_stage'; END IF;
    IF NEW.commercial_model IS DISTINCT FROM OLD.commercial_model THEN v_fields := v_fields || 'commercial_model'; END IF;
    IF NEW.partner_type IS DISTINCT FROM OLD.partner_type THEN v_fields := v_fields || 'partner_type'; END IF;
    IF array_length(v_fields, 1) IS NULL THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO public.partner_profile_history (
    profile_id, contact_email, change_kind, intent_bring, network_category,
    maturity_level, lifecycle_stage, commercial_model, partner_type,
    ab_variant, session_id, changed_fields, changed_by
  ) VALUES (
    NEW.id, NEW.contact_email,
    CASE WHEN TG_OP = 'INSERT' THEN 'created' ELSE 'updated' END,
    NEW.intent_bring, NEW.network_category, NEW.maturity_level, NEW.lifecycle_stage,
    NEW.commercial_model, NEW.partner_type, NEW.ab_variant, NEW.session_id,
    v_fields, auth.uid()
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS partner_profile_history_capture ON public.partner_intent_profiles;
CREATE TRIGGER partner_profile_history_capture
AFTER INSERT OR UPDATE ON public.partner_intent_profiles
FOR EACH ROW EXECUTE FUNCTION public._partner_profile_history_capture();

INSERT INTO public.partner_profile_history (
  profile_id, contact_email, change_kind, intent_bring, network_category,
  maturity_level, lifecycle_stage, commercial_model, partner_type, ab_variant, session_id, created_at
)
SELECT p.id, p.contact_email, 'created', p.intent_bring, p.network_category,
       p.maturity_level, p.lifecycle_stage, p.commercial_model, p.partner_type,
       p.ab_variant, p.session_id, p.created_at
FROM public.partner_intent_profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.partner_profile_history h WHERE h.profile_id = p.id);

CREATE OR REPLACE FUNCTION public.partner_profile_revert(p_history_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_h public.partner_profile_history; v_new uuid;
BEGIN
  IF NOT public.yp_is_staff() THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_authorised');
  END IF;
  SELECT * INTO v_h FROM public.partner_profile_history WHERE id = p_history_id;
  IF v_h.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'history_not_found');
  END IF;

  UPDATE public.partner_intent_profiles SET
    intent_bring = v_h.intent_bring,
    network_category = v_h.network_category,
    maturity_level = v_h.maturity_level,
    lifecycle_stage = v_h.lifecycle_stage,
    commercial_model = v_h.commercial_model,
    partner_type = v_h.partner_type,
    updated_at = now()
  WHERE id = v_h.profile_id;

  UPDATE public.partner_profile_history
     SET change_kind = 'reverted', reverted_from_history_id = v_h.id
   WHERE profile_id = v_h.profile_id
     AND created_at = (SELECT max(created_at) FROM public.partner_profile_history WHERE profile_id = v_h.profile_id);

  SELECT id INTO v_new FROM public.partner_profile_history
   WHERE profile_id = v_h.profile_id ORDER BY created_at DESC LIMIT 1;

  RETURN jsonb_build_object('ok', true, 'profile_id', v_h.profile_id, 'history_id', v_new);
END; $$;

REVOKE ALL ON FUNCTION public.partner_profile_revert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_profile_revert(uuid) TO authenticated;

CREATE TABLE IF NOT EXISTS public.partner_lifecycle_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_id uuid REFERENCES public.partner_lifecycle_signals(id) ON DELETE SET NULL,
  session_id text NOT NULL,
  profile_id uuid REFERENCES public.partner_intent_profiles(id) ON DELETE SET NULL,
  work_item_id uuid REFERENCES public.partner_work_items(id) ON DELETE SET NULL,
  previous_stage text,
  lifecycle_stage text NOT NULL,
  maturity_level text,
  network_category text,
  intent_bring text,
  ab_variant text,
  page_source text,
  actor_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_lifecycle_audit_session_idx
  ON public.partner_lifecycle_audit(session_id, created_at DESC);

GRANT SELECT ON public.partner_lifecycle_audit TO authenticated;
GRANT ALL ON public.partner_lifecycle_audit TO service_role;
ALTER TABLE public.partner_lifecycle_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS partner_lifecycle_audit_staff_read ON public.partner_lifecycle_audit;
CREATE POLICY partner_lifecycle_audit_staff_read ON public.partner_lifecycle_audit
  FOR SELECT TO authenticated USING (public.yp_is_staff());

CREATE OR REPLACE FUNCTION public._partner_lifecycle_audit_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'partner_lifecycle_audit is append-only';
END; $$;
DROP TRIGGER IF EXISTS partner_lifecycle_audit_immutable ON public.partner_lifecycle_audit;
CREATE TRIGGER partner_lifecycle_audit_immutable
BEFORE UPDATE OR DELETE ON public.partner_lifecycle_audit
FOR EACH ROW EXECUTE FUNCTION public._partner_lifecycle_audit_immutable();

CREATE OR REPLACE FUNCTION public._partner_lifecycle_audit_capture()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_prev text; v_profile uuid;
BEGIN
  SELECT lifecycle_stage INTO v_prev
    FROM public.partner_lifecycle_signals
   WHERE session_id = NEW.session_id AND id <> NEW.id
   ORDER BY created_at DESC LIMIT 1;

  SELECT id INTO v_profile FROM public.partner_intent_profiles
   WHERE session_id = NEW.session_id ORDER BY updated_at DESC LIMIT 1;

  INSERT INTO public.partner_lifecycle_audit (
    signal_id, session_id, profile_id, work_item_id, previous_stage,
    lifecycle_stage, maturity_level, network_category, intent_bring,
    ab_variant, page_source, actor_user_id
  ) VALUES (
    NEW.id, NEW.session_id, COALESCE(NEW.profile_id, v_profile), NEW.work_item_id, v_prev,
    NEW.lifecycle_stage, NEW.maturity_level, NEW.network_category, NEW.intent_bring,
    NEW.ab_variant, NEW.page_source, NEW.created_by
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS partner_lifecycle_audit_capture ON public.partner_lifecycle_signals;
CREATE TRIGGER partner_lifecycle_audit_capture
AFTER INSERT ON public.partner_lifecycle_signals
FOR EACH ROW EXECUTE FUNCTION public._partner_lifecycle_audit_capture();

INSERT INTO public.partner_lifecycle_audit (
  signal_id, session_id, profile_id, work_item_id, lifecycle_stage,
  maturity_level, network_category, intent_bring, ab_variant, page_source, created_at
)
SELECT s.id, s.session_id, s.profile_id, s.work_item_id, s.lifecycle_stage,
       s.maturity_level, s.network_category, s.intent_bring, s.ab_variant,
       s.page_source, s.created_at
FROM public.partner_lifecycle_signals s
WHERE NOT EXISTS (SELECT 1 FROM public.partner_lifecycle_audit a WHERE a.signal_id = s.id);

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_lifecycle_signals; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_lifecycle_audit; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_staff_notifications; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_profile_history; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;