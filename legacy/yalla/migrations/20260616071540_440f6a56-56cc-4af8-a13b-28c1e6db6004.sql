
-- ============ app_pages: route registry ============
CREATE TABLE public.app_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  route text NOT NULL UNIQUE,
  title text NOT NULL,
  page_group text,
  icon text,
  roles_required text[] NOT NULL DEFAULT ARRAY[]::text[],
  is_public boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.app_pages TO authenticated, anon;
GRANT ALL ON public.app_pages TO service_role;

ALTER TABLE public.app_pages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "app_pages readable to all"
  ON public.app_pages FOR SELECT
  USING (true);

CREATE POLICY "app_pages admin write"
  ON public.app_pages FOR ALL
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TRIGGER app_pages_updated_at
  BEFORE UPDATE ON public.app_pages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_app_pages_active ON public.app_pages(is_active, sort_order);

-- ============ navigation_logs ============
CREATE TABLE public.navigation_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  route text NOT NULL,
  from_route text,
  success boolean NOT NULL DEFAULT true,
  error_message text,
  duration_ms int,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.navigation_logs TO authenticated;
GRANT INSERT ON public.navigation_logs TO anon;
GRANT ALL ON public.navigation_logs TO service_role;

ALTER TABLE public.navigation_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "nav_logs insert self or anon"
  ON public.navigation_logs FOR INSERT
  TO authenticated, anon
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "nav_logs read own"
  ON public.navigation_logs FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "nav_logs read admin"
  ON public.navigation_logs FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE INDEX idx_nav_logs_user ON public.navigation_logs(user_id, created_at DESC);
CREATE INDEX idx_nav_logs_route ON public.navigation_logs(route, created_at DESC);
CREATE INDEX idx_nav_logs_failures ON public.navigation_logs(created_at DESC) WHERE success = false;

-- ============ ui_events ============
CREATE TABLE public.ui_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  session_id text,
  page_route text,
  element_id text NOT NULL,
  element_label text,
  action text NOT NULL DEFAULT 'click',
  success boolean NOT NULL DEFAULT true,
  error_message text,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.ui_events TO authenticated;
GRANT INSERT ON public.ui_events TO anon;
GRANT ALL ON public.ui_events TO service_role;

ALTER TABLE public.ui_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ui_events insert self or anon"
  ON public.ui_events FOR INSERT
  TO authenticated, anon
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

CREATE POLICY "ui_events read own"
  ON public.ui_events FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ui_events read admin"
  ON public.ui_events FOR SELECT
  TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE INDEX idx_ui_events_user ON public.ui_events(user_id, created_at DESC);
CREATE INDEX idx_ui_events_element ON public.ui_events(element_id, created_at DESC);
CREATE INDEX idx_ui_events_failures ON public.ui_events(created_at DESC) WHERE success = false;

-- ============ Navigation health admin RPC ============
CREATE OR REPLACE FUNCTION public.navigation_health_summary(_hours int DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _r jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'window_hours', _hours,
    'total_nav', (SELECT count(*) FROM public.navigation_logs WHERE created_at > now() - (_hours||' hours')::interval),
    'failed_nav', (SELECT count(*) FROM public.navigation_logs WHERE created_at > now() - (_hours||' hours')::interval AND success = false),
    'top_failed_routes', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb) FROM (
        SELECT route, count(*) AS hits, max(error_message) AS last_error
        FROM public.navigation_logs
        WHERE success = false AND created_at > now() - (_hours||' hours')::interval
        GROUP BY route ORDER BY hits DESC LIMIT 20
      ) t
    ),
    'top_failed_elements', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb) FROM (
        SELECT element_id, page_route, count(*) AS hits, max(error_message) AS last_error
        FROM public.ui_events
        WHERE success = false AND created_at > now() - (_hours||' hours')::interval
        GROUP BY element_id, page_route ORDER BY hits DESC LIMIT 20
      ) t
    ),
    'dead_routes', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)),'[]'::jsonb) FROM (
        SELECT n.route, count(*) AS hits
        FROM public.navigation_logs n
        LEFT JOIN public.app_pages p ON p.route = n.route
        WHERE p.id IS NULL AND n.created_at > now() - (_hours||' hours')::interval
        GROUP BY n.route ORDER BY hits DESC LIMIT 20
      ) t
    )
  ) INTO _r;
  RETURN _r;
END $$;

