CREATE TABLE public.corporate_billing_arrangements (
  corporate_id uuid PRIMARY KEY REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  mode text NOT NULL DEFAULT 'PREPAID_WALLET' CHECK (mode IN ('PREPAID_WALLET','CREDIT','HYBRID')),
  credit_period_days integer NOT NULL DEFAULT 1 CHECK (credit_period_days BETWEEN 1 AND 3),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','SUSPENDED')),
  notes text,
  approved_by uuid, approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.corporate_billing_arrangements TO authenticated;
GRANT ALL ON public.corporate_billing_arrangements TO service_role;
ALTER TABLE public.corporate_billing_arrangements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company members and finance read billing arrangement" ON public.corporate_billing_arrangements FOR SELECT TO authenticated
USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE public.corporate_trip_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.trip_bookings(id) ON DELETE RESTRICT,
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  mode text NOT NULL,
  fare_cents bigint NOT NULL,
  wallet_cents bigint NOT NULL DEFAULT 0,
  credit_cents bigint NOT NULL DEFAULT 0,
  status text NOT NULL CHECK (status IN ('SETTLED','EXCEPTION')),
  exception_reason text,
  cash_ledger_id uuid, facility_id uuid, invoice_id uuid, invoice_item_id uuid,
  attempts integer NOT NULL DEFAULT 1,
  settled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX corporate_trip_settlements_corp_idx ON public.corporate_trip_settlements(corporate_id, created_at);
GRANT SELECT ON public.corporate_trip_settlements TO authenticated;
GRANT ALL ON public.corporate_trip_settlements TO service_role;
ALTER TABLE public.corporate_trip_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company managers and finance read settlements" ON public.corporate_trip_settlements FOR SELECT TO authenticated
USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'finance_admin') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TRIGGER trg_cba_updated BEFORE UPDATE ON public.corporate_billing_arrangements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER trg_cts_updated BEFORE UPDATE ON public.corporate_trip_settlements FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION private.corporate_is_finance(_u uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.has_role(_u,'finance_admin') OR public.has_role(_u,'admin') OR public.has_role(_u,'super_admin') $$;

CREATE OR REPLACE FUNCTION private.corporate_wallet_cents(_c uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT balance_after_cents FROM corporate_cash_ledger WHERE corporate_id=_c ORDER BY occurred_at DESC, created_at DESC LIMIT 1),0) $$;

CREATE OR REPLACE FUNCTION private.corporate_active_facility(_c uuid) RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT id FROM corporate_credit_facilities WHERE corporate_id=_c AND state='ACTIVE'
    AND current_date BETWEEN effective_date AND expiry_date ORDER BY activated_at DESC NULLS LAST LIMIT 1 $$;

CREATE OR REPLACE FUNCTION private.corporate_available_credit_cents(_c uuid) RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce((SELECT greatest(approved_credit_limit_cents - coalesce(utilized_credit_cents,0),0) FROM corporate_credit_facilities WHERE id=private.corporate_active_facility(_c)),0) $$;

-- What the company can cover for one trip under its arrangement.
CREATE OR REPLACE FUNCTION private.corporate_capacity_cents(_c uuid) RETURNS bigint LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a corporate_billing_arrangements%ROWTYPE; m text;
BEGIN
  SELECT * INTO a FROM corporate_billing_arrangements WHERE corporate_id=_c;
  IF FOUND AND a.status='SUSPENDED' THEN RETURN 0; END IF;
  m := coalesce(a.mode,'PREPAID_WALLET');
  RETURN CASE m WHEN 'PREPAID_WALLET' THEN private.corporate_wallet_cents(_c)
    WHEN 'CREDIT' THEN private.corporate_available_credit_cents(_c)
    ELSE greatest(private.corporate_wallet_cents(_c),0) + private.corporate_available_credit_cents(_c) END;
END $$;

