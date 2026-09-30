
-- ============ COMMISSION ENGINE =============================================
CREATE TABLE IF NOT EXISTS public.commission_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  name text NOT NULL,
  version int NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','pending_approval','approved','retired')),
  default_rate_percent numeric NOT NULL CHECK (default_rate_percent >= 0 AND default_rate_percent <= 100),
  min_rate_percent numeric CHECK (min_rate_percent IS NULL OR (min_rate_percent >= 0 AND min_rate_percent <= 100)),
  max_rate_percent numeric CHECK (max_rate_percent IS NULL OR (max_rate_percent >= 0 AND max_rate_percent <= 100)),
  default_basis text NOT NULL DEFAULT 'net_service_price'
    CHECK (default_basis IN ('base_fare','service_price','net_service_price',
                             'eligible_transaction_amount','completed_service_amount',
                             'collected_amount','gross_customer_total')),
  excluded_components jsonb NOT NULL DEFAULT '["tax","pass_through","surcharge"]'::jsonb,
  effective_from date,
  effective_to date,
  supersedes_id uuid REFERENCES public.commission_schedules(id),
  change_summary text,
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

CREATE TABLE IF NOT EXISTS public.commission_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES public.commission_schedules(id) ON DELETE CASCADE,
  label text NOT NULL,
  priority int NOT NULL DEFAULT 100,
  service_code text,
  scope_label text,
  category_code text,
  country text,
  region text,
  city text,
  account_id uuid,
  customer_segment text,
  partner_id uuid,
  operator_id uuid,
  fleet_id uuid,
  contract_id uuid,
  transaction_type text,
  partner_tier text,
  promotion_code text,
  min_volume numeric,
  max_volume numeric,
  rate_percent numeric NOT NULL CHECK (rate_percent >= 0 AND rate_percent <= 100),
  basis text CHECK (basis IS NULL OR basis IN ('base_fare','service_price','net_service_price',
    'eligible_transaction_amount','completed_service_amount','collected_amount','gross_customer_total')),
  min_commission numeric,
  max_commission numeric,
  effective_from date,
  effective_to date,
  reason text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commission_rules_schedule_idx ON public.commission_rules (schedule_id, priority);

CREATE TABLE IF NOT EXISTS public.commission_resolutions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_kind text NOT NULL,
  source_id text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  schedule_id uuid NOT NULL REFERENCES public.commission_schedules(id),
  schedule_code text NOT NULL,
  schedule_version int NOT NULL,
  rule_id uuid REFERENCES public.commission_rules(id),
  rate_percent numeric NOT NULL,
  basis text NOT NULL,
  excluded_components jsonb NOT NULL DEFAULT '[]'::jsonb,
  currency text NOT NULL DEFAULT 'KES',
  base_amount numeric NOT NULL,
  commission_amount numeric NOT NULL,
  net_service_price numeric NOT NULL DEFAULT 0,
  tax_amount numeric NOT NULL DEFAULT 0,
  pass_through_amount numeric NOT NULL DEFAULT 0,
  customer_total numeric NOT NULL DEFAULT 0,
  supplier_payout numeric NOT NULL DEFAULT 0,
  price_stack jsonb NOT NULL DEFAULT '[]'::jsonb,
  account_id uuid,
  owner_staff_id uuid,
  calculated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);
CREATE INDEX IF NOT EXISTS commission_resolutions_source_idx ON public.commission_resolutions (source_kind, source_id);

CREATE TABLE IF NOT EXISTS public.commission_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid,
  rule_id uuid,
  action text NOT NULL,
  actor uuid,
  old_value jsonb,
  new_value jsonb,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.commission_schedules TO authenticated;
GRANT SELECT ON public.commission_rules TO authenticated;
GRANT SELECT ON public.commission_resolutions TO authenticated;
GRANT SELECT ON public.commission_audit_events TO authenticated;
GRANT ALL ON public.commission_schedules TO service_role;
GRANT ALL ON public.commission_rules TO service_role;
GRANT ALL ON public.commission_resolutions TO service_role;
GRANT ALL ON public.commission_audit_events TO service_role;