-- ============ Seed app_pages registry ============
INSERT INTO public.app_pages (route, title, page_group, icon, roles_required, is_public, sort_order) VALUES
  -- Marketing
  ('/',           'Home',       'marketing', 'Home',     ARRAY[]::text[], true, 10),
  ('/about',      'About',      'marketing', 'Info',     ARRAY[]::text[], true, 20),
  ('/riders',     'Riders',     'marketing', 'User',     ARRAY[]::text[], true, 30),
  ('/drivers',    'Drivers',    'marketing', 'Car',      ARRAY[]::text[], true, 40),
  ('/corporates', 'Corporates', 'marketing', 'Building', ARRAY[]::text[], true, 50),
  ('/delivery',   'Delivery',   'marketing', 'Package',  ARRAY[]::text[], true, 60),
  ('/rentals',    'Rentals',    'marketing', 'Key',      ARRAY[]::text[], true, 70),
  ('/pricing',    'Pricing',    'marketing', 'Tag',      ARRAY[]::text[], true, 80),
  ('/faq',        'FAQ',        'marketing', 'HelpCircle', ARRAY[]::text[], true, 90),
  ('/news',       'News',       'marketing', 'Newspaper', ARRAY[]::text[], true, 100),
  ('/careers',    'Careers',    'marketing', 'Briefcase', ARRAY[]::text[], true, 110),
  ('/contact',    'Contact',    'marketing', 'Mail',     ARRAY[]::text[], true, 120),
  ('/auth',       'Sign In',    'auth',      'LogIn',    ARRAY[]::text[], true, 200),
  ('/reset-password', 'Reset Password', 'auth', 'Key',   ARRAY[]::text[], true, 210),
  -- Rider
  ('/dashboard/rider',         'Overview', 'rider', 'LayoutDashboard', ARRAY['rider'],   false, 300),
  ('/dashboard/rider/wallet',  'Wallet',   'rider', 'Wallet',          ARRAY['rider'],   false, 310),
  ('/dashboard/rider/trips',   'Trips',    'rider', 'MapPin',          ARRAY['rider'],   false, 320),
  ('/dashboard/rider/support', 'Support',  'rider', 'HeadphonesIcon',  ARRAY['rider'],   false, 330),
  -- Driver
  ('/dashboard/driver',         'Overview',     'driver', 'LayoutDashboard', ARRAY['driver'], false, 400),
  ('/dashboard/driver/wallet',  'Wallet',       'driver', 'Wallet',          ARRAY['driver'], false, 410),
  ('/dashboard/driver/trips',   'Trips',        'driver', 'MapPin',          ARRAY['driver'], false, 420),
  ('/dashboard/driver/tax',     'Tax & Payouts','driver', 'Receipt',         ARRAY['driver'], false, 430),
  ('/dashboard/driver/support', 'Support',      'driver', 'HeadphonesIcon',  ARRAY['driver'], false, 440),
  -- Corporate
  ('/dashboard/corporate',           'Overview',  'corporate', 'LayoutDashboard', ARRAY['corporate_admin','corporate_employee'], false, 500),
  ('/dashboard/corporate/wallet',    'Wallet',    'corporate', 'Wallet',          ARRAY['corporate_admin'], false, 510),
  ('/dashboard/corporate/employees', 'Employees', 'corporate', 'Users',           ARRAY['corporate_admin'], false, 520),
  ('/dashboard/corporate/approvals', 'Approvals', 'corporate', 'CheckCircle2',    ARRAY['corporate_admin'], false, 530),
  ('/dashboard/corporate/spend',     'Spend',     'corporate', 'BarChart3',       ARRAY['corporate_admin'], false, 540),
  -- Admin
  ('/dashboard/admin',                   'Overview',           'admin', 'LayoutDashboard', ARRAY['admin','super_admin'], false, 600),
  ('/dashboard/admin/users',             'Users',              'admin', 'Users',           ARRAY['admin','super_admin'], false, 610),
  ('/dashboard/admin/roles',             'Roles',              'admin', 'Shield',          ARRAY['admin','super_admin'], false, 620),
  ('/dashboard/admin/mpesa',             'M-Pesa',             'admin', 'CreditCard',      ARRAY['admin','super_admin','finance_admin'], false, 630),
  ('/dashboard/admin/wallets',           'Wallets',            'admin', 'Wallet',          ARRAY['admin','super_admin','finance_admin'], false, 640),
  ('/dashboard/admin/payments',          'Payments Ops',       'admin', 'CreditCard',      ARRAY['admin','super_admin','finance_admin'], false, 650),
  ('/dashboard/admin/fos',               'FOS Control Center', 'admin', 'BarChart3',       ARRAY['admin','super_admin'], false, 660),
  ('/dashboard/admin/analytics-export',  'Analytics Export',   'admin', 'Database',        ARRAY['admin','super_admin'], false, 670),
  ('/dashboard/admin/tax',               'Tax Command Center', 'admin', 'Receipt',         ARRAY['admin','super_admin','finance_admin'], false, 680),
  ('/dashboard/admin/navigation-health', 'Navigation Health',  'admin', 'Activity',        ARRAY['admin','super_admin'], false, 690)
ON CONFLICT (route) DO UPDATE SET
  title = EXCLUDED.title,
  page_group = EXCLUDED.page_group,
  icon = EXCLUDED.icon,
  roles_required = EXCLUDED.roles_required,
  is_public = EXCLUDED.is_public,
  sort_order = EXCLUDED.sort_order,
  updated_at = now();
