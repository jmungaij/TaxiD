-- ============================================================================
-- PROVIDER CAPACITY — the supply side of the marketplace.
-- Operators publish capacity; staff approve it; the marketplace only ever
-- shows what has been approved and published. No listing can be created,
-- edited, approved or published except through the functions below.
-- ============================================================================

CREATE TABLE public.provider_capacity (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_user_id  uuid NOT NULL,
  provider_name     text NOT NULL,
  provider_kind     text NOT NULL CHECK (provider_kind IN ('DRIVER','FLEET_OPERATOR','CHARTER_OPERATOR','LOGISTICS_OPERATOR')),
  family            text NOT NULL CHECK (family IN ('ride','charter','rental','logistics')),
  title             text NOT NULL,
  vehicle_type      text NOT NULL,
  spec              text,
  seats             integer CHECK (seats IS NULL OR seats >= 0),
  units             integer NOT NULL DEFAULT 1 CHECK (units >= 1),
  base_city         text NOT NULL,
  coverage_area     text,
  rate_amount       numeric(14,2) CHECK (rate_amount IS NULL OR rate_amount >= 0),
  rate_basis        text NOT NULL DEFAULT 'per_day' CHECK (rate_basis IN ('per_trip','per_hour','per_day','per_km','per_tonne','on_request')),
  currency          text NOT NULL DEFAULT 'KES',
  available_from    date,
  available_to      date,
  registration_ref  text,
  notes             text,
  status            text NOT NULL DEFAULT 'DRAFT'
                    CHECK (status IN ('DRAFT','PENDING_APPROVAL','APPROVED','PUBLISHED','SENT_BACK','RETIRED')),
  submitted_at      timestamptz,
  submitted_by      uuid,
  decided_at        timestamptz,
  decided_by        uuid,
  decision_reason   text,
  published_at      timestamptz,
  retired_at        timestamptz,
  is_test           boolean NOT NULL DEFAULT false,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX provider_capacity_provider_idx ON public.provider_capacity (provider_user_id, status);
CREATE INDEX provider_capacity_public_idx   ON public.provider_capacity (family, base_city) WHERE status = 'PUBLISHED' AND is_test = false;

GRANT SELECT ON public.provider_capacity TO anon;
GRANT SELECT ON public.provider_capacity TO authenticated;
GRANT ALL    ON public.provider_capacity TO service_role;
ALTER TABLE public.provider_capacity ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.provider_capacity_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_id  uuid NOT NULL REFERENCES public.provider_capacity(id) ON DELETE CASCADE,
  action       text NOT NULL,
  status_from  text,
  status_to    text,
  reason       text,
  actor_id     uuid,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX provider_capacity_events_capacity_idx ON public.provider_capacity_events (capacity_id, created_at DESC);

GRANT SELECT ON public.provider_capacity_events TO authenticated;
GRANT ALL    ON public.provider_capacity_events TO service_role;
ALTER TABLE public.provider_capacity_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.capacity_enquiries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  capacity_id       uuid NOT NULL REFERENCES public.provider_capacity(id) ON DELETE CASCADE,
  lead_ref          text,
  requester_user_id uuid,
  organisation_name text,
  contact_name      text,
  service_date      date,
  passengers        integer CHECK (passengers IS NULL OR passengers >= 0),
  requirement       text,
  status            text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','ACKNOWLEDGED','CLOSED')),
  provider_note     text,
  acknowledged_at   timestamptz,
  closed_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX capacity_enquiries_capacity_idx  ON public.capacity_enquiries (capacity_id, created_at DESC);
CREATE INDEX capacity_enquiries_requester_idx ON public.capacity_enquiries (requester_user_id);

GRANT SELECT ON public.capacity_enquiries TO authenticated;
GRANT ALL    ON public.capacity_enquiries TO service_role;
ALTER TABLE public.capacity_enquiries ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Authority helpers
-- ---------------------------------------------------------------------------

-- An operator is accredited when their own record already exists on the
-- platform: an approved driver application, a registered driver record, or a
-- carrier profile they registered. Self-declared providers are never accredited.
CREATE OR REPLACE FUNCTION public.provider_is_accredited(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.driver_applications da
             WHERE da.applicant_user_id = _user_id AND da.status = 'APPROVED')
    OR EXISTS (SELECT 1 FROM public.drivers d WHERE d.user_id = _user_id)
    OR EXISTS (SELECT 1 FROM public.carrier_profiles cp WHERE cp.created_by = _user_id)
  );
