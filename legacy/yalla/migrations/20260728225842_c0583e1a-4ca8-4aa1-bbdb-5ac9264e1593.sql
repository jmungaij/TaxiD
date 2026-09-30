CREATE TABLE public.charter_partner_applications (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  submitted_by UUID,
  operator_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT,
  country TEXT,
  home_base TEXT,
  fleet_size INTEGER NOT NULL DEFAULT 0,
  aircraft_types TEXT,
  aoc_number TEXT,
  insurance_expiry DATE,
  notes TEXT,
  documents JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL DEFAULT 'submitted',
  reviewer_id UUID,
  review_note TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT charter_partner_applications_status_chk
    CHECK (status IN ('submitted','under_review','documents_required','approved','rejected'))
);

CREATE INDEX idx_cpa_status ON public.charter_partner_applications (status, created_at DESC);
CREATE INDEX idx_cpa_submitted_by ON public.charter_partner_applications (submitted_by);

CREATE TABLE public.charter_partner_application_events (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  application_id UUID NOT NULL REFERENCES public.charter_partner_applications(id) ON DELETE CASCADE,
  actor_id UUID,
  actor_email TEXT,
  action TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT,
  note TEXT,
  document_path TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cpae_application ON public.charter_partner_application_events (application_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE ON public.charter_partner_applications TO authenticated;
GRANT ALL ON public.charter_partner_applications TO service_role;
GRANT SELECT, INSERT ON public.charter_partner_application_events TO authenticated;
GRANT ALL ON public.charter_partner_application_events TO service_role;

ALTER TABLE public.charter_partner_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.charter_partner_application_events ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_charter_partner_admin(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','super_admin','operations_admin','compliance_admin')
  )
$$;

CREATE POLICY "Applicants create their own partner applications"
ON public.charter_partner_applications FOR INSERT TO authenticated
WITH CHECK (submitted_by = auth.uid());

CREATE POLICY "Applicants and admins read partner applications"
ON public.charter_partner_applications FOR SELECT TO authenticated
USING (submitted_by = auth.uid() OR public.is_charter_partner_admin(auth.uid()));

CREATE POLICY "Admins update partner applications"
ON public.charter_partner_applications FOR UPDATE TO authenticated
USING (public.is_charter_partner_admin(auth.uid()))
WITH CHECK (public.is_charter_partner_admin(auth.uid()));

CREATE POLICY "Applicants and admins read application events"
ON public.charter_partner_application_events FOR SELECT TO authenticated
USING (
  public.is_charter_partner_admin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.charter_partner_applications a
    WHERE a.id = application_id AND a.submitted_by = auth.uid()
  )
);

CREATE POLICY "Applicants and admins append application events"
ON public.charter_partner_application_events FOR INSERT TO authenticated
WITH CHECK (
  actor_id = auth.uid() AND (
    public.is_charter_partner_admin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.charter_partner_applications a
      WHERE a.id = application_id AND a.submitted_by = auth.uid()
    )
  )
);

CREATE TRIGGER trg_cpa_updated_at
BEFORE UPDATE ON public.charter_partner_applications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();