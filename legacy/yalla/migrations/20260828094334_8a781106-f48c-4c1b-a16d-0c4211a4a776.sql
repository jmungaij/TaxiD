-- ============ PHASE 2: ROUTE / ROUTE VERSION / STOP EXECUTION AGGREGATE ============

CREATE TABLE public.logistics_routes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_number text NOT NULL UNIQUE,
  organization_id uuid NULL,
  route_type text NOT NULL DEFAULT 'delivery'
    CHECK (route_type IN ('delivery','pickup','mixed','linehaul','returns','shuttle')),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PLANNED','ASSIGNED','READY','IN_PROGRESS','PAUSED','COMPLETED','FAILED','CANCELLED')),
  planned_start timestamptz,
  planned_end timestamptz,
  actual_start timestamptz,
  actual_end timestamptz,
  driver_user_id uuid,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  origin_hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE SET NULL,
  destination_hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE SET NULL,
  origin_label text,
  origin_lat numeric,
  origin_lng numeric,
  destination_label text,
  destination_lat numeric,
  destination_lng numeric,
  planned_distance_km numeric CHECK (planned_distance_km IS NULL OR planned_distance_km >= 0),
  actual_distance_km numeric CHECK (actual_distance_km IS NULL OR actual_distance_km >= 0),
  estimated_duration_min integer CHECK (estimated_duration_min IS NULL OR estimated_duration_min >= 0),
  actual_duration_min integer CHECK (actual_duration_min IS NULL OR actual_duration_min >= 0),
  service_window_start timestamptz,
  service_window_end timestamptz,
  required_capacity_kg numeric CHECK (required_capacity_kg IS NULL OR required_capacity_kg >= 0),
  required_vehicle_type text,
  optimization_status text NOT NULL DEFAULT 'not_optimized'
    CHECK (optimization_status IN ('not_optimized','pending','optimized','failed','manual')),
  current_version integer NOT NULL DEFAULT 1,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_logistics_routes_status ON public.logistics_routes(status);
CREATE INDEX idx_logistics_routes_driver ON public.logistics_routes(driver_user_id);
CREATE INDEX idx_logistics_routes_planned_start ON public.logistics_routes(planned_start);

CREATE TABLE public.logistics_route_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  parent_version_id uuid REFERENCES public.logistics_route_versions(id) ON DELETE SET NULL,
  change_reason text,
  optimization_source text NOT NULL DEFAULT 'manual',
  manual_override boolean NOT NULL DEFAULT true,
  plan_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz,
  UNIQUE (route_id, version_number)
);
CREATE INDEX idx_logistics_route_versions_route ON public.logistics_route_versions(route_id);

CREATE TABLE public.logistics_route_stops (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  route_version_id uuid NOT NULL REFERENCES public.logistics_route_versions(id) ON DELETE CASCADE,
  sequence integer NOT NULL CHECK (sequence > 0),
  stop_type text NOT NULL CHECK (stop_type IN ('pickup','delivery','return','hub','waypoint')),
  hub_id uuid REFERENCES public.logistics_hubs(id) ON DELETE SET NULL,
  address text,
  lat numeric,
  lng numeric,
  contact_name text,
  contact_phone text,
  instructions text,
  service_window_start timestamptz,
  service_window_end timestamptz,
  planned_arrival timestamptz,
  eta timestamptz,
  eta_source text CHECK (eta_source IS NULL OR eta_source IN ('planned','optimizer','dispatch','telemetry','manual')),
  eta_revised_at timestamptz,
  actual_arrival timestamptz,
  departed_at timestamptz,
  status text NOT NULL DEFAULT 'PLANNED'
    CHECK (status IN ('PLANNED','ASSIGNED','EN_ROUTE','ARRIVED','SERVICE_STARTED','COMPLETED','FAILED','SKIPPED','CANCELLED')),
  exception_id uuid REFERENCES public.logistics_exceptions(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_version_id, sequence) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX idx_logistics_route_stops_route ON public.logistics_route_stops(route_id);
CREATE INDEX idx_logistics_route_stops_version ON public.logistics_route_stops(route_version_id);
CREATE INDEX idx_logistics_route_stops_status ON public.logistics_route_stops(status);

CREATE TABLE public.logistics_stop_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stop_id uuid NOT NULL REFERENCES public.logistics_route_stops(id) ON DELETE CASCADE,
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  route_version_id uuid NOT NULL REFERENCES public.logistics_route_versions(id) ON DELETE CASCADE,
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('pickup','delivery','return')),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_version_id, package_id, role)
);
CREATE INDEX idx_logistics_stop_packages_stop ON public.logistics_stop_packages(stop_id);
CREATE INDEX idx_logistics_stop_packages_package ON public.logistics_stop_packages(package_id);

CREATE TABLE public.logistics_route_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES public.logistics_route_stops(id) ON DELETE SET NULL,
  route_version_id uuid REFERENCES public.logistics_route_versions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  reason text,
  actor_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_logistics_route_events_route ON public.logistics_route_events(route_id, created_at DESC);

CREATE TABLE public.logistics_route_dispatch_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES public.logistics_route_stops(id) ON DELETE SET NULL,
  dispatch_job_id uuid NOT NULL REFERENCES public.delivery_dispatch_jobs(id) ON DELETE CASCADE,
  linked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (route_id, dispatch_job_id)
);

