-- =====================================================================
-- PRICING 360 — commercial control plane
-- =====================================================================

CREATE TABLE public.pricing_rule_sets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  code text NOT NULL,
  name text NOT NULL,
  domain text NOT NULL CHECK (domain = ANY (ARRAY['ride_hailing','corporate_charter','delivery','logistics','rentals','leasing','all'])),
  version text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status = ANY (ARRAY['draft','under_review','approved','scheduled','published','superseded','archived'])),
  currency text NOT NULL DEFAULT 'KES',
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_until timestamptz,
  note text NOT NULL DEFAULT '',
  created_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  published_by uuid,
  published_at timestamptz,
  superseded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, version)
);

GRANT SELECT, INSERT, UPDATE ON public.pricing_rule_sets TO authenticated;
GRANT ALL ON public.pricing_rule_sets TO service_role;
ALTER TABLE public.pricing_rule_sets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read pricing rule sets" ON public.pricing_rule_sets
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin insert pricing rule sets" ON public.pricing_rule_sets
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update pricing rule sets" ON public.pricing_rule_sets
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());

CREATE TRIGGER trg_pricing_rule_sets_touch BEFORE UPDATE ON public.pricing_rule_sets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------------

CREATE TABLE public.pricing_components (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  rule_set_id uuid NOT NULL REFERENCES public.pricing_rule_sets(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = ANY (ARRAY['fee','tax','surcharge','discount','floor','commission'])),
  code text NOT NULL,
  label text NOT NULL,
  calc text NOT NULL CHECK (calc = ANY (ARRAY['percentage','fixed','multiplier'])),
  value numeric(14,4) NOT NULL CHECK (value >= 0),
  basis text NOT NULL DEFAULT 'adjusted_base'
    CHECK (basis = ANY (ARRAY['base','adjusted_base','pre_tax_subtotal','total'])),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority integer NOT NULL DEFAULT 100,
  stackable boolean NOT NULL DEFAULT true,
  requires_code boolean NOT NULL DEFAULT false,
  min_amount numeric(14,2),
  max_amount numeric(14,2),
  active boolean NOT NULL DEFAULT true,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (rule_set_id, code)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_components TO authenticated;
GRANT ALL ON public.pricing_components TO service_role;
ALTER TABLE public.pricing_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read pricing components" ON public.pricing_components
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));
CREATE POLICY "admin write pricing components" ON public.pricing_components
  FOR INSERT TO authenticated WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin update pricing components" ON public.pricing_components
  FOR UPDATE TO authenticated USING (public.is_platform_admin()) WITH CHECK (public.is_platform_admin());
CREATE POLICY "admin delete draft pricing components" ON public.pricing_components
  FOR DELETE TO authenticated USING (
    public.is_platform_admin()
    AND EXISTS (SELECT 1 FROM public.pricing_rule_sets s
                 WHERE s.id = rule_set_id AND s.status IN ('draft','under_review'))
  );

CREATE TRIGGER trg_pricing_components_touch BEFORE UPDATE ON public.pricing_components
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_pricing_components_lookup ON public.pricing_components (rule_set_id, kind, priority) WHERE active;

-- ---------------------------------------------------------------------

CREATE TABLE public.pricing_audit_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.pricing_audit_events TO authenticated;
GRANT ALL ON public.pricing_audit_events TO service_role;
ALTER TABLE public.pricing_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin read pricing audit" ON public.pricing_audit_events
  FOR SELECT TO authenticated USING (public.is_platform_admin());
CREATE POLICY "staff insert pricing audit" ON public.pricing_audit_events
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_portal_member(auth.uid()));

CREATE OR REPLACE FUNCTION public._block_pricing_audit_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'pricing_audit_events is append-only';
END;
$$;

CREATE TRIGGER trg_pricing_audit_append_only
  BEFORE UPDATE OR DELETE ON public.pricing_audit_events
  FOR EACH ROW EXECUTE FUNCTION public._block_pricing_audit_mutation();

-- ---------------------------------------------------------------------

CREATE TABLE public.pricing_quote_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  quote_ref text,
  domain text NOT NULL,
  inputs jsonb NOT NULL,
  result jsonb NOT NULL,
  rate_card_id uuid REFERENCES public.commercial_rate_cards(id) ON DELETE SET NULL,
  rate_card_version text,
  rule_set_id uuid REFERENCES public.pricing_rule_sets(id) ON DELETE SET NULL,
  rule_set_version text,
  currency text NOT NULL DEFAULT 'KES',
  total numeric(14,2) NOT NULL,
  calculated_by uuid,
  calculated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.pricing_quote_snapshots TO authenticated;
