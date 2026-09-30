
ALTER TABLE public.air_pricing_settings
  ADD COLUMN IF NOT EXISTS fuel_surcharge_pct numeric NOT NULL DEFAULT 0.06,
  ADD COLUMN IF NOT EXISTS vat_pct numeric NOT NULL DEFAULT 0.16,
  ADD COLUMN IF NOT EXISTS vat_domestic_only boolean NOT NULL DEFAULT true;

ALTER TABLE public.air_empty_legs DROP CONSTRAINT IF EXISTS air_empty_legs_status_check;
ALTER TABLE public.air_empty_legs ADD CONSTRAINT air_empty_legs_status_check CHECK (status IN ('pending_review','open','held','sold','withdrawn','rejected'));
ALTER TABLE public.air_empty_legs ALTER COLUMN status SET DEFAULT 'pending_review';
ALTER TABLE public.air_empty_legs ADD COLUMN IF NOT EXISTS review_note text, ADD COLUMN IF NOT EXISTS reviewed_at timestamptz, ADD COLUMN IF NOT EXISTS booking_id uuid;

CREATE OR REPLACE FUNCTION public._air_leg_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF public.air_is_admin() IS NOT TRUE AND coalesce(auth.role(),'') <> 'service_role' THEN
    IF TG_OP = 'INSERT' THEN NEW.status := 'pending_review'; NEW.review_note := NULL; NEW.reviewed_at := NULL; NEW.booking_id := NULL;
    ELSE
      NEW.review_note := OLD.review_note; NEW.reviewed_at := OLD.reviewed_at; NEW.booking_id := OLD.booking_id;
      NEW.owner_id := OLD.owner_id; NEW.fleet_id := OLD.fleet_id;
      IF NEW.status <> OLD.status AND NEW.status <> 'withdrawn' THEN NEW.status := OLD.status; END IF;
      IF OLD.status = 'open' AND (NEW.price_kes IS DISTINCT FROM OLD.price_kes OR NEW.depart_date IS DISTINCT FROM OLD.depart_date
         OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.destination IS DISTINCT FROM OLD.destination) THEN NEW.status := 'pending_review'; END IF;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.reviewed_at := now();
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public._air_leg_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS air_leg_guard ON public.air_empty_legs;
CREATE TRIGGER air_leg_guard BEFORE INSERT OR UPDATE ON public.air_empty_legs FOR EACH ROW EXECUTE FUNCTION public._air_leg_guard();

CREATE OR REPLACE FUNCTION public._air_nm(a text, b text) RETURNS numeric LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT (2 * 3440.065 * asin(sqrt(
    power(sin(radians(y.lat - x.lat)/2),2) + cos(radians(x.lat))*cos(radians(y.lat))*power(sin(radians(y.lng - x.lng)/2),2))))::numeric
  FROM air_airfields x, air_airfields y WHERE x.code = a AND y.code = b
$$;
REVOKE ALL ON FUNCTION public._air_nm(text,text) FROM PUBLIC, anon, authenticated;

-- Server-side authoritative quote for one partner aircraft (mirrors src/lib/aircharter/pricing.ts).
CREATE OR REPLACE FUNCTION public._air_quote_fleet(_fleet uuid, _origin text, _dest text, _depart date, _return date, _pax int)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE f air_fleet; c air_aircraft_classes; s air_pricing_settings; o air_airfields; d air_airfields;
  nm numeric; leg numeric; flown numeric; pos numeric := 0; ret numeric := 0; legs int; base numeric; fac numeric := 1;
  mult jsonb := '[]'; fuel numeric; fees numeric; adj numeric; sub numeric; fee numeric; vat numeric := 0; hrs numeric; total numeric; dow int;
