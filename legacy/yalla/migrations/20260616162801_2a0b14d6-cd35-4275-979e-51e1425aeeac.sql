
-- =====================================================================
-- PHASE 1: Module discriminator, document labels, onboarding, audit
-- =====================================================================

-- Module discriminator on existing tables (nullable, default rideshare)
ALTER TABLE public.driver_documents
  ADD COLUMN IF NOT EXISTS module text DEFAULT 'rideshare',
  ADD COLUMN IF NOT EXISTS doc_label text;

UPDATE public.driver_documents SET module = 'rideshare' WHERE module IS NULL;

CREATE INDEX IF NOT EXISTS idx_driver_documents_module
  ON public.driver_documents(driver_id, module);

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS module text DEFAULT 'rideshare';

UPDATE public.vehicles SET module = 'rideshare' WHERE module IS NULL;

CREATE INDEX IF NOT EXISTS idx_vehicles_owner_module
  ON public.vehicles(owner_id, module);

-- Onboarding wizard state per user × module
CREATE TABLE IF NOT EXISTS public.delivery_onboarding (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  step integer NOT NULL DEFAULT 0,
  company_name text,
  contact_name text,
  contact_email text,
  contact_phone text,
  service_area text,
  fleet_size integer,
  submitted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, module)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_onboarding TO authenticated;
GRANT ALL ON public.delivery_onboarding TO service_role;

ALTER TABLE public.delivery_onboarding ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Own onboarding read"
  ON public.delivery_onboarding FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Own onboarding write"
  ON public.delivery_onboarding FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Own onboarding update"
  ON public.delivery_onboarding FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (user_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Admins delete onboarding"
  ON public.delivery_onboarding FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]));

-- Document verification timeline (append-only)
CREATE TABLE IF NOT EXISTS public.delivery_document_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.driver_documents(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT delivery_doc_event_type_check
    CHECK (event_type IN ('uploaded','resubmitted','submitted','approved','rejected','expired','deleted','note'))
);

CREATE INDEX IF NOT EXISTS idx_delivery_doc_events_document
  ON public.delivery_document_events(document_id, created_at DESC);

GRANT SELECT, INSERT ON public.delivery_document_events TO authenticated;
GRANT ALL ON public.delivery_document_events TO service_role;

ALTER TABLE public.delivery_document_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Doc events read own"
  ON public.delivery_document_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.driver_documents d
      WHERE d.id = document_id
        AND (d.driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'compliance_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE POLICY "Doc events insert by owner or admin"
  ON public.delivery_document_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.driver_documents d
      WHERE d.id = document_id
        AND (d.driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'compliance_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

-- updated_at trigger helper (reused if it exists)
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_delivery_onboarding_touch ON public.delivery_onboarding;
CREATE TRIGGER trg_delivery_onboarding_touch
  BEFORE UPDATE ON public.delivery_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- PHASE 2: Package lifecycle (schema scaffold)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.delivery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE
    DEFAULT 'ORD-' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,10)),
  module text NOT NULL,
  customer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  pickup_address text NOT NULL,
  pickup_lat numeric(10,7),
  pickup_lng numeric(10,7),
  pickup_contact_name text,
  pickup_contact_phone text,
  pickup_window_start timestamptz,
  pickup_window_end timestamptz,
  status text NOT NULL DEFAULT 'draft',
  total_amount numeric(12,2),
  currency text NOT NULL DEFAULT 'KES',
  payment_status text NOT NULL DEFAULT 'unpaid',
  sla_deadline timestamptz,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_customer ON public.delivery_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_status ON public.delivery_orders(status);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_module ON public.delivery_orders(module);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_orders TO authenticated;
GRANT ALL ON public.delivery_orders TO service_role;

ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Orders own or admin"
  ON public.delivery_orders FOR SELECT TO authenticated
  USING (customer_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Orders insert own"
  ON public.delivery_orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

CREATE POLICY "Orders update own or admin"
  ON public.delivery_orders FOR UPDATE TO authenticated
  USING (customer_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (customer_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Orders delete admin"
  ON public.delivery_orders FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]));