GRANT ALL ON public.pricing_quote_snapshots TO service_role;
ALTER TABLE public.pricing_quote_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read pricing snapshots" ON public.pricing_quote_snapshots
  FOR SELECT TO authenticated USING (public.is_staff_portal_member(auth.uid()));

CREATE OR REPLACE FUNCTION public._block_pricing_snapshot_mutation()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'pricing_quote_snapshots is immutable';
END;
$$;

CREATE TRIGGER trg_pricing_snapshots_immutable
  BEFORE UPDATE OR DELETE ON public.pricing_quote_snapshots
  FOR EACH ROW EXECUTE FUNCTION public._block_pricing_snapshot_mutation();

CREATE INDEX idx_pricing_snapshots_ref ON public.pricing_quote_snapshots (quote_ref, calculated_at DESC);

-- =====================================================================
-- ENGINE
-- =====================================================================

CREATE OR REPLACE FUNCTION public.pricing360_active_rule_set(
  p_domain text DEFAULT 'corporate_charter',
  p_at timestamptz DEFAULT now()
)
RETURNS public.pricing_rule_sets
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM public.pricing_rule_sets
   WHERE status = 'published'
     AND domain IN (p_domain, 'all')
     AND effective_from <= p_at
     AND (effective_until IS NULL OR effective_until > p_at)
   ORDER BY (domain = p_domain) DESC, effective_from DESC
   LIMIT 1;
$$;

/**
 * The single authoritative price calculator.
 * Deterministic: same inputs + same published configuration = same result.
 */
