-- ===== Pricing =====
ALTER TABLE public.ride_types
  ADD COLUMN IF NOT EXISTS internal_class text,
  ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'metered',
  ADD COLUMN IF NOT EXISTS min_multiplier numeric NOT NULL DEFAULT 0.90,
  ADD COLUMN IF NOT EXISTS max_multiplier numeric NOT NULL DEFAULT 1.30,
  ADD COLUMN IF NOT EXISTS corporate_max_multiplier numeric NOT NULL DEFAULT 1.15;
ALTER TABLE public.mobility_vehicle_classes ADD COLUMN IF NOT EXISTS pricing_model text NOT NULL DEFAULT 'metered';
ALTER TABLE public.taxid_rate_card ADD COLUMN IF NOT EXISTS direction text;

CREATE TABLE public.pricing_modifiers (
  code text PRIMARY KEY, label text NOT NULL, applies_to text NOT NULL DEFAULT 'ride',
  multiplier numeric NOT NULL DEFAULT 1, floor_multiplier numeric, ceiling_multiplier numeric,
  conditions jsonb NOT NULL DEFAULT '{}', is_active boolean NOT NULL DEFAULT true, sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pricing_modifiers TO authenticated;
GRANT ALL ON public.pricing_modifiers TO service_role;
ALTER TABLE public.pricing_modifiers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Signed-in read modifiers" ON public.pricing_modifiers FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage modifiers" ON public.pricing_modifiers FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_pricing_modifiers_updated BEFORE UPDATE ON public.pricing_modifiers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Phase 2a: fund holds =====
CREATE TABLE public.corporate_fund_holds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL UNIQUE REFERENCES public.trip_bookings(id) ON DELETE CASCADE,
  corporate_id uuid NOT NULL, department_id uuid, cost_center_code text,
  amount_cents bigint NOT NULL CHECK (amount_cents >= 0), captured_cents bigint,
  status text NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD','CAPTURED','RELEASED')),
  held_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX ON public.corporate_fund_holds(corporate_id, status);
GRANT SELECT ON public.corporate_fund_holds TO authenticated;
GRANT ALL ON public.corporate_fund_holds TO service_role;
ALTER TABLE public.corporate_fund_holds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company managers read holds" ON public.corporate_fund_holds FOR SELECT TO authenticated
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'admin'));
CREATE TRIGGER trg_fund_holds_updated BEFORE UPDATE ON public.corporate_fund_holds FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Phase 2b: immutable ledger =====
CREATE TABLE public.trip_financial_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL, corporate_id uuid, department_id uuid, cost_center_code text,
  event text NOT NULL CHECK (event IN ('HOLD_PLACED','HOLD_ADJUSTED','HOLD_RELEASED','HOLD_CAPTURED','FARE_CHARGED')),
  amount_cents bigint NOT NULL, platform_commission_cents bigint, provider_net_cents bigint, commission_pct numeric,
  idempotency_key text NOT NULL UNIQUE, metadata jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE INDEX ON public.trip_financial_ledger(corporate_id, created_at);
CREATE INDEX ON public.trip_financial_ledger(booking_id);
GRANT SELECT ON public.trip_financial_ledger TO authenticated;
GRANT ALL ON public.trip_financial_ledger TO service_role;
ALTER TABLE public.trip_financial_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company managers read ledger" ON public.trip_financial_ledger FOR SELECT TO authenticated
  USING ((corporate_id IS NOT NULL AND public.is_corporate_manager_or_admin(auth.uid(), corporate_id)) OR public.has_role(auth.uid(),'admin'));
CREATE OR REPLACE FUNCTION private.ledger_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN RAISE EXCEPTION 'LEDGER_IS_APPEND_ONLY'; END $$;
CREATE TRIGGER trg_trip_ledger_immutable BEFORE UPDATE OR DELETE ON public.trip_financial_ledger FOR EACH ROW EXECUTE FUNCTION private.ledger_append_only();
CREATE TRIGGER trg_trip_ledger_no_truncate BEFORE TRUNCATE ON public.trip_financial_ledger FOR EACH STATEMENT EXECUTE FUNCTION private.ledger_append_only();

