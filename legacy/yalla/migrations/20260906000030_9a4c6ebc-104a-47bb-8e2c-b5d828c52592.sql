CREATE TABLE public.partner_recruitment_links (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  partner_application_id uuid NOT NULL UNIQUE REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  candidate_id uuid NOT NULL REFERENCES public.rec_candidates(id) ON DELETE CASCADE,
  vacancy_id uuid REFERENCES public.rec_vacancies(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.rec_applications(id) ON DELETE SET NULL,
  state text NOT NULL DEFAULT 'CANDIDATE_LINKED' CHECK (state IN ('CANDIDATE_LINKED','REQUISITION_LINKED')),
  notes text,
  linked_by uuid,
  linked_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.partner_recruitment_links TO authenticated;
GRANT ALL ON public.partner_recruitment_links TO service_role;
ALTER TABLE public.partner_recruitment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY prl_staff_read ON public.partner_recruitment_links
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.recruitment.read'));

CREATE TRIGGER trg_prl_touch BEFORE UPDATE ON public.partner_recruitment_links
  FOR EACH ROW EXECUTE FUNCTION public.rec_touch_updated_at();

CREATE INDEX idx_prl_candidate ON public.partner_recruitment_links(candidate_id);
CREATE INDEX idx_prl_vacancy ON public.partner_recruitment_links(vacancy_id);

-- Candidate resolution: reuse an existing Recruitment 360 candidate on the same
-- email, otherwise create one from the partner contact details.
CREATE OR REPLACE FUNCTION public._partner_resolve_candidate(_app public.partner_applications)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id
  FROM public.rec_candidates
  WHERE lower(email) = lower(btrim(_app.contact_email))
  ORDER BY created_at
  LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.rec_candidates (
      candidate_no, full_name, email, phone, location, source, engagement_status, record_state
    ) VALUES (
      public.rec_seq_code('CAN'),
      btrim(_app.contact_name),
      lower(btrim(_app.contact_email)),
      _app.contact_phone,
      NULLIF(btrim(coalesce(_app.city,'') || CASE WHEN coalesce(_app.city,'') <> '' AND coalesce(_app.country,'') <> '' THEN ', ' ELSE '' END || coalesce(_app.country,'')), ''),
      'partner_portal',
      'active',
      'active'
    )
    RETURNING id INTO v_id;
  END IF;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public._partner_resolve_candidate(public.partner_applications) FROM PUBLIC;

-- Every saved partner application becomes a recruitment candidate link.
CREATE OR REPLACE FUNCTION public._partner_application_link_trg()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_candidate uuid;
BEGIN
  IF coalesce(btrim(NEW.contact_email), '') = '' THEN
    RETURN NEW;
  END IF;

  v_candidate := public._partner_resolve_candidate(NEW);

  INSERT INTO public.partner_recruitment_links (partner_application_id, candidate_id, state)
  VALUES (NEW.id, v_candidate, 'CANDIDATE_LINKED')
  ON CONFLICT (partner_application_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public._partner_application_link_trg() FROM PUBLIC;

CREATE TRIGGER trg_partner_application_link
  AFTER INSERT ON public.partner_applications
  FOR EACH ROW EXECUTE FUNCTION public._partner_application_link_trg();

-- Recruiter action: attach the lead to a vacancy (requisition) and create the
-- recruitment application that carries the partner reference as its source.
CREATE OR REPLACE FUNCTION public.partner_lead_link_requisition(p jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_app public.partner_applications;
  v_vacancy public.rec_vacancies;
  v_candidate uuid;
  v_application uuid;
  v_link public.partner_recruitment_links;
BEGIN
  IF NOT public.has_staff_permission('staff.recruitment.manage') THEN
    RETURN jsonb_build_object('ok', false, 'code', 'AUTHORIZATION_ERROR');
  END IF;

  SELECT * INTO v_app FROM public.partner_applications WHERE id = (p->>'partner_application_id')::uuid;
  IF v_app.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'PARTNER_APPLICATION_NOT_FOUND');
  END IF;

  SELECT * INTO v_vacancy FROM public.rec_vacancies WHERE id = (p->>'vacancy_id')::uuid;
  IF v_vacancy.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'VACANCY_NOT_FOUND');
  END IF;

  SELECT * INTO v_link FROM public.partner_recruitment_links WHERE partner_application_id = v_app.id;
  IF v_link.id IS NULL THEN
    v_candidate := public._partner_resolve_candidate(v_app);
    INSERT INTO public.partner_recruitment_links (partner_application_id, candidate_id, state)
    VALUES (v_app.id, v_candidate, 'CANDIDATE_LINKED')
    RETURNING * INTO v_link;
  ELSE
    v_candidate := v_link.candidate_id;
  END IF;

  SELECT id INTO v_application
  FROM public.rec_applications
  WHERE candidate_id = v_candidate AND vacancy_id = v_vacancy.id
  LIMIT 1;

  IF v_application IS NULL THEN
    INSERT INTO public.rec_applications (
      application_no, candidate_id, vacancy_id, source, source_detail, stage, status, cover_letter
    ) VALUES (
      public.rec_seq_code('APP'),
      v_candidate,
      v_vacancy.id,
      'partner_portal',
      v_app.reference,
      'applied',
      'active',
      NULLIF(btrim(coalesce(v_app.intent_bring, '')), '')
    )
    RETURNING id INTO v_application;
  END IF;

  UPDATE public.partner_recruitment_links
  SET vacancy_id = v_vacancy.id,
      application_id = v_application,
      state = 'REQUISITION_LINKED',
      notes = NULLIF(btrim(coalesce(p->>'notes','')), ''),
      linked_by = auth.uid(),
      linked_at = now()
  WHERE id = v_link.id;

  RETURN jsonb_build_object(
    'ok', true,
    'candidate_id', v_candidate,
    'application_id', v_application,
    'vacancy_id', v_vacancy.id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.partner_lead_link_requisition(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_lead_link_requisition(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.partner_lead_link_requisition(jsonb) TO service_role;

-- Back-fill candidates for partner applications saved before this change.
DO $$
DECLARE r public.partner_applications;
BEGIN
  FOR r IN
    SELECT pa.* FROM public.partner_applications pa
    LEFT JOIN public.partner_recruitment_links l ON l.partner_application_id = pa.id
    WHERE l.id IS NULL AND coalesce(btrim(pa.contact_email), '') <> ''
  LOOP
    INSERT INTO public.partner_recruitment_links (partner_application_id, candidate_id, state)
    VALUES (r.id, public._partner_resolve_candidate(r), 'CANDIDATE_LINKED')
    ON CONFLICT (partner_application_id) DO NOTHING;
  END LOOP;
END $$;