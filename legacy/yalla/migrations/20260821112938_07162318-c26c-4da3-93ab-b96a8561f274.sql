-- ============================================================
-- YALLA PARTNERS — Phase 1/2 foundation spine
-- Demand & distribution layer over the existing execution engine.
-- ============================================================

DO $$ BEGIN
  CREATE TYPE public.partner_type AS ENUM (
    'TOUR_OPERATOR','DMC','TRAVEL_AGENCY','HOTEL','AIRLINE','AIR_CHARTER','CORPORATE',
    'EVENT','ECOMMERCE','RETAIL','COURIER','LOGISTICS','NGO','SCHOOL','GOVERNMENT',
    'TRAVEL_PLATFORM','OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_status AS ENUM ('draft','pending','active','suspended','terminated');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_verification_status AS ENUM ('unverified','in_review','verified','rejected','expired');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_commercial_model AS ENUM ('REFER','BOOK','EMBED','API','WHITE_LABEL','ORCHESTRATE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_commission_model AS ENUM ('NET_RATE','MARKUP','COMMISSION','REVENUE_SHARE','FIXED_FEE','TIERED_RATE','CONTRACT_RATE','CUSTOM');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mobility_service_type AS ENUM ('RIDE','CHARTER','DELIVERY','LOGISTICS','AIR_CHARTER','MARINE','RENTAL','LEASING','MULTI_SERVICE');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.mobility_order_status AS ENUM (
    'DRAFT','QUOTE_REQUESTED','QUOTED','CUSTOMER_APPROVAL','PAYMENT_PENDING','CONFIRMED',
    'ALLOCATING','ASSIGNED','EN_ROUTE','IN_SERVICE','COMPLETED','RECONCILING','SETTLED',
    'CANCELLED','FAILED','REASSIGNMENT_REQUIRED','SUPPLIER_NO_SHOW','CUSTOMER_NO_SHOW','DISPUTED','REFUNDED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.partner_user_role AS ENUM ('owner','admin','agent','finance','viewer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------- partners
CREATE TABLE IF NOT EXISTS public.partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_code text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  trading_name text,
  partner_type public.partner_type NOT NULL DEFAULT 'OTHER',
  status public.partner_status NOT NULL DEFAULT 'pending',
  verification_status public.partner_verification_status NOT NULL DEFAULT 'unverified',
  commercial_model public.partner_commercial_model NOT NULL DEFAULT 'BOOK',
  commission_model public.partner_commission_model NOT NULL DEFAULT 'COMMISSION',
  partner_margin_pct numeric(6,3) NOT NULL DEFAULT 0,
  corporate_account_id uuid REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  primary_contact_name text,
  primary_contact_email text,
  primary_contact_phone text,
  country text NOT NULL DEFAULT 'KE',
  city text,
  api_access boolean NOT NULL DEFAULT false,
  white_label boolean NOT NULL DEFAULT false,
  risk_score numeric(5,2) NOT NULL DEFAULT 0,
  trust_score numeric(5,2) NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  partner_role public.partner_user_role NOT NULL DEFAULT 'agent',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (partner_id, user_id)
);
CREATE INDEX IF NOT EXISTS partner_users_user_idx ON public.partner_users(user_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL UNIQUE DEFAULT ('YP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  organisation_name text NOT NULL,
  partner_type public.partner_type NOT NULL DEFAULT 'OTHER',
  category text,
  commercial_model public.partner_commercial_model NOT NULL DEFAULT 'BOOK',
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text NOT NULL,
  country text NOT NULL DEFAULT 'KE',
  city text,
  website text,
  monthly_volume_estimate integer,
  requirements text,
  status text NOT NULL DEFAULT 'submitted',
  review_notes text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.partner_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  phone text,
  email text,
  customer_reference text,
  organisation text,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  accessibility_needs text,
  lifetime_spend numeric(14,2) NOT NULL DEFAULT 0,
  outstanding_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_customers_partner_idx ON public.partner_customers(partner_id);

CREATE TABLE IF NOT EXISTS public.journeys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  journey_code text NOT NULL UNIQUE DEFAULT ('JNY-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  partner_customer_id uuid REFERENCES public.partner_customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  starts_on date,
  ends_on date,
  passengers integer NOT NULL DEFAULT 1,
  supplier_cost_total numeric(14,2) NOT NULL DEFAULT 0,
  partner_margin_total numeric(14,2) NOT NULL DEFAULT 0,
  customer_price_total numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS journeys_partner_idx ON public.journeys(partner_id);

CREATE TABLE IF NOT EXISTS public.mobility_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text NOT NULL UNIQUE DEFAULT ('MO-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10))),
  partner_id uuid REFERENCES public.partners(id) ON DELETE SET NULL,
  partner_customer_id uuid REFERENCES public.partner_customers(id) ON DELETE SET NULL,
  journey_id uuid REFERENCES public.journeys(id) ON DELETE SET NULL,
  leg_index integer NOT NULL DEFAULT 1,
  service_type public.mobility_service_type NOT NULL DEFAULT 'RIDE',
  status public.mobility_order_status NOT NULL DEFAULT 'DRAFT',
  pickup_label text,
  destination_label text,
  stops jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz,
  passengers integer NOT NULL DEFAULT 1,
  vehicle_class text,
  service_level text,
  supplier_cost numeric(14,2) NOT NULL DEFAULT 0,
  yalla_margin numeric(14,2) NOT NULL DEFAULT 0,
  partner_margin numeric(14,2) NOT NULL DEFAULT 0,
  taxes numeric(14,2) NOT NULL DEFAULT 0,
  fees numeric(14,2) NOT NULL DEFAULT 0,
  customer_price numeric(14,2) NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'KES',
  idempotency_key text UNIQUE,
  special_requirements text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mobility_orders_partner_idx ON public.mobility_orders(partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS mobility_orders_journey_idx ON public.mobility_orders(journey_id);
CREATE INDEX IF NOT EXISTS mobility_orders_status_idx ON public.mobility_orders(status);

CREATE TABLE IF NOT EXISTS public.capacity_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text NOT NULL UNIQUE DEFAULT ('CAP-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,8))),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  service_type public.mobility_service_type NOT NULL DEFAULT 'CHARTER',
  origin_label text NOT NULL,
  destination_label text,
  needed_at timestamptz,
  passengers integer,
  cargo_weight_kg numeric(12,2),
  vehicle_class text,
  service_level text,
  budget_amount numeric(14,2),
  currency text NOT NULL DEFAULT 'KES',
  requirements text,
  status text NOT NULL DEFAULT 'open',
  resolution_notes text,
  is_demo boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS capacity_requests_partner_idx ON public.capacity_requests(partner_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.partner_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id uuid NOT NULL REFERENCES public.partners(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  title text NOT NULL,
  detail text,
  severity text NOT NULL DEFAULT 'info',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS partner_events_partner_idx ON public.partner_events(partner_id, created_at DESC);

-- ------------------------------------------------------- membership helper
CREATE OR REPLACE FUNCTION public.is_partner_member(_partner_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.partner_users pu
    WHERE pu.partner_id = _partner_id AND pu.user_id = auth.uid() AND pu.is_active
  );
$$;

CREATE OR REPLACE FUNCTION public.yp_is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_any_role(auth.uid(), ARRAY[
    'admin','super_admin','operations_admin','finance_admin','compliance_admin','director','general_manager'
  ]::app_role[]);
$$;

GRANT EXECUTE ON FUNCTION public.is_partner_member(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.yp_is_staff() TO authenticated, service_role;

-- ------------------------------------------------------------- updated_at
CREATE OR REPLACE FUNCTION public.yp_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partners','partner_applications','partner_customers','journeys','mobility_orders','capacity_requests']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS yp_touch_%1$s ON public.%1$s', t);
    EXECUTE format('CREATE TRIGGER yp_touch_%1$s BEFORE UPDATE ON public.%1$s FOR EACH ROW EXECUTE FUNCTION public.yp_touch_updated_at()', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------- grants
GRANT SELECT, INSERT, UPDATE ON public.partners TO authenticated;
GRANT SELECT ON public.partner_users TO authenticated;
GRANT INSERT ON public.partner_applications TO anon, authenticated;
GRANT SELECT, UPDATE ON public.partner_applications TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.partner_customers TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.journeys TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.mobility_orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.capacity_requests TO authenticated;
GRANT SELECT ON public.partner_events TO authenticated;
GRANT ALL ON public.partners, public.partner_users, public.partner_applications,
  public.partner_customers, public.journeys, public.mobility_orders,
  public.capacity_requests, public.partner_events TO service_role;

-- ------------------------------------------------------------------- RLS
ALTER TABLE public.partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.journeys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mobility_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capacity_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY partners_read ON public.partners FOR SELECT TO authenticated
  USING (public.yp_is_staff() OR public.is_partner_member(id));
CREATE POLICY partners_staff_write ON public.partners FOR INSERT TO authenticated
  WITH CHECK (public.yp_is_staff());
CREATE POLICY partners_update ON public.partners FOR UPDATE TO authenticated
  USING (public.yp_is_staff()) WITH CHECK (public.yp_is_staff());

CREATE POLICY partner_users_read ON public.partner_users FOR SELECT TO authenticated
  USING (public.yp_is_staff() OR user_id = auth.uid() OR public.is_partner_member(partner_id));

CREATE POLICY partner_applications_insert ON public.partner_applications FOR INSERT TO anon, authenticated
  WITH CHECK (true);
CREATE POLICY partner_applications_staff_read ON public.partner_applications FOR SELECT TO authenticated
  USING (public.yp_is_staff());
CREATE POLICY partner_applications_staff_update ON public.partner_applications FOR UPDATE TO authenticated
  USING (public.yp_is_staff()) WITH CHECK (public.yp_is_staff());

CREATE POLICY partner_customers_rw ON public.partner_customers FOR ALL TO authenticated
  USING (public.yp_is_staff() OR public.is_partner_member(partner_id))
  WITH CHECK (public.yp_is_staff() OR public.is_partner_member(partner_id));

CREATE POLICY journeys_rw ON public.journeys FOR ALL TO authenticated
  USING (public.yp_is_staff() OR public.is_partner_member(partner_id))
  WITH CHECK (public.yp_is_staff() OR public.is_partner_member(partner_id));

CREATE POLICY mobility_orders_rw ON public.mobility_orders FOR ALL TO authenticated
  USING (public.yp_is_staff() OR (partner_id IS NOT NULL AND public.is_partner_member(partner_id)))
  WITH CHECK (public.yp_is_staff() OR (partner_id IS NOT NULL AND public.is_partner_member(partner_id)));

CREATE POLICY capacity_requests_rw ON public.capacity_requests FOR ALL TO authenticated
  USING (public.yp_is_staff() OR public.is_partner_member(partner_id))
  WITH CHECK (public.yp_is_staff() OR public.is_partner_member(partner_id));

CREATE POLICY partner_events_read ON public.partner_events FOR SELECT TO authenticated
  USING (public.yp_is_staff() OR public.is_partner_member(partner_id));