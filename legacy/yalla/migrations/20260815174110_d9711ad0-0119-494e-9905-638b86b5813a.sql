-- 1. Keep the existing calculator, wrap it in a contract normaliser.
ALTER FUNCTION public.ap360_quote(jsonb) RENAME TO ap360_quote_core;

CREATE OR REPLACE FUNCTION public.ap360_quote(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res    jsonb;
  v_status text;
  v_priced boolean;
  v_total  numeric;
BEGIN
  v_res := public.ap360_quote_core(p_input);
  v_status := COALESCE(v_res->>'status', 'INVALID_INPUT');
  v_priced := v_status IN ('OK','PRICE_RAISED_TO_FLOOR');
  v_total := NULLIF(v_res->>'customer_price','')::numeric;

  -- Contract: currency is always present; a payable figure exists only when the
  -- authority priced the request; anything else is an estimate at most.
  v_res := v_res
    || jsonb_build_object('currency', COALESCE(v_res->>'currency', 'KES'))
    || jsonb_build_object(
         'authoritative_price', CASE WHEN v_priced THEN to_jsonb(v_total) ELSE 'null'::jsonb END,
         'indicative_price',    CASE WHEN v_priced OR v_total IS NULL THEN 'null'::jsonb ELSE to_jsonb(v_total) END,
         'priced', v_priced);

  -- No semantically dangerous partial payload: a withheld outcome carries no
  -- payable field at all, and always states why.
  IF NOT v_priced THEN
    v_res := (v_res - 'customer_price')
      || jsonb_build_object('message',
           COALESCE(NULLIF(v_res->>'message',''), NULLIF(v_res->>'error',''),
             CASE v_status
               WHEN 'PRICE_EXCEPTION_REQUIRED' THEN 'This price needs a governed commercial exception before it can be sold.'
               WHEN 'QUOTE_REQUIRED' THEN 'This asset is priced by negotiated quote.'
               WHEN 'NO_PUBLISHED_VERSION' THEN 'No published pricing version governs this asset yet, so no price is shown.'
               WHEN 'UNKNOWN_CATEGORY' THEN 'This asset category is not registered in the pricing authority.'
               WHEN 'UNKNOWN_ENGINE' THEN 'The pricing engine for this asset is not configured.'
               ELSE 'The pricing request is incomplete.'
             END));
  END IF;

  RETURN v_res;
END $function$;

-- 2. Freezing a quote: refuse withheld prices, and record the refusal.
CREATE OR REPLACE FUNCTION public.ap360_save_quote(p_input jsonb, p_quote_ref text DEFAULT NULL::text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_res jsonb; v_id uuid; v_status text; v_reason text;
BEGIN
  IF NOT public.is_staff_portal_member(auth.uid()) THEN
    RAISE EXCEPTION 'AP360: not authorised to issue quotes';
  END IF;

  v_res := public.ap360_quote(p_input);
  v_status := COALESCE(v_res->>'status','INVALID_INPUT');

  IF v_status NOT IN ('OK','PRICE_RAISED_TO_FLOOR') THEN
    v_reason := COALESCE(NULLIF(v_res->>'message',''), NULLIF(v_res->>'error',''), v_status);
    INSERT INTO public.pricing_audit_events(actor_id, actor_email, action, entity, entity_id, new_value, reason)
    VALUES (auth.uid(),
            (SELECT email FROM auth.users WHERE id = auth.uid()),
            'simulate', 'ap360_quote', NULL,
            jsonb_build_object(
              'event', v_status,
              'blockedReason', v_reason,
              'quote_ref', p_quote_ref,
              'category_code', p_input->>'category_code',
              'authoritative_price', NULL,
              'indicative_price', v_res->'indicative_price',
              'priced', false,
              '__rbac', 'denied'),
            'ap360_save_quote refused: ' || v_reason || ' [rbac:denied]');
    RETURN jsonb_build_object('saved', false, 'status', v_status, 'blocked_reason', v_reason, 'result', v_res);
  END IF;

  INSERT INTO public.ap360_quote_snapshots(
    quote_ref, profile_id, version_id, category_code, engine_code, version_number,
    inputs, result, customer_price, operator_net, yalla_revenue, operator_floor,
    contribution_pct, profitability_band, calculated_by, valid_until)
  VALUES (
    p_quote_ref, (v_res->>'profile_id')::uuid, (v_res->>'version_id')::uuid,
    v_res->>'category_code', v_res->>'engine_code', (v_res->>'version')::int,
    p_input, v_res,
    (v_res->>'authoritative_price')::numeric, (v_res->>'operator_net')::numeric,
    (v_res->>'yalla_revenue')::numeric, (v_res->>'operator_floor')::numeric,
    NULLIF(v_res->>'contribution_pct','')::numeric, v_res->>'profitability_band',
    auth.uid(), now() + interval '14 days')
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('saved', true, 'snapshot_id', v_id, 'status', v_status, 'result', v_res);
END $function$;

-- 3. Shadow comparison reads the authoritative field, not the legacy alias.
CREATE OR REPLACE FUNCTION public.ap360_shadow_compare(p_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_old jsonb; v_new jsonb; v_o numeric; v_n numeric;
BEGIN
  IF NOT public.is_staff_portal_member(auth.uid()) THEN
    RAISE EXCEPTION 'AP360: not authorised'; END IF;
  BEGIN v_old := public.asset_pricing_calculate(p_input);
  EXCEPTION WHEN others THEN v_old := jsonb_build_object('status','LEGACY_ERROR','error', SQLERRM); END;
  v_new := public.ap360_quote(p_input);
  v_o := NULLIF(v_old->>'total','')::numeric;
  v_n := NULLIF(v_new->>'authoritative_price','')::numeric;
  RETURN jsonb_build_object(
    'inputs', p_input,
    'legacy', v_old, 'ap360', v_new,
    'legacy_total', v_o, 'ap360_total', v_n,
    'difference', CASE WHEN v_o IS NULL OR v_n IS NULL THEN NULL ELSE ROUND(v_n - v_o, 2) END,
    'difference_pct', CASE WHEN v_o IS NULL OR v_n IS NULL OR v_o = 0 THEN NULL
                           ELSE ROUND((v_n - v_o) / v_o * 100, 2) END,
    'comparable', v_o IS NOT NULL AND v_n IS NOT NULL);
END $function$;