ALTER TABLE public.commission_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_resolutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commission_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commission schedules readable by commercial staff"
  ON public.commission_schedules FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.has_staff_permission('staff.commercial.read')
         OR public.has_staff_permission('staff.pricing.read')
         OR public.has_staff_permission('staff.finance.read'));

CREATE POLICY "commission rules readable by commercial staff"
  ON public.commission_rules FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.has_staff_permission('staff.commercial.read')
         OR public.has_staff_permission('staff.pricing.read')
         OR public.has_staff_permission('staff.finance.read'));

CREATE POLICY "commission resolutions readable by finance and pricing"
  ON public.commission_resolutions FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.has_staff_permission('staff.finance.read')
         OR public.has_staff_permission('staff.pricing.manage'));

CREATE POLICY "commission audit readable by finance and pricing"
  ON public.commission_audit_events FOR SELECT TO authenticated
  USING (public.is_platform_admin() OR public.has_staff_permission('staff.finance.read')
         OR public.has_staff_permission('staff.pricing.manage'));

CREATE OR REPLACE FUNCTION public._commission_touch() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS commission_schedules_touch ON public.commission_schedules;
CREATE TRIGGER commission_schedules_touch BEFORE UPDATE ON public.commission_schedules
FOR EACH ROW EXECUTE FUNCTION public._commission_touch();
DROP TRIGGER IF EXISTS commission_rules_touch ON public.commission_rules;
CREATE TRIGGER commission_rules_touch BEFORE UPDATE ON public.commission_rules
FOR EACH ROW EXECUTE FUNCTION public._commission_touch();

-- Published schedules and historical resolutions are immutable.
CREATE OR REPLACE FUNCTION public._commission_schedule_immutable() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.status = 'approved' AND NEW.status = 'approved'
     AND (NEW.default_rate_percent <> OLD.default_rate_percent
          OR NEW.default_basis <> OLD.default_basis
          OR NEW.excluded_components <> OLD.excluded_components) THEN
    RAISE EXCEPTION 'COMMISSION_SCHEDULE_IMMUTABLE: publish a new version instead';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS commission_schedule_immutable ON public.commission_schedules;
CREATE TRIGGER commission_schedule_immutable BEFORE UPDATE ON public.commission_schedules
FOR EACH ROW EXECUTE FUNCTION public._commission_schedule_immutable();

CREATE OR REPLACE FUNCTION public._commission_resolution_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'COMMISSION_RESOLUTION_APPEND_ONLY'; END $$;
DROP TRIGGER IF EXISTS commission_resolution_append_only ON public.commission_resolutions;
CREATE TRIGGER commission_resolution_append_only BEFORE UPDATE OR DELETE
ON public.commission_resolutions FOR EACH ROW
EXECUTE FUNCTION public._commission_resolution_append_only();

CREATE OR REPLACE FUNCTION public._commission_audit_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'COMMISSION_AUDIT_APPEND_ONLY'; END $$;
DROP TRIGGER IF EXISTS commission_audit_append_only ON public.commission_audit_events;
CREATE TRIGGER commission_audit_append_only BEFORE UPDATE OR DELETE
ON public.commission_audit_events FOR EACH ROW
EXECUTE FUNCTION public._commission_audit_append_only();

-- Seed: the configured platform default (15%), not a hardcoded rule.
INSERT INTO public.commission_schedules (
  code, name, version, status, default_rate_percent, min_rate_percent, max_rate_percent,
  default_basis, excluded_components, effective_from, change_summary, approved_at, published_at)
SELECT 'platform_default', 'Yalla platform commission', 1, 'approved', 15, 0, 30,
       'net_service_price', '["tax","pass_through","surcharge"]'::jsonb, current_date,
       'Initial configured default: 15% of net service price, excluding tax and pass-through charges.',
       now(), now()
WHERE NOT EXISTS (SELECT 1 FROM public.commission_schedules WHERE code = 'platform_default');

-- ---- authority helper ------------------------------------------------------
CREATE OR REPLACE FUNCTION public._commission_may_configure() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.is_platform_admin()
    OR public.has_staff_permission('staff.pricing.manage'), false)
$$;

CREATE OR REPLACE FUNCTION public._commission_may_see_money() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.is_platform_admin()
    OR public.has_staff_permission('staff.finance.read')
    OR public.has_staff_permission('staff.pricing.manage'), false)