CREATE TABLE public.logistics_route_deviations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  stop_id uuid REFERENCES public.logistics_route_stops(id) ON DELETE SET NULL,
  kind text NOT NULL CHECK (kind IN ('route_deviation','missed_stop','unexpected_stop','sequence_violation','route_abandonment')),
  severity text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  distance_m numeric,
  narrative text,
  exception_id uuid REFERENCES public.logistics_exceptions(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved','dismissed')),
  detected_at timestamptz NOT NULL DEFAULT now(),
  detected_by uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_logistics_route_deviations_route ON public.logistics_route_deviations(route_id);

CREATE TABLE public.logistics_route_optimization_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route_id uuid NOT NULL REFERENCES public.logistics_routes(id) ON DELETE CASCADE,
  route_version_id uuid REFERENCES public.logistics_route_versions(id) ON DELETE SET NULL,
  result_version_id uuid REFERENCES public.logistics_route_versions(id) ON DELETE SET NULL,
  provider_key text NOT NULL DEFAULT 'manual',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','succeeded','failed','skipped')),
  request jsonb NOT NULL DEFAULT '{}'::jsonb,
  response jsonb,
  error text,
  requested_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE public.logistics_route_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  base_url text,
  credential_secret_name text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  health_status text NOT NULL DEFAULT 'unknown' CHECK (health_status IN ('unknown','healthy','degraded','unreachable','unconfigured')),
  health_detail text,
  last_checked_at timestamptz,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- telemetry linkage (existing GPS trace layer stays authoritative for traces)
ALTER TABLE public.delivery_route_segments
  ADD COLUMN IF NOT EXISTS route_id uuid REFERENCES public.logistics_routes(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS route_version_id uuid REFERENCES public.logistics_route_versions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS stop_id uuid REFERENCES public.logistics_route_stops(id) ON DELETE SET NULL;

-- ============ GRANTS ============
GRANT SELECT ON public.logistics_routes, public.logistics_route_versions, public.logistics_route_stops,
  public.logistics_stop_packages, public.logistics_route_events, public.logistics_route_dispatch_links,
  public.logistics_route_deviations, public.logistics_route_optimization_runs, public.logistics_route_providers
  TO authenticated;
GRANT ALL ON public.logistics_routes, public.logistics_route_versions, public.logistics_route_stops,
  public.logistics_stop_packages, public.logistics_route_events, public.logistics_route_dispatch_links,
  public.logistics_route_deviations, public.logistics_route_optimization_runs, public.logistics_route_providers
  TO service_role;

ALTER TABLE public.logistics_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_stops ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_stop_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_dispatch_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_deviations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_optimization_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_route_providers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "routes_staff_read" ON public.logistics_routes FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read') OR driver_user_id = auth.uid());
CREATE POLICY "routes_staff_write" ON public.logistics_routes FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE POLICY "route_versions_read" ON public.logistics_route_versions FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
    OR EXISTS (SELECT 1 FROM public.logistics_routes r WHERE r.id = route_id AND r.driver_user_id = auth.uid()));
CREATE POLICY "route_versions_write" ON public.logistics_route_versions FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE POLICY "route_stops_read" ON public.logistics_route_stops FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
    OR EXISTS (SELECT 1 FROM public.logistics_routes r WHERE r.id = route_id AND r.driver_user_id = auth.uid()));
CREATE POLICY "route_stops_write" ON public.logistics_route_stops FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE POLICY "stop_packages_read" ON public.logistics_stop_packages FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read')
    OR EXISTS (SELECT 1 FROM public.logistics_routes r WHERE r.id = route_id AND r.driver_user_id = auth.uid()));
CREATE POLICY "stop_packages_write" ON public.logistics_stop_packages FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

CREATE POLICY "route_events_read" ON public.logistics_route_events FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY "route_dispatch_links_read" ON public.logistics_route_dispatch_links FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY "route_dispatch_links_write" ON public.logistics_route_dispatch_links FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));
CREATE POLICY "route_deviations_read" ON public.logistics_route_deviations FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY "route_deviations_write" ON public.logistics_route_deviations FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));
CREATE POLICY "route_optimization_read" ON public.logistics_route_optimization_runs FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY "route_providers_read" ON public.logistics_route_providers FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.logistics.read'));
CREATE POLICY "route_providers_write" ON public.logistics_route_providers FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.logistics.manage'))
  WITH CHECK (public.has_staff_permission('staff.logistics.manage'));

-- ============ TRIGGERS ============
CREATE OR REPLACE FUNCTION public._logistics_route_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER trg_logistics_routes_touch BEFORE UPDATE ON public.logistics_routes
  FOR EACH ROW EXECUTE FUNCTION public._logistics_route_touch();
CREATE TRIGGER trg_logistics_route_stops_touch BEFORE UPDATE ON public.logistics_route_stops
  FOR EACH ROW EXECUTE FUNCTION public._logistics_route_touch();
CREATE TRIGGER trg_logistics_route_providers_touch BEFORE UPDATE ON public.logistics_route_providers
  FOR EACH ROW EXECUTE FUNCTION public._logistics_route_touch();

CREATE OR REPLACE FUNCTION public._logistics_route_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'logistics_route_events is append-only'; END; $$;
CREATE TRIGGER trg_route_events_immutable BEFORE UPDATE OR DELETE ON public.logistics_route_events
  FOR EACH ROW EXECUTE FUNCTION public._logistics_route_events_append_only();

-- version immutability: only superseded_at may change
CREATE OR REPLACE FUNCTION public._logistics_route_version_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'route versions cannot be deleted'; END IF;
  IF NEW.route_id IS DISTINCT FROM OLD.route_id
     OR NEW.version_number IS DISTINCT FROM OLD.version_number
     OR NEW.plan_snapshot IS DISTINCT FROM OLD.plan_snapshot
     OR NEW.parent_version_id IS DISTINCT FROM OLD.parent_version_id THEN
    RAISE EXCEPTION 'route versions are immutable';
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER trg_route_versions_immutable BEFORE UPDATE OR DELETE ON public.logistics_route_versions
  FOR EACH ROW EXECUTE FUNCTION public._logistics_route_version_immutable();

