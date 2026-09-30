CREATE OR REPLACE FUNCTION public.sales_engine_settings_set(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_before jsonb; v_after jsonb;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_SET_ENGINE_SETTINGS';
  END IF;
  SELECT to_jsonb(s) INTO v_before FROM public.sales_engine_settings s WHERE s.id;

  UPDATE public.sales_engine_settings SET
    business_days_only = coalesce((p->>'business_days_only')::boolean, business_days_only),
    warn_ratio = coalesce((p->>'warn_ratio')::numeric, warn_ratio),
    closing_soon_days = coalesce((p->>'closing_soon_days')::int, closing_soon_days),
    stale_followup_days = coalesce((p->>'stale_followup_days')::int, stale_followup_days),
    eligible_position_codes = CASE WHEN p ? 'eligible_position_codes'
      THEN (SELECT array_agg(value::text) FROM jsonb_array_elements_text(p->'eligible_position_codes') AS t(value))
      ELSE eligible_position_codes END,
    updated_at = now()
  WHERE id
  RETURNING to_jsonb(sales_engine_settings) INTO v_after;

  IF v_after IS NULL THEN RAISE EXCEPTION 'ENGINE_SETTINGS_MISSING'; END IF;

  INSERT INTO public.sales_target_events (action, scope, before_value, after_value, actor_user_id, note)
  VALUES ('ENGINE_SETTINGS_CHANGED', 'COMPANY', v_before, v_after, auth.uid(), p->>'notes');

  RETURN v_after;
END $$;
REVOKE EXECUTE ON FUNCTION public.sales_engine_settings_set(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_engine_settings_set(jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.sales_governance_overview()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_admin boolean;
BEGIN
  v_admin := public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin');
  IF NOT v_admin THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;

  RETURN jsonb_build_object(
    'settings', (SELECT to_jsonb(s) FROM public.sales_engine_settings s WHERE s.id),
    'targets', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', t.id, 'scope', t.scope, 'period', t.period, 'amount_kes', t.amount_kes,
        'position_code', t.position_code, 'staff_member_id', t.staff_member_id,
        'staff_name', coalesce(sm.preferred_name, sm.full_name),
        'effective_from', t.effective_from, 'effective_to', t.effective_to,
        'is_active', t.is_active, 'is_override', t.is_override, 'notes', t.notes
      ) ORDER BY t.is_active DESC, t.effective_from DESC), '[]'::jsonb)
      FROM public.sales_targets t LEFT JOIN public.staff_members sm ON sm.id = t.staff_member_id),
    'policies', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', pl.id, 'process', pl.process, 'label', pl.label, 'minutes', pl.minutes,
        'warn_ratio', pl.warn_ratio, 'pause_on_customer', pl.pause_on_customer,
        'is_active', pl.is_active, 'effective_from', pl.effective_from
      ) ORDER BY pl.process), '[]'::jsonb) FROM public.sales_sla_policies pl),
    'closures', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'period_start', c.period_start, 'period_end', c.period_end,
        'staff_member_id', c.staff_member_id,
        'staff_name', coalesce(sm.preferred_name, sm.full_name),
        'target_kes', c.target_kes, 'revenue_kes', c.revenue_kes,
        'attainment_pct', c.attainment_pct, 'won_count', c.won_count,
        'closed_at', c.created_at
      ) ORDER BY c.period_start DESC, c.revenue_kes DESC), '[]'::jsonb)
      FROM public.sales_period_closures c LEFT JOIN public.staff_members sm ON sm.id = c.staff_member_id),
    'roster', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'staff_id', sm.id, 'name', coalesce(sm.preferred_name, sm.full_name),
        'position_code', op.code, 'position', op.title,
        'target_kes', ((public.sales_target_for(sm.id, date_trunc('month', now())::date))->>'target_kes')::numeric
      ) ORDER BY coalesce(sm.preferred_name, sm.full_name)), '[]'::jsonb)
      FROM public.staff_members sm JOIN public.org_positions op ON op.id = sm.position_id
      WHERE sm.employment_status IN ('active','onboarding')
        AND op.code = ANY (public._sales_eligible_codes())),
    'positions', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', op.code, 'title', op.title)
        ORDER BY op.code), '[]'::jsonb) FROM public.org_positions op),
    'audit', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'action', e.action, 'scope', e.scope, 'staff_member_id', e.staff_member_id,
        'before_value', e.before_value, 'after_value', e.after_value,
        'note', e.note, 'created_at', e.created_at) ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM (SELECT * FROM public.sales_target_events ORDER BY created_at DESC LIMIT 50) e)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.sales_governance_overview() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.sales_governance_overview() TO authenticated;
