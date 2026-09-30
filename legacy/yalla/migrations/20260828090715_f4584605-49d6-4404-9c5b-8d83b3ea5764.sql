-- ============================================================================
-- Logistics Phase 1 completion: hub lifecycle, capacity, service area,
-- operating hours, contacts, cross-dock staging, granular authorization.
-- Domain: logistics
-- ============================================================================

/* --------------------------- granular permissions -------------------------- */
INSERT INTO public.staff_permissions (key, domain, action, description) VALUES
  ('staff.logistics.hubs.read', 'logistics', 'read', 'View logistics hubs, capacity, areas, hours and contacts'),
  ('staff.logistics.hubs.create', 'logistics', 'create', 'Create a logistics hub'),
  ('staff.logistics.hubs.update', 'logistics', 'update', 'Edit logistics hub attributes'),
  ('staff.logistics.hubs.activate', 'logistics', 'activate', 'Activate a logistics hub'),
  ('staff.logistics.hubs.deactivate', 'logistics', 'deactivate', 'Suspend or deactivate a logistics hub'),
  ('staff.logistics.hubs.manage_capacity', 'logistics', 'manage', 'Change hub capacity figures'),
  ('staff.logistics.hubs.manage_capabilities', 'logistics', 'manage', 'Change hub operational capabilities'),
  ('staff.logistics.hubs.manage_contacts', 'logistics', 'manage', 'Manage hub contacts')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key)
SELECT r.role, p.key
FROM (VALUES ('admin'::app_role), ('super_admin'::app_role), ('operations_admin'::app_role)) AS r(role)
CROSS JOIN (VALUES
  ('staff.logistics.hubs.read'), ('staff.logistics.hubs.create'), ('staff.logistics.hubs.update'),
  ('staff.logistics.hubs.activate'), ('staff.logistics.hubs.deactivate'),
  ('staff.logistics.hubs.manage_capacity'), ('staff.logistics.hubs.manage_capabilities'),
  ('staff.logistics.hubs.manage_contacts')
) AS p(key)
ON CONFLICT DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key)
SELECT r.role, p.key
FROM (VALUES ('dispatch_manager'::app_role), ('director'::app_role), ('general_manager'::app_role)) AS r(role)
CROSS JOIN (VALUES ('staff.logistics.hubs.read')) AS p(key)
ON CONFLICT DO NOTHING;

INSERT INTO public.staff_role_permissions (role, permission_key)
SELECT 'dispatch_manager'::app_role, p.key
FROM (VALUES ('staff.logistics.hubs.update'), ('staff.logistics.hubs.manage_capacity')) AS p(key)
ON CONFLICT DO NOTHING;

/** Single authorization primitive for every hub action. Reuses the staff
 *  permission spine; platform admins remain implicitly authorised. */
