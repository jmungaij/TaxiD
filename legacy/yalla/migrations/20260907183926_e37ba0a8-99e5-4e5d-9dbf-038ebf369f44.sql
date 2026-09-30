ALTER TABLE public.sales_engine_settings
  ADD COLUMN IF NOT EXISTS eligible_position_codes text[] NOT NULL
  DEFAULT ARRAY['YML-SAL-CSS-001','SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD'];

CREATE OR REPLACE FUNCTION public._sales_eligible_codes()
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce((SELECT eligible_position_codes FROM public.sales_engine_settings WHERE id),
                  ARRAY['YML-SAL-CSS-001','SLS-MOB','SLS-SUP','SLS-PRT','SLS-LEAD']);
$$;
REVOKE EXECUTE ON FUNCTION public._sales_eligible_codes() FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.sales_route_resolve(_ctx jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_account uuid := nullif(_ctx->>'account_id','')::uuid;
  v_service text := _ctx->>'service'; v_country text := _ctx->>'country';
  v_city text := _ctx->>'city'; v_terr text := _ctx->>'territory'; v_tier text := _ctx->>'tier';
  a record; v_id uuid; v_rule uuid; v_codes text[] := public._sales_eligible_codes();
BEGIN
  IF v_account IS NOT NULL THEN
    SELECT * INTO a FROM public.crm_accounts WHERE id = v_account;
    v_terr := coalesce(v_terr, a.territory); v_city := coalesce(v_city, a.city);
    v_country := coalesce(v_country, a.country); v_tier := coalesce(v_tier, a.importance_tier);
    IF a.strategic_owner_staff_id IS NOT NULL AND coalesce(a.importance_tier,'') IN ('key','strategic') THEN
      RETURN jsonb_build_object('staff_id', a.strategic_owner_staff_id, 'rule_kind','STRATEGIC_OWNER',
        'reason','Strategic account owner retained for account continuity');
    END IF;
    IF a.owner_staff_id IS NOT NULL THEN
      RETURN jsonb_build_object('staff_id', a.owner_staff_id, 'rule_kind','ACCOUNT_OWNER',
        'reason','Existing account owner retained for account continuity');
    END IF;
  END IF;

  SELECT r.staff_member_id, r.id INTO v_id, v_rule
    FROM public.sales_routing_rules r
    JOIN public.staff_members s ON s.id = r.staff_member_id AND s.employment_status IN ('active','onboarding')
   WHERE r.is_active AND r.kind = 'TERRITORY'
     AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND (r.match_country IS NULL OR r.match_country = v_country)
     AND (r.match_city IS NULL OR r.match_city = v_city)
     AND (r.match_territory IS NULL OR r.match_territory = v_terr)
   ORDER BY r.priority, r.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','TERRITORY','rule_id',v_rule,'reason','Territory rule');
  END IF;

  SELECT r.staff_member_id, r.id INTO v_id, v_rule
    FROM public.sales_routing_rules r
    JOIN public.staff_members s ON s.id = r.staff_member_id AND s.employment_status IN ('active','onboarding')
   WHERE r.is_active AND r.kind = 'CAPABILITY'
     AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
     AND (r.match_service IS NULL OR coalesce(v_service,'') ILIKE '%'||r.match_service||'%')
     AND (r.match_tier IS NULL OR r.match_tier = v_tier)
   ORDER BY r.priority, r.created_at LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','CAPABILITY','rule_id',v_rule,'reason','Service capability rule');
  END IF;

  SELECT s.id, r.id INTO v_id, v_rule
    FROM public.sales_routing_rules r
    JOIN public.staff_members s ON s.unit_id = r.unit_id AND s.employment_status IN ('active','onboarding')
   WHERE r.is_active AND r.kind = 'TEAM' AND r.unit_id IS NOT NULL
     AND r.effective_from <= current_date AND (r.effective_to IS NULL OR r.effective_to >= current_date)
   ORDER BY r.priority,
     (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = s.id
       AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), s.created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','TEAM','rule_id',v_rule,'reason','Team assignment rule');
  END IF;

  SELECT s.id INTO v_id
    FROM public.staff_members s
    JOIN public.org_positions p ON p.id = s.position_id
   WHERE s.employment_status IN ('active','onboarding')
     AND p.code = ANY (v_codes)
   ORDER BY (SELECT count(*) FROM public.sales_leads l WHERE l.sales_staff_id = s.id
              AND l.stage NOT IN ('CLOSED_WON','CLOSED_LOST','DISQUALIFIED')), s.created_at
   LIMIT 1;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','CAPACITY','reason','Lightest open workload among eligible specialists');
  END IF;

  SELECT s.id INTO v_id FROM public.staff_members s
    LEFT JOIN public.org_units u ON u.id = s.unit_id
   WHERE s.employment_status IN ('active','onboarding') AND coalesce(u.name,'') ILIKE '%sales%'
   ORDER BY s.created_at LIMIT 1;
  RETURN jsonb_build_object('staff_id', v_id, 'rule_kind','FALLBACK','reason','First available sales unit member');
END $$;
REVOKE EXECUTE ON FUNCTION public.sales_route_resolve(jsonb) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.sales_period_close(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_start date := coalesce((p->>'period_start')::date, date_trunc('month', now() - interval '1 month')::date);
        v_end date; v_n int := 0; s record; f jsonb; t numeric;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_CLOSE_PERIOD';
  END IF;
  v_start := date_trunc('month', v_start)::date;
  v_end := (v_start + interval '1 month')::date;

  FOR s IN SELECT sm.id FROM public.staff_members sm
             JOIN public.org_positions op ON op.id = sm.position_id
            WHERE sm.employment_status IN ('active','onboarding')
              AND op.code = ANY (public._sales_eligible_codes())
  LOOP
    f := public._sales_person_figures(s.id, v_start::timestamptz, v_end::timestamptz, false);
    t := ((public.sales_target_for(s.id, v_start))->>'target_kes')::numeric;
    INSERT INTO public.sales_period_closures
      (period_start, period_end, staff_member_id, target_kes, revenue_kes, attainment_pct,
       won_count, decided_count, open_pipeline_kes, snapshot, closed_by)
    VALUES (v_start, v_end - 1, s.id, coalesce(t,0), (f->>'revenue_won_kes')::numeric,
       CASE WHEN coalesce(t,0) > 0 THEN round((f->>'revenue_won_kes')::numeric * 100 / t, 2) END,
       (f->>'won_count')::int, (f->>'decided_count')::int, (f->>'open_pipeline_kes')::numeric,
       f || jsonb_build_object('target_kes', coalesce(t,0)), auth.uid())
    ON CONFLICT (period_start, staff_member_id) DO NOTHING;
    v_n := v_n + 1;
  END LOOP;
  RETURN jsonb_build_object('period_start', v_start, 'period_end', v_end - 1, 'people', v_n);
END $$;
REVOKE EXECUTE ON FUNCTION public.sales_period_close(jsonb) FROM PUBLIC, anon;
