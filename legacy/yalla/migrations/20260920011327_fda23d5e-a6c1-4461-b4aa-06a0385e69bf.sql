DO $migration$
DECLARE
  signature regprocedure;
BEGIN
  FOREACH signature IN ARRAY ARRAY[
    'public._carrier_owns_leg(uuid,uuid)'::regprocedure,
    'public._commercial_missing_evidence(uuid,text)'::regprocedure,
    'public._invoice_assert_complete(uuid)'::regprocedure,
    'public._invoice_can_write(uuid)'::regprocedure,
    'public._log_exception_action(uuid,text,text,text,uuid,uuid,text,text)'::regprocedure,
    'public._logistics_hub_audit(uuid,text,jsonb,jsonb)'::regprocedure,
    'public._proforma_assert_complete(uuid)'::regprocedure,
    'public._proforma_can_approve()'::regprocedure,
    'public._proforma_can_write(uuid)'::regprocedure,
    'public._provider_booking_reference()'::regprocedure,
    'public._provider_payout_tier(bigint)'::regprocedure,
    'public._rate_card_can_approve()'::regprocedure,
    'public._rate_card_can_read()'::regprocedure,
    'public._rate_card_can_write()'::regprocedure,
    'public._revenue_finance_authorised()'::regprocedure,
    'public._sales_day_contracts(uuid,timestamp with time zone,timestamp with time zone,date)'::regprocedure,
    'public._sales_eligible_codes()'::regprocedure,
    'public._sales_kpi_target(uuid,date,date)'::regprocedure,
    'public._sales_lead_writable(uuid)'::regprocedure,
    'public._sales_person_figures(uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure
  ]
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', signature);
  END LOOP;
END
$migration$;