CREATE OR REPLACE FUNCTION public.logistics_hub_authorised(_action text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
     AND (public.has_staff_permission('staff.logistics.hubs.' || _action)
          OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
$$;

REVOKE ALL ON FUNCTION public.logistics_hub_authorised(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_hub_authorised(text) TO authenticated, service_role;

/* ------------------------------- hub columns ------------------------------- */
ALTER TABLE public.logistics_hubs
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Africa/Nairobi',
  ADD COLUMN IF NOT EXISTS capacity_unit text NOT NULL DEFAULT 'parcels',
  ADD COLUMN IF NOT EXISTS max_capacity numeric,
  ADD COLUMN IF NOT EXISTS current_capacity numeric NOT NULL DEFAULT 0;

UPDATE public.logistics_hubs SET status = CASE WHEN active THEN 'active' ELSE 'inactive' END
WHERE status = 'draft';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_hubs_status_chk') THEN
    ALTER TABLE public.logistics_hubs ADD CONSTRAINT logistics_hubs_status_chk
      CHECK (status IN ('draft','active','suspended','inactive'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_hubs_capacity_chk') THEN
    ALTER TABLE public.logistics_hubs ADD CONSTRAINT logistics_hubs_capacity_chk
      CHECK (current_capacity >= 0 AND (max_capacity IS NULL OR max_capacity >= 0));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_hubs_coords_chk') THEN
    ALTER TABLE public.logistics_hubs ADD CONSTRAINT logistics_hubs_coords_chk
      CHECK ((lat IS NULL AND lng IS NULL)
             OR (lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'logistics_hubs_capabilities_chk') THEN
    ALTER TABLE public.logistics_hubs ADD CONSTRAINT logistics_hubs_capabilities_chk
      CHECK (capabilities <@ ARRAY['receiving','sorting','staging','cross_dock','dispatch','storage','returns_processing','cold_chain']::text[]);
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_logistics_hubs_code_ci
  ON public.logistics_hubs (upper(code));

/** `active` stays the read-side projection of the lifecycle so existing
 *  consumers (manifest console, dispatch) need no change. */
CREATE OR REPLACE FUNCTION public._logistics_hub_project_active()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.active := (NEW.status = 'active');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_logistics_hub_project_active ON public.logistics_hubs;
CREATE TRIGGER trg_logistics_hub_project_active
  BEFORE INSERT OR UPDATE ON public.logistics_hubs
  FOR EACH ROW EXECUTE FUNCTION public._logistics_hub_project_active();

UPDATE public.logistics_hubs SET status = status;  -- reproject `active`

/* ------------------------------ service areas ------------------------------ */
CREATE TABLE IF NOT EXISTS public.logistics_hub_service_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  area_type text NOT NULL CHECK (area_type IN ('radius','polygon','city','region','corridor')),
  label text,
  city text,
  region text,
  corridor_code text,
  center_lat numeric(10,7),
  center_lng numeric(10,7),
  radius_km numeric,
  polygon jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hub_area_radius_shape CHECK (
    area_type <> 'radius'
    OR (center_lat IS NOT NULL AND center_lng IS NOT NULL AND radius_km IS NOT NULL AND radius_km > 0)
  ),
  CONSTRAINT hub_area_polygon_shape CHECK (
    area_type <> 'polygon' OR (polygon IS NOT NULL AND jsonb_typeof(polygon) = 'array')
  ),
  CONSTRAINT hub_area_named_shape CHECK (
    area_type NOT IN ('city','region','corridor')
    OR coalesce(city, region, corridor_code) IS NOT NULL
  )
);

GRANT SELECT ON public.logistics_hub_service_areas TO authenticated;
GRANT ALL ON public.logistics_hub_service_areas TO service_role;
ALTER TABLE public.logistics_hub_service_areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_areas_staff_read" ON public.logistics_hub_service_areas
  FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE INDEX IF NOT EXISTS idx_hub_service_areas_hub ON public.logistics_hub_service_areas (hub_id);

CREATE TRIGGER trg_hub_service_areas_touch BEFORE UPDATE ON public.logistics_hub_service_areas
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* ----------------------------- operating hours ---------------------------- */
CREATE TABLE IF NOT EXISTS public.logistics_hub_operating_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  opens time,
  closes time,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, weekday),
  CONSTRAINT hub_hours_window CHECK (closed OR (opens IS NOT NULL AND closes IS NOT NULL AND closes > opens))
);

GRANT SELECT ON public.logistics_hub_operating_hours TO authenticated;
GRANT ALL ON public.logistics_hub_operating_hours TO service_role;
ALTER TABLE public.logistics_hub_operating_hours ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_hours_staff_read" ON public.logistics_hub_operating_hours
  FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE TRIGGER trg_hub_hours_touch BEFORE UPDATE ON public.logistics_hub_operating_hours
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE IF NOT EXISTS public.logistics_hub_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  closure_date date NOT NULL,
  reason text,
  closed boolean NOT NULL DEFAULT true,
  opens time,
  closes time,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hub_id, closure_date),
  CONSTRAINT hub_closure_window CHECK (closed OR (opens IS NOT NULL AND closes IS NOT NULL AND closes > opens))
);

GRANT SELECT ON public.logistics_hub_closures TO authenticated;
GRANT ALL ON public.logistics_hub_closures TO service_role;
ALTER TABLE public.logistics_hub_closures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_closures_staff_read" ON public.logistics_hub_closures
  FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read') OR public.logistics_ops_actor_authorised('staff.logistics.read'));

/* -------------------------------- contacts -------------------------------- */
CREATE TABLE IF NOT EXISTS public.logistics_hub_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_role text,
  phone text,
  email text,
  is_primary boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hub_contact_reachable CHECK (coalesce(phone, email) IS NOT NULL)
);