BEGIN
  SELECT * INTO f FROM air_fleet WHERE id = _fleet AND status = 'active';
  IF NOT FOUND THEN RAISE EXCEPTION 'Aircraft is not available'; END IF;
  SELECT * INTO c FROM air_aircraft_classes WHERE code = f.class_code;
  SELECT * INTO s FROM air_pricing_settings WHERE id = 1;
  SELECT * INTO o FROM air_airfields WHERE code = _origin; SELECT * INTO d FROM air_airfields WHERE code = _dest;
  IF o.code IS NULL OR d.code IS NULL OR o.code = d.code THEN RAISE EXCEPTION 'Choose two different airports'; END IF;
  IF _pax < 1 OR _pax > f.seats THEN RAISE EXCEPTION 'This aircraft seats up to %', f.seats; END IF;
  IF (o.kind = 'airstrip' OR d.kind = 'airstrip') AND NOT c.bush_strip_ok THEN RAISE EXCEPTION 'This aircraft cannot land on that airstrip'; END IF;
  IF _depart < (now() AT TIME ZONE 'Africa/Nairobi')::date THEN RAISE EXCEPTION 'Departure date is in the past'; END IF;
  IF _return IS NOT NULL AND _return < _depart THEN RAISE EXCEPTION 'Return must be after departure'; END IF;
  nm := _air_nm(_origin,_dest);
  leg := nm / c.cruise_kts + s.taxi_hours;
  legs := CASE WHEN _return IS NULL THEN 1 ELSE 2 END;
  flown := greatest(leg * legs, c.min_block_hours);
  IF f.home_base <> _origin THEN pos := _air_nm(f.home_base,_origin) / c.cruise_kts + s.taxi_hours; END IF;
  IF _return IS NULL THEN ret := leg * s.one_way_return_pct; END IF;
  hrs := flown + pos + ret;
  base := hrs * f.hourly_rate_kes;
  IF coalesce((s.season_multipliers ->> extract(month FROM _depart)::int::text)::numeric,1) <> 1 THEN
    fac := fac * (s.season_multipliers ->> extract(month FROM _depart)::int::text)::numeric;
    mult := mult || jsonb_build_object('label','Season','factor',(s.season_multipliers ->> extract(month FROM _depart)::int::text)::numeric); END IF;
  dow := extract(dow FROM _depart);
  IF dow IN (0,5,6) AND s.weekend_multiplier <> 1 THEN fac := fac * s.weekend_multiplier; mult := mult || jsonb_build_object('label','Weekend','factor',s.weekend_multiplier); END IF;
  IF (_depart::timestamp + interval '9 hours') - (now() AT TIME ZONE 'Africa/Nairobi') < make_interval(hours => s.urgent_hours) THEN
    fac := fac * s.urgent_multiplier; mult := mult || jsonb_build_object('label','Short notice','factor',s.urgent_multiplier);
  ELSIF _depart - (now() AT TIME ZONE 'Africa/Nairobi')::date > s.early_days THEN
    fac := fac * s.early_multiplier; mult := mult || jsonb_build_object('label','Early booking','factor',s.early_multiplier); END IF;
  adj := base * (fac - 1);
  fuel := (base + adj) * s.fuel_surcharge_pct;
  fees := (o.landing_fee_kes + d.landing_fee_kes) * legs;
  sub := base + adj + fuel + fees;
  fee := sub * s.yalla_fee_pct;
  IF NOT s.vat_domestic_only OR (o.country = 'Kenya' AND d.country = 'Kenya') THEN vat := (sub + fee) * s.vat_pct; END IF;
  total := round((sub + fee + vat) / 100) * 100;
  RETURN jsonb_build_object('total_kes', total, 'distance_nm', round(nm), 'billable_hours', round(hrs,2),
    'lines', jsonb_build_array(
      jsonb_build_object('label','Flying cost','amount_kes',round(base)),
      jsonb_build_object('label','Demand & timing adjustment','amount_kes',round(adj)),
      jsonb_build_object('label','Fuel surcharge','amount_kes',round(fuel)),
      jsonb_build_object('label','Landing & handling fees','amount_kes',round(fees)),
      jsonb_build_object('label','Yalla service fee','amount_kes',round(fee)),
      jsonb_build_object('label','VAT','amount_kes',round(vat))),
    'multipliers', mult);