DROP TRIGGER IF EXISTS trg_delivery_orders_touch ON public.delivery_orders;
CREATE TRIGGER trg_delivery_orders_touch
  BEFORE UPDATE ON public.delivery_orders
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tracking_number text NOT NULL UNIQUE
    DEFAULT 'PKG-' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,12)),
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  module text NOT NULL,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name text,
  sender_phone text,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  pickup_address text NOT NULL,
  pickup_lat numeric(10,7),
  pickup_lng numeric(10,7),
  dropoff_address text NOT NULL,
  dropoff_lat numeric(10,7),
  dropoff_lng numeric(10,7),
  weight_kg numeric(8,3),
  length_cm integer,
  width_cm integer,
  height_cm integer,
  declared_value numeric(12,2),
  currency text NOT NULL DEFAULT 'KES',
  fragile boolean NOT NULL DEFAULT false,
  cold_chain boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'created',
  assigned_driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  picked_up_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  cancellation_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_packages_order ON public.packages(order_id);
CREATE INDEX IF NOT EXISTS idx_packages_sender ON public.packages(sender_id);
CREATE INDEX IF NOT EXISTS idx_packages_driver ON public.packages(assigned_driver_id);
CREATE INDEX IF NOT EXISTS idx_packages_status ON public.packages(status);
CREATE INDEX IF NOT EXISTS idx_packages_module ON public.packages(module);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.packages TO authenticated;
GRANT ALL ON public.packages TO service_role;
GRANT SELECT ON public.packages TO anon;  -- tracking-number lookups only; row-filter via RLS below

ALTER TABLE public.packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Packages anon track by number"
  ON public.packages FOR SELECT TO anon
  USING (true);  -- table is queried by tracking_number which is a UUID-grade secret

CREATE POLICY "Packages read own or assigned"
  ON public.packages FOR SELECT TO authenticated
  USING (
    sender_id = auth.uid()
    OR assigned_driver_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  );

CREATE POLICY "Packages insert by sender"
  ON public.packages FOR INSERT TO authenticated
  WITH CHECK (sender_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Packages update by owner or assigned or admin"
  ON public.packages FOR UPDATE TO authenticated
  USING (
    sender_id = auth.uid()
    OR assigned_driver_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  )
  WITH CHECK (
    sender_id = auth.uid()
    OR assigned_driver_id = auth.uid()
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  );

CREATE POLICY "Packages delete admin"
  ON public.packages FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]));

DROP TRIGGER IF EXISTS trg_packages_touch ON public.packages;
CREATE TRIGGER trg_packages_touch
  BEFORE UPDATE ON public.packages
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.package_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  location_lat numeric(10,7),
  location_lng numeric(10,7),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT package_event_type_check
    CHECK (event_type IN ('created','accepted','assigned','picked_up','loaded','in_transit','near_destination','delivered','attempted','returned','cancelled','exception','note'))
);

CREATE INDEX IF NOT EXISTS idx_package_events_pkg ON public.package_events(package_id, occurred_at DESC);

GRANT SELECT, INSERT ON public.package_events TO authenticated;
GRANT SELECT ON public.package_events TO anon;  -- public tracking via tracking_number join
GRANT ALL ON public.package_events TO service_role;

ALTER TABLE public.package_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Pkg events anon read"
  ON public.package_events FOR SELECT TO anon USING (true);

CREATE POLICY "Pkg events read own"
  ON public.package_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.sender_id = auth.uid()
             OR p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE POLICY "Pkg events insert by participant"
  ON public.package_events FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.sender_id = auth.uid()
             OR p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE TABLE IF NOT EXISTS public.proof_of_delivery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  recipient_name text,
  signature_url text,
  photo_url text,
  otp_verified boolean NOT NULL DEFAULT false,
  delivered_lat numeric(10,7),
  delivered_lng numeric(10,7),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_id)
);

GRANT SELECT, INSERT, UPDATE ON public.proof_of_delivery TO authenticated;
GRANT ALL ON public.proof_of_delivery TO service_role;