GRANT SELECT ON public.logistics_hub_contacts TO authenticated;
GRANT ALL ON public.logistics_hub_contacts TO service_role;
ALTER TABLE public.logistics_hub_contacts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_contacts_staff_read" ON public.logistics_hub_contacts
  FOR SELECT TO authenticated
  USING (public.logistics_hub_authorised('read'));

CREATE UNIQUE INDEX IF NOT EXISTS uq_hub_primary_contact
  ON public.logistics_hub_contacts (hub_id) WHERE is_primary AND active;

CREATE TRIGGER trg_hub_contacts_touch BEFORE UPDATE ON public.logistics_hub_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* --------------------------- cross-dock staging --------------------------- */
CREATE TABLE IF NOT EXISTS public.logistics_hub_package_stage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  package_id uuid NOT NULL,
  stage text NOT NULL CHECK (stage IN ('received','sorted','staged','consolidated','dispatched')),
  inbound_manifest_id uuid REFERENCES public.logistics_manifests(id) ON DELETE SET NULL,
  outbound_manifest_id uuid REFERENCES public.logistics_manifests(id) ON DELETE SET NULL,
  custody_event_id uuid REFERENCES public.package_chain_of_custody(id) ON DELETE SET NULL,
  actor_id uuid,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id)
);

GRANT SELECT ON public.logistics_hub_package_stage TO authenticated;
GRANT ALL ON public.logistics_hub_package_stage TO service_role;
ALTER TABLE public.logistics_hub_package_stage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_stage_staff_read" ON public.logistics_hub_package_stage
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE INDEX IF NOT EXISTS idx_hub_stage_hub ON public.logistics_hub_package_stage (hub_id, stage);

CREATE TRIGGER trg_hub_stage_touch BEFORE UPDATE ON public.logistics_hub_package_stage
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

/* ------------------- inactive hubs reject operational use ----------------- */
CREATE OR REPLACE FUNCTION public._logistics_manifest_hub_state_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_status text;
BEGIN
  IF NEW.origin_hub_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.logistics_hubs WHERE id = NEW.origin_hub_id;
    IF v_status <> 'active' THEN
      RAISE EXCEPTION 'origin_hub_not_active';
    END IF;
  END IF;
  IF NEW.destination_hub_id IS NOT NULL THEN
    SELECT status INTO v_status FROM public.logistics_hubs WHERE id = NEW.destination_hub_id;
    IF v_status <> 'active' THEN
      RAISE EXCEPTION 'destination_hub_not_active';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_manifest_hub_state_guard ON public.logistics_manifests;
CREATE TRIGGER trg_manifest_hub_state_guard
  BEFORE INSERT OR UPDATE OF origin_hub_id, destination_hub_id ON public.logistics_manifests
  FOR EACH ROW EXECUTE FUNCTION public._logistics_manifest_hub_state_guard();