-- ===== Phase 2c: budgets =====
CREATE TABLE public.corporate_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('department','cost_center')),
  department_id uuid REFERENCES public.corporate_departments(id) ON DELETE CASCADE,
  cost_center_code text,
  monthly_amount_cents bigint NOT NULL CHECK (monthly_amount_cents >= 0),
  enforcement text NOT NULL DEFAULT 'approval' CHECK (enforcement IN ('warn','approval','block')),
  warn_at_pct int NOT NULL DEFAULT 80 CHECK (warn_at_pct BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true, created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((scope='department' AND department_id IS NOT NULL) OR (scope='cost_center' AND cost_center_code IS NOT NULL)));
CREATE UNIQUE INDEX corporate_budgets_dept_uq ON public.corporate_budgets(corporate_id, department_id) WHERE scope='department';
CREATE UNIQUE INDEX corporate_budgets_cc_uq ON public.corporate_budgets(corporate_id, lower(cost_center_code)) WHERE scope='cost_center';
GRANT SELECT, INSERT, UPDATE, DELETE ON public.corporate_budgets TO authenticated;
GRANT ALL ON public.corporate_budgets TO service_role;
ALTER TABLE public.corporate_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Members read budgets" ON public.corporate_budgets FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.has_role(auth.uid(),'admin'));
CREATE POLICY "Managers manage budgets" ON public.corporate_budgets FOR ALL TO authenticated
  USING (public.is_corporate_manager_or_admin(auth.uid(), corporate_id))
  WITH CHECK (public.is_corporate_manager_or_admin(auth.uid(), corporate_id));
