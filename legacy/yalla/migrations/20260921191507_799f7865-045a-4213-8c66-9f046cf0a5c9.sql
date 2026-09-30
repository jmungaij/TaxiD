-- Internal, unmasked commission computation. Money masking is a READ concern
-- and must never influence what is permanently recorded.
CREATE OR REPLACE FUNCTION public._commission_compute(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_sched public.commission_schedules;
  v_rule public.commission_rules;
  v_on date := coalesce(nullif(p->>'on_date','')::date, current_date);
  v_net numeric := coalesce((p->>'net_service_price')::numeric, 0);
  v_base_fare numeric := coalesce((p->>'base_fare')::numeric, v_net);
  v_tax numeric := coalesce((p->>'tax_amount')::numeric, 0);
  v_pass numeric := coalesce((p->>'pass_through_amount')::numeric, 0);
  v_surch numeric := coalesce((p->>'surcharge_amount')::numeric, 0);
  v_collected numeric := nullif(p->>'collected_amount','')::numeric;
  v_rate numeric; v_basis text; v_base numeric; v_amount numeric; v_total numeric;
BEGIN
  SELECT * INTO v_sched FROM public.commission_schedules
   WHERE code = coalesce(nullif(p->>'schedule_code',''),'platform_default')
     AND status = 'approved'
     AND (effective_from IS NULL OR effective_from <= v_on)
     AND (effective_to IS NULL OR effective_to >= v_on)
   ORDER BY version DESC LIMIT 1;
  IF v_sched.id IS NULL AND nullif(p->>'schedule_version','') IS NOT NULL THEN
    SELECT * INTO v_sched FROM public.commission_schedules
     WHERE code = coalesce(nullif(p->>'schedule_code',''),'platform_default')
       AND version = (p->>'schedule_version')::int LIMIT 1;
  END IF;
  IF v_sched.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_SCHEDULE_NOT_FOUND'; END IF;

  SELECT * INTO v_rule FROM public.commission_rules r
   WHERE r.schedule_id = v_sched.id AND r.active
     AND (r.effective_from IS NULL OR r.effective_from <= v_on)
     AND (r.effective_to IS NULL OR r.effective_to >= v_on)
     AND (r.service_code IS NULL OR r.service_code = p->>'service_code')
     AND (r.scope_label IS NULL OR r.scope_label = p->>'scope_label')
     AND (r.category_code IS NULL OR r.category_code = p->>'category_code')
     AND (r.city IS NULL OR r.city = p->>'city')
     AND (r.region IS NULL OR r.region = p->>'region')
     AND (r.country IS NULL OR r.country = p->>'country')
     AND (r.account_id IS NULL OR r.account_id = nullif(p->>'account_id','')::uuid)
     AND (r.customer_segment IS NULL OR r.customer_segment = p->>'customer_segment')
     AND (r.partner_id IS NULL OR r.partner_id = nullif(p->>'partner_id','')::uuid)
     AND (r.contract_id IS NULL OR r.contract_id = nullif(p->>'contract_id','')::uuid)
     AND (r.transaction_type IS NULL OR r.transaction_type = p->>'transaction_type')
     AND (r.partner_tier IS NULL OR r.partner_tier = p->>'partner_tier')
     AND (r.min_volume IS NULL OR coalesce((p->>'volume')::numeric,0) >= r.min_volume)
     AND (r.max_volume IS NULL OR coalesce((p->>'volume')::numeric,0) <= r.max_volume)
   ORDER BY r.priority ASC, r.created_at DESC LIMIT 1;

  v_rate := coalesce(nullif(p->>'override_rate_percent','')::numeric,
                     v_rule.rate_percent, v_sched.default_rate_percent);
  IF v_sched.min_rate_percent IS NOT NULL THEN v_rate := greatest(v_rate, v_sched.min_rate_percent); END IF;
  IF v_sched.max_rate_percent IS NOT NULL THEN v_rate := least(v_rate, v_sched.max_rate_percent); END IF;
  v_basis := coalesce(v_rule.basis, v_sched.default_basis);

  v_base := CASE v_basis
    WHEN 'base_fare' THEN v_base_fare
    WHEN 'service_price' THEN v_net + v_surch
    WHEN 'net_service_price' THEN v_net
    WHEN 'eligible_transaction_amount' THEN v_net
    WHEN 'completed_service_amount' THEN v_net
    WHEN 'collected_amount' THEN coalesce(v_collected, 0)
    WHEN 'gross_customer_total' THEN v_net + v_surch + v_tax + v_pass
    ELSE v_net END;

  v_amount := round(v_base * v_rate / 100.0, 2);
  IF v_rule.min_commission IS NOT NULL THEN v_amount := greatest(v_amount, v_rule.min_commission); END IF;
  IF v_rule.max_commission IS NOT NULL THEN v_amount := least(v_amount, v_rule.max_commission); END IF;
  v_total := v_net + v_surch + v_tax + v_pass;

  RETURN jsonb_build_object(
    'schedule_id', v_sched.id, 'schedule_code', v_sched.code,
    'schedule_version', v_sched.version, 'schedule_name', v_sched.name,
    'rule_id', v_rule.id, 'rule_label', v_rule.label,
    'rate_percent', v_rate, 'default_rate_percent', v_sched.default_rate_percent,
    'basis', v_basis, 'excluded_components', v_sched.excluded_components,
    'base_amount', v_base, 'commission_amount', v_amount,
    'supplier_payout', round(v_net + v_surch - v_amount, 2),
    'net_service_price', v_net, 'tax_amount', v_tax,
    'pass_through_amount', v_pass, 'surcharge_amount', v_surch,
    'customer_total', v_total,
    'price_stack', jsonb_build_array(
      jsonb_build_object('label','Net service price','amount', v_net),
      jsonb_build_object('label','Surcharges','amount', v_surch),
      jsonb_build_object('label','Pass-through charges','amount', v_pass),
      jsonb_build_object('label','Tax','amount', v_tax),
      jsonb_build_object('label','Customer total','amount', v_total)));
END $function$;

REVOKE ALL ON FUNCTION public._commission_compute(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._commission_compute(jsonb) FROM anon;
REVOKE ALL ON FUNCTION public._commission_compute(jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public._commission_compute(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.commission_resolve(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_r jsonb; v_money boolean;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;
  v_r := public._commission_compute(p);
  v_money := public._commission_may_see_money();
  IF NOT v_money THEN
    v_r := v_r - 'base_amount' - 'commission_amount' - 'supplier_payout'
           || jsonb_build_object('base_amount', NULL, 'commission_amount', NULL,
                                 'supplier_payout', NULL);
  END IF;
  RETURN v_r || jsonb_build_object('money_visible', v_money);
END $function$;

CREATE OR REPLACE FUNCTION public.commission_snapshot_record(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_full jsonb; v_id uuid; v_key text;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  v_key := coalesce(nullif(p->>'idempotency_key',''),
                    (p->>'source_kind') || ':' || (p->>'source_id'));
  SELECT id INTO v_id FROM public.commission_resolutions WHERE idempotency_key = v_key;
  IF v_id IS NOT NULL THEN
    RETURN jsonb_build_object('resolution_id', v_id, 'created', false);
  END IF;

  -- Always record the full economics; visibility is applied on read only.
  v_full := public._commission_compute(p);

  INSERT INTO public.commission_resolutions (
    source_kind, source_id, idempotency_key, schedule_id, schedule_code, schedule_version,
    rule_id, rate_percent, basis, excluded_components, currency, base_amount, commission_amount,
    net_service_price, tax_amount, pass_through_amount, customer_total, supplier_payout,
    price_stack, account_id, owner_staff_id, created_by)
  VALUES (
    coalesce(p->>'source_kind','manual'), coalesce(p->>'source_id', v_key), v_key,
    (v_full->>'schedule_id')::uuid, v_full->>'schedule_code', (v_full->>'schedule_version')::int,
    nullif(v_full->>'rule_id','')::uuid, (v_full->>'rate_percent')::numeric, v_full->>'basis',
    v_full->'excluded_components', coalesce(p->>'currency','KES'),
    (v_full->>'base_amount')::numeric, (v_full->>'commission_amount')::numeric,
    (v_full->>'net_service_price')::numeric, (v_full->>'tax_amount')::numeric,
    (v_full->>'pass_through_amount')::numeric, (v_full->>'customer_total')::numeric,
    (v_full->>'supplier_payout')::numeric, v_full->'price_stack',
    nullif(p->>'account_id','')::uuid, nullif(p->>'owner_staff_id','')::uuid, auth.uid())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('resolution_id', v_id, 'created', true,
                            'resolution', public.commission_resolve(p));
END $function$;

-- One-time audited repair for records stored with masked (zero) money.
CREATE OR REPLACE FUNCTION public._commission_resolution_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'UPDATE'
     AND coalesce(current_setting('yalla.commission_money_repair', true),'') = 'on'
     AND OLD.commission_amount = 0 AND OLD.base_amount = 0
     AND OLD.rate_percent = NEW.rate_percent
     AND OLD.schedule_version = NEW.schedule_version
     AND OLD.net_service_price = NEW.net_service_price THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'COMMISSION_RESOLUTION_APPEND_ONLY';
END $function$;

CREATE OR REPLACE FUNCTION public.commission_resolution_repair_money()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE r record; v_fixed integer := 0; v_base numeric; v_amount numeric;
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND coalesce(current_setting('request.jwt.claim.role', true),'') <> 'service_role'
     AND NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not_authorised: platform administrators only';
  END IF;

  PERFORM set_config('yalla.commission_money_repair','on', true);
  FOR r IN SELECT * FROM public.commission_resolutions
            WHERE commission_amount = 0 AND base_amount = 0 AND net_service_price > 0 LOOP
    v_base := CASE r.basis
      WHEN 'gross_customer_total' THEN r.customer_total
      ELSE r.net_service_price END;
    v_amount := round(v_base * r.rate_percent / 100.0, 2);
    UPDATE public.commission_resolutions
       SET base_amount = v_base, commission_amount = v_amount,
           supplier_payout = round(r.net_service_price - v_amount, 2)
     WHERE id = r.id;
    INSERT INTO public.commission_audit_events (schedule_id, action, actor, new_value, reason)
    VALUES (r.schedule_id, 'resolution_money_repaired', auth.uid(),
            jsonb_build_object('resolution_id', r.id, 'base_amount', v_base,
                               'commission_amount', v_amount, 'rate_percent', r.rate_percent),
            'Snapshot was stored with masked (zero) money because the recorder could not view money figures.');
    v_fixed := v_fixed + 1;
  END LOOP;
  PERFORM set_config('yalla.commission_money_repair','off', true);
  RETURN jsonb_build_object('repaired', v_fixed);
END $function$;

REVOKE ALL ON FUNCTION public.commission_resolution_repair_money() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_resolution_repair_money() FROM anon;
GRANT EXECUTE ON FUNCTION public.commission_resolution_repair_money() TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_resolution_repair_money() TO service_role;