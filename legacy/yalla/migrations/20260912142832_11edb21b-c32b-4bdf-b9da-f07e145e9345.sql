CREATE OR REPLACE FUNCTION public._sales_day_contracts(
  _staff uuid,
  _day_start timestamptz,
  _day_end timestamptz,
  _month_start date
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_month_end date := (_month_start + interval '1 month')::date;
  v_signed_today int := 0;
  v_activated_today int := 0;
  v_rev_today numeric := 0;
  v_rev_month numeric := 0;
  v_awaiting_signature int := 0;
  v_awaiting_activation int := 0;
  v_activated_month int := 0;
  v_pending_value numeric := 0;
  v_list jsonb := '[]'::jsonb;
  v_waiting jsonb := '[]'::jsonb;
BEGIN
  SELECT
    count(*) FILTER (WHERE c.signature_date = (_day_start AT TIME ZONE 'Africa/Nairobi')::date),
    count(*) FILTER (WHERE c.activated_at >= _day_start AND c.activated_at < _day_end),
    count(*) FILTER (WHERE c.activated_at >= _month_start::timestamptz AND c.activated_at < v_month_end::timestamptz),
    count(*) FILTER (WHERE c.activated_at IS NULL AND c.status = ANY (ARRAY[
      'shared','sent_to_customer','customer_review','under_negotiation','signature_pending','partially_signed'])),
    count(*) FILTER (WHERE c.activated_at IS NULL AND c.status = ANY (ARRAY[
      'customer_accepted','executed','contracted'])),
    coalesce(sum(c.value_amount) FILTER (WHERE c.activated_at IS NULL AND c.status = ANY (ARRAY[
      'customer_accepted','executed','contracted'])), 0)
    INTO v_signed_today, v_activated_today, v_activated_month,
         v_awaiting_signature, v_awaiting_activation, v_pending_value
    FROM public.commercial_contract_instances c
   WHERE c.owner_staff_id = _staff AND NOT c.is_test;

  SELECT
    coalesce(sum(e.amount) FILTER (WHERE e.created_at >= _day_start AND e.created_at < _day_end), 0),
    coalesce(sum(e.amount) FILTER (WHERE e.execution_date >= _month_start AND e.execution_date < v_month_end), 0)
    INTO v_rev_today, v_rev_month
    FROM public.contract_revenue_events e
    JOIN public.commercial_contract_instances c ON c.id = e.contract_id
   WHERE NOT c.is_test
     AND (e.staff_member_id = _staff OR c.owner_staff_id = _staff);

  -- contracts activated this month, newest first
  SELECT coalesce(jsonb_agg(x ORDER BY x->>'activated_at' DESC), '[]'::jsonb)
    INTO v_list
    FROM (
      SELECT jsonb_build_object(
               'contract_id', c.id,
               'contract_number', c.contract_number,
               'organisation', coalesce(a.name, a.legal_name, c.customer_legal_name),
               'status', c.status,
               'value_kes', c.value_amount,
               'currency', c.currency,
               'activated_at', c.activated_at,
               'revenue_recorded_kes', (
                 SELECT coalesce(sum(e.amount), 0) FROM public.contract_revenue_events e
                  WHERE e.contract_id = c.id)
             ) AS x
        FROM public.commercial_contract_instances c
        LEFT JOIN public.crm_accounts a ON a.id = c.account_id
       WHERE c.owner_staff_id = _staff AND NOT c.is_test
         AND c.activated_at >= _month_start::timestamptz
         AND c.activated_at < v_month_end::timestamptz
       ORDER BY c.activated_at DESC
       LIMIT 10
    ) s;

  -- what the contract book is waiting on
  SELECT coalesce(jsonb_agg(x), '[]'::jsonb)
    INTO v_waiting
    FROM (
      SELECT jsonb_build_object(
               'contract_id', c.id,
               'contract_number', c.contract_number,
               'organisation', coalesce(a.name, a.legal_name, c.customer_legal_name),
               'status', c.status,
               'value_kes', c.value_amount,
               'waiting_on', CASE
                 WHEN c.status = ANY (ARRAY['customer_accepted','executed','contracted'])
                   THEN 'Signed — waiting for activation'
                 ELSE 'Waiting for the signed copy' END
             ) AS x
        FROM public.commercial_contract_instances c
        LEFT JOIN public.crm_accounts a ON a.id = c.account_id
       WHERE c.owner_staff_id = _staff AND NOT c.is_test
         AND c.activated_at IS NULL
         AND c.status = ANY (ARRAY['shared','sent_to_customer','customer_review','under_negotiation',
                                   'signature_pending','partially_signed','customer_accepted',
                                   'executed','contracted'])
       ORDER BY c.value_amount DESC NULLS LAST, c.updated_at DESC
       LIMIT 10
    ) s;

  RETURN jsonb_build_object(
    'signed_today', v_signed_today,
    'activated_today', v_activated_today,
    'activated_this_month', v_activated_month,
    'revenue_recorded_today_kes', v_rev_today,
    'revenue_recorded_month_kes', v_rev_month,
    'awaiting_signature', v_awaiting_signature,
    'awaiting_activation', v_awaiting_activation,
    'awaiting_activation_value_kes', v_pending_value,
    'activated', v_list,
    'waiting', v_waiting
  );
END $function$;

REVOKE ALL ON FUNCTION public._sales_day_contracts(uuid, timestamptz, timestamptz, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._sales_day_contracts(uuid, timestamptz, timestamptz, date) TO authenticated;