CREATE OR REPLACE FUNCTION public.pricing360_calculate(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_domain text := COALESCE(p_input->>'domain', 'corporate_charter');
  v_service text := p_input->>'service_code';
  v_scope text := COALESCE(p_input->>'scope_label', '');
  v_category text := p_input->>'category_code';
  v_basis text := COALESCE(p_input->>'pricing_basis', 'per_day');
  v_qty numeric := GREATEST(1, COALESCE((p_input->>'quantity')::numeric, 1));
  v_day_type text := COALESCE(p_input->>'day_type', 'standard');
  v_at timestamptz := COALESCE((p_input->>'effective_date')::timestamptz, now());
  v_promo text := NULLIF(p_input->>'promo_code', '');
  v_card public.commercial_rate_cards;
  v_line public.commercial_rate_lines;
  v_rs public.pricing_rule_sets;
  v_comp record;
  v_base numeric := 0;
  v_adjusted numeric := 0;
  v_fees numeric := 0;
  v_discounts numeric := 0;
  v_taxes numeric := 0;
  v_amount numeric;
  v_basis_amount numeric;
  v_components jsonb := '[]'::jsonb;
  v_blocked boolean := false;
BEGIN
  IF v_service IS NULL OR v_category IS NULL THEN
    RETURN jsonb_build_object('status','INVALID_INPUT','error','service_code and category_code are required');
  END IF;

  SELECT * INTO v_card FROM public.commercial_rate_cards
   WHERE product_domain = v_domain AND status = 'approved'
     AND (effective_from IS NULL OR effective_from <= v_at::date)
   ORDER BY effective_from DESC NULLS LAST, created_at DESC
   LIMIT 1;

  IF v_card.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_PUBLISHED_RATE_CARD',
      'error','Pricing configuration unavailable — manual pricing review required','domain',v_domain);
  END IF;

  SELECT * INTO v_line FROM public.commercial_rate_lines
   WHERE rate_card_id = v_card.id AND service_code = v_service
     AND category_code = v_category AND pricing_basis = v_basis
     AND (v_scope = '' OR scope_label = v_scope)
   ORDER BY (scope_label = v_scope) DESC
   LIMIT 1;

  IF v_line.id IS NULL THEN
    RETURN jsonb_build_object('status','NO_VALID_RATE',
      'error','Pricing configuration unavailable — manual pricing review required',
      'rate_card_version', v_card.version,
      'requested', jsonb_build_object('service_code',v_service,'scope_label',v_scope,
                                      'category_code',v_category,'pricing_basis',v_basis));
  END IF;

  v_rs := public.pricing360_active_rule_set(v_domain, v_at);
  IF v_rs.id IS NULL THEN
    RETURN jsonb_build_object('status','PRICING_CONFIGURATION_ERROR',
      'error','No published commercial rule set is in force','rate_card_version',v_card.version);
  END IF;

  v_base := round(v_line.amount * v_qty);
  v_adjusted := v_base;
  v_components := v_components || jsonb_build_object(
    'kind','base','code','base_rate','label', v_line.service_code || ' base rate',
    'calc','fixed','amount', v_base,
    'reason', format('%s × %s at %s %s per %s', v_qty, v_category, v_line.currency, v_line.amount,
                     replace(v_basis,'per_','')),
    'source', 'rate_line:' || v_line.id);

  -- 1. Surcharges (multipliers / additions on the base)
  FOR v_comp IN
    SELECT * FROM public.pricing_components
     WHERE rule_set_id = v_rs.id AND active AND kind = 'surcharge'
     ORDER BY priority, code
  LOOP
    CONTINUE WHEN (v_comp.scope ? 'day_type')
      AND NOT (v_comp.scope->'day_type' @> to_jsonb(v_day_type));
    CONTINUE WHEN (v_comp.scope ? 'service_code')
      AND NOT (v_comp.scope->'service_code' @> to_jsonb(v_service));
    v_amount := CASE v_comp.calc
      WHEN 'multiplier' THEN round(v_base * v_comp.value) - v_base
      WHEN 'percentage' THEN round(v_base * v_comp.value / 100)
      ELSE round(v_comp.value * v_qty) END;
    IF v_amount <> 0 THEN
      v_adjusted := v_adjusted + v_amount;
      v_components := v_components || jsonb_build_object(
        'kind','surcharge','code',v_comp.code,'label',v_comp.label,'calc',v_comp.calc,
        'value',v_comp.value,'amount',v_amount,'reason',v_comp.reason,
        'source','pricing_component:' || v_comp.id);
      IF NOT v_comp.stackable THEN EXIT; END IF;
    END IF;
  END LOOP;

  -- 2. Fees (on the adjusted base)
  FOR v_comp IN
    SELECT * FROM public.pricing_components
     WHERE rule_set_id = v_rs.id AND active AND kind = 'fee'
     ORDER BY priority, code
  LOOP
    CONTINUE WHEN (v_comp.scope ? 'service_code')
      AND NOT (v_comp.scope->'service_code' @> to_jsonb(v_service));
    v_basis_amount := CASE v_comp.basis WHEN 'base' THEN v_base ELSE v_adjusted END;
    v_amount := CASE v_comp.calc
      WHEN 'percentage' THEN round(v_basis_amount * v_comp.value / 100)
      ELSE round(v_comp.value) END;
    IF v_comp.max_amount IS NOT NULL THEN v_amount := LEAST(v_amount, v_comp.max_amount); END IF;
    IF v_amount <> 0 THEN
      v_fees := v_fees + v_amount;
      v_components := v_components || jsonb_build_object(
        'kind','fee','code',v_comp.code,'label',v_comp.label,'calc',v_comp.calc,
        'value',v_comp.value,'amount',v_amount,'reason',v_comp.reason,
        'source','pricing_component:' || v_comp.id);
    END IF;
  END LOOP;

  -- 3. Discounts (server-calculated only; never trust a client amount)
  FOR v_comp IN
    SELECT * FROM public.pricing_components
     WHERE rule_set_id = v_rs.id AND active AND kind = 'discount'
     ORDER BY priority, code
  LOOP
    CONTINUE WHEN v_comp.requires_code AND (v_promo IS NULL OR lower(v_promo) <> lower(v_comp.code));
    CONTINUE WHEN (v_comp.scope ? 'service_code')
      AND NOT (v_comp.scope->'service_code' @> to_jsonb(v_service));
    v_basis_amount := CASE v_comp.basis WHEN 'base' THEN v_base ELSE v_adjusted END;
    v_amount := CASE v_comp.calc
      WHEN 'percentage' THEN round(v_basis_amount * v_comp.value / 100)
      ELSE round(v_comp.value) END;
    IF v_comp.max_amount IS NOT NULL THEN v_amount := LEAST(v_amount, v_comp.max_amount); END IF;
    IF v_amount > 0 THEN
      v_discounts := v_discounts + v_amount;
      v_components := v_components || jsonb_build_object(
        'kind','discount','code',v_comp.code,'label',v_comp.label,'calc',v_comp.calc,
        'value',v_comp.value,'amount',-v_amount,'reason',v_comp.reason,
        'source','pricing_component:' || v_comp.id);
      IF NOT v_comp.stackable THEN EXIT; END IF;
    END IF;
  END LOOP;

  -- 4. Taxes (only when explicitly configured — never implied)
  FOR v_comp IN
    SELECT * FROM public.pricing_components
     WHERE rule_set_id = v_rs.id AND active AND kind = 'tax'
     ORDER BY priority, code
  LOOP
    CONTINUE WHEN (v_comp.scope ? 'service_code')
      AND NOT (v_comp.scope->'service_code' @> to_jsonb(v_service));
    v_basis_amount := v_adjusted + v_fees - v_discounts;
    v_amount := CASE v_comp.calc
      WHEN 'percentage' THEN round(v_basis_amount * v_comp.value / 100)
      ELSE round(v_comp.value) END;
    IF v_amount <> 0 THEN
      v_taxes := v_taxes + v_amount;
      v_components := v_components || jsonb_build_object(
        'kind','tax','code',v_comp.code,'label',v_comp.label,'calc',v_comp.calc,
        'value',v_comp.value,'amount',v_amount,'reason',v_comp.reason,
        'source','pricing_component:' || v_comp.id);
    END IF;
  END LOOP;

  -- 5. Floors
  FOR v_comp IN
    SELECT * FROM public.pricing_components
     WHERE rule_set_id = v_rs.id AND active AND kind = 'floor'
     ORDER BY priority, code
  LOOP
    IF v_comp.min_amount IS NOT NULL
       AND (v_adjusted + v_fees - v_discounts + v_taxes) < v_comp.min_amount THEN
      v_blocked := true;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'status', CASE WHEN v_blocked THEN 'PRICE_FLOOR_BREACH' ELSE 'OK' END,
    'currency', v_line.currency,
    'base', v_base,
    'adjusted_base', v_adjusted,
    'fees_total', v_fees,
    'discounts_total', v_discounts,
    'taxes_total', v_taxes,
    'total', v_adjusted + v_fees - v_discounts + v_taxes,
    'components', v_components,
    'included_distance_km', v_line.included_distance_km,
    'included_distance_period', v_line.included_distance_period,
    'rate_card_id', v_card.id,
    'rate_card_code', v_card.code,
    'rate_card_version', v_card.version,
    'rule_set_id', v_rs.id,
    'rule_set_version', v_rs.version,
    'effective_date', v_at,
    'calculated_at', now(),
    'inputs', p_input
  );