-- Open credit invoice for the current 1–3 day cycle.
CREATE OR REPLACE FUNCTION private.corporate_cycle_invoice(_c uuid, _days int) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p uuid; inv uuid; ps date; pe date;
BEGIN
  SELECT id, period_start, period_end INTO p, ps, pe FROM corporate_billing_periods
   WHERE corporate_id=_c AND status='OPEN' AND current_date BETWEEN period_start AND period_end AND metadata->>'kind'='credit_cycle'
   ORDER BY period_start DESC LIMIT 1;
  IF p IS NULL THEN
    ps := current_date; pe := current_date + (_days-1);
    INSERT INTO corporate_billing_periods(corporate_id, period_start, period_end, metadata)
      VALUES (_c, ps, pe, jsonb_build_object('kind','credit_cycle','days',_days))
      ON CONFLICT (corporate_id, period_start, period_end) DO UPDATE SET updated_at=now() RETURNING id INTO p;
  END IF;
  SELECT id INTO inv FROM corporate_invoices WHERE corporate_id=_c AND period_id=p;
  IF inv IS NULL THEN
    INSERT INTO corporate_invoices(corporate_id, period_id, invoice_number, status, subtotal_cents, tax_total_cents, total_cents, paid_cents, balance_cents, currency, due_at, metadata)
    VALUES (_c, p, 'TXD-CI-'||to_char(ps,'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,6)),
      'DRAFT', 0, 0, 0, 0, 0, 'KES', (pe + 1 + _days)::timestamptz, jsonb_build_object('kind','credit_cycle','credit_period_days',_days))
    RETURNING id INTO inv;
  END IF;
  RETURN inv;
END $$;

CREATE OR REPLACE FUNCTION private.corporate_trip_settle(_booking_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b trip_bookings%ROWTYPE; a corporate_billing_arrangements%ROWTYPE; s corporate_trip_settlements%ROWTYPE;
  m text; fare bigint; wal bigint; cred bigint; use_w bigint := 0; use_c bigint := 0; reason text;
  led uuid; fac uuid; inv uuid; item uuid; ln int; emp text;
BEGIN
  SELECT * INTO b FROM trip_bookings WHERE id=_booking_id FOR UPDATE;
  IF NOT FOUND OR b.booking_context<>'business' OR b.corporate_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_A_BUSINESS_TRIP'); END IF;
  IF b.status<>'completed' THEN RETURN jsonb_build_object('ok',false,'error','TRIP_NOT_COMPLETED'); END IF;
  SELECT * INTO s FROM corporate_trip_settlements WHERE booking_id=_booking_id FOR UPDATE;
  IF FOUND AND s.status='SETTLED' THEN RETURN jsonb_build_object('ok',true,'already',true,'status','SETTLED'); END IF;

  fare := round(coalesce(b.total_fare,0)*100)::bigint;
  SELECT * INTO a FROM corporate_billing_arrangements WHERE corporate_id=b.corporate_id;
  m := coalesce(a.mode,'PREPAID_WALLET');
  PERFORM 1 FROM corporate_accounts WHERE id=b.corporate_id FOR UPDATE;
  wal := private.corporate_wallet_cents(b.corporate_id);
  fac := private.corporate_active_facility(b.corporate_id);
  cred := private.corporate_available_credit_cents(b.corporate_id);

  IF fare <= 0 THEN reason := 'NO_FINAL_FARE';
  ELSIF coalesce(a.status,'ACTIVE')='SUSPENDED' THEN reason := 'BILLING_SUSPENDED';
  ELSIF m='PREPAID_WALLET' THEN IF wal >= fare THEN use_w := fare; ELSE reason := 'WALLET_INSUFFICIENT'; END IF;
  ELSIF m='CREDIT' THEN IF fac IS NULL THEN reason := 'NO_ACTIVE_CREDIT_FACILITY'; ELSIF cred >= fare THEN use_c := fare; ELSE reason := 'CREDIT_LIMIT_EXCEEDED'; END IF;
  ELSE use_w := least(greatest(wal,0), fare); use_c := fare - use_w;
    IF use_c > 0 AND (fac IS NULL OR cred < use_c) THEN reason := 'WALLET_AND_CREDIT_INSUFFICIENT'; use_w := 0; use_c := 0; END IF;
  END IF;

  IF reason IS NOT NULL THEN
    INSERT INTO corporate_trip_settlements(booking_id, corporate_id, mode, fare_cents, status, exception_reason)
      VALUES (_booking_id, b.corporate_id, m, fare, 'EXCEPTION', reason)
      ON CONFLICT (booking_id) DO UPDATE SET mode=EXCLUDED.mode, fare_cents=EXCLUDED.fare_cents, exception_reason=EXCLUDED.exception_reason, attempts=corporate_trip_settlements.attempts+1;
    RETURN jsonb_build_object('ok',false,'status','EXCEPTION','reason',reason);
  END IF;

  IF use_w > 0 THEN
    INSERT INTO corporate_cash_ledger(corporate_id, entry_type, amount_cents, balance_after_cents, reference, description, source_kind, source_id, created_by, metadata)
      VALUES (b.corporate_id, 'ride_charge', -use_w, wal - use_w, b.booking_number, 'Business trip '||b.booking_number, 'trip_booking', b.id, auth.uid(),
        jsonb_build_object('trip_purpose', b.trip_purpose, 'cost_center', b.cost_center_code)) RETURNING id INTO led;
  END IF;
  IF use_c > 0 THEN
    UPDATE corporate_credit_facilities SET utilized_credit_cents = coalesce(utilized_credit_cents,0) + use_c, updated_at=now() WHERE id=fac;
    inv := private.corporate_cycle_invoice(b.corporate_id, coalesce(a.credit_period_days,1));
    SELECT coalesce(max(line_number),0)+1 INTO ln FROM corporate_invoice_items WHERE invoice_id=inv;
    SELECT coalesce(p.full_name, e.email) INTO emp FROM corporate_employees e LEFT JOIN profiles p ON p.user_id=e.user_id WHERE e.id=b.corporate_employee_id;
    INSERT INTO corporate_invoice_items(invoice_id, line_number, source_ref, description, employee_user_id, employee_name, cost_center,
      trip_origin, trip_destination, trip_started_at, trip_ended_at, quantity, unit_price_cents, taxable_cents, tax_cents, total_cents, metadata)
      VALUES (inv, ln, b.booking_number, 'Business trip '||b.booking_number||coalesce(' — '||b.trip_purpose,''), b.rider_user_id, emp, b.cost_center_code,
        b.pickup_address, b.dropoff_address, b.started_at, b.completed_at, 1, use_c, use_c, 0, use_c, jsonb_build_object('booking_id', b.id, 'facility_id', fac))
      RETURNING id INTO item;
    UPDATE corporate_invoices SET subtotal_cents=subtotal_cents+use_c, total_cents=total_cents+use_c, balance_cents=balance_cents+use_c, updated_at=now() WHERE id=inv;
  END IF;

  INSERT INTO corporate_trip_settlements(booking_id, corporate_id, mode, fare_cents, wallet_cents, credit_cents, status, cash_ledger_id, facility_id, invoice_id, invoice_item_id, settled_at)
    VALUES (_booking_id, b.corporate_id, m, fare, use_w, use_c, 'SETTLED', led, CASE WHEN use_c>0 THEN fac END, inv, item, now())
    ON CONFLICT (booking_id) DO UPDATE SET mode=EXCLUDED.mode, fare_cents=EXCLUDED.fare_cents, wallet_cents=EXCLUDED.wallet_cents, credit_cents=EXCLUDED.credit_cents,
      status='SETTLED', exception_reason=NULL, cash_ledger_id=EXCLUDED.cash_ledger_id, facility_id=EXCLUDED.facility_id, invoice_id=EXCLUDED.invoice_id,
      invoice_item_id=EXCLUDED.invoice_item_id, settled_at=now(), attempts=corporate_trip_settlements.attempts+1;
  RETURN jsonb_build_object('ok',true,'status','SETTLED','wallet_cents',use_w,'credit_cents',use_c,'invoice_id',inv);
END $$;

-- Runs automatically on completion; never blocks the trip from finishing.
CREATE OR REPLACE FUNCTION private.trg_business_trip_settle() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status='completed' AND OLD.status IS DISTINCT FROM 'completed' AND NEW.booking_context='business' AND NEW.corporate_id IS NOT NULL THEN
    BEGIN
      PERFORM private.corporate_trip_settle(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO corporate_trip_settlements(booking_id, corporate_id, mode, fare_cents, status, exception_reason)
        VALUES (NEW.id, NEW.corporate_id, 'UNKNOWN', round(coalesce(NEW.total_fare,0)*100)::bigint, 'EXCEPTION', left('SETTLEMENT_ERROR: '||SQLERRM,300))
        ON CONFLICT (booking_id) DO UPDATE SET exception_reason=EXCLUDED.exception_reason, attempts=corporate_trip_settlements.attempts+1;
    END;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_business_trip_settle AFTER UPDATE OF status ON public.trip_bookings FOR EACH ROW EXECUTE FUNCTION private.trg_business_trip_settle();

-- Finance: set arrangement, retry exceptions, issue invoices whose cycle ended.
CREATE OR REPLACE FUNCTION private.corporate_billing_set(_corporate_id uuid, _mode text, _credit_period_days int DEFAULT 1, _status text DEFAULT 'ACTIVE', _notes text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private.corporate_is_finance(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  IF _mode NOT IN ('PREPAID_WALLET','CREDIT','HYBRID') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_MODE'); END IF;
  IF _credit_period_days NOT BETWEEN 1 AND 3 THEN RETURN jsonb_build_object('ok',false,'error','CREDIT_PERIOD_1_TO_3_DAYS'); END IF;
  IF _mode IN ('CREDIT','HYBRID') AND private.corporate_active_facility(_corporate_id) IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NO_ACTIVE_CREDIT_FACILITY'); END IF;
  INSERT INTO corporate_billing_arrangements(corporate_id, mode, credit_period_days, status, notes, approved_by, approved_at)
    VALUES (_corporate_id, _mode, _credit_period_days, _status, left(_notes,500), auth.uid(), now())
    ON CONFLICT (corporate_id) DO UPDATE SET mode=EXCLUDED.mode, credit_period_days=EXCLUDED.credit_period_days, status=EXCLUDED.status,
      notes=EXCLUDED.notes, approved_by=EXCLUDED.approved_by, approved_at=now();
  RETURN jsonb_build_object('ok',true);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_settlement_retry(_booking_id uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT private.corporate_is_finance(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  RETURN private.corporate_trip_settle(_booking_id);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_credit_invoices_issue() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE n int;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT private.corporate_is_finance(auth.uid()) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  WITH done AS (
    UPDATE corporate_billing_periods SET status='BILLED', locked_at=now(), billed_at=now(), updated_at=now()
     WHERE status='OPEN' AND metadata->>'kind'='credit_cycle' AND period_end < current_date RETURNING id)
  UPDATE corporate_invoices i SET status='ISSUED', issued_at=now(), updated_at=now()
    FROM done WHERE i.period_id=done.id AND i.status='DRAFT' AND i.total_cents > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN jsonb_build_object('ok',true,'issued',n);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_billing_overview(_corporate_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE a corporate_billing_arrangements%ROWTYPE;
BEGIN
  IF NOT (private.corporate_is_finance(auth.uid()) OR public.is_corporate_manager_or_admin(auth.uid(), _corporate_id)) THEN RAISE EXCEPTION 'NOT_AUTHORISED' USING ERRCODE='42501'; END IF;
  SELECT * INTO a FROM corporate_billing_arrangements WHERE corporate_id=_corporate_id;
  RETURN jsonb_build_object(
    'mode', coalesce(a.mode,'PREPAID_WALLET'), 'credit_period_days', coalesce(a.credit_period_days,1), 'status', coalesce(a.status,'ACTIVE'),
    'wallet_cents', private.corporate_wallet_cents(_corporate_id),
    'available_credit_cents', private.corporate_available_credit_cents(_corporate_id),
    'has_facility', private.corporate_active_facility(_corporate_id) IS NOT NULL,
    'settled_count', (SELECT count(*) FROM corporate_trip_settlements WHERE corporate_id=_corporate_id AND status='SETTLED'),
    'exceptions', coalesce((SELECT jsonb_agg(jsonb_build_object('booking_id',s.booking_id,'booking_number',b.booking_number,'fare_cents',s.fare_cents,'reason',s.exception_reason,'at',s.updated_at) ORDER BY s.updated_at DESC)
       FROM corporate_trip_settlements s JOIN trip_bookings b ON b.id=s.booking_id WHERE s.corporate_id=_corporate_id AND s.status='EXCEPTION'),'[]'::jsonb),
    'recent', coalesce((SELECT jsonb_agg(x ORDER BY x->>'at' DESC) FROM (SELECT jsonb_build_object('booking_number',b.booking_number,'fare_cents',s.fare_cents,'wallet_cents',s.wallet_cents,'credit_cents',s.credit_cents,'invoice_number',i.invoice_number,'at',s.settled_at) x
       FROM corporate_trip_settlements s JOIN trip_bookings b ON b.id=s.booking_id LEFT JOIN corporate_invoices i ON i.id=s.invoice_id
       WHERE s.corporate_id=_corporate_id AND s.status='SETTLED' ORDER BY s.settled_at DESC LIMIT 20) q),'[]'::jsonb),
    'open_invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('invoice_number',invoice_number,'status',status,'total_cents',total_cents,'balance_cents',balance_cents,'due_at',due_at) ORDER BY created_at DESC)
       FROM corporate_invoices WHERE corporate_id=_corporate_id AND status IN ('DRAFT','ISSUED','PARTIALLY_PAID','OVERDUE') AND metadata->>'kind'='credit_cycle'),'[]'::jsonb));
END $$;

-- Booking check: wallet and/or approved credit per arrangement.
DO $$
DECLARE src text;
BEGIN
  SELECT pg_get_functiondef('private.trip_confirm_booking_ctx(uuid,text,text,uuid,text,text,timestamptz)'::regprocedure) INTO src;
  src := replace(src, 'IF v_wallet < v_fare THEN', 'v_wallet := private.corporate_capacity_cents(_corporate_id);
  IF v_wallet < v_fare THEN');
  src := replace(src, '''COMPANY_WALLET_INSUFFICIENT''', '''COMPANY_FUNDS_INSUFFICIENT''');
  EXECUTE src;
END $$;

REVOKE ALL ON FUNCTION private.corporate_is_finance(uuid), private.corporate_wallet_cents(uuid), private.corporate_active_facility(uuid), private.corporate_available_credit_cents(uuid),
  private.corporate_capacity_cents(uuid), private.corporate_cycle_invoice(uuid,int), private.corporate_trip_settle(uuid), private.trg_business_trip_settle(),
  private.corporate_billing_set(uuid,text,int,text,text), private.corporate_settlement_retry(uuid), private.corporate_credit_invoices_issue(), private.corporate_billing_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.corporate_billing_set(uuid,text,int,text,text), private.corporate_settlement_retry(uuid), private.corporate_credit_invoices_issue(),
  private.corporate_billing_overview(uuid), private.corporate_capacity_cents(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.corporate_billing_set(_corporate_id uuid, _mode text, _credit_period_days int DEFAULT 1, _status text DEFAULT 'ACTIVE', _notes text DEFAULT NULL) RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_billing_set(_corporate_id,_mode,_credit_period_days,_status,_notes) $$;
CREATE OR REPLACE FUNCTION public.corporate_settlement_retry(_booking_id uuid) RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_settlement_retry(_booking_id) $$;
CREATE OR REPLACE FUNCTION public.corporate_credit_invoices_issue() RETURNS jsonb
  LANGUAGE sql SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_credit_invoices_issue() $$;
CREATE OR REPLACE FUNCTION public.corporate_billing_overview(_corporate_id uuid) RETURNS jsonb
  LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_billing_overview(_corporate_id) $$;
REVOKE ALL ON FUNCTION public.corporate_billing_set(uuid,text,int,text,text), public.corporate_settlement_retry(uuid), public.corporate_credit_invoices_issue(), public.corporate_billing_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_billing_set(uuid,text,int,text,text), public.corporate_settlement_retry(uuid), public.corporate_credit_invoices_issue(), public.corporate_billing_overview(uuid) TO authenticated;