DROP POLICY IF EXISTS platform_settings_read_all ON public.platform_settings;
CREATE POLICY platform_settings_read_authenticated ON public.platform_settings FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.platform_settings FROM anon;

DROP POLICY IF EXISTS tassess_read ON public.training_assessments;
CREATE POLICY tassess_read ON public.training_assessments FOR SELECT TO authenticated USING (true);
REVOKE SELECT ON public.training_assessments FROM anon;