/* ---------------------------- serviceability ------------------------------ */
CREATE OR REPLACE FUNCTION public.logistics_hub_serves_location(
  _hub_id uuid,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _city text DEFAULT NULL,
  _region text DEFAULT NULL,
  _corridor text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  pts jsonb;
  n int;
  i int;
  j int;
  inside boolean;
  xi numeric; yi numeric; xj numeric; yj numeric;
  dist_km numeric;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.logistics_hubs WHERE id = _hub_id AND status = 'active') THEN
    RETURN false;
  END IF;

  FOR a IN SELECT * FROM public.logistics_hub_service_areas WHERE hub_id = _hub_id AND active LOOP
    IF a.area_type = 'radius' AND _lat IS NOT NULL AND _lng IS NOT NULL THEN
      -- haversine, earth radius 6371 km
      dist_km := 6371 * 2 * asin(sqrt(
        power(sin(radians(_lat - a.center_lat) / 2), 2)
        + cos(radians(a.center_lat)) * cos(radians(_lat))
          * power(sin(radians(_lng - a.center_lng) / 2), 2)
      ));
      IF dist_km <= a.radius_km THEN RETURN true; END IF;

    ELSIF a.area_type = 'polygon' AND _lat IS NOT NULL AND _lng IS NOT NULL THEN
      -- ray casting over [[lng,lat], ...]
      pts := a.polygon;
      n := jsonb_array_length(pts);
      IF n >= 3 THEN
        inside := false;
        i := 0;
        j := n - 1;
        WHILE i < n LOOP
          xi := (pts -> i -> 0)::text::numeric;
          yi := (pts -> i -> 1)::text::numeric;
          xj := (pts -> j -> 0)::text::numeric;
          yj := (pts -> j -> 1)::text::numeric;
          IF ((yi > _lat) <> (yj > _lat))
             AND (_lng < (xj - xi) * (_lat - yi) / NULLIF(yj - yi, 0) + xi) THEN
            inside := NOT inside;
          END IF;
          j := i;
          i := i + 1;
        END LOOP;
        IF inside THEN RETURN true; END IF;
      END IF;

    ELSIF a.area_type = 'city' AND _city IS NOT NULL AND lower(a.city) = lower(_city) THEN
      RETURN true;
    ELSIF a.area_type = 'region' AND _region IS NOT NULL AND lower(a.region) = lower(_region) THEN
      RETURN true;
    ELSIF a.area_type = 'corridor' AND _corridor IS NOT NULL AND lower(a.corridor_code) = lower(_corridor) THEN
      RETURN true;
    END IF;
  END LOOP;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_hub_serves_location(uuid, numeric, numeric, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_hub_serves_location(uuid, numeric, numeric, text, text, text) TO authenticated, service_role;

/* --------------------------- open/closed evaluation ----------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_open_at(_hub_id uuid, _at timestamptz DEFAULT now())
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tz text;
  v_local timestamp;
  v_date date;
  v_time time;
  v_dow smallint;
  c record;
  h record;
BEGIN
  SELECT timezone INTO v_tz FROM public.logistics_hubs WHERE id = _hub_id AND status = 'active';
  IF v_tz IS NULL THEN RETURN false; END IF;

  v_local := _at AT TIME ZONE v_tz;
  v_date := v_local::date;
  v_time := v_local::time;
  v_dow := extract(dow FROM v_local)::smallint;

  SELECT * INTO c FROM public.logistics_hub_closures
   WHERE hub_id = _hub_id AND closure_date = v_date;
  IF FOUND THEN
    IF c.closed THEN RETURN false; END IF;
    RETURN v_time >= c.opens AND v_time < c.closes;
  END IF;

  SELECT * INTO h FROM public.logistics_hub_operating_hours
   WHERE hub_id = _hub_id AND weekday = v_dow;
  IF NOT FOUND THEN RETURN false; END IF;
  IF h.closed THEN RETURN false; END IF;
  RETURN v_time >= h.opens AND v_time < h.closes;
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_hub_open_at(uuid, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_hub_open_at(uuid, timestamptz) TO authenticated, service_role;

/* -------------------------- legacy manifest notice ------------------------ */
COMMENT ON TABLE public.manifests IS
  'DEPRECATED (Logistics Phase 1K). Superseded by public.logistics_manifests, which is the single authoritative manifest model. Table is empty and has no application references; retained read-only for historical safety. Do not write new rows.';
REVOKE INSERT, UPDATE, DELETE ON public.manifests FROM authenticated;