-- ============ CORE HELPERS ============
CREATE OR REPLACE FUNCTION public.logistics_route_authorised(_action text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN _action = 'read'
    THEN public.has_staff_permission('staff.logistics.read') OR public.has_staff_permission('staff.logistics.manage')
    ELSE public.has_staff_permission('staff.logistics.manage') END;
$$;

CREATE OR REPLACE FUNCTION public.logistics_route_log_event(
  _route_id uuid, _stop_id uuid, _version_id uuid, _event_type text,
  _from text, _to text, _reason text, _metadata jsonb DEFAULT '{}'::jsonb)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.logistics_route_events(route_id, stop_id, route_version_id, event_type, from_status, to_status, reason, actor_id, metadata)
  VALUES (_route_id, _stop_id, _version_id, _event_type, _from, _to, _reason, auth.uid(), COALESCE(_metadata,'{}'::jsonb))
  RETURNING id;
$$;

-- ============ ROUTE CREATION / VERSIONING ============
CREATE OR REPLACE FUNCTION public.logistics_route_upsert(
  _route_id uuid,
  _payload jsonb,
  _reason text DEFAULT NULL)
RETURNS public.logistics_routes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_route public.logistics_routes; v_version uuid; v_num text;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE = '42501';
  END IF;

  IF _route_id IS NULL THEN
    v_num := COALESCE(NULLIF(_payload->>'route_number',''),
      'RTE-' || to_char(now() AT TIME ZONE 'Africa/Nairobi','YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,5)));
    INSERT INTO public.logistics_routes(
      route_number, organization_id, route_type, planned_start, planned_end,
      origin_hub_id, destination_hub_id, origin_label, origin_lat, origin_lng,
      destination_label, destination_lat, destination_lng,
      service_window_start, service_window_end, required_capacity_kg, required_vehicle_type,
      planned_distance_km, estimated_duration_min, notes, created_by, updated_by)
    VALUES (
      v_num, NULLIF(_payload->>'organization_id','')::uuid, COALESCE(NULLIF(_payload->>'route_type',''),'delivery'),
      NULLIF(_payload->>'planned_start','')::timestamptz, NULLIF(_payload->>'planned_end','')::timestamptz,
      NULLIF(_payload->>'origin_hub_id','')::uuid, NULLIF(_payload->>'destination_hub_id','')::uuid,
      NULLIF(_payload->>'origin_label',''), NULLIF(_payload->>'origin_lat','')::numeric, NULLIF(_payload->>'origin_lng','')::numeric,
      NULLIF(_payload->>'destination_label',''), NULLIF(_payload->>'destination_lat','')::numeric, NULLIF(_payload->>'destination_lng','')::numeric,
      NULLIF(_payload->>'service_window_start','')::timestamptz, NULLIF(_payload->>'service_window_end','')::timestamptz,
      NULLIF(_payload->>'required_capacity_kg','')::numeric, NULLIF(_payload->>'required_vehicle_type',''),
      NULLIF(_payload->>'planned_distance_km','')::numeric, NULLIF(_payload->>'estimated_duration_min','')::integer,
      NULLIF(_payload->>'notes',''), auth.uid(), auth.uid())
    RETURNING * INTO v_route;

    INSERT INTO public.logistics_route_versions(route_id, version_number, change_reason, optimization_source, manual_override, created_by, plan_snapshot)
    VALUES (v_route.id, 1, COALESCE(_reason,'initial plan'), 'manual', true, auth.uid(), jsonb_build_object('stops', '[]'::jsonb))
    RETURNING id INTO v_version;

    PERFORM public.logistics_route_log_event(v_route.id, NULL, v_version, 'route_created', NULL, v_route.status, _reason, _payload);
    RETURN v_route;
  END IF;

  UPDATE public.logistics_routes SET
    route_type = COALESCE(NULLIF(_payload->>'route_type',''), route_type),
    organization_id = COALESCE(NULLIF(_payload->>'organization_id','')::uuid, organization_id),
    planned_start = COALESCE(NULLIF(_payload->>'planned_start','')::timestamptz, planned_start),
    planned_end = COALESCE(NULLIF(_payload->>'planned_end','')::timestamptz, planned_end),
    origin_hub_id = COALESCE(NULLIF(_payload->>'origin_hub_id','')::uuid, origin_hub_id),
    destination_hub_id = COALESCE(NULLIF(_payload->>'destination_hub_id','')::uuid, destination_hub_id),
    origin_label = COALESCE(NULLIF(_payload->>'origin_label',''), origin_label),
    destination_label = COALESCE(NULLIF(_payload->>'destination_label',''), destination_label),
    origin_lat = COALESCE(NULLIF(_payload->>'origin_lat','')::numeric, origin_lat),
    origin_lng = COALESCE(NULLIF(_payload->>'origin_lng','')::numeric, origin_lng),
    destination_lat = COALESCE(NULLIF(_payload->>'destination_lat','')::numeric, destination_lat),
    destination_lng = COALESCE(NULLIF(_payload->>'destination_lng','')::numeric, destination_lng),
    service_window_start = COALESCE(NULLIF(_payload->>'service_window_start','')::timestamptz, service_window_start),
    service_window_end = COALESCE(NULLIF(_payload->>'service_window_end','')::timestamptz, service_window_end),
    required_capacity_kg = COALESCE(NULLIF(_payload->>'required_capacity_kg','')::numeric, required_capacity_kg),
    required_vehicle_type = COALESCE(NULLIF(_payload->>'required_vehicle_type',''), required_vehicle_type),
    planned_distance_km = COALESCE(NULLIF(_payload->>'planned_distance_km','')::numeric, planned_distance_km),
    estimated_duration_min = COALESCE(NULLIF(_payload->>'estimated_duration_min','')::integer, estimated_duration_min),
    notes = COALESCE(NULLIF(_payload->>'notes',''), notes),
    updated_by = auth.uid()
  WHERE id = _route_id
  RETURNING * INTO v_route;

  IF v_route.id IS NULL THEN RAISE EXCEPTION 'route not found' USING ERRCODE = 'P0002'; END IF;
  PERFORM public.logistics_route_log_event(v_route.id, NULL, NULL, 'route_updated', NULL, v_route.status, _reason, _payload);
  RETURN v_route;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_new_version(
  _route_id uuid, _reason text, _optimization_source text DEFAULT 'manual', _manual_override boolean DEFAULT true)
RETURNS public.logistics_route_versions
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_current public.logistics_route_versions; v_new public.logistics_route_versions; v_route public.logistics_routes;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_route FROM public.logistics_routes WHERE id = _route_id FOR UPDATE;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'route not found' USING ERRCODE = 'P0002'; END IF;
  IF v_route.status IN ('COMPLETED','CANCELLED','FAILED') THEN
    RAISE EXCEPTION 'route is closed; new versions are not permitted' USING ERRCODE = '23514';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'a change reason is required' USING ERRCODE = '23514';
  END IF;

  SELECT * INTO v_current FROM public.logistics_route_versions
   WHERE route_id = _route_id ORDER BY version_number DESC LIMIT 1;

  INSERT INTO public.logistics_route_versions(route_id, version_number, parent_version_id, change_reason, optimization_source, manual_override, created_by, plan_snapshot)
  VALUES (_route_id, COALESCE(v_current.version_number,0) + 1, v_current.id, _reason, COALESCE(_optimization_source,'manual'), _manual_override, auth.uid(),
    COALESCE((SELECT jsonb_build_object('stops', jsonb_agg(to_jsonb(s) ORDER BY s.sequence))
              FROM public.logistics_route_stops s WHERE s.route_version_id = v_current.id), jsonb_build_object('stops','[]'::jsonb)))
  RETURNING * INTO v_new;

  -- copy stops forward (open work only keeps its live state)
  INSERT INTO public.logistics_route_stops(
    route_id, route_version_id, sequence, stop_type, hub_id, address, lat, lng, contact_name, contact_phone,
    instructions, service_window_start, service_window_end, planned_arrival, eta, eta_source, eta_revised_at,
    actual_arrival, departed_at, status, exception_id, metadata, created_by)
  SELECT route_id, v_new.id, sequence, stop_type, hub_id, address, lat, lng, contact_name, contact_phone,
    instructions, service_window_start, service_window_end, planned_arrival, eta, eta_source, eta_revised_at,
    actual_arrival, departed_at, status, exception_id, metadata, auth.uid()
  FROM public.logistics_route_stops WHERE route_version_id = v_current.id;

  INSERT INTO public.logistics_stop_packages(stop_id, route_id, route_version_id, package_id, role, created_by)
  SELECT ns.id, sp.route_id, v_new.id, sp.package_id, sp.role, auth.uid()
  FROM public.logistics_stop_packages sp
  JOIN public.logistics_route_stops os ON os.id = sp.stop_id
  JOIN public.logistics_route_stops ns ON ns.route_version_id = v_new.id AND ns.sequence = os.sequence
  WHERE sp.route_version_id = v_current.id;

  UPDATE public.logistics_route_versions SET superseded_at = now() WHERE id = v_current.id;
  UPDATE public.logistics_routes SET current_version = v_new.version_number, updated_by = auth.uid() WHERE id = _route_id;
  PERFORM public.logistics_route_log_event(_route_id, NULL, v_new.id, 'route_version_created', NULL, NULL, _reason,
    jsonb_build_object('version', v_new.version_number, 'source', _optimization_source));
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_current_version(_route_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.logistics_route_versions WHERE route_id = _route_id ORDER BY version_number DESC LIMIT 1;
$$;

-- ============ STOPS ============
CREATE OR REPLACE FUNCTION public.logistics_stop_upsert(_stop_id uuid, _route_id uuid, _payload jsonb)
RETURNS public.logistics_route_stops
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stop public.logistics_route_stops; v_version uuid; v_seq integer;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE = '42501';
  END IF;

  IF _stop_id IS NOT NULL THEN
    UPDATE public.logistics_route_stops SET
      stop_type = COALESCE(NULLIF(_payload->>'stop_type',''), stop_type),
      hub_id = COALESCE(NULLIF(_payload->>'hub_id','')::uuid, hub_id),
      address = COALESCE(NULLIF(_payload->>'address',''), address),
      lat = COALESCE(NULLIF(_payload->>'lat','')::numeric, lat),
      lng = COALESCE(NULLIF(_payload->>'lng','')::numeric, lng),
      contact_name = COALESCE(NULLIF(_payload->>'contact_name',''), contact_name),
      contact_phone = COALESCE(NULLIF(_payload->>'contact_phone',''), contact_phone),
      instructions = COALESCE(NULLIF(_payload->>'instructions',''), instructions),
      service_window_start = COALESCE(NULLIF(_payload->>'service_window_start','')::timestamptz, service_window_start),
      service_window_end = COALESCE(NULLIF(_payload->>'service_window_end','')::timestamptz, service_window_end),
      planned_arrival = COALESCE(NULLIF(_payload->>'planned_arrival','')::timestamptz, planned_arrival),
      eta = COALESCE(NULLIF(_payload->>'eta','')::timestamptz, eta),
      eta_source = COALESCE(NULLIF(_payload->>'eta_source',''), eta_source),
      eta_revised_at = CASE WHEN NULLIF(_payload->>'eta','') IS NOT NULL THEN now() ELSE eta_revised_at END
    WHERE id = _stop_id RETURNING * INTO v_stop;
    IF v_stop.id IS NULL THEN RAISE EXCEPTION 'stop not found' USING ERRCODE='P0002'; END IF;
    PERFORM public.logistics_route_log_event(v_stop.route_id, v_stop.id, v_stop.route_version_id, 'stop_updated', NULL, v_stop.status, NULLIF(_payload->>'reason',''), _payload);
    RETURN v_stop;
  END IF;

  v_version := public.logistics_route_current_version(_route_id);
  IF v_version IS NULL THEN RAISE EXCEPTION 'route has no version' USING ERRCODE='P0002'; END IF;
  SELECT COALESCE(MAX(sequence),0) + 1 INTO v_seq FROM public.logistics_route_stops WHERE route_version_id = v_version;

  INSERT INTO public.logistics_route_stops(
    route_id, route_version_id, sequence, stop_type, hub_id, address, lat, lng, contact_name, contact_phone,
    instructions, service_window_start, service_window_end, planned_arrival, eta, eta_source, created_by)
  VALUES (_route_id, v_version, COALESCE(NULLIF(_payload->>'sequence','')::integer, v_seq),
    COALESCE(NULLIF(_payload->>'stop_type',''),'delivery'), NULLIF(_payload->>'hub_id','')::uuid,
    NULLIF(_payload->>'address',''), NULLIF(_payload->>'lat','')::numeric, NULLIF(_payload->>'lng','')::numeric,
    NULLIF(_payload->>'contact_name',''), NULLIF(_payload->>'contact_phone',''), NULLIF(_payload->>'instructions',''),
    NULLIF(_payload->>'service_window_start','')::timestamptz, NULLIF(_payload->>'service_window_end','')::timestamptz,
    NULLIF(_payload->>'planned_arrival','')::timestamptz, NULLIF(_payload->>'eta','')::timestamptz,
    NULLIF(_payload->>'eta_source',''), auth.uid())
  RETURNING * INTO v_stop;

  PERFORM public.logistics_route_log_event(_route_id, v_stop.id, v_version, 'stop_added', NULL, v_stop.status, NULLIF(_payload->>'reason',''), _payload);
  RETURN v_stop;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_stop_remove(_stop_id uuid, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stop public.logistics_route_stops;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'a removal reason is required' USING ERRCODE='23514'; END IF;
  SELECT * INTO v_stop FROM public.logistics_route_stops WHERE id = _stop_id FOR UPDATE;
  IF v_stop.id IS NULL THEN RAISE EXCEPTION 'stop not found' USING ERRCODE='P0002'; END IF;
  IF v_stop.status IN ('COMPLETED','SERVICE_STARTED','ARRIVED') THEN
    RAISE EXCEPTION 'stop already in execution and cannot be removed' USING ERRCODE='23514'; END IF;
  DELETE FROM public.logistics_route_stops WHERE id = _stop_id;
  PERFORM public.logistics_route_log_event(v_stop.route_id, NULL, v_stop.route_version_id, 'stop_removed', v_stop.status, NULL, _reason, to_jsonb(v_stop));
  RETURN true;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_reorder_stops(_route_id uuid, _stop_ids uuid[], _reason text)
RETURNS SETOF public.logistics_route_stops
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_version uuid; v_count integer; i integer;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 3 THEN
    RAISE EXCEPTION 'a reorder reason is required' USING ERRCODE='23514'; END IF;
  v_version := public.logistics_route_current_version(_route_id);
  SELECT count(*) INTO v_count FROM public.logistics_route_stops WHERE route_version_id = v_version;
  IF v_count <> array_length(_stop_ids,1) THEN
    RAISE EXCEPTION 'reorder must include every stop on the current version' USING ERRCODE='23514'; END IF;

  FOR i IN 1..array_length(_stop_ids,1) LOOP
    UPDATE public.logistics_route_stops SET sequence = i
     WHERE id = _stop_ids[i] AND route_version_id = v_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'stop % does not belong to this route version', _stop_ids[i] USING ERRCODE='23514'; END IF;
  END LOOP;

  PERFORM public.logistics_route_log_event(_route_id, NULL, v_version, 'stops_reordered', NULL, NULL, _reason, jsonb_build_object('order', to_jsonb(_stop_ids)));
  RETURN QUERY SELECT * FROM public.logistics_route_stops WHERE route_version_id = v_version ORDER BY sequence;
END; $$;

-- ============ PACKAGE ASSOCIATION ============
CREATE OR REPLACE FUNCTION public.logistics_stop_attach_package(_stop_id uuid, _package_id uuid, _role text)
RETURNS public.logistics_stop_packages
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stop public.logistics_route_stops; v_link public.logistics_stop_packages; v_pickup_seq integer;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_stop FROM public.logistics_route_stops WHERE id = _stop_id;
  IF v_stop.id IS NULL THEN RAISE EXCEPTION 'stop not found' USING ERRCODE='P0002'; END IF;
  IF _role NOT IN ('pickup','delivery','return') THEN
    RAISE EXCEPTION 'invalid package role' USING ERRCODE='23514'; END IF;
  IF _role = 'pickup' AND v_stop.stop_type NOT IN ('pickup','hub','waypoint') THEN
    RAISE EXCEPTION 'pickup packages must attach to a pickup or hub stop' USING ERRCODE='23514'; END IF;
  IF _role = 'delivery' AND v_stop.stop_type NOT IN ('delivery','hub') THEN
    RAISE EXCEPTION 'delivery packages must attach to a delivery or hub stop' USING ERRCODE='23514'; END IF;
  IF _role = 'return' AND v_stop.stop_type NOT IN ('return','hub') THEN
    RAISE EXCEPTION 'return packages must attach to a return or hub stop' USING ERRCODE='23514'; END IF;

  IF _role = 'delivery' THEN
    SELECT s.sequence INTO v_pickup_seq
      FROM public.logistics_stop_packages sp JOIN public.logistics_route_stops s ON s.id = sp.stop_id
     WHERE sp.route_version_id = v_stop.route_version_id AND sp.package_id = _package_id AND sp.role = 'pickup';
    IF v_pickup_seq IS NOT NULL AND v_pickup_seq >= v_stop.sequence THEN
      RAISE EXCEPTION 'delivery stop must come after the pickup stop for this package' USING ERRCODE='23514';
    END IF;
  END IF;

  INSERT INTO public.logistics_stop_packages(stop_id, route_id, route_version_id, package_id, role, created_by)
  VALUES (_stop_id, v_stop.route_id, v_stop.route_version_id, _package_id, _role, auth.uid())
  RETURNING * INTO v_link;

  PERFORM public.logistics_route_log_event(v_stop.route_id, _stop_id, v_stop.route_version_id, 'package_attached', NULL, NULL, NULL,
    jsonb_build_object('package_id', _package_id, 'role', _role));
  RETURN v_link;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_stop_detach_package(_link_id uuid, _reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.logistics_stop_packages; v_status text;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_link FROM public.logistics_stop_packages WHERE id = _link_id;
  IF v_link.id IS NULL THEN RETURN false; END IF;
  SELECT status INTO v_status FROM public.logistics_route_stops WHERE id = v_link.stop_id;
  IF v_status IN ('COMPLETED','SERVICE_STARTED') THEN
    RAISE EXCEPTION 'cannot detach a package from a serviced stop' USING ERRCODE='23514'; END IF;
  DELETE FROM public.logistics_stop_packages WHERE id = _link_id;
  PERFORM public.logistics_route_log_event(v_link.route_id, v_link.stop_id, v_link.route_version_id, 'package_detached', NULL, NULL, _reason, to_jsonb(v_link));
  RETURN true;
END; $$;

-- ============ ELIGIBILITY ============
CREATE OR REPLACE FUNCTION public.logistics_route_eligibility(_route_id uuid, _driver_user_id uuid, _vehicle_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_route public.logistics_routes; v_reasons text[] := '{}'; v_driver record; v_vehicle record;
        v_load numeric; v_open integer;
BEGIN
  IF NOT public.logistics_route_authorised('read') THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_route FROM public.logistics_routes WHERE id = _route_id;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'route not found' USING ERRCODE='P0002'; END IF;

  SELECT d.status::text AS status, d.verification_status::text AS verification, d.user_id
    INTO v_driver FROM public.drivers d WHERE d.user_id = _driver_user_id;

  IF v_driver.user_id IS NULL THEN
    v_reasons := v_reasons || 'DRIVER_UNAVAILABLE';
  ELSE
    IF v_driver.status <> 'active' THEN v_reasons := v_reasons || 'DRIVER_UNAVAILABLE'; END IF;
    IF v_driver.verification <> 'verified' THEN v_reasons := v_reasons || 'COMPLIANCE_REQUIRED'; END IF;
  END IF;

  SELECT count(*) INTO v_open FROM public.logistics_routes r
   WHERE r.driver_user_id = _driver_user_id AND r.id <> _route_id
     AND r.status IN ('ASSIGNED','READY','IN_PROGRESS','PAUSED');
  IF v_open > 0 THEN v_reasons := v_reasons || 'ALREADY_ASSIGNED'; END IF;

  IF _vehicle_id IS NOT NULL THEN
    SELECT v.vehicle_status::text AS status, v.vehicle_type, v.seating_capacity
      INTO v_vehicle FROM public.vehicles v WHERE v.id = _vehicle_id;
    IF v_vehicle.status IS NULL THEN v_reasons := v_reasons || 'VEHICLE_UNAVAILABLE';
    ELSIF v_vehicle.status NOT IN ('active','available') THEN v_reasons := v_reasons || 'VEHICLE_UNAVAILABLE';
    END IF;
    IF v_route.required_vehicle_type IS NOT NULL AND v_vehicle.vehicle_type IS DISTINCT FROM v_route.required_vehicle_type THEN
      v_reasons := v_reasons || 'VEHICLE_TYPE_MISMATCH';
    END IF;
  END IF;

  SELECT COALESCE(sum(p.weight_kg),0) INTO v_load
    FROM public.logistics_stop_packages sp JOIN public.packages p ON p.id = sp.package_id
   WHERE sp.route_version_id = public.logistics_route_current_version(_route_id) AND sp.role IN ('pickup','delivery');
  IF v_route.required_capacity_kg IS NOT NULL AND v_load > v_route.required_capacity_kg THEN
    v_reasons := v_reasons || 'CAPACITY_EXCEEDED';
  END IF;

  RETURN jsonb_build_object(
    'status', CASE WHEN array_length(v_reasons,1) IS NULL THEN 'ELIGIBLE' ELSE 'INELIGIBLE' END,
    'reasons', to_jsonb(v_reasons),
    'planned_load_kg', v_load,
    'evaluated_at', now());
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_assign(
  _route_id uuid, _driver_user_id uuid, _vehicle_id uuid, _reason text, _force boolean DEFAULT false)
RETURNS public.logistics_routes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_route public.logistics_routes; v_elig jsonb;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  v_elig := public.logistics_route_eligibility(_route_id, _driver_user_id, _vehicle_id);
  IF v_elig->>'status' <> 'ELIGIBLE' AND NOT _force THEN
    RAISE EXCEPTION 'driver/vehicle not eligible: %', v_elig->>'reasons' USING ERRCODE='23514';
  END IF;
  IF _force AND (_reason IS NULL OR length(trim(_reason)) < 5) THEN
    RAISE EXCEPTION 'an override reason is required' USING ERRCODE='23514'; END IF;

  UPDATE public.logistics_routes
     SET driver_user_id = _driver_user_id, vehicle_id = _vehicle_id, updated_by = auth.uid(),
         status = CASE WHEN status IN ('DRAFT','PLANNED') THEN 'ASSIGNED' ELSE status END
   WHERE id = _route_id RETURNING * INTO v_route;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'route not found' USING ERRCODE='P0002'; END IF;

  UPDATE public.logistics_route_stops SET status = 'ASSIGNED'
   WHERE route_version_id = public.logistics_route_current_version(_route_id) AND status = 'PLANNED';

  PERFORM public.logistics_route_log_event(_route_id, NULL, NULL, 'route_assigned', NULL, v_route.status, _reason,
    jsonb_build_object('driver_user_id', _driver_user_id, 'vehicle_id', _vehicle_id, 'eligibility', v_elig, 'forced', _force));
  RETURN v_route;
END; $$;

-- ============ STATE MACHINES ============
CREATE OR REPLACE FUNCTION public.logistics_stop_transition(
  _stop_id uuid, _to_status text, _reason text DEFAULT NULL, _lat numeric DEFAULT NULL, _lng numeric DEFAULT NULL)
RETURNS public.logistics_route_stops
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_stop public.logistics_route_stops; v_route public.logistics_routes; v_allowed text[]; v_is_driver boolean;
BEGIN
  SELECT * INTO v_stop FROM public.logistics_route_stops WHERE id = _stop_id FOR UPDATE;
  IF v_stop.id IS NULL THEN RAISE EXCEPTION 'stop not found' USING ERRCODE='P0002'; END IF;
  SELECT * INTO v_route FROM public.logistics_routes WHERE id = v_stop.route_id;
  v_is_driver := v_route.driver_user_id IS NOT NULL AND v_route.driver_user_id = auth.uid();
  IF NOT public.logistics_route_authorised('manage') AND NOT v_is_driver THEN
    RAISE EXCEPTION 'not authorised to move this stop' USING ERRCODE='42501'; END IF;

  v_allowed := CASE v_stop.status
    WHEN 'PLANNED' THEN ARRAY['ASSIGNED','SKIPPED','CANCELLED']
    WHEN 'ASSIGNED' THEN ARRAY['EN_ROUTE','PLANNED','SKIPPED','CANCELLED']
    WHEN 'EN_ROUTE' THEN ARRAY['ARRIVED','FAILED','SKIPPED','CANCELLED']
    WHEN 'ARRIVED' THEN ARRAY['SERVICE_STARTED','FAILED','SKIPPED']
    WHEN 'SERVICE_STARTED' THEN ARRAY['COMPLETED','FAILED']
    WHEN 'FAILED' THEN ARRAY['EN_ROUTE','SKIPPED','CANCELLED']
    ELSE ARRAY[]::text[] END;

  IF NOT (_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid stop transition % -> %', v_stop.status, _to_status USING ERRCODE='23514'; END IF;

  IF _to_status IN ('FAILED','SKIPPED','CANCELLED') AND (_reason IS NULL OR length(trim(_reason)) < 3) THEN
    RAISE EXCEPTION 'a reason is required for % transitions', _to_status USING ERRCODE='23514'; END IF;

  UPDATE public.logistics_route_stops SET
    status = _to_status,
    actual_arrival = CASE WHEN _to_status = 'ARRIVED' THEN COALESCE(actual_arrival, now()) ELSE actual_arrival END,
    departed_at = CASE WHEN _to_status IN ('COMPLETED','FAILED','SKIPPED') THEN COALESCE(departed_at, now()) ELSE departed_at END,
    metadata = metadata || jsonb_strip_nulls(jsonb_build_object('last_lat', _lat, 'last_lng', _lng))
  WHERE id = _stop_id RETURNING * INTO v_stop;

  PERFORM public.logistics_route_log_event(v_stop.route_id, v_stop.id, v_stop.route_version_id, 'stop_transition',
    NULL, _to_status, _reason, jsonb_strip_nulls(jsonb_build_object('lat', _lat, 'lng', _lng)));
  RETURN v_stop;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_transition(_route_id uuid, _to_status text, _reason text DEFAULT NULL)
RETURNS public.logistics_routes
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_route public.logistics_routes; v_allowed text[]; v_open integer; v_unresolved integer; v_version uuid;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_route FROM public.logistics_routes WHERE id = _route_id FOR UPDATE;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'route not found' USING ERRCODE='P0002'; END IF;
  v_version := public.logistics_route_current_version(_route_id);

  v_allowed := CASE v_route.status
    WHEN 'DRAFT' THEN ARRAY['PLANNED','CANCELLED']
    WHEN 'PLANNED' THEN ARRAY['ASSIGNED','DRAFT','CANCELLED']
    WHEN 'ASSIGNED' THEN ARRAY['READY','PLANNED','CANCELLED']
    WHEN 'READY' THEN ARRAY['IN_PROGRESS','ASSIGNED','CANCELLED']
    WHEN 'IN_PROGRESS' THEN ARRAY['PAUSED','COMPLETED','FAILED','CANCELLED']
    WHEN 'PAUSED' THEN ARRAY['IN_PROGRESS','FAILED','CANCELLED']
    ELSE ARRAY[]::text[] END;
  IF NOT (_to_status = ANY(v_allowed)) THEN
    RAISE EXCEPTION 'invalid route transition % -> %', v_route.status, _to_status USING ERRCODE='23514'; END IF;

  IF _to_status = 'PLANNED' THEN
    SELECT count(*) INTO v_open FROM public.logistics_route_stops WHERE route_version_id = v_version;
    IF v_open = 0 THEN RAISE EXCEPTION 'a route needs at least one stop before planning' USING ERRCODE='23514'; END IF;
  END IF;

  IF _to_status IN ('READY','IN_PROGRESS') AND (v_route.driver_user_id IS NULL OR v_route.vehicle_id IS NULL) THEN
    RAISE EXCEPTION 'route needs an assigned driver and vehicle' USING ERRCODE='23514';
  END IF;

  IF _to_status = 'COMPLETED' THEN
    SELECT count(*) INTO v_open FROM public.logistics_route_stops
     WHERE route_version_id = v_version AND status IN ('PLANNED','ASSIGNED','EN_ROUTE','ARRIVED','SERVICE_STARTED');
    IF v_open > 0 THEN
      RAISE EXCEPTION 'route has % unresolved stop(s); resolve or skip them first', v_open USING ERRCODE='23514'; END IF;
    SELECT count(*) INTO v_unresolved FROM public.logistics_route_stops
     WHERE route_version_id = v_version AND status = 'FAILED' AND exception_id IS NULL;
    IF v_unresolved > 0 THEN
      RAISE EXCEPTION '% failed stop(s) have no exception recorded', v_unresolved USING ERRCODE='23514'; END IF;
  END IF;

  IF _to_status IN ('FAILED','CANCELLED') AND (_reason IS NULL OR length(trim(_reason)) < 3) THEN
    RAISE EXCEPTION 'a reason is required for % transitions', _to_status USING ERRCODE='23514'; END IF;

  UPDATE public.logistics_routes SET
    status = _to_status,
    actual_start = CASE WHEN _to_status = 'IN_PROGRESS' THEN COALESCE(actual_start, now()) ELSE actual_start END,
    actual_end = CASE WHEN _to_status IN ('COMPLETED','FAILED','CANCELLED') THEN COALESCE(actual_end, now()) ELSE actual_end END,
    actual_duration_min = CASE WHEN _to_status IN ('COMPLETED','FAILED')
      THEN COALESCE(actual_duration_min, EXTRACT(EPOCH FROM (now() - COALESCE(actual_start, now())))::integer / 60) ELSE actual_duration_min END,
    updated_by = auth.uid()
  WHERE id = _route_id RETURNING * INTO v_route;

  PERFORM public.logistics_route_log_event(_route_id, NULL, v_version, 'route_transition', NULL, _to_status, _reason, '{}'::jsonb);
  RETURN v_route;
END; $$;

-- ============ DISPATCH / TELEMETRY / DEVIATION ============
CREATE OR REPLACE FUNCTION public.logistics_route_link_dispatch_job(_route_id uuid, _stop_id uuid, _dispatch_job_id uuid)
RETURNS public.logistics_route_dispatch_links
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link public.logistics_route_dispatch_links;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  INSERT INTO public.logistics_route_dispatch_links(route_id, stop_id, dispatch_job_id, linked_by)
  VALUES (_route_id, _stop_id, _dispatch_job_id, auth.uid())
  ON CONFLICT (route_id, dispatch_job_id) DO UPDATE SET stop_id = EXCLUDED.stop_id
  RETURNING * INTO v_link;
  PERFORM public.logistics_route_log_event(_route_id, _stop_id, NULL, 'dispatch_linked', NULL, NULL, NULL,
    jsonb_build_object('dispatch_job_id', _dispatch_job_id));
  RETURN v_link;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_record_deviation(
  _route_id uuid, _stop_id uuid, _kind text, _severity text, _narrative text, _distance_m numeric DEFAULT NULL)
RETURNS public.logistics_route_deviations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dev public.logistics_route_deviations; v_is_driver boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.logistics_routes r WHERE r.id = _route_id AND r.driver_user_id = auth.uid()) INTO v_is_driver;
  IF NOT public.logistics_route_authorised('manage') AND NOT v_is_driver THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
  INSERT INTO public.logistics_route_deviations(route_id, stop_id, kind, severity, narrative, distance_m, detected_by)
  VALUES (_route_id, _stop_id, _kind, COALESCE(_severity,'medium'), _narrative, _distance_m, auth.uid())
  RETURNING * INTO v_dev;
  PERFORM public.logistics_route_log_event(_route_id, _stop_id, NULL, 'route_deviation', NULL, NULL, _narrative,
    jsonb_build_object('kind', _kind, 'severity', _severity, 'distance_m', _distance_m));
  RETURN v_dev;
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_resolve_deviation(_deviation_id uuid, _status text, _note text)
RETURNS public.logistics_route_deviations
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dev public.logistics_route_deviations;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
  IF _status NOT IN ('acknowledged','resolved','dismissed') THEN
    RAISE EXCEPTION 'invalid deviation status' USING ERRCODE='23514'; END IF;
  UPDATE public.logistics_route_deviations
     SET status = _status, narrative = COALESCE(narrative,'') || CASE WHEN _note IS NULL THEN '' ELSE E'\n' || _note END,
         resolved_by = CASE WHEN _status <> 'acknowledged' THEN auth.uid() ELSE resolved_by END,
         resolved_at = CASE WHEN _status <> 'acknowledged' THEN now() ELSE resolved_at END
   WHERE id = _deviation_id RETURNING * INTO v_dev;
  RETURN v_dev;
END; $$;

-- ============ OPTIMISATION ============
CREATE OR REPLACE FUNCTION public.logistics_route_optimize(
  _route_id uuid, _provider_key text DEFAULT 'manual', _request jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run public.logistics_route_optimization_runs; v_provider public.logistics_route_providers; v_version uuid;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  v_version := public.logistics_route_current_version(_route_id);
  SELECT * INTO v_provider FROM public.logistics_route_providers WHERE provider_key = _provider_key;

  INSERT INTO public.logistics_route_optimization_runs(route_id, route_version_id, provider_key, request, requested_by)
  VALUES (_route_id, v_version, _provider_key, COALESCE(_request,'{}'::jsonb), auth.uid())
  RETURNING * INTO v_run;

  IF _provider_key <> 'manual' AND (v_provider.id IS NULL OR NOT v_provider.enabled) THEN
    UPDATE public.logistics_route_optimization_runs
       SET status = 'skipped', error = 'provider not configured or disabled', completed_at = now()
     WHERE id = v_run.id;
    UPDATE public.logistics_routes SET optimization_status = 'not_optimized' WHERE id = _route_id;
    RETURN jsonb_build_object('run_id', v_run.id, 'status', 'skipped',
      'reason', 'PROVIDER_NOT_CONFIGURED', 'fallback', 'manual_planning');
  END IF;

  UPDATE public.logistics_route_optimization_runs SET status = 'pending' WHERE id = v_run.id;
  UPDATE public.logistics_routes SET optimization_status = 'pending' WHERE id = _route_id;
  RETURN jsonb_build_object('run_id', v_run.id, 'status', 'pending', 'route_version_id', v_version);
END; $$;

CREATE OR REPLACE FUNCTION public.logistics_route_optimization_apply(
  _run_id uuid, _ordered_stop_ids uuid[], _response jsonb, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_run public.logistics_route_optimization_runs; v_version public.logistics_route_versions; i integer;
BEGIN
  IF NOT public.logistics_route_authorised('manage') THEN
    RAISE EXCEPTION 'not authorised to manage routes' USING ERRCODE='42501'; END IF;
  SELECT * INTO v_run FROM public.logistics_route_optimization_runs WHERE id = _run_id;
  IF v_run.id IS NULL THEN RAISE EXCEPTION 'optimization run not found' USING ERRCODE='P0002'; END IF;

  v_version := public.logistics_route_new_version(v_run.route_id,
    COALESCE(_reason, 'optimization result applied'), v_run.provider_key, v_run.provider_key = 'manual');

  IF _ordered_stop_ids IS NOT NULL THEN
    FOR i IN 1..array_length(_ordered_stop_ids,1) LOOP
      UPDATE public.logistics_route_stops ns SET sequence = i
        FROM public.logistics_route_stops os
       WHERE os.id = _ordered_stop_ids[i] AND ns.route_version_id = v_version.id AND ns.sequence = os.sequence;
    END LOOP;
  END IF;

  UPDATE public.logistics_route_optimization_runs
     SET status = 'succeeded', response = _response, result_version_id = v_version.id, completed_at = now()
   WHERE id = _run_id;
  UPDATE public.logistics_routes
     SET optimization_status = CASE WHEN v_run.provider_key = 'manual' THEN 'manual' ELSE 'optimized' END,
         planned_distance_km = COALESCE(NULLIF(_response->>'distance_km','')::numeric, planned_distance_km),
         estimated_duration_min = COALESCE(NULLIF(_response->>'duration_min','')::integer, estimated_duration_min)
   WHERE id = v_run.route_id;

  RETURN jsonb_build_object('run_id', _run_id, 'status', 'succeeded', 'route_version_id', v_version.id, 'version', v_version.version_number);
END; $$;

-- ============ READ MODEL ============
CREATE OR REPLACE FUNCTION public.logistics_route_detail(_route_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_route public.logistics_routes; v_version uuid;
BEGIN
  SELECT * INTO v_route FROM public.logistics_routes WHERE id = _route_id;
  IF v_route.id IS NULL THEN RAISE EXCEPTION 'route not found' USING ERRCODE='P0002'; END IF;
  IF NOT public.logistics_route_authorised('read') AND v_route.driver_user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'not authorised' USING ERRCODE='42501'; END IF;
  v_version := public.logistics_route_current_version(_route_id);

  RETURN jsonb_build_object(
    'route', to_jsonb(v_route),
    'current_version_id', v_version,
    'versions', COALESCE((SELECT jsonb_agg(to_jsonb(v) ORDER BY v.version_number DESC)
                          FROM public.logistics_route_versions v WHERE v.route_id = _route_id), '[]'::jsonb),
    'stops', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'stop', to_jsonb(s),
                          'packages', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                                'link_id', sp.id, 'role', sp.role, 'package', to_jsonb(p)))
                              FROM public.logistics_stop_packages sp
                              JOIN public.packages p ON p.id = sp.package_id
                             WHERE sp.stop_id = s.id), '[]'::jsonb))
                        ORDER BY s.sequence)
                      FROM public.logistics_route_stops s WHERE s.route_version_id = v_version), '[]'::jsonb),
    'deviations', COALESCE((SELECT jsonb_agg(to_jsonb(d) ORDER BY d.detected_at DESC)
                            FROM public.logistics_route_deviations d WHERE d.route_id = _route_id), '[]'::jsonb),
    'dispatch_jobs', COALESCE((SELECT jsonb_agg(jsonb_build_object('link', to_jsonb(l), 'job', to_jsonb(j)))
                               FROM public.logistics_route_dispatch_links l
                               JOIN public.delivery_dispatch_jobs j ON j.id = l.dispatch_job_id
                              WHERE l.route_id = _route_id), '[]'::jsonb),
    'optimization_runs', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.created_at DESC)
                                   FROM public.logistics_route_optimization_runs o WHERE o.route_id = _route_id), '[]'::jsonb),
    'events', COALESCE((SELECT jsonb_agg(to_jsonb(e) ORDER BY e.created_at DESC)
                        FROM (SELECT * FROM public.logistics_route_events WHERE route_id = _route_id
                              ORDER BY created_at DESC LIMIT 100) e), '[]'::jsonb));
