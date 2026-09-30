CREATE OR REPLACE FUNCTION public.commercial_quotation_accept(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  q public.commercial_quotations;
  v_staff uuid := public._my_staff_member_id();
  v_from date := nullif(p->>'service_from','')::date;
  v_ref text := nullif(btrim(coalesce(p->>'customer_reference','')),'');
  v_make_bookings boolean := coalesce((p->>'create_bookings')::boolean, true);
  v_account_name text;
  v_invoice public.tax_invoices;
  v_invoice_id uuid;
  v_sub bigint; v_vat bigint;
  v_line record;
  v_line_no int := 0;
  v_bookings int := 0;
  v_commission uuid;
  v_commission_error text;
  v_start timestamptz;
  v_i int;
  v_created_invoice boolean := false;
  v_first_service text;
  v_first_scope text;
  v_first_category text;
  v_snapshot jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'NOT_AUTHENTICATED'; END IF;

  SELECT * INTO q FROM public.commercial_quotations WHERE id = (p->>'quotation_id')::uuid;
  IF q.id IS NULL THEN RAISE EXCEPTION 'QUOTATION_NOT_FOUND'; END IF;
  IF NOT (public.is_platform_admin() OR public.is_commercial_staff()) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED';
  END IF;
  IF q.status IN ('declined','expired','superseded') THEN
    RAISE EXCEPTION 'QUOTATION_NOT_OPEN: %', q.status;
  END IF;
  IF q.approval_status = 'pending' THEN
    RAISE EXCEPTION 'APPROVAL_PENDING: the negotiated price still needs approval';
  END IF;

  -- Quote validity: a lapsed price must be repriced, never booked as-is.
  IF q.status <> 'accepted' THEN
    IF q.valid_from IS NOT NULL AND q.valid_from > current_date THEN
      RAISE EXCEPTION 'QUOTATION_NOT_YET_VALID: this price takes effect on %', q.valid_from;
    END IF;
    IF q.valid_until IS NOT NULL AND q.valid_until < current_date THEN
      UPDATE public.commercial_quotations SET status = 'expired', updated_at = now()
       WHERE id = q.id AND status NOT IN ('accepted','superseded');
      RAISE EXCEPTION 'QUOTATION_EXPIRED: validity ended on % — reprice and revalidate before booking', q.valid_until;
    END IF;
  END IF;

  IF coalesce(q.total_amount,0) <= 0 THEN RAISE EXCEPTION 'QUOTATION_VALUE_REQUIRED'; END IF;
  IF v_from IS NULL THEN RAISE EXCEPTION 'SERVICE_FROM_REQUIRED'; END IF;

  SELECT a.name INTO v_account_name FROM public.crm_accounts a WHERE a.id = q.account_id;

  SELECT l.service_code, l.scope_label, l.category_code
    INTO v_first_service, v_first_scope, v_first_category
    FROM public.commercial_quotation_lines l
   WHERE l.quotation_id = q.id ORDER BY l.created_at LIMIT 1;

  -- Invoice at the quoted price (the transaction price), once per quotation.
  SELECT * INTO v_invoice FROM public.tax_invoices
   WHERE quote_reference = q.quote_number AND status <> 'cancelled' LIMIT 1;
  IF v_invoice.id IS NULL THEN
    v_sub := round(q.total_amount * 100)::bigint;
    v_vat := round(v_sub * 0.16)::bigint;
    INSERT INTO public.tax_invoices (
      status, customer_company, currency, vat_rate, vat_inclusive, payment_terms,
      quote_reference, customer_ref, service_from, subtotal_cents, vat_cents, total_cents,
      paid_cents, owner_staff_id, created_by, account_id, contract_id, notes
    ) VALUES (
      'draft', coalesce(v_account_name, 'Unnamed customer'), coalesce(q.currency,'KES'), 16, false,
      '30 days', q.quote_number, v_ref, v_from, v_sub, v_vat, v_sub + v_vat,
      0, coalesce(q.owner_staff_id, v_staff), auth.uid(), q.account_id, q.contract_instance_id,
      'Raised from accepted quotation ' || q.quote_number || ' at the quoted price.'
    ) RETURNING id INTO v_invoice_id;
    v_created_invoice := true;

    FOR v_line IN
      SELECT * FROM public.commercial_quotation_lines WHERE quotation_id = q.id ORDER BY created_at
    LOOP
      v_line_no := v_line_no + 1;
      INSERT INTO public.tax_invoice_lines (
        invoice_id, line_no, description, service_date, vehicle_category, qty,
        unit_rate_cents, amount_cents
      ) VALUES (
        v_invoice_id, v_line_no,
        coalesce(v_line.scope_label,'') || ' · ' || v_line.service_code || ' (' || v_line.category_code || ')',
        v_from, v_line.category_code, v_line.quantity,
        round(v_line.unit_amount * 100)::bigint,
        round(v_line.line_total * 100)::bigint
      );
    END LOOP;
  ELSE
    v_invoice_id := v_invoice.id;
  END IF;

  -- Booked service records: one per quoted unit, idempotent per quotation line.
  IF v_make_bookings THEN
    FOR v_line IN
      SELECT * FROM public.commercial_quotation_lines WHERE quotation_id = q.id ORDER BY created_at
    LOOP
      FOR v_i IN 1..least(greatest(coalesce(v_line.quantity,1)::int,1), 60) LOOP
        v_start := (v_from + (v_i - 1)) + time '08:00' AT TIME ZONE 'Africa/Nairobi';
        INSERT INTO public.commercial_service_executions (
          execution_ref, account_id, contract_id, owner_staff_id, service_type,
          origin, destination, scheduled_at, status, value_kes, external_reference, recorded_by
        )
        SELECT
          'SVC-' || to_char(now(),'DDMMYY') || '-' || upper(substr(md5(v_line.id::text || v_i::text),1,5)),
          q.account_id, q.contract_instance_id, coalesce(q.owner_staff_id, v_staff),
          CASE WHEN v_line.service_code = 'airport_transfer' THEN 'AIRPORT_TRANSFER' ELSE 'CHARTER' END,
          NULL, v_line.scope_label, v_start, 'SCHEDULED', v_line.unit_amount,
          q.quote_number || '#' || v_line.id::text || '#' || v_i::text, auth.uid()
        WHERE NOT EXISTS (
          SELECT 1 FROM public.commercial_service_executions e
           WHERE e.external_reference = q.quote_number || '#' || v_line.id::text || '#' || v_i::text);
        v_bookings := v_bookings + 1;
      END LOOP;
    END LOOP;
  END IF;

  -- Immutable commission snapshot at the accepted (quoted) price.
  BEGIN
    v_snapshot := public.commission_snapshot_record(jsonb_build_object(
      'source_kind', 'commercial_quotation',
      'source_id', q.id::text,
      'idempotency_key', 'quotation:' || q.id::text,
      'service_code', v_first_service,
      'scope_label', v_first_scope,
      'category_code', v_first_category,
      'transaction_type', 'corporate_charter',
      'account_id', q.account_id,
      'contract_id', q.contract_instance_id,
      'owner_staff_id', coalesce(q.owner_staff_id, v_staff),
      'currency', coalesce(q.currency,'KES'),
      'net_service_price', q.total_amount,
      'tax_amount', round(q.total_amount * 0.16, 2),
      'on_date', v_from));
  EXCEPTION WHEN OTHERS THEN
    v_snapshot := jsonb_build_object('error', SQLERRM);
  END;

  -- Commission payable event on the accepted value, idempotent per quotation.
  -- Acceptance authority was already enforced above, so this is an authorised
  -- platform action for the duration of this transaction only.
  PERFORM set_config('yalla.commission_system_action', 'on', true);
  BEGIN
    v_commission := public.commission_generate_event(
      'commercial_quotation', q.id::text, round(q.total_amount * 100)::bigint,
      v_from, NULL, NULL, q.quote_number, coalesce(q.currency,'KES'),
      NULL, coalesce(q.owner_staff_id, v_staff), 'primary', 100,
      'quotation:' || q.id::text);
  EXCEPTION WHEN OTHERS THEN
    v_commission := NULL;
    v_commission_error := SQLERRM;
  END;
  PERFORM set_config('yalla.commission_system_action', 'off', true);

  UPDATE public.commercial_quotations
     SET status = 'accepted', updated_at = now(),
         notes = coalesce(notes,'') ||
                 CASE WHEN v_ref IS NOT NULL THEN E'\nCustomer reference: ' || v_ref ELSE '' END
   WHERE id = q.id;

  RETURN jsonb_build_object(
    'quotation_id', q.id,
    'quote_number', q.quote_number,
    'invoice_id', v_invoice_id,
    'invoice_created', v_created_invoice,
    'bookings_created', v_bookings,
    'commission_event_id', v_commission,
    'commission_note', CASE WHEN v_commission IS NULL
      THEN coalesce('Commission not raised: ' || v_commission_error,
                    'Commission not raised — no active plan or owner rule resolves this revenue.') END,
    'commission_resolution_id', v_snapshot->>'resolution_id',
    'commission_snapshot', v_snapshot->'resolution',
    'transaction_value', q.total_amount);
END; $function$;

REVOKE ALL ON FUNCTION public.commercial_quotation_accept(jsonb) FROM anon;