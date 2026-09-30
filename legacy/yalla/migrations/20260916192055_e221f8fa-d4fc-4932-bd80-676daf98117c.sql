REVOKE SELECT ON public.logistics_service_config FROM anon, authenticated;

GRANT SELECT (
  offering_code, lifecycle, self_service_booking, enquiry_enabled,
  partner_eligibility_required, service_areas, operating_hours, pod_required,
  returns_policy, claims_policy, restricted_goods_policy, last_verified_at
) ON public.logistics_service_config TO anon, authenticated;

GRANT ALL ON public.logistics_service_config TO service_role;