ALTER TABLE public.corporate_credit_facilities ALTER COLUMN guarantee_id DROP NOT NULL;

CREATE TABLE public.corporate_credit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  requested_limit_cents bigint NOT NULL CHECK (requested_limit_cents > 0),
  credit_period_days integer NOT NULL DEFAULT 3 CHECK (credit_period_days BETWEEN 1 AND 3),
  reason text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','DECLINED','CANCELLED')),
  requested_by uuid,
  approved_limit_cents bigint,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  facility_id uuid REFERENCES public.corporate_credit_facilities(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.corporate_credit_requests TO authenticated;
GRANT ALL ON public.corporate_credit_requests TO service_role;
ALTER TABLE public.corporate_credit_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Company managers and TaxiD admins read credit requests" ON public.corporate_credit_requests
  FOR SELECT TO authenticated
  USING (private.is_corporate_manager_or_admin(auth.uid(), corporate_id)
         OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[]));
CREATE INDEX ON public.corporate_credit_requests(corporate_id, created_at DESC);

CREATE OR REPLACE FUNCTION private.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public
AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TRIGGER corporate_credit_requests_touch BEFORE UPDATE ON public.corporate_credit_requests
  FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();

-- Rate-card quote: one pricing path for quotes and company bookings.
CREATE OR REPLACE FUNCTION private.taxid_quote(_ride_type uuid, _plat numeric, _plng numeric, _dlat numeric, _dlng numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE rt ride_types%ROWTYPE; dist numeric; mins numeric; base numeric; dch numeric; tch numeric; metered numeric;
  ap text; ap_lat numeric; ap_lng numeric; pickup_at_ap boolean := false; o_lat numeric; o_lng numeric;
  grp text; zone text; zone_km numeric; floor_kes numeric; premium numeric := 0; fare numeric; basis text := 'metered';
BEGIN
  SELECT * INTO rt FROM ride_types WHERE id=_ride_type AND is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','VEHICLE_NOT_AVAILABLE'); END IF;
  IF rt.pricing_model = 'daily_charter' THEN RETURN jsonb_build_object('ok',false,'error','DAY_RATE_VEHICLE'); END IF;
  IF _plat IS NULL OR _plng IS NULL OR _dlat IS NULL OR _dlng IS NULL THEN RETURN jsonb_build_object('ok',false,'error','LOCATIONS_REQUIRED'); END IF;
  dist := round(private.geo_km(_plat,_plng,_dlat,_dlng) * 1.3, 2);
  mins := round(dist * 2);
  base := coalesce(rt.base_fare,0); dch := round(coalesce(rt.per_km_rate,0)*dist, 2); tch := round(coalesce(rt.per_minute_rate,0)*mins, 2);
  metered := greatest(coalesce(rt.minimum_fare,0), base + dch + tch);
  fare := metered;

  -- Airport detection (within 3 km of the terminal)
  SELECT a.code, a.lat, a.lng INTO ap, ap_lat, ap_lng FROM (VALUES ('JKIA',-1.3192::numeric,36.9278::numeric),('Wilson',-1.3217,36.8148)) a(code,lat,lng)
   WHERE private.geo_km(_plat,_plng,a.lat,a.lng) <= 3 OR private.geo_km(_dlat,_dlng,a.lat,a.lng) <= 3
   ORDER BY least(private.geo_km(_plat,_plng,a.lat,a.lng), private.geo_km(_dlat,_dlng,a.lat,a.lng)) LIMIT 1;
  IF ap IS NOT NULL THEN
    pickup_at_ap := private.geo_km(_plat,_plng,ap_lat,ap_lng) <= 3;
    IF pickup_at_ap THEN o_lat := _dlat; o_lng := _dlng; ELSE o_lat := _plat; o_lng := _plng; END IF;
    grp := CASE rt.internal_class WHEN 'ECONOMY' THEN 'Mini' WHEN 'COMFORT' THEN 'Mini' WHEN 'SUV' THEN 'SUV'
             WHEN 'SHUTTLE' THEN 'Executive Van' ELSE 'Comfy / Noah' END;
    SELECT z.name, private.geo_km(o_lat,o_lng,z.lat,z.lng) INTO zone, zone_km FROM (VALUES
      ('JKIA','CBD / Upper Hill',-1.2921::numeric,36.8219::numeric),('JKIA','Westlands / Lavington',-1.2676,36.7900),
      ('JKIA','Kilimani',-1.2900,36.7850),('JKIA','Gigiri / Runda',-1.2290,36.8070),('JKIA','Karen / outer zone',-1.3197,36.7076),
      ('Wilson','Westlands',-1.2676,36.8060),('Wilson','Karen',-1.3197,36.7076)) z(airport,name,lat,lng)
     WHERE z.airport = ap AND private.geo_km(o_lat,o_lng,z.lat,z.lng) <= 6
     ORDER BY private.geo_km(o_lat,o_lng,z.lat,z.lng) LIMIT 1;
    IF zone IS NOT NULL THEN
      SELECT amount_kes INTO floor_kes FROM taxid_rate_card WHERE section='airport_zone' AND is_active AND direction=ap AND location=zone AND vehicle_group=grp LIMIT 1;
    END IF;
    IF pickup_at_ap THEN
      SELECT amount_kes INTO premium FROM taxid_rate_card WHERE section='airport_pickup_premium' AND is_active LIMIT 1;
      premium := coalesce(premium,0);
    END IF;
    fare := metered + premium; basis := 'airport_distance';
    IF floor_kes IS NOT NULL AND floor_kes > fare THEN fare := floor_kes; basis := 'airport_zone_floor'; END IF;
  END IF;

  RETURN jsonb_build_object('ok',true,'ride_type_id',rt.id,'ride_type',rt.name,'distance_km',dist,'duration_min',mins,
    'base_kes',base,'distance_kes',dch,'time_kes',tch,'minimum_kes',coalesce(rt.minimum_fare,0),'metered_kes',metered,
    'airport',ap,'pickup_at_airport',pickup_at_ap,'zone',zone,'zone_vehicle_group',grp,'zone_floor_kes',floor_kes,
    'pickup_premium_kes',premium,'basis',basis,'fare_kes',round(fare),'fare_cents',(round(fare)*100)::bigint,
    'commission_pct',coalesce(rt.commission_pct,15));
END $$;
REVOKE ALL ON FUNCTION private.taxid_quote(uuid,numeric,numeric,numeric,numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.taxid_quote(uuid,numeric,numeric,numeric,numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.taxid_quote(_ride_type uuid, _plat numeric, _plng numeric, _dlat numeric, _dlng numeric)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$ SELECT private.taxid_quote(_ride_type,_plat,_plng,_dlat,_dlng) $$;
REVOKE ALL ON FUNCTION public.taxid_quote(uuid,numeric,numeric,numeric,numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.taxid_quote(uuid,numeric,numeric,numeric,numeric) TO authenticated;

-- Company bookings price through the same quote engine.
CREATE OR REPLACE FUNCTION private.corporate_estimate_fare(_ride_type uuid, _plat numeric, _plng numeric, _dlat numeric, _dlng numeric)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE q jsonb;
BEGIN
  q := private.taxid_quote(_ride_type,_plat,_plng,_dlat,_dlng);
  IF NOT coalesce((q->>'ok')::boolean,false) THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('distance_km', (q->>'distance_km')::numeric, 'fare_cents', (q->>'fare_cents')::bigint, 'quote', q);
END $$;

-- Credit requests (company) and decisions (super admin only)
CREATE OR REPLACE FUNCTION private.corporate_credit_request(_corporate_id uuid, _limit_kes numeric, _period_days integer, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE rid uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF NOT private.is_corporate_manager_or_admin(auth.uid(), _corporate_id) THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHORISED'); END IF;
  IF _limit_kes IS NULL OR _limit_kes < 1000 OR _limit_kes > 100000000 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_AMOUNT'); END IF;
  IF _period_days NOT BETWEEN 1 AND 3 THEN RETURN jsonb_build_object('ok',false,'error','CREDIT_PERIOD_1_TO_3_DAYS'); END IF;
  IF EXISTS (SELECT 1 FROM corporate_credit_requests WHERE corporate_id=_corporate_id AND status='PENDING') THEN
    RETURN jsonb_build_object('ok',false,'error','REQUEST_ALREADY_PENDING'); END IF;
  INSERT INTO corporate_credit_requests(corporate_id, requested_limit_cents, credit_period_days, reason, requested_by)
    VALUES (_corporate_id, round(_limit_kes*100)::bigint, _period_days, left(_reason,500), auth.uid()) RETURNING id INTO rid;
  RETURN jsonb_build_object('ok',true,'request_id',rid);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_credit_decide(_request_id uuid, _approve boolean, _limit_kes numeric DEFAULT NULL, _period_days integer DEFAULT NULL, _months integer DEFAULT 12, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r corporate_credit_requests%ROWTYPE; lim bigint; per int; fid uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'SUPER_ADMIN_ONLY' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM corporate_credit_requests WHERE id=_request_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF r.status <> 'PENDING' THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_DECIDED'); END IF;
  IF NOT _approve THEN
    UPDATE corporate_credit_requests SET status='DECLINED', decided_by=auth.uid(), decided_at=now(), decision_note=left(_note,500) WHERE id=r.id;
    RETURN jsonb_build_object('ok',true,'status','DECLINED');
  END IF;
  lim := coalesce(round(_limit_kes*100)::bigint, r.requested_limit_cents);
  per := coalesce(_period_days, r.credit_period_days);
  IF lim <= 0 OR per NOT BETWEEN 1 AND 3 OR coalesce(_months,0) NOT BETWEEN 1 AND 36 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_TERMS'); END IF;
  UPDATE corporate_credit_facilities SET state='CLOSED', updated_at=now() WHERE corporate_id=r.corporate_id AND state='ACTIVE';
  INSERT INTO corporate_credit_facilities(corporate_id, approved_credit_limit_cents, utilized_credit_cents, currency, effective_date, expiry_date,
      state, policy_reference, approved_by, approved_at, activated_by, activated_at)
    VALUES (r.corporate_id, lim, 0, 'KES', current_date, (current_date + make_interval(months => _months))::date,
      'ACTIVE', 'SUPER_ADMIN_APPROVAL:'||r.id, auth.uid(), now(), auth.uid(), now()) RETURNING id INTO fid;
  INSERT INTO corporate_billing_arrangements(corporate_id, mode, credit_period_days, status, notes, approved_by, approved_at)
    VALUES (r.corporate_id, 'HYBRID', per, 'ACTIVE', 'Credit approved by super admin', auth.uid(), now())
    ON CONFLICT (corporate_id) DO UPDATE SET mode='HYBRID', credit_period_days=EXCLUDED.credit_period_days, status='ACTIVE',
      notes=EXCLUDED.notes, approved_by=EXCLUDED.approved_by, approved_at=now();
  UPDATE corporate_credit_requests SET status='APPROVED', approved_limit_cents=lim, credit_period_days=per, facility_id=fid,
    decided_by=auth.uid(), decided_at=now(), decision_note=left(_note,500) WHERE id=r.id;
  RETURN jsonb_build_object('ok',true,'status','APPROVED','facility_id',fid);
END $$;

CREATE OR REPLACE FUNCTION private.corporate_funding_overview(_corporate_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f corporate_credit_facilities%ROWTYPE; a corporate_billing_arrangements%ROWTYPE; held bigint; bal bigint;
BEGIN
  IF auth.uid() IS NULL OR (NOT public.is_corporate_member(auth.uid(), _corporate_id)
     AND NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])) THEN
    RAISE EXCEPTION 'Forbidden' USING ERRCODE='42501'; END IF;
  bal := coalesce((SELECT balance_after_cents FROM corporate_cash_ledger WHERE corporate_id=_corporate_id ORDER BY occurred_at DESC, created_at DESC LIMIT 1),0);
  held := coalesce((SELECT sum(amount_cents) FROM corporate_fund_holds WHERE corporate_id=_corporate_id AND status='HELD'),0);
  SELECT * INTO f FROM corporate_credit_facilities WHERE id=private.corporate_active_facility(_corporate_id);
  SELECT * INTO a FROM corporate_billing_arrangements WHERE corporate_id=_corporate_id;
  RETURN jsonb_build_object('balance_cents',bal,'held_cents',held,
    'credit', CASE WHEN f.id IS NULL THEN NULL ELSE jsonb_build_object('limit_cents',f.approved_credit_limit_cents,'used_cents',coalesce(f.utilized_credit_cents,0),
       'available_cents',greatest(f.approved_credit_limit_cents-coalesce(f.utilized_credit_cents,0),0),'expiry_date',f.expiry_date,'effective_date',f.effective_date) END,
    'arrangement', CASE WHEN a.corporate_id IS NULL THEN NULL ELSE jsonb_build_object('mode',a.mode,'credit_period_days',a.credit_period_days,'status',a.status) END,
    'is_super_admin', public.has_role(auth.uid(),'super_admin'),
    'can_manage', private.is_corporate_manager_or_admin(auth.uid(), _corporate_id));
END $$;

REVOKE ALL ON FUNCTION private.corporate_credit_request(uuid,numeric,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.corporate_credit_decide(uuid,boolean,numeric,integer,integer,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private.corporate_funding_overview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.corporate_credit_request(uuid,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.corporate_credit_decide(uuid,boolean,numeric,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION private.corporate_funding_overview(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.corporate_credit_request(_corporate_id uuid, _limit_kes numeric, _period_days integer, _reason text)
RETURNS jsonb LANGUAGE sql SET search_path = public AS $$ SELECT private.corporate_credit_request(_corporate_id,_limit_kes,_period_days,_reason) $$;
CREATE OR REPLACE FUNCTION public.corporate_credit_decide(_request_id uuid, _approve boolean, _limit_kes numeric DEFAULT NULL, _period_days integer DEFAULT NULL, _months integer DEFAULT 12, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SET search_path = public AS $$ SELECT private.corporate_credit_decide(_request_id,_approve,_limit_kes,_period_days,_months,_note) $$;
CREATE OR REPLACE FUNCTION public.corporate_funding_overview(_corporate_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SET search_path = public AS $$ SELECT private.corporate_funding_overview(_corporate_id) $$;
REVOKE ALL ON FUNCTION public.corporate_credit_request(uuid,numeric,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.corporate_credit_decide(uuid,boolean,numeric,integer,integer,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.corporate_funding_overview(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_credit_request(uuid,numeric,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.corporate_credit_decide(uuid,boolean,numeric,integer,integer,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.corporate_funding_overview(uuid) TO authenticated;