$$;

CREATE OR REPLACE FUNCTION public.capacity_can_approve(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR public.has_role(_user_id, 'super_admin'::app_role)
    OR public.has_staff_permission('staff.logistics.manage')
  );
$$;

CREATE OR REPLACE FUNCTION public.capacity_is_platform_admin(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _user_id IS NOT NULL AND (
    public.has_role(_user_id, 'admin'::app_role)
    OR public.has_role(_user_id, 'super_admin'::app_role)
  );
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

CREATE POLICY provider_capacity_public_read ON public.provider_capacity
  FOR SELECT TO anon, authenticated
  USING (status = 'PUBLISHED' AND is_test = false);

CREATE POLICY provider_capacity_own_read ON public.provider_capacity
  FOR SELECT TO authenticated
  USING (provider_user_id = auth.uid());

CREATE POLICY provider_capacity_staff_read ON public.provider_capacity
  FOR SELECT TO authenticated
  USING (public.capacity_can_approve(auth.uid()));

CREATE POLICY provider_capacity_events_read ON public.provider_capacity_events
  FOR SELECT TO authenticated
  USING (
    public.capacity_can_approve(auth.uid())
    OR EXISTS (SELECT 1 FROM public.provider_capacity pc
                WHERE pc.id = capacity_id AND pc.provider_user_id = auth.uid())
  );

CREATE POLICY capacity_enquiries_read ON public.capacity_enquiries
  FOR SELECT TO authenticated
  USING (
    requester_user_id = auth.uid()
    OR public.capacity_can_approve(auth.uid())
    OR EXISTS (SELECT 1 FROM public.provider_capacity pc
                WHERE pc.id = capacity_id AND pc.provider_user_id = auth.uid())
  );

-- History is permanent.
CREATE OR REPLACE FUNCTION public._provider_capacity_events_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'CAPACITY_HISTORY_IS_PERMANENT';
END;
$$;
CREATE TRIGGER provider_capacity_events_append_only
  BEFORE UPDATE OR DELETE ON public.provider_capacity_events
  FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_events_append_only();

CREATE OR REPLACE FUNCTION public._provider_capacity_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER provider_capacity_touch BEFORE UPDATE ON public.provider_capacity
  FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_touch();
CREATE TRIGGER capacity_enquiries_touch BEFORE UPDATE ON public.capacity_enquiries
  FOR EACH ROW EXECUTE FUNCTION public._provider_capacity_touch();

-- ---------------------------------------------------------------------------
-- Operator writes
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.provider_capacity_save(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_id  uuid := NULLIF(p->>'id','')::uuid;
  v_row public.provider_capacity;
  v_new boolean := false;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.provider_is_accredited(v_uid) THEN RAISE EXCEPTION 'PROVIDER_NOT_ACCREDITED'; END IF;

  IF coalesce(p->>'provider_name','') = ''
     OR coalesce(p->>'title','') = ''
     OR coalesce(p->>'vehicle_type','') = ''
     OR coalesce(p->>'base_city','') = '' THEN
    RAISE EXCEPTION 'INCOMPLETE_CAPACITY_RECORD';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.provider_capacity (
      provider_user_id, provider_name, provider_kind, family, title, vehicle_type, spec,
      seats, units, base_city, coverage_area, rate_amount, rate_basis, currency,
      available_from, available_to, registration_ref, notes
    ) VALUES (
      v_uid,
      p->>'provider_name',
      coalesce(p->>'provider_kind','DRIVER'),
      coalesce(p->>'family','ride'),
      p->>'title',
      p->>'vehicle_type',
      NULLIF(p->>'spec',''),
      NULLIF(p->>'seats','')::int,
      coalesce(NULLIF(p->>'units','')::int, 1),
      p->>'base_city',
      NULLIF(p->>'coverage_area',''),
      NULLIF(p->>'rate_amount','')::numeric,
      coalesce(NULLIF(p->>'rate_basis',''),'per_day'),
      coalesce(NULLIF(p->>'currency',''),'KES'),
      NULLIF(p->>'available_from','')::date,
      NULLIF(p->>'available_to','')::date,
      NULLIF(p->>'registration_ref',''),
      NULLIF(p->>'notes','')
    ) RETURNING * INTO v_row;
    v_new := true;
  ELSE
    SELECT * INTO v_row FROM public.provider_capacity WHERE id = v_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_NOT_FOUND'; END IF;
    IF v_row.provider_user_id <> v_uid THEN RAISE EXCEPTION 'NOT_YOUR_CAPACITY'; END IF;
    IF v_row.status NOT IN ('DRAFT','SENT_BACK') THEN RAISE EXCEPTION 'CAPACITY_LOCKED_FOR_EDITING'; END IF;

    UPDATE public.provider_capacity SET
      provider_name   = p->>'provider_name',
      provider_kind   = coalesce(p->>'provider_kind', provider_kind),
      family          = coalesce(p->>'family', family),
      title           = p->>'title',
      vehicle_type    = p->>'vehicle_type',
      spec            = NULLIF(p->>'spec',''),
      seats           = NULLIF(p->>'seats','')::int,
      units           = coalesce(NULLIF(p->>'units','')::int, 1),
      base_city       = p->>'base_city',
      coverage_area   = NULLIF(p->>'coverage_area',''),
      rate_amount     = NULLIF(p->>'rate_amount','')::numeric,
      rate_basis      = coalesce(NULLIF(p->>'rate_basis',''),'per_day'),
      currency        = coalesce(NULLIF(p->>'currency',''),'KES'),
      available_from  = NULLIF(p->>'available_from','')::date,
      available_to    = NULLIF(p->>'available_to','')::date,
      registration_ref= NULLIF(p->>'registration_ref',''),
      notes           = NULLIF(p->>'notes','')
    WHERE id = v_id RETURNING * INTO v_row;
  END IF;

  INSERT INTO public.provider_capacity_events (capacity_id, action, status_to, actor_id)
  VALUES (v_row.id, CASE WHEN v_new THEN 'CREATED' ELSE 'EDITED' END, v_row.status, v_uid);

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_capacity_submit(_capacity_id uuid, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_capacity;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.provider_capacity WHERE id = _capacity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_NOT_FOUND'; END IF;
  IF v_row.provider_user_id <> v_uid THEN RAISE EXCEPTION 'NOT_YOUR_CAPACITY'; END IF;
  IF v_row.status NOT IN ('DRAFT','SENT_BACK') THEN RAISE EXCEPTION 'ONLY_DRAFT_CAPACITY_CAN_BE_SUBMITTED'; END IF;

  UPDATE public.provider_capacity
     SET status = 'PENDING_APPROVAL', submitted_at = now(), submitted_by = v_uid,
         decision_reason = NULL
   WHERE id = _capacity_id RETURNING * INTO v_row;

  INSERT INTO public.provider_capacity_events (capacity_id, action, status_from, status_to, reason, actor_id)
  VALUES (_capacity_id, 'SUBMITTED', 'DRAFT', 'PENDING_APPROVAL', NULLIF(_note,''), v_uid);

  RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status);
END;
$$;

CREATE OR REPLACE FUNCTION public.provider_capacity_retire(_capacity_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_capacity;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF coalesce(_reason,'') = '' THEN RAISE EXCEPTION 'RETIREMENT_REASON_REQUIRED'; END IF;
  SELECT * INTO v_row FROM public.provider_capacity WHERE id = _capacity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_NOT_FOUND'; END IF;
  IF v_row.provider_user_id <> v_uid AND NOT public.capacity_can_approve(v_uid) THEN
    RAISE EXCEPTION 'NOT_AUTHORISED_TO_RETIRE_CAPACITY';
  END IF;
  IF v_row.status = 'RETIRED' THEN RAISE EXCEPTION 'CAPACITY_ALREADY_RETIRED'; END IF;

  UPDATE public.provider_capacity
     SET status = 'RETIRED', retired_at = now(), decision_reason = _reason
   WHERE id = _capacity_id;

  INSERT INTO public.provider_capacity_events (capacity_id, action, status_from, status_to, reason, actor_id)
  VALUES (_capacity_id, 'RETIRED', v_row.status, 'RETIRED', _reason, v_uid);

  RETURN jsonb_build_object('id', _capacity_id, 'status', 'RETIRED');
END;
$$;

-- ---------------------------------------------------------------------------
-- Approval gate: approving publishes; sending back needs a reason; nobody
-- approves their own listing unless they are a platform administrator.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provider_capacity_decide(_capacity_id uuid, _decision text, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.provider_capacity;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF NOT public.capacity_can_approve(v_uid) THEN RAISE EXCEPTION 'CAPACITY_APPROVAL_NOT_PERMITTED'; END IF;
  IF _decision NOT IN ('APPROVE','SEND_BACK') THEN RAISE EXCEPTION 'UNKNOWN_DECISION'; END IF;

  SELECT * INTO v_row FROM public.provider_capacity WHERE id = _capacity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CAPACITY_NOT_FOUND'; END IF;
  IF v_row.status <> 'PENDING_APPROVAL' THEN RAISE EXCEPTION 'CAPACITY_NOT_AWAITING_APPROVAL'; END IF;

  IF _decision = 'APPROVE' THEN
    IF v_row.provider_user_id = v_uid AND NOT public.capacity_is_platform_admin(v_uid) THEN
      RAISE EXCEPTION 'SEPARATE_APPROVER_REQUIRED';
    END IF;
    UPDATE public.provider_capacity
       SET status = 'PUBLISHED', decided_at = now(), decided_by = v_uid,
           decision_reason = NULLIF(_reason,''), published_at = now()
     WHERE id = _capacity_id;
    INSERT INTO public.provider_capacity_events (capacity_id, action, status_from, status_to, reason, actor_id)
    VALUES (_capacity_id, 'APPROVED_AND_PUBLISHED', 'PENDING_APPROVAL', 'PUBLISHED', NULLIF(_reason,''), v_uid);
    RETURN jsonb_build_object('id', _capacity_id, 'status', 'PUBLISHED');
  END IF;

  IF coalesce(_reason,'') = '' THEN RAISE EXCEPTION 'SEND_BACK_REASON_REQUIRED'; END IF;
  UPDATE public.provider_capacity
     SET status = 'SENT_BACK', decided_at = now(), decided_by = v_uid, decision_reason = _reason
   WHERE id = _capacity_id;
  INSERT INTO public.provider_capacity_events (capacity_id, action, status_from, status_to, reason, actor_id)
  VALUES (_capacity_id, 'SENT_BACK', 'PENDING_APPROVAL', 'SENT_BACK', _reason, v_uid);

  RETURN jsonb_build_object('id', _capacity_id, 'status', 'SENT_BACK');
END;
$$;

-- ---------------------------------------------------------------------------
-- Reads
-- ---------------------------------------------------------------------------

-- Public marketplace search. Returns only published, non-test capacity.
CREATE OR REPLACE FUNCTION public.marketplace_capacity_search(p jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', c.id,
           'family', c.family,
           'title', c.title,
           'provider_name', c.provider_name,
           'provider_kind', c.provider_kind,
           'vehicle_type', c.vehicle_type,
           'spec', c.spec,
           'seats', c.seats,
           'units', c.units,
           'base_city', c.base_city,
           'coverage_area', c.coverage_area,
           'rate_amount', c.rate_amount,
           'rate_basis', c.rate_basis,
           'currency', c.currency,
           'available_from', c.available_from,
           'available_to', c.available_to,
           'published_at', c.published_at
         ) ORDER BY c.rate_amount NULLS LAST, c.title), '[]'::jsonb)
  FROM public.provider_capacity c
  WHERE c.status = 'PUBLISHED'
    AND c.is_test = false
    AND (coalesce(p->>'family','') = '' OR c.family = p->>'family')
    AND (coalesce(p->>'city','')   = '' OR c.base_city ILIKE '%' || (p->>'city') || '%'
                                        OR coalesce(c.coverage_area,'') ILIKE '%' || (p->>'city') || '%')
    AND (coalesce(p->>'vehicle_type','') = '' OR c.vehicle_type ILIKE '%' || (p->>'vehicle_type') || '%')
    AND (coalesce(p->>'seats','') = '' OR coalesce(c.seats, 0) >= (p->>'seats')::int)
    AND (coalesce(p->>'date','') = '' OR (
          (c.available_from IS NULL OR (p->>'date')::date >= c.available_from) AND
          (c.available_to   IS NULL OR (p->>'date')::date <= c.available_to)));
$$;

-- The operator's own portal: their capacity, their enquiries, their numbers.
CREATE OR REPLACE FUNCTION public.provider_capacity_portal()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_out jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;

  SELECT jsonb_build_object(
    'accredited', public.provider_is_accredited(v_uid),
    'can_approve', public.capacity_can_approve(v_uid),
    'summary', (
      SELECT jsonb_build_object(
        'total',      count(*),
        'published',  count(*) FILTER (WHERE status = 'PUBLISHED'),
        'awaiting',   count(*) FILTER (WHERE status = 'PENDING_APPROVAL'),
        'drafts',     count(*) FILTER (WHERE status IN ('DRAFT','SENT_BACK')),
        'retired',    count(*) FILTER (WHERE status = 'RETIRED'),
        'units_live', coalesce(sum(units) FILTER (WHERE status = 'PUBLISHED'), 0)
      ) FROM public.provider_capacity WHERE provider_user_id = v_uid
    ),
    'capacity', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'family', c.family, 'title', c.title, 'provider_name', c.provider_name,
        'provider_kind', c.provider_kind, 'vehicle_type', c.vehicle_type, 'spec', c.spec,
        'seats', c.seats, 'units', c.units, 'base_city', c.base_city, 'coverage_area', c.coverage_area,
        'rate_amount', c.rate_amount, 'rate_basis', c.rate_basis, 'currency', c.currency,
        'available_from', c.available_from, 'available_to', c.available_to,
        'registration_ref', c.registration_ref, 'notes', c.notes, 'status', c.status,
        'decision_reason', c.decision_reason, 'submitted_at', c.submitted_at,
        'published_at', c.published_at, 'created_at', c.created_at,
        'enquiry_count', (SELECT count(*) FROM public.capacity_enquiries e WHERE e.capacity_id = c.id),
        'open_enquiries', (SELECT count(*) FROM public.capacity_enquiries e WHERE e.capacity_id = c.id AND e.status <> 'CLOSED'),
        'history', (
          SELECT coalesce(jsonb_agg(jsonb_build_object(
            'action', ev.action, 'status_to', ev.status_to, 'reason', ev.reason, 'created_at', ev.created_at
          ) ORDER BY ev.created_at DESC), '[]'::jsonb)
          FROM public.provider_capacity_events ev WHERE ev.capacity_id = c.id
        )
      ) ORDER BY c.created_at DESC), '[]'::jsonb)
      FROM public.provider_capacity c WHERE c.provider_user_id = v_uid
    ),
    'enquiries', (
      SELECT coalesce(jsonb_agg(jsonb_build_object(
        'id', e.id, 'capacity_id', e.capacity_id, 'capacity_title', c.title,
        'lead_ref', e.lead_ref, 'organisation_name', e.organisation_name,
        'contact_name', e.contact_name, 'service_date', e.service_date,
        'passengers', e.passengers, 'requirement', e.requirement,
        'status', e.status, 'provider_note', e.provider_note, 'created_at', e.created_at
      ) ORDER BY e.created_at DESC), '[]'::jsonb)
      FROM public.capacity_enquiries e
      JOIN public.provider_capacity c ON c.id = e.capacity_id
      WHERE c.provider_user_id = v_uid
    ),
    'awaiting_review', (
      SELECT CASE WHEN public.capacity_can_approve(v_uid) THEN coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'family', c.family, 'title', c.title, 'provider_name', c.provider_name,
        'vehicle_type', c.vehicle_type, 'seats', c.seats, 'units', c.units,
        'base_city', c.base_city, 'rate_amount', c.rate_amount, 'rate_basis', c.rate_basis,
        'currency', c.currency, 'submitted_at', c.submitted_at, 'is_own', c.provider_user_id = v_uid
      ) ORDER BY c.submitted_at), '[]'::jsonb) ELSE '[]'::jsonb END
      FROM public.provider_capacity c WHERE c.status = 'PENDING_APPROVAL'
    )
  ) INTO v_out;

  RETURN v_out;
