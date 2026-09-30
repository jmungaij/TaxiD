-- ============ Pricing 360 feature flags ============
CREATE TABLE public.pricing360_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT true,
  note text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing360_feature_flags TO authenticated;
GRANT INSERT, UPDATE ON public.pricing360_feature_flags TO authenticated;
GRANT ALL ON public.pricing360_feature_flags TO service_role;

ALTER TABLE public.pricing360_feature_flags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read pricing flags"
  ON public.pricing360_feature_flags FOR SELECT TO authenticated
  USING (public.is_staff_portal_member(auth.uid()) OR public.is_platform_admin());

CREATE POLICY "admin write pricing flags"
  ON public.pricing360_feature_flags FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "admin update pricing flags"
  ON public.pricing360_feature_flags FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ============ Pricing 360 role permission grants ============
CREATE TABLE public.pricing360_role_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL,
  permission text NOT NULL,
  allowed boolean NOT NULL DEFAULT false,
  reason text NOT NULL DEFAULT '',
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role, permission)
);

GRANT SELECT ON public.pricing360_role_grants TO authenticated;
GRANT INSERT, UPDATE ON public.pricing360_role_grants TO authenticated;
GRANT ALL ON public.pricing360_role_grants TO service_role;

ALTER TABLE public.pricing360_role_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read pricing grants"
  ON public.pricing360_role_grants FOR SELECT TO authenticated
  USING (public.is_staff_portal_member(auth.uid()) OR public.is_platform_admin());

CREATE POLICY "admin insert pricing grants"
  ON public.pricing360_role_grants FOR INSERT TO authenticated
  WITH CHECK (public.is_platform_admin());

CREATE POLICY "admin update pricing grants"
  ON public.pricing360_role_grants FOR UPDATE TO authenticated
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- Shared updated_at trigger
CREATE OR REPLACE FUNCTION public.touch_pricing360_governance()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_touch_pricing360_flags
  BEFORE UPDATE ON public.pricing360_feature_flags
  FOR EACH ROW EXECUTE FUNCTION public.touch_pricing360_governance();

CREATE TRIGGER trg_touch_pricing360_grants
  BEFORE UPDATE ON public.pricing360_role_grants
  FOR EACH ROW EXECUTE FUNCTION public.touch_pricing360_governance();