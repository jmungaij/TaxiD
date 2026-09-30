CREATE TABLE public.company_collateral (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  slug text NOT NULL,
  title text NOT NULL,
  version text NOT NULL DEFAULT 'v1.0',
  description text,
  file_url text NOT NULL,
  file_size bigint,
  page_count integer,
  status text NOT NULL DEFAULT 'draft',
  published_at timestamptz,
  published_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT company_collateral_status_chk CHECK (status IN ('draft','published','superseded')),
  CONSTRAINT company_collateral_slug_version_key UNIQUE (slug, version)
);

GRANT SELECT ON public.company_collateral TO anon;
GRANT SELECT, INSERT, UPDATE ON public.company_collateral TO authenticated;
GRANT ALL ON public.company_collateral TO service_role;

ALTER TABLE public.company_collateral ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Published collateral is readable by anyone"
  ON public.company_collateral FOR SELECT
  USING (status = 'published');

CREATE POLICY "Admins read all collateral"
  ON public.company_collateral FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins insert collateral"
  ON public.company_collateral FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Admins update collateral"
  ON public.company_collateral FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE TRIGGER update_company_collateral_updated_at
  BEFORE UPDATE ON public.company_collateral
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.company_collateral_downloads (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  collateral_id uuid NOT NULL REFERENCES public.company_collateral(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid(),
  surface text NOT NULL DEFAULT 'staff_documents',
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.company_collateral_downloads TO authenticated;
GRANT ALL ON public.company_collateral_downloads TO service_role;

ALTER TABLE public.company_collateral_downloads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees log their own downloads"
  ON public.company_collateral_downloads FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Employees read their own downloads"
  ON public.company_collateral_downloads FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Admins read all downloads"
  ON public.company_collateral_downloads FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin'));

CREATE INDEX company_collateral_downloads_collateral_idx
  ON public.company_collateral_downloads (collateral_id, created_at DESC);