$$;

-- ---- resolve ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_resolve(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
  v_rate numeric; v_basis text; v_base numeric; v_amount numeric;
  v_total numeric;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()
          OR public.has_staff_permission('staff.commercial.read')) THEN
    RAISE EXCEPTION 'not_authorised: commercial staff only';
  END IF;

  SELECT * INTO v_sched FROM public.commission_schedules
   WHERE code = coalesce(nullif(p->>'schedule_code',''),'platform_default')
     AND status = 'approved'
     AND (effective_from IS NULL OR effective_from <= v_on)
     AND (effective_to IS NULL OR effective_to >= v_on)
   ORDER BY version DESC LIMIT 1;
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
    'base_amount', CASE WHEN public._commission_may_see_money() THEN v_base END,
    'commission_amount', CASE WHEN public._commission_may_see_money() THEN v_amount END,
    'supplier_payout', CASE WHEN public._commission_may_see_money()
                            THEN round(v_net + v_surch - v_amount, 2) END,
    'net_service_price', v_net, 'tax_amount', v_tax,
    'pass_through_amount', v_pass, 'surcharge_amount', v_surch,
    'customer_total', v_total,
    'money_visible', public._commission_may_see_money(),
    'price_stack', jsonb_build_array(
      jsonb_build_object('label','Net service price','amount', v_net),
      jsonb_build_object('label','Surcharges','amount', v_surch),
      jsonb_build_object('label','Pass-through charges','amount', v_pass),
      jsonb_build_object('label','Tax','amount', v_tax),
      jsonb_build_object('label','Customer total','amount', v_total)));
END $$;