END;
$$;

-- ---------------------------------------------------------------------------
-- Enquiries: a customer asking for a specific listing from the marketplace.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.capacity_enquiry_record(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_capacity uuid := NULLIF(p->>'capacity_id','')::uuid;
  v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF v_capacity IS NULL THEN RAISE EXCEPTION 'CAPACITY_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.provider_capacity
                  WHERE id = v_capacity AND status = 'PUBLISHED' AND is_test = false) THEN
    RAISE EXCEPTION 'CAPACITY_NOT_AVAILABLE';
  END IF;

  INSERT INTO public.capacity_enquiries (
    capacity_id, lead_ref, requester_user_id, organisation_name, contact_name,
    service_date, passengers, requirement
  ) VALUES (
    v_capacity, NULLIF(p->>'lead_ref',''), v_uid,
    NULLIF(p->>'organisation_name',''), NULLIF(p->>'contact_name',''),
    NULLIF(p->>'service_date','')::date, NULLIF(p->>'passengers','')::int,
    NULLIF(p->>'requirement','')
  ) RETURNING id INTO v_id;

  RETURN jsonb_build_object('id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.capacity_enquiry_update(_enquiry_id uuid, _status text, _note text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner uuid;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'AUTHENTICATION_REQUIRED'; END IF;
  IF _status NOT IN ('ACKNOWLEDGED','CLOSED') THEN RAISE EXCEPTION 'UNKNOWN_ENQUIRY_STATUS'; END IF;

  SELECT c.provider_user_id INTO v_owner
    FROM public.capacity_enquiries e JOIN public.provider_capacity c ON c.id = e.capacity_id
   WHERE e.id = _enquiry_id;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'ENQUIRY_NOT_FOUND'; END IF;
  IF v_owner <> v_uid AND NOT public.capacity_can_approve(v_uid) THEN
    RAISE EXCEPTION 'NOT_YOUR_ENQUIRY';
  END IF;

  UPDATE public.capacity_enquiries
     SET status = _status,
         provider_note = coalesce(NULLIF(_note,''), provider_note),
         acknowledged_at = CASE WHEN _status = 'ACKNOWLEDGED' THEN now() ELSE acknowledged_at END,
         closed_at = CASE WHEN _status = 'CLOSED' THEN now() ELSE closed_at END
   WHERE id = _enquiry_id;

  RETURN jsonb_build_object('id', _enquiry_id, 'status', _status);
END;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants: deny by default, anon only for the public search.
-- ---------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.provider_capacity_save(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_capacity_submit(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_capacity_retire(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_capacity_decide(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_capacity_portal() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacity_enquiry_record(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacity_enquiry_update(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketplace_capacity_search(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.provider_is_accredited(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacity_can_approve(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.capacity_is_platform_admin(uuid) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.provider_capacity_save(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_capacity_submit(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_capacity_retire(uuid, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_capacity_decide(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_capacity_portal() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capacity_enquiry_record(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capacity_enquiry_update(uuid, text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.marketplace_capacity_search(jsonb) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.provider_is_accredited(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capacity_can_approve(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.capacity_is_platform_admin(uuid) TO authenticated, service_role;