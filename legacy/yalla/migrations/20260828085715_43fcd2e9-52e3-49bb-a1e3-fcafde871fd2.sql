-- ============================================================================
-- Logistics Phase 1: hub model extension + hub administration
-- Domain: logistics
-- ============================================================================

ALTER TABLE public.logistics_hubs
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS country_code text NOT NULL DEFAULT 'KE',
  ADD COLUMN IF NOT EXISTS service_area jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS operating_hours jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS capabilities text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS capacity jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS contact_name text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS responsible_operator_id uuid,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS created_by uuid;

/* ----------------------------- hub audit trail ---------------------------- */
CREATE TABLE IF NOT EXISTS public.logistics_hub_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.logistics_hubs(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('created','updated','activated','deactivated')),
  actor_id uuid,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.logistics_hub_audit TO authenticated;
GRANT ALL ON public.logistics_hub_audit TO service_role;
ALTER TABLE public.logistics_hub_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hub_audit_staff_read" ON public.logistics_hub_audit
  FOR SELECT TO authenticated
  USING (public.logistics_ops_actor_authorised('staff.logistics.read'));

CREATE INDEX IF NOT EXISTS idx_logistics_hub_audit_hub
  ON public.logistics_hub_audit (hub_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._logistics_hub_audit_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'logistics_hub_audit is append-only';
END;
$$;

DROP TRIGGER IF EXISTS trg_logistics_hub_audit_immutable ON public.logistics_hub_audit;
CREATE TRIGGER trg_logistics_hub_audit_immutable
  BEFORE UPDATE OR DELETE ON public.logistics_hub_audit
  FOR EACH ROW EXECUTE FUNCTION public._logistics_hub_audit_immutable();

/* ------------------------------ hub upsert -------------------------------- */
CREATE OR REPLACE FUNCTION public.logistics_hub_upsert(
  _id uuid,
  _code text,
  _name text,
  _hub_type text,
  _city text DEFAULT NULL,
  _address text DEFAULT NULL,
  _lat numeric DEFAULT NULL,
  _lng numeric DEFAULT NULL,
  _region text DEFAULT NULL,
  _country_code text DEFAULT 'KE',
  _service_area jsonb DEFAULT '[]'::jsonb,
  _operating_hours jsonb DEFAULT '{}'::jsonb,
  _capabilities text[] DEFAULT '{}'::text[],
  _capacity jsonb DEFAULT '{}'::jsonb,
  _contact_name text DEFAULT NULL,
  _contact_phone text DEFAULT NULL,
  _contact_email text DEFAULT NULL,
  _responsible_operator_id uuid DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF NOT public.has_any_role(v_actor, ARRAY['admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  IF coalesce(trim(_code), '') = '' OR coalesce(trim(_name), '') = '' THEN
    RAISE EXCEPTION 'code_and_name_required';
  END IF;

  IF _id IS NOT NULL THEN
    SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
    IF v_before IS NULL THEN
      RAISE EXCEPTION 'hub_not_found';
    END IF;
  END IF;

  IF _id IS NULL THEN
    INSERT INTO public.logistics_hubs (
      code, name, hub_type, city, address, lat, lng, region, country_code,
      service_area, operating_hours, capabilities, capacity,
      contact_name, contact_phone, contact_email, responsible_operator_id, notes, created_by
    ) VALUES (
      upper(trim(_code)), trim(_name), _hub_type, _city, _address, _lat, _lng, _region,
      coalesce(_country_code, 'KE'), coalesce(_service_area, '[]'::jsonb),
      coalesce(_operating_hours, '{}'::jsonb), coalesce(_capabilities, '{}'::text[]),
      coalesce(_capacity, '{}'::jsonb), _contact_name, _contact_phone, _contact_email,
      _responsible_operator_id, _notes, v_actor
    )
    RETURNING * INTO v_row;
  ELSE
    UPDATE public.logistics_hubs SET
      code = upper(trim(_code)),
      name = trim(_name),
      hub_type = _hub_type,
      city = _city,
      address = _address,
      lat = _lat,
      lng = _lng,
      region = _region,
      country_code = coalesce(_country_code, 'KE'),
      service_area = coalesce(_service_area, '[]'::jsonb),
      operating_hours = coalesce(_operating_hours, '{}'::jsonb),
      capabilities = coalesce(_capabilities, '{}'::text[]),
      capacity = coalesce(_capacity, '{}'::jsonb),
      contact_name = _contact_name,
      contact_phone = _contact_phone,
      contact_email = _contact_email,
      responsible_operator_id = _responsible_operator_id,
      notes = _notes
    WHERE id = _id
    RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.logistics_hub_audit (hub_id, action, actor_id, before_state, after_state)
  VALUES (v_row.id, CASE WHEN _id IS NULL THEN 'created' ELSE 'updated' END,
          v_actor, v_before, to_jsonb(v_row));

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_hub_upsert(uuid, text, text, text, text, text, numeric, numeric, text, text, jsonb, jsonb, text[], jsonb, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_hub_upsert(uuid, text, text, text, text, text, numeric, numeric, text, text, jsonb, jsonb, text[], jsonb, text, text, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_hub_upsert(uuid, text, text, text, text, text, numeric, numeric, text, text, jsonb, jsonb, text[], jsonb, text, text, text, uuid, text) TO service_role;

/* ---------------------------- hub activation ------------------------------ */
CREATE OR REPLACE FUNCTION public.logistics_hub_set_active(_id uuid, _active boolean)
RETURNS public.logistics_hubs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_before jsonb;
  v_row public.logistics_hubs;
BEGIN
  IF NOT public.has_any_role(v_actor, ARRAY['admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'not_authorised';
  END IF;

  SELECT to_jsonb(h) INTO v_before FROM public.logistics_hubs h WHERE h.id = _id;
  IF v_before IS NULL THEN
    RAISE EXCEPTION 'hub_not_found';
  END IF;

  UPDATE public.logistics_hubs SET active = _active WHERE id = _id RETURNING * INTO v_row;

  INSERT INTO public.logistics_hub_audit (hub_id, action, actor_id, before_state, after_state)
  VALUES (v_row.id, CASE WHEN _active THEN 'activated' ELSE 'deactivated' END,
          v_actor, v_before, to_jsonb(v_row));

  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.logistics_hub_set_active(uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.logistics_hub_set_active(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.logistics_hub_set_active(uuid, boolean) TO service_role;