-- ---- immutable snapshot ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_snapshot_record(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_r jsonb; v_id uuid; v_key text;
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
  v_r := public.commission_resolve(p);
  INSERT INTO public.commission_resolutions (
    source_kind, source_id, idempotency_key, schedule_id, schedule_code, schedule_version,
    rule_id, rate_percent, basis, excluded_components, currency, base_amount, commission_amount,
    net_service_price, tax_amount, pass_through_amount, customer_total, supplier_payout,
    price_stack, account_id, owner_staff_id, created_by)
  VALUES (
    coalesce(p->>'source_kind','manual'), coalesce(p->>'source_id', v_key), v_key,
    (v_r->>'schedule_id')::uuid, v_r->>'schedule_code', (v_r->>'schedule_version')::int,
    nullif(v_r->>'rule_id','')::uuid, (v_r->>'rate_percent')::numeric, v_r->>'basis',
    v_r->'excluded_components', coalesce(p->>'currency','KES'),
    coalesce((v_r->>'base_amount')::numeric, 0), coalesce((v_r->>'commission_amount')::numeric, 0),
    (v_r->>'net_service_price')::numeric, (v_r->>'tax_amount')::numeric,
    (v_r->>'pass_through_amount')::numeric, (v_r->>'customer_total')::numeric,
    coalesce((v_r->>'supplier_payout')::numeric, 0), v_r->'price_stack',
    nullif(p->>'account_id','')::uuid, nullif(p->>'owner_staff_id','')::uuid, auth.uid())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('resolution_id', v_id, 'created', true, 'resolution', v_r);
END $$;

-- ---- governance ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_schedule_open_draft(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_src public.commission_schedules; v_new uuid; v_ver int;
BEGIN
  IF NOT public._commission_may_configure() THEN RAISE EXCEPTION 'not_authorised: pricing managers only'; END IF;
  SELECT * INTO v_src FROM public.commission_schedules
   WHERE code = coalesce(nullif(p->>'code',''),'platform_default')
   ORDER BY version DESC LIMIT 1;
  IF v_src.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_SCHEDULE_NOT_FOUND'; END IF;
  SELECT id INTO v_new FROM public.commission_schedules
   WHERE code = v_src.code AND status = 'draft' ORDER BY version DESC LIMIT 1;
  IF v_new IS NOT NULL THEN RETURN jsonb_build_object('schedule_id', v_new, 'created', false); END IF;

  SELECT max(version) + 1 INTO v_ver FROM public.commission_schedules WHERE code = v_src.code;
  INSERT INTO public.commission_schedules (
    code, name, version, status, default_rate_percent, min_rate_percent, max_rate_percent,
    default_basis, excluded_components, supersedes_id, change_summary, created_by)
  VALUES (v_src.code, v_src.name, v_ver, 'draft',
    coalesce((p->>'default_rate_percent')::numeric, v_src.default_rate_percent),
    v_src.min_rate_percent, v_src.max_rate_percent,
    coalesce(nullif(p->>'default_basis',''), v_src.default_basis),
    coalesce(p->'excluded_components', v_src.excluded_components),
    v_src.id, nullif(p->>'change_summary',''), auth.uid())
  RETURNING id INTO v_new;

  INSERT INTO public.commission_rules (
    schedule_id, label, priority, service_code, scope_label, category_code, country, region, city,
    account_id, customer_segment, partner_id, operator_id, fleet_id, contract_id, transaction_type,
    partner_tier, promotion_code, min_volume, max_volume, rate_percent, basis, min_commission,
    max_commission, effective_from, effective_to, reason, active, created_by)
  SELECT v_new, label, priority, service_code, scope_label, category_code, country, region, city,
    account_id, customer_segment, partner_id, operator_id, fleet_id, contract_id, transaction_type,
    partner_tier, promotion_code, min_volume, max_volume, rate_percent, basis, min_commission,
    max_commission, effective_from, effective_to, reason, active, auth.uid()
  FROM public.commission_rules WHERE schedule_id = v_src.id;

  INSERT INTO public.commission_audit_events (schedule_id, action, actor, new_value, reason)
  VALUES (v_new, 'draft_opened', auth.uid(),
          jsonb_build_object('version', v_ver, 'from_version', v_src.version),
          nullif(p->>'change_summary',''));
  RETURN jsonb_build_object('schedule_id', v_new, 'version', v_ver, 'created', true);
END $$;

CREATE OR REPLACE FUNCTION public.commission_rule_save(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sched public.commission_schedules; v_old public.commission_rules; v_id uuid;
BEGIN
  IF NOT public._commission_may_configure() THEN RAISE EXCEPTION 'not_authorised: pricing managers only'; END IF;
  SELECT * INTO v_sched FROM public.commission_schedules WHERE id = (p->>'schedule_id')::uuid;
  IF v_sched.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_SCHEDULE_NOT_FOUND'; END IF;
  IF v_sched.status <> 'draft' THEN RAISE EXCEPTION 'SCHEDULE_NOT_DRAFT: open a new draft version first'; END IF;

  IF nullif(p->>'rule_id','') IS NOT NULL THEN
    SELECT * INTO v_old FROM public.commission_rules WHERE id = (p->>'rule_id')::uuid;
    UPDATE public.commission_rules SET
      label = coalesce(nullif(p->>'label',''), label),
      priority = coalesce((p->>'priority')::int, priority),
      service_code = nullif(p->>'service_code',''),
      scope_label = nullif(p->>'scope_label',''),
      category_code = nullif(p->>'category_code',''),
      country = nullif(p->>'country',''), region = nullif(p->>'region',''), city = nullif(p->>'city',''),
      account_id = nullif(p->>'account_id','')::uuid,
      customer_segment = nullif(p->>'customer_segment',''),
      partner_id = nullif(p->>'partner_id','')::uuid,
      contract_id = nullif(p->>'contract_id','')::uuid,
      transaction_type = nullif(p->>'transaction_type',''),
      partner_tier = nullif(p->>'partner_tier',''),
      min_volume = nullif(p->>'min_volume','')::numeric,
      max_volume = nullif(p->>'max_volume','')::numeric,
      rate_percent = coalesce((p->>'rate_percent')::numeric, rate_percent),
      basis = nullif(p->>'basis',''),
      min_commission = nullif(p->>'min_commission','')::numeric,
      max_commission = nullif(p->>'max_commission','')::numeric,
      effective_from = nullif(p->>'effective_from','')::date,
      effective_to = nullif(p->>'effective_to','')::date,
      reason = nullif(p->>'reason',''),
      active = coalesce((p->>'active')::boolean, active)
     WHERE id = v_old.id RETURNING id INTO v_id;
    INSERT INTO public.commission_audit_events (schedule_id, rule_id, action, actor, old_value, new_value, reason)
    VALUES (v_sched.id, v_id, 'rule_updated', auth.uid(), to_jsonb(v_old), p, nullif(p->>'reason',''));
  ELSE
    INSERT INTO public.commission_rules (
      schedule_id, label, priority, service_code, scope_label, category_code, country, region, city,
      account_id, customer_segment, partner_id, contract_id, transaction_type, partner_tier,
      min_volume, max_volume, rate_percent, basis, min_commission, max_commission,
      effective_from, effective_to, reason, created_by)
    VALUES (v_sched.id, coalesce(nullif(p->>'label',''),'Commission rule'),
      coalesce((p->>'priority')::int, 100),
      nullif(p->>'service_code',''), nullif(p->>'scope_label',''), nullif(p->>'category_code',''),
      nullif(p->>'country',''), nullif(p->>'region',''), nullif(p->>'city',''),
      nullif(p->>'account_id','')::uuid, nullif(p->>'customer_segment',''),
      nullif(p->>'partner_id','')::uuid, nullif(p->>'contract_id','')::uuid,
      nullif(p->>'transaction_type',''), nullif(p->>'partner_tier',''),
      nullif(p->>'min_volume','')::numeric, nullif(p->>'max_volume','')::numeric,
      (p->>'rate_percent')::numeric, nullif(p->>'basis',''),
      nullif(p->>'min_commission','')::numeric, nullif(p->>'max_commission','')::numeric,
      nullif(p->>'effective_from','')::date, nullif(p->>'effective_to','')::date,
      nullif(p->>'reason',''), auth.uid())
    RETURNING id INTO v_id;
    INSERT INTO public.commission_audit_events (schedule_id, rule_id, action, actor, new_value, reason)
    VALUES (v_sched.id, v_id, 'rule_created', auth.uid(), p, nullif(p->>'reason',''));
  END IF;
  RETURN jsonb_build_object('rule_id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.commission_rule_delete(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_rule public.commission_rules; v_status text;
BEGIN
  IF NOT public._commission_may_configure() THEN RAISE EXCEPTION 'not_authorised: pricing managers only'; END IF;
  SELECT * INTO v_rule FROM public.commission_rules WHERE id = (p->>'rule_id')::uuid;
  IF v_rule.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_RULE_NOT_FOUND'; END IF;
  SELECT status INTO v_status FROM public.commission_schedules WHERE id = v_rule.schedule_id;
  IF v_status <> 'draft' THEN RAISE EXCEPTION 'SCHEDULE_NOT_DRAFT'; END IF;
  DELETE FROM public.commission_rules WHERE id = v_rule.id;
  INSERT INTO public.commission_audit_events (schedule_id, rule_id, action, actor, old_value, reason)
  VALUES (v_rule.schedule_id, v_rule.id, 'rule_deleted', auth.uid(), to_jsonb(v_rule), nullif(p->>'reason',''));
  RETURN jsonb_build_object('deleted', true);
END $$;

CREATE OR REPLACE FUNCTION public.commission_schedule_publish(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_sched public.commission_schedules; v_from date;
BEGIN
  IF NOT public._commission_may_configure() THEN RAISE EXCEPTION 'not_authorised: pricing managers only'; END IF;
  SELECT * INTO v_sched FROM public.commission_schedules WHERE id = (p->>'schedule_id')::uuid;
  IF v_sched.id IS NULL THEN RAISE EXCEPTION 'COMMISSION_SCHEDULE_NOT_FOUND'; END IF;
  IF v_sched.status <> 'draft' THEN RAISE EXCEPTION 'SCHEDULE_NOT_DRAFT'; END IF;
  IF coalesce(nullif(p->>'reason',''), v_sched.change_summary) IS NULL THEN
    RAISE EXCEPTION 'REASON_REQUIRED: a commission change must record its reason';
  END IF;
  v_from := coalesce(nullif(p->>'effective_from','')::date, current_date);

  UPDATE public.commission_schedules
     SET status = 'retired', effective_to = v_from - 1
   WHERE code = v_sched.code AND status = 'approved';

  UPDATE public.commission_schedules
     SET status = 'approved', effective_from = v_from,
         change_summary = coalesce(nullif(p->>'reason',''), change_summary),
         approved_by = auth.uid(), approved_at = now(),
         published_by = auth.uid(), published_at = now()
   WHERE id = v_sched.id;

  INSERT INTO public.commission_audit_events (schedule_id, action, actor, new_value, reason)
  VALUES (v_sched.id, 'published', auth.uid(),
          jsonb_build_object('version', v_sched.version, 'effective_from', v_from,
                             'default_rate_percent', v_sched.default_rate_percent),
          coalesce(nullif(p->>'reason',''), v_sched.change_summary));
  RETURN jsonb_build_object('schedule_id', v_sched.id, 'version', v_sched.version, 'effective_from', v_from);
END $$;

-- ---- simulator -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_simulate(p jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_opt jsonb; v_out jsonb := '[]'::jsonb; v_res jsonb;
BEGIN
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;
  FOR v_opt IN SELECT * FROM jsonb_array_elements(coalesce(p->'options','[]'::jsonb)) LOOP
    v_res := public.commission_resolve((p - 'options') || v_opt);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'label', coalesce(v_opt->>'label','Option'),
      'customer_price', coalesce((v_opt->>'net_service_price')::numeric,
                                (p->>'net_service_price')::numeric),
      'rate_percent', v_res->'rate_percent',
      'commission_amount', v_res->'commission_amount',
      'supplier_payout', v_res->'supplier_payout',
      'customer_total', v_res->'customer_total',
      'basis', v_res->'basis',
      'money_visible', v_res->'money_visible'));
  END LOOP;
  RETURN jsonb_build_object('options', v_out, 'note',
    'Scenario comparison from the current commission configuration. Not a guaranteed outcome.');
END $$;

-- ---- commission intelligence ----------------------------------------------
CREATE OR REPLACE FUNCTION public.commission_intelligence_summary(p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_out jsonb;
BEGIN
  IF NOT public._commission_may_see_money() THEN
    RAISE EXCEPTION 'not_authorised: finance or pricing managers only';
  END IF;
  SELECT jsonb_build_object(
    'from', p_from, 'to', p_to,
    'transactions', count(*),
    'gross_transaction_value', coalesce(round(sum(customer_total),2),0),
    'eligible_base', coalesce(round(sum(base_amount),2),0),
    'commission_revenue', coalesce(round(sum(commission_amount),2),0),
    'supplier_payout', coalesce(round(sum(supplier_payout),2),0),
    'average_rate_percent', round(avg(rate_percent),2),
    'revenue_per_transaction', CASE WHEN count(*) > 0
      THEN round(sum(commission_amount)/count(*),2) END,
    'rate_min', min(rate_percent), 'rate_max', max(rate_percent),
    'data_through', max(calculated_at),
    'by_schedule', coalesce((SELECT jsonb_agg(x) FROM (
      SELECT jsonb_build_object('schedule_code', schedule_code, 'version', schedule_version,
        'transactions', count(*), 'commission', round(sum(commission_amount),2),
        'avg_rate_percent', round(avg(rate_percent),2)) AS x
      FROM public.commission_resolutions
      WHERE calculated_at::date BETWEEN p_from AND p_to
      GROUP BY schedule_code, schedule_version) s),'[]'::jsonb)
  ) INTO v_out
  FROM public.commission_resolutions
  WHERE calculated_at::date BETWEEN p_from AND p_to;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.commission_resolve(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_snapshot_record(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_simulate(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_intelligence_summary(date,date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_schedule_open_draft(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_rule_save(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_rule_delete(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commission_schedule_publish(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._commission_may_configure() FROM PUBLIC;
REVOKE ALL ON FUNCTION public._commission_may_see_money() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commission_resolve(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_snapshot_record(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_simulate(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_intelligence_summary(date,date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_schedule_open_draft(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_rule_save(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_rule_delete(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.commission_schedule_publish(jsonb) TO authenticated;

-- ---- quote validity + commission snapshot on acceptance --------------------
ALTER TABLE public.commercial_quotations
  ADD COLUMN IF NOT EXISTS valid_from date,
  ADD COLUMN IF NOT EXISTS price_locked_until timestamptz;
