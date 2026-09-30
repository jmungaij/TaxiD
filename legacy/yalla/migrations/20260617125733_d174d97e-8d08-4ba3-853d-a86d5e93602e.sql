
CREATE TABLE public.nav_integrity_threshold_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  environment text NOT NULL,
  threshold_id uuid,
  action text NOT NULL CHECK (action IN ('insert','update','delete')),
  changed_by uuid REFERENCES auth.users(id),
  changed_by_email text,
  old_values jsonb,
  new_values jsonb,
  diff jsonb,
  changed_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.nav_integrity_threshold_audit TO authenticated;
GRANT ALL ON public.nav_integrity_threshold_audit TO service_role;

ALTER TABLE public.nav_integrity_threshold_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins view threshold audit"
  ON public.nav_integrity_threshold_audit FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX idx_nav_threshold_audit_env_time
  ON public.nav_integrity_threshold_audit (environment, changed_at DESC);

CREATE OR REPLACE FUNCTION public.log_nav_threshold_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_email text;
  v_diff jsonb := '{}'::jsonb;
  v_old jsonb;
  v_new jsonb;
  v_key text;
BEGIN
  SELECT email INTO v_email FROM auth.users WHERE id = v_uid;

  IF TG_OP = 'INSERT' THEN
    v_new := to_jsonb(NEW);
    INSERT INTO public.nav_integrity_threshold_audit
      (environment, threshold_id, action, changed_by, changed_by_email, old_values, new_values, diff)
    VALUES (NEW.environment, NEW.id, 'insert', v_uid, v_email, NULL, v_new, v_new);
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    FOR v_key IN SELECT jsonb_object_keys(v_new) LOOP
      IF (v_old->v_key) IS DISTINCT FROM (v_new->v_key)
         AND v_key NOT IN ('updated_at') THEN
        v_diff := v_diff || jsonb_build_object(v_key,
          jsonb_build_object('old', v_old->v_key, 'new', v_new->v_key));
      END IF;
    END LOOP;
    IF v_diff <> '{}'::jsonb THEN
      INSERT INTO public.nav_integrity_threshold_audit
        (environment, threshold_id, action, changed_by, changed_by_email, old_values, new_values, diff)
      VALUES (NEW.environment, NEW.id, 'update', v_uid, v_email, v_old, v_new, v_diff);
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := to_jsonb(OLD);
    INSERT INTO public.nav_integrity_threshold_audit
      (environment, threshold_id, action, changed_by, changed_by_email, old_values, new_values, diff)
    VALUES (OLD.environment, OLD.id, 'delete', v_uid, v_email, v_old, NULL, v_old);
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_nav_threshold_audit ON public.nav_integrity_thresholds;
CREATE TRIGGER trg_nav_threshold_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.nav_integrity_thresholds
  FOR EACH ROW EXECUTE FUNCTION public.log_nav_threshold_change();