CREATE TRIGGER trg_corporate_budgets_updated BEFORE UPDATE ON public.corporate_budgets FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Engine functions =====
CREATE OR REPLACE FUNCTION private.corporate_held_cents(_c uuid, _exclude uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT coalesce(sum(amount_cents),0)::bigint FROM corporate_fund_holds WHERE corporate_id=_c AND status='HELD' AND booking_id IS DISTINCT FROM _exclude $$;

-- used = charged this month + active holds, for one budget
CREATE OR REPLACE FUNCTION private.corporate_budget_used_cents(_b public.corporate_budgets, _exclude uuid DEFAULT NULL)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT (SELECT coalesce(sum(amount_cents),0) FROM trip_financial_ledger l
           WHERE l.corporate_id=_b.corporate_id AND l.event='FARE_CHARGED' AND l.created_at >= date_trunc('month', now())
             AND ((_b.scope='department' AND l.department_id=_b.department_id) OR (_b.scope='cost_center' AND lower(l.cost_center_code)=lower(_b.cost_center_code))))
       + (SELECT coalesce(sum(amount_cents),0) FROM corporate_fund_holds h
           WHERE h.corporate_id=_b.corporate_id AND h.status='HELD' AND h.booking_id IS DISTINCT FROM _exclude
             AND ((_b.scope='department' AND h.department_id=_b.department_id) OR (_b.scope='cost_center' AND lower(h.cost_center_code)=lower(_b.cost_center_code)))) $$;

-- Worst outcome across matching budgets: OK | WARN | APPROVAL | BLOCK
CREATE OR REPLACE FUNCTION private.corporate_budget_check(_c uuid, _dept uuid, _cc text, _fare bigint, _exclude uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b corporate_budgets%ROWTYPE; used bigint; worst int := 0; r int; out jsonb := '[]';
BEGIN
  FOR b IN SELECT * FROM corporate_budgets WHERE corporate_id=_c AND active
     AND ((scope='department' AND department_id=_dept) OR (scope='cost_center' AND _cc IS NOT NULL AND lower(cost_center_code)=lower(btrim(_cc)))) LOOP
    used := private.corporate_budget_used_cents(b, _exclude);
    r := CASE WHEN used + _fare > b.monthly_amount_cents THEN CASE b.enforcement WHEN 'block' THEN 3 WHEN 'approval' THEN 2 ELSE 1 END
              WHEN b.monthly_amount_cents > 0 AND (used + _fare) * 100 >= b.monthly_amount_cents * b.warn_at_pct THEN 1 ELSE 0 END;
    worst := greatest(worst, r);
    out := out || jsonb_build_object('budget_id', b.id, 'scope', b.scope, 'limit_cents', b.monthly_amount_cents, 'used_cents', used, 'after_cents', used+_fare, 'result', r);
  END LOOP;
  RETURN jsonb_build_object('decision', (ARRAY['OK','WARN','APPROVAL','BLOCK'])[worst+1], 'budgets', out);
END $$;

-- Hold lifecycle driven by the booking itself (covers every booking path)
CREATE OR REPLACE FUNCTION private.corporate_hold_sync() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE amt bigint; dept uuid; h corporate_fund_holds%ROWTYPE;
BEGIN
  IF NEW.booking_context IS DISTINCT FROM 'business' OR NEW.corporate_id IS NULL THEN RETURN NEW; END IF;
  amt := round(coalesce(NEW.total_fare,0)*100)::bigint;
  SELECT department_id INTO dept FROM corporate_employees WHERE id=NEW.corporate_employee_id;
  SELECT * INTO h FROM corporate_fund_holds WHERE booking_id=NEW.id;

  IF NEW.status IN ('cancelled','rejected','declined','expired','failed') THEN
    IF FOUND AND h.status='HELD' THEN
      UPDATE corporate_fund_holds SET status='RELEASED', closed_at=now() WHERE id=h.id;
      INSERT INTO trip_financial_ledger(booking_id, corporate_id, department_id, cost_center_code, event, amount_cents, idempotency_key, metadata)
        VALUES (NEW.id, NEW.corporate_id, h.department_id, h.cost_center_code, 'HOLD_RELEASED', h.amount_cents, NEW.id||':HOLD_RELEASED', jsonb_build_object('status', NEW.status))
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  ELSIF NEW.status <> 'completed' THEN
    IF NOT FOUND THEN
      INSERT INTO corporate_fund_holds(booking_id, corporate_id, department_id, cost_center_code, amount_cents)
        VALUES (NEW.id, NEW.corporate_id, dept, NEW.cost_center_code, amt);
      INSERT INTO trip_financial_ledger(booking_id, corporate_id, department_id, cost_center_code, event, amount_cents, idempotency_key, metadata)
        VALUES (NEW.id, NEW.corporate_id, dept, NEW.cost_center_code, 'HOLD_PLACED', amt, NEW.id||':HOLD_PLACED', jsonb_build_object('booking_number', NEW.booking_number))
        ON CONFLICT (idempotency_key) DO NOTHING;
    ELSIF h.status='HELD' AND h.amount_cents <> amt THEN
      UPDATE corporate_fund_holds SET amount_cents=amt WHERE id=h.id;
      INSERT INTO trip_financial_ledger(booking_id, corporate_id, department_id, cost_center_code, event, amount_cents, idempotency_key, metadata)
        VALUES (NEW.id, NEW.corporate_id, h.department_id, h.cost_center_code, 'HOLD_ADJUSTED', amt, NEW.id||':HOLD_ADJUSTED:'||amt, jsonb_build_object('from_cents', h.amount_cents))
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_trip_bookings_hold_sync AFTER INSERT OR UPDATE OF status, booking_context, corporate_id, total_fare ON public.trip_bookings
  FOR EACH ROW EXECUTE FUNCTION private.corporate_hold_sync();

-- Capture on settlement + commission split, exactly once per booking
CREATE OR REPLACE FUNCTION private.corporate_hold_capture() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE b trip_bookings%ROWTYPE; pct numeric; com bigint; h corporate_fund_holds%ROWTYPE; dept uuid;
BEGIN
  IF NEW.status <> 'SETTLED' THEN RETURN NEW; END IF;
  SELECT * INTO b FROM trip_bookings WHERE id=NEW.booking_id;
  SELECT coalesce(commission_pct,15) INTO pct FROM ride_types WHERE id=b.ride_type_id;
  pct := coalesce(pct,15);
  com := round(NEW.fare_cents * pct / 100.0)::bigint;
  SELECT * INTO h FROM corporate_fund_holds WHERE booking_id=NEW.booking_id;
  dept := coalesce(h.department_id, (SELECT department_id FROM corporate_employees WHERE id=b.corporate_employee_id));
  INSERT INTO trip_financial_ledger(booking_id, corporate_id, department_id, cost_center_code, event, amount_cents, platform_commission_cents, provider_net_cents, commission_pct, idempotency_key, metadata)
    VALUES (NEW.booking_id, NEW.corporate_id, dept, b.cost_center_code, 'FARE_CHARGED', NEW.fare_cents, com, NEW.fare_cents-com, pct, NEW.booking_id||':FARE_CHARGED',
      jsonb_build_object('wallet_cents', NEW.wallet_cents, 'credit_cents', NEW.credit_cents, 'invoice_id', NEW.invoice_id, 'booking_number', b.booking_number))
    ON CONFLICT (idempotency_key) DO NOTHING;
  IF FOUND AND h.status='HELD' THEN
    UPDATE corporate_fund_holds SET status='CAPTURED', captured_cents=NEW.fare_cents, closed_at=now() WHERE id=h.id;
    INSERT INTO trip_financial_ledger(booking_id, corporate_id, department_id, cost_center_code, event, amount_cents, idempotency_key, metadata)
      VALUES (NEW.booking_id, NEW.corporate_id, h.department_id, h.cost_center_code, 'HOLD_CAPTURED', NEW.fare_cents, NEW.booking_id||':HOLD_CAPTURED', jsonb_build_object('held_cents', h.amount_cents))
      ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_settlement_capture AFTER INSERT OR UPDATE OF status ON public.corporate_trip_settlements
  FOR EACH ROW EXECUTE FUNCTION private.corporate_hold_capture();

-- Budget overview for the dashboard
CREATE OR REPLACE FUNCTION private.corporate_budget_overview(_c uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE res jsonb;
BEGIN
  IF NOT (private.is_corporate_member(auth.uid(), _c) OR public.has_role(auth.uid(),'admin')) THEN RAISE EXCEPTION 'FORBIDDEN' USING ERRCODE='42501'; END IF;
  SELECT jsonb_build_object(
    'held_cents', private.corporate_held_cents(_c),
    'budgets', coalesce(jsonb_agg(jsonb_build_object('id', b.id, 'scope', b.scope, 'department_id', b.department_id, 'department', d.name,
       'cost_center_code', b.cost_center_code, 'limit_cents', b.monthly_amount_cents, 'enforcement', b.enforcement, 'warn_at_pct', b.warn_at_pct,
       'active', b.active, 'used_cents', private.corporate_budget_used_cents(b)) ORDER BY b.scope, d.name, b.cost_center_code), '[]'))
  INTO res FROM corporate_budgets b LEFT JOIN corporate_departments d ON d.id=b.department_id WHERE b.corporate_id=_c;
  RETURN res;
END $$;
CREATE OR REPLACE FUNCTION public.corporate_budget_overview(_c uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path TO 'public' AS $$ SELECT private.corporate_budget_overview(_c) $$;
REVOKE ALL ON FUNCTION private.corporate_held_cents(uuid,uuid), private.corporate_budget_used_cents(public.corporate_budgets,uuid), private.corporate_budget_check(uuid,uuid,text,bigint,uuid), private.corporate_hold_sync(), private.corporate_hold_capture(), private.ledger_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.corporate_budget_overview(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.corporate_budget_overview(uuid) TO authenticated;

-- Booking: subtract active holds from capacity, enforce budgets
CREATE OR REPLACE FUNCTION private.trip_confirm_booking_ctx(_quote_id uuid, _context text DEFAULT 'personal'::text, _payment_method text DEFAULT 'mpesa'::text, _corporate_id uuid DEFAULT NULL::uuid, _purpose text DEFAULT NULL::text, _cost_center text DEFAULT NULL::text, _scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE u uuid := auth.uid(); v_id uuid; b trip_bookings%ROWTYPE; e corporate_employees%ROWTYPE;
  v_fare bigint; v_month bigint; v_wallet bigint; v_reason text; v_appr uuid; v_dist numeric; v_ev jsonb; v_bud jsonb;
BEGIN
  IF u IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF _context = 'personal' THEN
    IF _payment_method NOT IN ('mpesa','cash','wallet') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_PAYMENT_METHOD'); END IF;
    v_id := private.trip_confirm_booking(_quote_id, _payment_method, _scheduled_for);
    RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','confirmed','context','personal');
  ELSIF _context <> 'business' THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_CONTEXT');
  END IF;

  SELECT * INTO e FROM corporate_employees WHERE corporate_id=_corporate_id AND user_id=u AND status='active' AND removed_at IS NULL;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_AN_ACTIVE_EMPLOYEE'); END IF;
  IF coalesce((SELECT status::text FROM corporate_accounts WHERE id=_corporate_id),'') <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok',false,'error','COMPANY_NOT_ACTIVE'); END IF;
  IF length(btrim(coalesce(_purpose,''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','PURPOSE_REQUIRED'); END IF;

  v_id := private.trip_confirm_booking(_quote_id, 'wallet', _scheduled_for);
  SELECT * INTO b FROM trip_bookings WHERE id=v_id;
  v_fare := round(b.total_fare*100)::bigint;
  SELECT distance_km INTO v_dist FROM trip_quotes WHERE id=_quote_id;
  SELECT coalesce(sum(round(total_fare*100)),0)::bigint INTO v_month FROM trip_bookings
   WHERE corporate_employee_id=e.id AND created_at >= date_trunc('month',now()) AND status NOT IN ('cancelled','rejected') AND id<>v_id;

  v_ev := private.corporate_policy_evaluate(_corporate_id, e.id, b.ride_type_id, v_fare, v_dist, coalesce(_scheduled_for, now()), v_id);
  IF v_ev->>'decision' <> 'COMPLIANT' THEN
    PERFORM private.corporate_policy_log(_corporate_id, e.id, u, b.ride_type_id, v_fare, v_dist, v_ev, CASE WHEN v_ev->>'decision'='BLOCKED' THEN NULL ELSE v_id END);
  END IF;

  v_wallet := private.corporate_capacity_cents(_corporate_id) - private.corporate_held_cents(_corporate_id, v_id);
  v_bud := private.corporate_budget_check(_corporate_id, e.department_id, _cost_center, v_fare, v_id);
  IF v_ev->>'decision'='BLOCKED' OR v_wallet < v_fare OR v_bud->>'decision'='BLOCK' THEN
    DELETE FROM trip_status_history WHERE trip_booking_id=v_id;
    UPDATE trip_requests SET status='quoting' WHERE id=b.trip_request_id;
    DELETE FROM trip_bookings WHERE id=v_id;
    IF v_ev->>'decision'='BLOCKED' THEN
      RETURN jsonb_build_object('ok',false,'error','POLICY_BLOCKED','policy',v_ev,'fare_cents',v_fare);
    ELSIF v_bud->>'decision'='BLOCK' THEN
      RETURN jsonb_build_object('ok',false,'error','BUDGET_EXCEEDED','budget',v_bud,'fare_cents',v_fare);
    END IF;
    RETURN jsonb_build_object('ok',false,'error','COMPANY_FUNDS_INSUFFICIENT','fare_cents',v_fare,'available_cents',greatest(v_wallet,0));
  END IF;

  v_reason := CASE
    WHEN e.per_trip_cap_cents IS NOT NULL AND v_fare > e.per_trip_cap_cents THEN 'OVER_PER_TRIP_LIMIT'
    WHEN e.monthly_cap_cents IS NOT NULL AND v_month + v_fare > e.monthly_cap_cents THEN 'OVER_MONTHLY_LIMIT'
    WHEN v_bud->>'decision'='APPROVAL' THEN 'OVER_BUDGET'
    WHEN coalesce(e.requires_approval,false) THEN 'APPROVAL_REQUIRED_BY_POLICY'
    WHEN v_ev->>'decision'='EXCEPTION' THEN 'POLICY_EXCEPTION' END;

  UPDATE trip_bookings SET booking_context='business', corporate_id=_corporate_id, corporate_employee_id=e.id,
    payment_method='corporate', intent='corporate', trip_purpose=left(btrim(_purpose),200), cost_center_code=nullif(left(btrim(coalesce(_cost_center,'')),40),'')
   WHERE id=v_id;

  IF v_reason IS NOT NULL THEN
    INSERT INTO corporate_ride_approvals(corporate_id, employee_id, department_id, requested_by, trip_request_id, pickup_address, dropoff_address,
      estimated_fare_cents, scheduled_for, justification, status, booking_id, passenger_count, cost_center_code, purpose, expires_at, metadata)
    VALUES (_corporate_id, e.id, e.department_id, u, b.trip_request_id, b.pickup_address, b.dropoff_address,
      v_fare, _scheduled_for, _purpose, 'pending', v_id, b.passenger_count, _cost_center, _purpose, now()+interval '2 hours',
      jsonb_build_object('reason', v_reason, 'policy', v_ev, 'budget', v_bud)) RETURNING id INTO v_appr;
    UPDATE trip_bookings SET status='awaiting_approval', corporate_approval_id=v_appr WHERE id=v_id;
    INSERT INTO trip_status_history(trip_booking_id, from_status, to_status, changed_by, reason)
      VALUES (v_id, b.status, 'awaiting_approval', u, v_reason);
    RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','awaiting_approval','reason',v_reason,'context','business','policy',v_ev,'budget',v_bud);
  END IF;
  RETURN jsonb_build_object('ok',true,'booking_id',v_id,'state','confirmed','context','business','policy',v_ev,'budget',v_bud);
END $function$;