END;
$$;

REVOKE ALL ON FUNCTION public.pricing360_calculate(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing360_calculate(jsonb) TO authenticated, anon, service_role;
REVOKE ALL ON FUNCTION public.pricing360_active_rule_set(text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing360_active_rule_set(text, timestamptz) TO authenticated, service_role;

/** Calculates and freezes an immutable snapshot for a quote reference. */
CREATE OR REPLACE FUNCTION public.pricing360_snapshot_quote(p_input jsonb, p_quote_ref text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_res jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required';
  END IF;
  v_res := public.pricing360_calculate(p_input);
  IF (v_res->>'status') <> 'OK' THEN RETURN v_res; END IF;

  INSERT INTO public.pricing_quote_snapshots (
    quote_ref, domain, inputs, result, rate_card_id, rate_card_version,
    rule_set_id, rule_set_version, currency, total, calculated_by)
  VALUES (
    p_quote_ref, COALESCE(p_input->>'domain','corporate_charter'), p_input, v_res,
    (v_res->>'rate_card_id')::uuid, v_res->>'rate_card_version',
    (v_res->>'rule_set_id')::uuid, v_res->>'rule_set_version',
    v_res->>'currency', (v_res->>'total')::numeric, auth.uid());

  RETURN v_res;
END;
$$;

REVOKE ALL ON FUNCTION public.pricing360_snapshot_quote(jsonb, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing360_snapshot_quote(jsonb, text) TO authenticated, service_role;

/** Admin-only publication with automatic supersede + audit. */
CREATE OR REPLACE FUNCTION public.pricing360_publish_rule_set(p_id uuid, p_reason text DEFAULT '')
RETURNS public.pricing_rule_sets
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_row public.pricing_rule_sets; v_prev jsonb;
BEGIN
  IF NOT public.is_platform_admin() THEN
    RAISE EXCEPTION 'not authorised to publish pricing';
  END IF;
  SELECT * INTO v_row FROM public.pricing_rule_sets WHERE id = p_id;
  IF v_row.id IS NULL THEN RAISE EXCEPTION 'rule set not found'; END IF;
  IF v_row.status NOT IN ('approved','scheduled') THEN
    RAISE EXCEPTION 'only an approved or scheduled rule set may be published (current: %)', v_row.status;
  END IF;
  IF v_row.approved_by IS NOT NULL AND v_row.approved_by = auth.uid() THEN
    RAISE EXCEPTION 'separation of duties: the approver may not also publish';
  END IF;
  v_prev := to_jsonb(v_row);

  UPDATE public.pricing_rule_sets
     SET status = 'superseded', superseded_at = now(), effective_until = COALESCE(effective_until, now())
   WHERE status = 'published' AND domain = v_row.domain AND id <> p_id;

  UPDATE public.pricing_rule_sets
     SET status = 'published', published_at = now(), published_by = auth.uid()
   WHERE id = p_id
  RETURNING * INTO v_row;

  INSERT INTO public.pricing_audit_events (actor_id, action, entity, entity_id, previous_value, new_value, reason)
  VALUES (auth.uid(), 'publish', 'pricing_rule_sets', p_id, v_prev, to_jsonb(v_row), p_reason);

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.pricing360_publish_rule_set(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing360_publish_rule_set(uuid, text) TO authenticated, service_role;

/** Pricing health: real conditions, not table existence. */
CREATE OR REPLACE FUNCTION public.pricing360_health()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object(
    'published_rule_sets', (SELECT count(*) FROM public.pricing_rule_sets WHERE status='published'),
    'domains_without_rule_set', (
      SELECT coalesce(jsonb_agg(d), '[]'::jsonb) FROM (
        SELECT DISTINCT product_domain AS d FROM public.commercial_rate_cards WHERE status='approved'
      ) x WHERE NOT EXISTS (
        SELECT 1 FROM public.pricing_rule_sets s
         WHERE s.status='published' AND s.domain IN (x.d,'all'))),
    'approved_rate_cards', (SELECT count(*) FROM public.commercial_rate_cards WHERE status='approved'),
    'rate_lines', (SELECT count(*) FROM public.commercial_rate_lines),
    'non_positive_rates', (SELECT count(*) FROM public.commercial_rate_lines WHERE amount <= 0),
    'duplicate_rate_lines', (
      SELECT count(*) FROM (
        SELECT rate_card_id, service_code, scope_label, category_code, pricing_basis
          FROM public.commercial_rate_lines
         GROUP BY 1,2,3,4,5 HAVING count(*) > 1) d),
    'active_tax_components', (
      SELECT count(*) FROM public.pricing_components c
        JOIN public.pricing_rule_sets s ON s.id=c.rule_set_id
       WHERE s.status='published' AND c.active AND c.kind='tax'),
    'active_discount_components', (
      SELECT count(*) FROM public.pricing_components c
        JOIN public.pricing_rule_sets s ON s.id=c.rule_set_id
       WHERE s.status='published' AND c.active AND c.kind='discount'),
    'invalid_effective_windows', (
      SELECT count(*) FROM public.pricing_rule_sets
       WHERE effective_until IS NOT NULL AND effective_until <= effective_from),
    'snapshots', (SELECT count(*) FROM public.pricing_quote_snapshots),
    'generated_at', now()
  );
$$;

REVOKE ALL ON FUNCTION public.pricing360_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.pricing360_health() TO authenticated, service_role;

-- =====================================================================
-- SEED — authoritative commercial rule set
-- =====================================================================
INSERT INTO public.pricing_rule_sets (code, name, domain, version, status, effective_from, note, approved_at, published_at)
VALUES ('YALLA-COMMERCIAL', 'Yalla Commercial Rules', 'all', '2026.08', 'published',
        '2026-08-01T00:00:00Z', 'Marketplace Service 15%, Night/Sunday surcharge x1.25, no implied tax.',
        now(), now());

INSERT INTO public.pricing_components (rule_set_id, kind, code, label, calc, value, basis, scope, priority, stackable, reason)
SELECT s.id, v.kind, v.code, v.label, v.calc, v.value, v.basis, v.scope::jsonb, v.priority, v.stackable, v.reason
FROM public.pricing_rule_sets s,
LATERAL (VALUES
  ('surcharge','night_sunday','Night & Sunday surcharge','multiplier',1.25,'base',
   '{"day_type":["night","sunday","holiday"]}',10,true,
   'Applies to night, Sunday and public-holiday operations per the published rate card.'),
  ('fee','marketplace_service','Marketplace Service','percentage',15,'adjusted_base','{}',20,true,
   'Booking platform, live GPS tracking, payment processing, 24/7 operations desk, fraud protection, customer support, operator management, digital documentation.')
) AS v(kind,code,label,calc,value,basis,scope,priority,stackable,reason)
WHERE s.code = 'YALLA-COMMERCIAL' AND s.version = '2026.08';

INSERT INTO public.pricing_audit_events (action, entity, new_value, reason)
SELECT 'seed', 'pricing_rule_sets', to_jsonb(s), 'Pricing 360 initial authoritative commercial rule set'
FROM public.pricing_rule_sets s WHERE s.code='YALLA-COMMERCIAL' AND s.version='2026.08';