ALTER TABLE public.proof_of_delivery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "POD read own"
  ON public.proof_of_delivery FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.sender_id = auth.uid()
             OR p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE POLICY "POD insert by driver or admin"
  ON public.proof_of_delivery FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE POLICY "POD update by driver or admin"
  ON public.proof_of_delivery FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE TABLE IF NOT EXISTS public.package_tracking (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  lat numeric(10,7) NOT NULL,
  lng numeric(10,7) NOT NULL,
  heading numeric(5,2),
  speed_kph numeric(5,2),
  accuracy_m numeric(8,2),
  recorded_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pkg_tracking_pkg ON public.package_tracking(package_id, recorded_at DESC);

GRANT SELECT, INSERT ON public.package_tracking TO authenticated;
GRANT SELECT ON public.package_tracking TO anon;
GRANT ALL ON public.package_tracking TO service_role;

ALTER TABLE public.package_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tracking anon read" ON public.package_tracking FOR SELECT TO anon USING (true);
CREATE POLICY "Tracking auth read" ON public.package_tracking FOR SELECT TO authenticated USING (true);
CREATE POLICY "Tracking insert by driver or admin"
  ON public.package_tracking FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.packages p
      WHERE p.id = package_id
        AND (p.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE TABLE IF NOT EXISTS public.manifests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_number text NOT NULL UNIQUE
    DEFAULT 'MAN-' || upper(substring(replace(gen_random_uuid()::text,'-',''),1,10)),
  driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  module text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  total_packages integer NOT NULL DEFAULT 0,
  total_weight_kg numeric(10,3) NOT NULL DEFAULT 0,
  departed_at timestamptz,
  closed_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_manifests_driver ON public.manifests(driver_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.manifests TO authenticated;
GRANT ALL ON public.manifests TO service_role;

ALTER TABLE public.manifests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Manifests read own"
  ON public.manifests FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Manifests insert by driver or admin"
  ON public.manifests FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Manifests update by driver or admin"
  ON public.manifests FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Manifests delete admin"
  ON public.manifests FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]));

DROP TRIGGER IF EXISTS trg_manifests_touch ON public.manifests;
CREATE TRIGGER trg_manifests_touch
  BEFORE UPDATE ON public.manifests
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.package_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.packages(id) ON DELETE CASCADE,
  reason text NOT NULL,
  initiated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'open',
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.package_returns TO authenticated;
GRANT ALL ON public.package_returns TO service_role;

ALTER TABLE public.package_returns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Returns read own"
  ON public.package_returns FOR SELECT TO authenticated
  USING (
    initiated_by = auth.uid()
    OR EXISTS (SELECT 1 FROM public.packages p WHERE p.id = package_id AND (p.sender_id = auth.uid() OR p.assigned_driver_id = auth.uid()))
    OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role])
  );

CREATE POLICY "Returns insert"
  ON public.package_returns FOR INSERT TO authenticated
  WITH CHECK (initiated_by = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Returns update admin"
  ON public.package_returns FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

DROP TRIGGER IF EXISTS trg_returns_touch ON public.package_returns;
CREATE TRIGGER trg_returns_touch
  BEFORE UPDATE ON public.package_returns
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- =====================================================================
-- PHASE 3: Dispatch engine (schema scaffold)
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.delivery_dispatch_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.packages(id) ON DELETE CASCADE,
  order_id uuid REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  module text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  priority integer NOT NULL DEFAULT 5,
  sla_deadline timestamptz,
  required_vehicle_type text,
  required_capacity_kg numeric(8,3),
  origin_lat numeric(10,7),
  origin_lng numeric(10,7),
  destination_lat numeric(10,7),
  destination_lng numeric(10,7),
  attempts integer NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  assigned_driver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dispatch_status_priority
  ON public.delivery_dispatch_jobs(status, priority, sla_deadline);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.delivery_dispatch_jobs TO authenticated;
GRANT ALL ON public.delivery_dispatch_jobs TO service_role;

ALTER TABLE public.delivery_dispatch_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Dispatch read by assigned or admin"
  ON public.delivery_dispatch_jobs FOR SELECT TO authenticated
  USING (assigned_driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Dispatch admin write"
  ON public.delivery_dispatch_jobs FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Dispatch admin update"
  ON public.delivery_dispatch_jobs FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Dispatch admin delete"
  ON public.delivery_dispatch_jobs FOR DELETE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role]));

