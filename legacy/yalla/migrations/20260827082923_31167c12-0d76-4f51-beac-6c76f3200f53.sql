DO $tighten$
DECLARE
  spec jsonb := '[
    {"t":"platform_settings","p":"platform_settings_read_authenticated","perm":"staff.commercial.read","admin":true},
    {"t":"sales_lead_routing_rules","p":"Staff can read lead routing rules","perm":"staff.commercial.read"},
    {"t":"support_sla_policies","p":"Staff read sla policies","perm":"staff.commercial.read"},
    {"t":"doc_security_profiles","p":"security profiles readable by staff","perm":"staff.commercial.read"},
    {"t":"doc_source_systems","p":"source systems readable by staff","perm":"staff.commercial.read"},
    {"t":"payment_regression_fingerprints","p":"authenticated read fingerprints","perm":"staff.commercial.read"},
    {"t":"payment_qualification_failure_classes","p":"read failure classes","perm":"staff.commercial.read"},
    {"t":"workflow_registry","p":"Authenticated read workflow_registry","perm":"staff.commercial.read"},
    {"t":"dispatch_rule_versions","p":"rulever read","perm":"staff.partners.read"},
    {"t":"driver_risk_rules","p":"drr_read","perm":"staff.partners.read"},
    {"t":"intern_recruitment_weight_sets","p":"weight_sets_read","perm":"staff.people.read"},
    {"t":"posting_rules","p":"Auth can view posting rules","perm":"staff.commercial.read"},
    {"t":"charter_pdf_templates","p":"templates readable by authenticated","perm":"staff.commercial.read"},
    {"t":"app_pages","p":"app_pages readable by authenticated","perm":"staff.commercial.read"}
  ]'::jsonb;
  e jsonb;
BEGIN
  FOR e IN SELECT * FROM jsonb_array_elements(spec)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', e ->> 'p', e ->> 't');
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_staff_permission(%L) OR public.has_role(auth.uid(), ''super_admin''::app_role))',
      (e ->> 't') || '_staff_read', e ->> 't', e ->> 'perm'
    );
  END LOOP;
END;
$tighten$;