END $$;
REVOKE ALL ON FUNCTION public._air_quote_fleet(uuid,text,text,date,date,int) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.air_book(_fleet uuid, _leg uuid, _origin text, _dest text, _depart date, _return date, _pax int, _contact jsonb, _notes text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE uid uuid := auth.uid(); q jsonb; l air_empty_legs; f air_fleet; ref text; bid uuid; amt numeric;
BEGIN
  IF uid IS NULL THEN RAISE EXCEPTION 'Sign in to book'; END IF;
  IF coalesce(length(_contact->>'name'),0) < 2 OR coalesce(length(_contact->>'phone'),0) < 7 THEN RAISE EXCEPTION 'Name and phone are required'; END IF;
  IF _leg IS NOT NULL THEN
    SELECT * INTO l FROM air_empty_legs WHERE id = _leg AND status = 'open' AND depart_date >= current_date FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'This empty leg is no longer available'; END IF;
    IF _pax < 1 OR _pax > l.seats THEN RAISE EXCEPTION 'This empty leg has % seats', l.seats; END IF;
    SELECT * INTO f FROM air_fleet WHERE id = l.fleet_id AND status = 'active';
    IF NOT FOUND THEN RAISE EXCEPTION 'Aircraft is not available'; END IF;
    amt := l.price_kes;
    q := jsonb_build_object('total_kes', amt, 'lines', jsonb_build_array(jsonb_build_object('label','Empty-leg price (all-in)','amount_kes',amt)));
    _origin := l.origin; _dest := l.destination; _depart := l.depart_date; _return := NULL;
  ELSE
    q := _air_quote_fleet(_fleet, _origin, _dest, _depart, _return, _pax);
    SELECT * INTO f FROM air_fleet WHERE id = _fleet;
    amt := (q->>'total_kes')::numeric;
  END IF;
  ref := 'CH-' || upper(substr(md5(gen_random_uuid()::text),1,10));
  INSERT INTO charter_bookings(reference,user_id,category_slug,asset_name,passengers,contact,trip,amount,currency,payment_method,payment_status,status)
  VALUES (ref, uid, 'aircraft-charter', f.model || ' ' || f.registration || ' · ' || f.operator_name,
    jsonb_build_array(jsonb_build_object('count',_pax)), _contact,
    jsonb_build_object('kind', CASE WHEN _leg IS NULL THEN 'air_charter' ELSE 'air_empty_leg' END, 'fleet_id', f.id, 'empty_leg_id', _leg,
      'origin', _origin, 'destination', _dest, 'depart_date', _depart, 'return_date', _return, 'passengers', _pax,
      'notes', left(coalesce(_notes,''),1000), 'quote', q),
    amt, 'KES', 'mpesa', 'pending', 'pending_payment')
  RETURNING id INTO bid;
  IF _leg IS NOT NULL THEN UPDATE air_empty_legs SET status = 'held', booking_id = bid WHERE id = _leg; END IF;
  RETURN jsonb_build_object('booking_id', bid, 'reference', ref, 'amount_kes', amt, 'quote', q);
END $$;
REVOKE ALL ON FUNCTION public.air_book(uuid,uuid,text,text,date,date,int,jsonb,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.air_book(uuid,uuid,text,text,date,date,int,jsonb,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.air_pricing_public() RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT jsonb_build_object('id',id,'fx_kes_per_usd',fx_kes_per_usd,'season_multipliers',season_multipliers,
    'weekend_multiplier',weekend_multiplier,'urgent_hours',urgent_hours,'urgent_multiplier',urgent_multiplier,
    'early_days',early_days,'early_multiplier',early_multiplier,'one_way_return_pct',one_way_return_pct,
    'taxi_hours',taxi_hours,'yalla_fee_pct',yalla_fee_pct,'fuel_surcharge_pct',fuel_surcharge_pct,'vat_pct',vat_pct,'vat_domestic_only',vat_domestic_only)
  FROM public.air_pricing_settings WHERE id = 1
$$;
