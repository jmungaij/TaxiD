CREATE OR REPLACE FUNCTION public.audit_trip_booking_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  IF NEW.total_fare IS DISTINCT FROM OLD.total_fare THEN v_cols := array_append(v_cols,'total_fare'); END IF;
  IF NEW.surge_multiplier IS DISTINCT FROM OLD.surge_multiplier THEN v_cols := array_append(v_cols,'surge_multiplier'); END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN v_cols := array_append(v_cols,'payment_method'); END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN v_cols := array_append(v_cols,'currency'); END IF;
  IF NEW.tax_cents IS DISTINCT FROM OLD.tax_cents THEN v_cols := array_append(v_cols,'tax_cents'); END IF;
  IF NEW.commission_cents IS DISTINCT FROM OLD.commission_cents THEN v_cols := array_append(v_cols,'commission_cents'); END IF;
  IF NEW.partner_entitlement_cents IS DISTINCT FROM OLD.partner_entitlement_cents THEN v_cols := array_append(v_cols,'partner_entitlement_cents'); END IF;
  IF NEW.payment_reference IS DISTINCT FROM OLD.payment_reference THEN v_cols := array_append(v_cols,'payment_reference'); END IF;
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN v_cols := array_append(v_cols,'payment_status'); END IF;
  IF array_length(v_cols,1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_privileged_update(
    'trip_bookings', NEW.id::text, v_cols,
    jsonb_build_object('total_fare',OLD.total_fare,'surge_multiplier',OLD.surge_multiplier,'status',OLD.status,'payment_method',OLD.payment_method,'currency',OLD.currency,'tax_cents',OLD.tax_cents,'commission_cents',OLD.commission_cents,'partner_entitlement_cents',OLD.partner_entitlement_cents,'payment_reference',OLD.payment_reference,'payment_status',OLD.payment_status),
    jsonb_build_object('total_fare',NEW.total_fare,'surge_multiplier',NEW.surge_multiplier,'status',NEW.status,'payment_method',NEW.payment_method,'currency',NEW.currency,'tax_cents',NEW.tax_cents,'commission_cents',NEW.commission_cents,'partner_entitlement_cents',NEW.partner_entitlement_cents,'payment_reference',NEW.payment_reference,'payment_status',NEW.payment_status)
  );
  RETURN NEW;
END; $function$;