END; $$;

-- ============ EXECUTE GRANTS (deny by default) ============
REVOKE EXECUTE ON FUNCTION public.logistics_route_authorised(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_log_event(uuid,uuid,uuid,text,text,text,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_upsert(uuid,jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_new_version(uuid,text,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_current_version(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_stop_upsert(uuid,uuid,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_stop_remove(uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_reorder_stops(uuid,uuid[],text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_stop_attach_package(uuid,uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_stop_detach_package(uuid,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_eligibility(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_assign(uuid,uuid,uuid,text,boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_stop_transition(uuid,text,text,numeric,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_transition(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_link_dispatch_job(uuid,uuid,uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_record_deviation(uuid,uuid,text,text,text,numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_resolve_deviation(uuid,text,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_optimize(uuid,text,jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_optimization_apply(uuid,uuid[],jsonb,text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.logistics_route_detail(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.logistics_route_authorised(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_upsert(uuid,jsonb,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_new_version(uuid,text,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_current_version(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_stop_upsert(uuid,uuid,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_stop_remove(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_reorder_stops(uuid,uuid[],text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_stop_attach_package(uuid,uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_stop_detach_package(uuid,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_eligibility(uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_assign(uuid,uuid,uuid,text,boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_stop_transition(uuid,text,text,numeric,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_transition(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_link_dispatch_job(uuid,uuid,uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_record_deviation(uuid,uuid,text,text,text,numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_resolve_deviation(uuid,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_optimize(uuid,text,jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_optimization_apply(uuid,uuid[],jsonb,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_detail(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.logistics_route_log_event(uuid,uuid,uuid,text,text,text,text,jsonb) TO service_role;

INSERT INTO public.logistics_route_providers(provider_key, display_name, enabled, health_status, health_detail)
VALUES ('manual','Manual dispatcher planning', true, 'healthy', 'Authorized manual planning fallback'),
       ('google_routes','Google Routes API', false, 'unconfigured', 'No credentials configured'),
       ('osrm','OSRM / self-hosted', false, 'unconfigured', 'No base URL configured')
ON CONFLICT (provider_key) DO NOTHING;