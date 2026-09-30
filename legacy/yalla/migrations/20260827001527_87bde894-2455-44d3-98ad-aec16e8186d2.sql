-- ============================================================
-- Freight & fulfilment enquiry pipeline (enquiry-only services)
-- ============================================================

CREATE TABLE public.logistics_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE
    DEFAULT 'ENQ-' || to_char(now(), 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6)),
  -- What was asked for. Offering codes are validated by the edge function
  -- against the shared logistics catalogue (ENQUIRY_ONLY offerings only).
  offering_code text NOT NULL,
  service_label text,
  -- Who is asking. contact_user_id is derived server-side from the bearer
  -- token; it is never accepted from the request body.
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  company_name text,
  contact_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Shipment facts.
  origin_label text NOT NULL,
  destination_label text NOT NULL,
  cargo_description text NOT NULL,
  goods_code text,
  weight_kg numeric(12,2),
  volume_cbm numeric(12,2),
  shipment_frequency text NOT NULL DEFAULT 'ONE_OFF',
  target_date date,
  budget_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  requirements text,
  -- Provenance and triage.
  source_page text,
  spam_score integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'received',
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  respond_by timestamptz NOT NULL DEFAULT now() + interval '1 day',
  acknowledged_at timestamptz,
  closed_at timestamptz,
  outcome text,
  triage_notes text,
  is_test boolean NOT NULL DEFAULT false,
  status_changed_at timestamptz NOT NULL DEFAULT now(),
  status_changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT logistics_enquiries_status_chk CHECK (
    status IN ('received','acknowledged','qualifying','quoted','won','lost','closed','spam')
  ),
  CONSTRAINT logistics_enquiries_frequency_chk CHECK (
    shipment_frequency IN ('ONE_OFF','WEEKLY','MONTHLY','CONTRACT')
  ),
  CONSTRAINT logistics_enquiries_weight_chk CHECK (weight_kg IS NULL OR weight_kg > 0),
  CONSTRAINT logistics_enquiries_volume_chk CHECK (volume_cbm IS NULL OR volume_cbm > 0)
);

CREATE TABLE public.logistics_enquiry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enquiry_id uuid NOT NULL REFERENCES public.logistics_enquiries(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  note text,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX logistics_enquiries_triage_idx
  ON public.logistics_enquiries (status, respond_by)
  WHERE is_test = false;
CREATE INDEX logistics_enquiries_created_idx ON public.logistics_enquiries (created_at DESC);
CREATE INDEX logistics_enquiries_owner_idx ON public.logistics_enquiries (owner_id, status);
CREATE INDEX logistics_enquiries_contact_idx ON public.logistics_enquiries (contact_user_id, created_at DESC);
CREATE INDEX logistics_enquiry_events_enquiry_idx ON public.logistics_enquiry_events (enquiry_id, created_at DESC);

-- ---------------- Grants (Data API access) ----------------
GRANT SELECT, UPDATE ON public.logistics_enquiries TO authenticated;
GRANT ALL ON public.logistics_enquiries TO service_role;
GRANT SELECT, INSERT ON public.logistics_enquiry_events TO authenticated;
GRANT ALL ON public.logistics_enquiry_events TO service_role;

-- ---------------- RLS ----------------
ALTER TABLE public.logistics_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_enquiry_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "enquiry_owner_read"
  ON public.logistics_enquiries FOR SELECT TO authenticated
  USING (contact_user_id = auth.uid());

CREATE POLICY "enquiry_staff_read"
  ON public.logistics_enquiries FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','dispatch_manager','general_manager','director']::app_role[]));

CREATE POLICY "enquiry_staff_update"
  ON public.logistics_enquiries FOR UPDATE TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','dispatch_manager','general_manager','director']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','dispatch_manager','general_manager','director']::app_role[]));

CREATE POLICY "enquiry_events_read"
  ON public.logistics_enquiry_events FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','dispatch_manager','general_manager','director']::app_role[])
    OR EXISTS (
      SELECT 1 FROM public.logistics_enquiries e
      WHERE e.id = logistics_enquiry_events.enquiry_id AND e.contact_user_id = auth.uid()
    )
  );

CREATE POLICY "enquiry_events_staff_insert"
  ON public.logistics_enquiry_events FOR INSERT TO authenticated
  WITH CHECK (
    public.has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','dispatch_manager','general_manager','director']::app_role[])
    AND (actor_id IS NULL OR actor_id = auth.uid())
  );

-- ---------------- Immutability of the event ledger ----------------
CREATE OR REPLACE FUNCTION public.tg_logistics_enquiry_events_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% on public.logistics_enquiry_events is not allowed: records are immutable', TG_OP;
END;
$$;

CREATE TRIGGER logistics_enquiry_events_no_update
  BEFORE UPDATE OR DELETE ON public.logistics_enquiry_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_logistics_enquiry_events_immutable();

-- ---------------- Status change capture ----------------
CREATE OR REPLACE FUNCTION public.tg_logistics_enquiry_touch()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at := now();
    NEW.status_changed_by := auth.uid();
    IF NEW.status = 'acknowledged' AND NEW.acknowledged_at IS NULL THEN
      NEW.acknowledged_at := now();
    END IF;
    IF NEW.status IN ('won','lost','closed') AND NEW.closed_at IS NULL THEN
      NEW.closed_at := now();
    END IF;
    INSERT INTO public.logistics_enquiry_events (enquiry_id, event_type, from_status, to_status, actor_id, note)
    VALUES (NEW.id, 'status_changed', OLD.status, NEW.status, auth.uid(), NEW.triage_notes);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER logistics_enquiries_touch
  BEFORE UPDATE ON public.logistics_enquiries
  FOR EACH ROW EXECUTE FUNCTION public.tg_logistics_enquiry_touch();

CREATE OR REPLACE FUNCTION public.tg_logistics_enquiry_received()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.logistics_enquiry_events (enquiry_id, event_type, to_status, actor_id, note)
  VALUES (NEW.id, 'received', NEW.status, NEW.contact_user_id, NEW.source_page);
  RETURN NEW;
END;
$$;

CREATE TRIGGER logistics_enquiries_received
  AFTER INSERT ON public.logistics_enquiries
  FOR EACH ROW EXECUTE FUNCTION public.tg_logistics_enquiry_received();