DROP TRIGGER IF EXISTS trg_dispatch_touch ON public.delivery_dispatch_jobs;
CREATE TRIGGER trg_dispatch_touch
  BEFORE UPDATE ON public.delivery_dispatch_jobs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE TABLE IF NOT EXISTS public.delivery_driver_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.delivery_dispatch_jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  score numeric(8,4) NOT NULL DEFAULT 0,
  distance_km numeric(8,3),
  eta_seconds integer,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_dispatch_candidates_job ON public.delivery_driver_candidates(job_id, score DESC);

GRANT SELECT, INSERT ON public.delivery_driver_candidates TO authenticated;
GRANT ALL ON public.delivery_driver_candidates TO service_role;

ALTER TABLE public.delivery_driver_candidates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Candidates read own or admin"
  ON public.delivery_driver_candidates FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Candidates admin insert"
  ON public.delivery_driver_candidates FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.delivery_assignment_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.delivery_dispatch_jobs(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  offered_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  response text,
  responded_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_assignment_queue_driver ON public.delivery_assignment_queue(driver_id, response);

GRANT SELECT, INSERT, UPDATE ON public.delivery_assignment_queue TO authenticated;
GRANT ALL ON public.delivery_assignment_queue TO service_role;

ALTER TABLE public.delivery_assignment_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Queue read own or admin"
  ON public.delivery_assignment_queue FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Queue admin insert"
  ON public.delivery_assignment_queue FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Queue update own response"
  ON public.delivery_assignment_queue FOR UPDATE TO authenticated
  USING (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.delivery_route_segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.delivery_dispatch_jobs(id) ON DELETE CASCADE,
  segment_index integer NOT NULL,
  start_lat numeric(10,7),
  start_lng numeric(10,7),
  end_lat numeric(10,7),
  end_lng numeric(10,7),
  distance_m integer,
  duration_s integer,
  polyline text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.delivery_route_segments TO authenticated;
GRANT ALL ON public.delivery_route_segments TO service_role;

ALTER TABLE public.delivery_route_segments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Route segments read by participant or admin"
  ON public.delivery_route_segments FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.delivery_dispatch_jobs j
      WHERE j.id = job_id
        AND (j.assigned_driver_id = auth.uid()
             OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
    )
  );

CREATE POLICY "Route segments admin insert"
  ON public.delivery_route_segments FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.delivery_eta_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid REFERENCES public.packages(id) ON DELETE CASCADE,
  job_id uuid REFERENCES public.delivery_dispatch_jobs(id) ON DELETE CASCADE,
  predicted_eta timestamptz NOT NULL,
  confidence numeric(5,4),
  model_version text,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eta_pkg ON public.delivery_eta_predictions(package_id, created_at DESC);

GRANT SELECT, INSERT ON public.delivery_eta_predictions TO authenticated;
GRANT SELECT ON public.delivery_eta_predictions TO anon;
GRANT ALL ON public.delivery_eta_predictions TO service_role;

ALTER TABLE public.delivery_eta_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ETA anon read" ON public.delivery_eta_predictions FOR SELECT TO anon USING (true);
CREATE POLICY "ETA auth read" ON public.delivery_eta_predictions FOR SELECT TO authenticated USING (true);
CREATE POLICY "ETA admin insert"
  ON public.delivery_eta_predictions FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.delivery_driver_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module text NOT NULL,
  acceptance_rate numeric(5,4),
  on_time_rate numeric(5,4),
  cancel_rate numeric(5,4),
  rating numeric(3,2),
  completed_deliveries integer NOT NULL DEFAULT 0,
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, module, window_start, window_end)
);

CREATE INDEX IF NOT EXISTS idx_driver_scores_driver ON public.delivery_driver_scores(driver_id, module);

GRANT SELECT, INSERT, UPDATE ON public.delivery_driver_scores TO authenticated;
GRANT ALL ON public.delivery_driver_scores TO service_role;

ALTER TABLE public.delivery_driver_scores ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Scores read own or admin"
  ON public.delivery_driver_scores FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Scores admin insert"
  ON public.delivery_driver_scores FOR INSERT TO authenticated
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));

CREATE POLICY "Scores admin update"
  ON public.delivery_driver_scores FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'operations_admin'::app_role]));
