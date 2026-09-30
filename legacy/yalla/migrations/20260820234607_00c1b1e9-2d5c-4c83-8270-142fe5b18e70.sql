-- =========================================================================
-- Interns 360 · public announcement analytics, application intake,
-- immutable programme revisions and publication stability.
-- =========================================================================

/* ------------------------------- analytics ------------------------------ */

CREATE TABLE IF NOT EXISTS public.rec_public_announcement_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id    uuid REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  public_slug   text NOT NULL,
  event_kind    text NOT NULL CHECK (event_kind IN ('VIEW','APPLICATION_START','APPLICATION_SUBMIT')),
  visitor_hash  text,
  referrer_host text,
  device_class  text CHECK (device_class IS NULL OR device_class IN ('mobile','tablet','desktop','unknown')),
  occurred_at   timestamptz NOT NULL DEFAULT now(),
  occurred_on   date NOT NULL DEFAULT (now() AT TIME ZONE 'UTC')::date
);

CREATE INDEX IF NOT EXISTS rec_public_announcement_events_slug_idx
  ON public.rec_public_announcement_events (public_slug, event_kind, occurred_on);
CREATE INDEX IF NOT EXISTS rec_public_announcement_events_vacancy_idx
  ON public.rec_public_announcement_events (vacancy_id, occurred_on);

GRANT SELECT ON public.rec_public_announcement_events TO authenticated;
GRANT ALL ON public.rec_public_announcement_events TO service_role;
ALTER TABLE public.rec_public_announcement_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "announcement events readable by recruitment staff" ON public.rec_public_announcement_events;
CREATE POLICY "announcement events readable by recruitment staff"
  ON public.rec_public_announcement_events FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','director','admin','general_manager','operations_admin']::public.app_role[]));

DROP POLICY IF EXISTS "announcement events service role" ON public.rec_public_announcement_events;
CREATE POLICY "announcement events service role"
  ON public.rec_public_announcement_events FOR ALL TO service_role USING (true) WITH CHECK (true);

/* Visitor-safe recorder. Writes only coarse, non-identifying signals and never
   returns programme internals. Capped per visitor + slug + kind + day so the
   funnel cannot be inflated by repeat calls. */
CREATE OR REPLACE FUNCTION public.rec_public_announcement_track(
  p_slug text,
  p_event text,
  p_visitor text DEFAULT NULL,
  p_referrer text DEFAULT NULL,
  p_device text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slug text := nullif(trim(p_slug), '');
  v_event text := upper(nullif(trim(p_event), ''));
  v_vacancy uuid;
  v_hash text;
  v_host text;
  v_count integer;
BEGIN
  IF v_slug IS NULL OR v_event IS NULL THEN RETURN; END IF;
  IF v_event NOT IN ('VIEW','APPLICATION_START','APPLICATION_SUBMIT') THEN RETURN; END IF;

  -- Only open, published programmes are countable.
  SELECT id INTO v_vacancy FROM public.rec_public_vacancy(v_slug) LIMIT 1;
  IF v_vacancy IS NULL THEN RETURN; END IF;

  v_hash := CASE
    WHEN nullif(trim(p_visitor), '') IS NULL THEN NULL
    ELSE encode(digest('yalla-announcement:' || left(trim(p_visitor), 128), 'sha256'), 'hex')
  END;

  v_host := lower(left(regexp_replace(coalesce(p_referrer, ''), '^https?://([^/]+).*$', '\1'), 120));
  v_host := nullif(v_host, '');

  IF v_hash IS NOT NULL THEN
    SELECT count(*) INTO v_count
    FROM public.rec_public_announcement_events
    WHERE public_slug = v_slug AND event_kind = v_event AND visitor_hash = v_hash
      AND occurred_on = (now() AT TIME ZONE 'UTC')::date;
    IF v_count >= 5 THEN RETURN; END IF;
  END IF;

  INSERT INTO public.rec_public_announcement_events(
    vacancy_id, public_slug, event_kind, visitor_hash, referrer_host, device_class)
  VALUES (v_vacancy, v_slug, v_event, v_hash, v_host,
          CASE WHEN lower(coalesce(p_device,'')) IN ('mobile','tablet','desktop') THEN lower(p_device) ELSE 'unknown' END);
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_announcement_track(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_announcement_track(text, text, text, text, text) TO anon, authenticated, service_role;

/* Staff-facing funnel. Counts only; no candidate identity, no scoring. */
CREATE OR REPLACE FUNCTION public.rec_internship_funnel(
  p_slug text DEFAULT NULL,
  p_days integer DEFAULT 30
) RETURNS TABLE (
  vacancy_id uuid,
  public_slug text,
  title text,
  views bigint,
  unique_views bigint,
  application_starts bigint,
  application_submits bigint,
  applications_recorded bigint,
  start_rate numeric,
  submit_rate numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH scope AS (
    SELECT v.id, v.public_slug, v.title
    FROM public.rec_vacancies v
    JOIN public.rec_internship_specs s ON s.vacancy_id = v.id
    WHERE p_slug IS NULL OR v.public_slug = p_slug
  ), ev AS (
    SELECT e.public_slug, e.event_kind, e.visitor_hash
    FROM public.rec_public_announcement_events e
    WHERE e.occurred_at > now() - make_interval(days => greatest(coalesce(p_days, 30), 1))
  )
  SELECT
    sc.id,
    sc.public_slug,
    sc.title,
    count(*) FILTER (WHERE ev.event_kind = 'VIEW')::bigint,
    count(DISTINCT ev.visitor_hash) FILTER (WHERE ev.event_kind = 'VIEW')::bigint,
    count(*) FILTER (WHERE ev.event_kind = 'APPLICATION_START')::bigint,
    count(*) FILTER (WHERE ev.event_kind = 'APPLICATION_SUBMIT')::bigint,
    (SELECT count(*) FROM public.rec_applications a WHERE a.vacancy_id = sc.id)::bigint,
    CASE WHEN count(*) FILTER (WHERE ev.event_kind = 'VIEW') = 0 THEN 0
         ELSE round(100.0 * count(*) FILTER (WHERE ev.event_kind = 'APPLICATION_START')
                    / count(*) FILTER (WHERE ev.event_kind = 'VIEW'), 1) END,
    CASE WHEN count(*) FILTER (WHERE ev.event_kind = 'APPLICATION_START') = 0 THEN 0
         ELSE round(100.0 * count(*) FILTER (WHERE ev.event_kind = 'APPLICATION_SUBMIT')
                    / count(*) FILTER (WHERE ev.event_kind = 'APPLICATION_START'), 1) END
  FROM scope sc
  LEFT JOIN ev ON ev.public_slug = sc.public_slug
  WHERE public.has_any_role(auth.uid(), ARRAY['super_admin','director','admin','general_manager','operations_admin']::public.app_role[])
  GROUP BY sc.id, sc.public_slug, sc.title
  ORDER BY 4 DESC;
$$;

REVOKE ALL ON FUNCTION public.rec_internship_funnel(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_internship_funnel(text, integer) TO authenticated, service_role;

/* --------------------------- immutable revisions ------------------------ */

CREATE TABLE IF NOT EXISTS public.rec_internship_spec_versions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vacancy_id    uuid NOT NULL REFERENCES public.rec_vacancies(id) ON DELETE CASCADE,
  spec_id       uuid NOT NULL,
  version       integer NOT NULL,
  revision_state text NOT NULL DEFAULT 'DRAFT' CHECK (revision_state IN ('DRAFT','PUBLISHED','SUPERSEDED')),
  snapshot      jsonb NOT NULL,
  public_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_hash  text NOT NULL,
  sealed_at     timestamptz,
  sealed_by     uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  created_by    uuid,
  UNIQUE (vacancy_id, version)
);

CREATE INDEX IF NOT EXISTS rec_internship_spec_versions_state_idx
  ON public.rec_internship_spec_versions (vacancy_id, revision_state, version DESC);

GRANT SELECT ON public.rec_internship_spec_versions TO authenticated;
GRANT ALL ON public.rec_internship_spec_versions TO service_role;
ALTER TABLE public.rec_internship_spec_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "internship revisions readable by recruitment staff" ON public.rec_internship_spec_versions;
CREATE POLICY "internship revisions readable by recruitment staff"
  ON public.rec_internship_spec_versions FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','director','admin','general_manager','operations_admin']::public.app_role[]));

DROP POLICY IF EXISTS "internship revisions service role" ON public.rec_internship_spec_versions;
CREATE POLICY "internship revisions service role"
  ON public.rec_internship_spec_versions FOR ALL TO service_role USING (true) WITH CHECK (true);

/* A sealed revision is evidence: it can never be rewritten or removed.
   Only the DRAFT → PUBLISHED / SUPERSEDED lifecycle field may move. */
CREATE OR REPLACE FUNCTION public._internship_revision_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Internship revisions are immutable and cannot be deleted.';
  END IF;
  IF NEW.snapshot IS DISTINCT FROM OLD.snapshot
     OR NEW.public_snapshot IS DISTINCT FROM OLD.public_snapshot
     OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.vacancy_id IS DISTINCT FROM OLD.vacancy_id THEN
    RAISE EXCEPTION 'Internship revision % is sealed; create a new revision instead.', OLD.version;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS internship_revision_immutability ON public.rec_internship_spec_versions;
CREATE TRIGGER internship_revision_immutability
  BEFORE UPDATE OR DELETE ON public.rec_internship_spec_versions
  FOR EACH ROW EXECUTE FUNCTION public._internship_revision_immutability();

/* Every spec write captures a new immutable DRAFT revision. Published
   revisions stay untouched, so a live announcement never shifts under the
   public while staff edit the next version. */
CREATE OR REPLACE FUNCTION public._internship_capture_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next integer;
  v_snapshot jsonb := to_jsonb(NEW);
  v_public jsonb;
BEGIN
  SELECT coalesce(max(version), 0) + 1 INTO v_next
  FROM public.rec_internship_spec_versions WHERE vacancy_id = NEW.vacancy_id;

  v_public := jsonb_build_object(
    'internship_type', NEW.internship_type,
    'duration_weeks', NEW.duration_weeks,
    'start_date', NEW.start_date,
    'end_date', NEW.end_date,
    'application_deadline', NEW.application_deadline,
    'host_function', NEW.host_function,
    'business_unit', NEW.business_unit,
    'programme_purpose', NEW.programme_purpose,
    'public_preview', coalesce(NEW.public_preview, '{}'::jsonb),
    'learning_outcomes', coalesce(NEW.learning_outcomes, '[]'::jsonb),
    'practical_capabilities', coalesce(to_jsonb(NEW.practical_capabilities), '[]'::jsonb),
    'success_profile', coalesce(to_jsonb(NEW.success_profile), '[]'::jsonb),
    'required_documents', coalesce(to_jsonb(NEW.required_documents), '[]'::jsonb)
  );

  INSERT INTO public.rec_internship_spec_versions(
    vacancy_id, spec_id, version, revision_state, snapshot, public_snapshot, content_hash, created_by)
  VALUES (
    NEW.vacancy_id, NEW.id, v_next, 'DRAFT', v_snapshot, v_public,
    encode(digest(v_snapshot::text, 'sha256'), 'hex'), auth.uid());

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS internship_capture_revision ON public.rec_internship_specs;
CREATE TRIGGER internship_capture_revision
  AFTER INSERT OR UPDATE ON public.rec_internship_specs
  FOR EACH ROW EXECUTE FUNCTION public._internship_capture_revision();

/* Seals the newest draft as the live public revision. */
CREATE OR REPLACE FUNCTION public.rec_internship_publish_revision(p_vacancy uuid)
RETURNS TABLE (version integer, content_hash text, sealed_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['super_admin','director','admin','general_manager','operations_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Not authorised to publish an internship revision.';
  END IF;

  SELECT id INTO v_id
  FROM public.rec_internship_spec_versions
  WHERE vacancy_id = p_vacancy AND revision_state = 'DRAFT'
  ORDER BY version DESC LIMIT 1;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'No draft revision to publish for this programme.';
  END IF;

  UPDATE public.rec_internship_spec_versions
     SET revision_state = 'SUPERSEDED'
   WHERE vacancy_id = p_vacancy AND revision_state = 'PUBLISHED';

  UPDATE public.rec_internship_spec_versions
     SET revision_state = 'PUBLISHED', sealed_at = now(), sealed_by = auth.uid()
   WHERE id = v_id;

  RETURN QUERY
  SELECT v.version, v.content_hash, v.sealed_at
  FROM public.rec_internship_spec_versions v WHERE v.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_internship_publish_revision(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_internship_publish_revision(uuid) TO authenticated, service_role;

/* Seed one sealed revision per existing programme so live announcements keep
   serving exactly what is on the page today. */
INSERT INTO public.rec_internship_spec_versions(
  vacancy_id, spec_id, version, revision_state, snapshot, public_snapshot, content_hash, sealed_at, created_by)
SELECT s.vacancy_id, s.id, 1, 'PUBLISHED', to_jsonb(s),
  jsonb_build_object(
    'internship_type', s.internship_type, 'duration_weeks', s.duration_weeks,
    'start_date', s.start_date, 'end_date', s.end_date,
    'application_deadline', s.application_deadline, 'host_function', s.host_function,
    'business_unit', s.business_unit, 'programme_purpose', s.programme_purpose,
    'public_preview', coalesce(s.public_preview, '{}'::jsonb),
    'learning_outcomes', coalesce(s.learning_outcomes, '[]'::jsonb),
    'practical_capabilities', coalesce(to_jsonb(s.practical_capabilities), '[]'::jsonb),
    'success_profile', coalesce(to_jsonb(s.success_profile), '[]'::jsonb),
    'required_documents', coalesce(to_jsonb(s.required_documents), '[]'::jsonb)),
  encode(digest(to_jsonb(s)::text, 'sha256'), 'hex'), now(), s.created_by
FROM public.rec_internship_specs s
WHERE NOT EXISTS (
  SELECT 1 FROM public.rec_internship_spec_versions v WHERE v.vacancy_id = s.vacancy_id);

/* The public announcement is served from the sealed revision when one exists. */
DROP FUNCTION IF EXISTS public.rec_public_internship(text);
CREATE OR REPLACE FUNCTION public.rec_public_internship(p_slug text)
RETURNS TABLE (
  vacancy_id uuid,
  public_slug text,
  internship_type text,
  duration_weeks integer,
  start_date date,
  end_date date,
  application_deadline date,
  host_function text,
  business_unit text,
  programme_purpose text,
  summary text,
  what_you_will_do text,
  what_you_will_learn text,
  who_should_apply text,
  learning_outcomes jsonb,
  practical_capabilities text[],
  success_profile text[],
  required_documents text[],
  published_version integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH v AS (SELECT * FROM public.rec_public_vacancy(p_slug) LIMIT 1),
  spec AS (SELECT s.* FROM public.rec_internship_specs s JOIN v ON s.vacancy_id = v.id),
  rev AS (
    SELECT r.public_snapshot, r.version
    FROM public.rec_internship_spec_versions r JOIN v ON r.vacancy_id = v.id
    WHERE r.revision_state = 'PUBLISHED'
    ORDER BY r.version DESC LIMIT 1
  ), src AS (
    SELECT
      coalesce(rev.public_snapshot, jsonb_build_object(
        'internship_type', spec.internship_type, 'duration_weeks', spec.duration_weeks,
        'start_date', spec.start_date, 'end_date', spec.end_date,
        'application_deadline', spec.application_deadline, 'host_function', spec.host_function,
        'business_unit', spec.business_unit, 'programme_purpose', spec.programme_purpose,
        'public_preview', coalesce(spec.public_preview, '{}'::jsonb),
        'learning_outcomes', coalesce(spec.learning_outcomes, '[]'::jsonb),
        'practical_capabilities', coalesce(to_jsonb(spec.practical_capabilities), '[]'::jsonb),
        'success_profile', coalesce(to_jsonb(spec.success_profile), '[]'::jsonb),
        'required_documents', coalesce(to_jsonb(spec.required_documents), '[]'::jsonb))) AS s,
      rev.version AS ver
    FROM spec LEFT JOIN rev ON true
  )
  SELECT
    (SELECT id FROM v),
    (SELECT public_slug FROM v),
    nullif(src.s->>'internship_type',''),
    nullif(src.s->>'duration_weeks','')::integer,
    nullif(src.s->>'start_date','')::date,
    nullif(src.s->>'end_date','')::date,
    nullif(src.s->>'application_deadline','')::date,
    nullif(src.s->>'host_function',''),
    nullif(src.s->>'business_unit',''),
    nullif(src.s->>'programme_purpose',''),
    nullif(src.s->'public_preview'->>'summary',''),
    nullif(src.s->'public_preview'->>'what_you_will_do',''),
    nullif(src.s->'public_preview'->>'what_you_will_learn',''),
    nullif(src.s->'public_preview'->>'who_should_apply',''),
    coalesce(src.s->'learning_outcomes','[]'::jsonb),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(src.s->'practical_capabilities')), '{}'::text[]),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(src.s->'success_profile')), '{}'::text[]),
    coalesce(ARRAY(SELECT jsonb_array_elements_text(src.s->'required_documents')), '{}'::text[]),
    src.ver
  FROM src
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.rec_public_internship(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_internship(text) TO anon, authenticated, service_role;

/* ------------------ public internship application intake ---------------- */

CREATE TABLE IF NOT EXISTS public.intern_public_application_links (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL UNIQUE,
  pipeline_id    uuid NOT NULL,
  vacancy_id     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.intern_public_application_links TO authenticated;
GRANT ALL ON public.intern_public_application_links TO service_role;
ALTER TABLE public.intern_public_application_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "intern application links readable by recruitment staff" ON public.intern_public_application_links;
CREATE POLICY "intern application links readable by recruitment staff"
  ON public.intern_public_application_links FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['super_admin','director','admin','general_manager','operations_admin']::public.app_role[]));

DROP POLICY IF EXISTS "intern application links service role" ON public.intern_public_application_links;
CREATE POLICY "intern application links service role"
  ON public.intern_public_application_links FOR ALL TO service_role USING (true) WITH CHECK (true);

/* Visitor-facing internship submission. Reuses rec_public_apply for identity,
   consent, rate limiting and document rules, then records the academic profile
   and opens the internal recruitment pipeline. Returns only the applicant's own
   reference — no scores, weights, tracks or pipeline identifiers. */
CREATE OR REPLACE FUNCTION public.rec_public_internship_apply(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_app uuid;
  v_candidate uuid;
  v_vacancy uuid;
  v_spec public.rec_internship_specs;
  v_ac jsonb := coalesce(p_payload->'academic_profile', '{}'::jsonb);
  v_pipeline uuid;
BEGIN
  v_result := to_jsonb(public.rec_public_apply(p_payload));
  v_app := nullif(v_result->>'application_id','')::uuid;
  IF v_app IS NULL THEN
    v_app := nullif(v_result->>'id','')::uuid;
  END IF;
  IF v_app IS NULL THEN
    RETURN v_result;
  END IF;

  SELECT a.candidate_id, a.vacancy_id INTO v_candidate, v_vacancy
  FROM public.rec_applications a WHERE a.id = v_app;

  SELECT * INTO v_spec FROM public.rec_internship_specs WHERE vacancy_id = v_vacancy;
  IF v_spec.id IS NULL THEN
    RETURN v_result;   -- not an internship: the ordinary ATS flow already handled it
  END IF;

  INSERT INTO public.intern_academic_profiles(
    application_id, candidate_id, qualification_level, programme, institution,
    institution_type, specialisation, year_of_study, semester, academic_stage,
    relevant_courses, attachment_done, attachment_detail, projects, skills,
    portfolio_url, work_experience, learning_objectives, expected_outcomes)
  VALUES (
    v_app, v_candidate,
    nullif(trim(v_ac->>'qualification_level'),''),
    nullif(trim(v_ac->>'programme'),''),
    nullif(trim(v_ac->>'institution'),''),
    nullif(trim(v_ac->>'institution_type'),''),
    nullif(trim(v_ac->>'specialisation'),''),
    nullif(v_ac->>'year_of_study','')::integer,
    nullif(v_ac->>'semester','')::integer,
    nullif(trim(v_ac->>'academic_stage'),''),
    coalesce(ARRAY(SELECT left(trim(x),160) FROM jsonb_array_elements_text(coalesce(v_ac->'relevant_courses','[]'::jsonb)) x WHERE trim(x) <> ''), '{}'::text[]),
    coalesce((v_ac->>'attachment_done')::boolean, false),
    left(nullif(trim(v_ac->>'attachment_detail'),''), 2000),
    coalesce(ARRAY(SELECT left(trim(x),300) FROM jsonb_array_elements_text(coalesce(v_ac->'projects','[]'::jsonb)) x WHERE trim(x) <> ''), '{}'::text[]),
    coalesce(ARRAY(SELECT left(trim(x),80) FROM jsonb_array_elements_text(coalesce(v_ac->'skills','[]'::jsonb)) x WHERE trim(x) <> ''), '{}'::text[]),
    left(nullif(trim(v_ac->>'portfolio_url'),''), 500),
    left(nullif(trim(v_ac->>'work_experience'),''), 2000),
    coalesce(ARRAY(SELECT left(trim(x),300) FROM jsonb_array_elements_text(coalesce(v_ac->'learning_objectives','[]'::jsonb)) x WHERE trim(x) <> ''), '{}'::text[]),
    coalesce(ARRAY(SELECT left(trim(x),300) FROM jsonb_array_elements_text(coalesce(v_ac->'expected_outcomes','[]'::jsonb)) x WHERE trim(x) <> ''), '{}'::text[])
  )
  ON CONFLICT DO NOTHING;

  SELECT id INTO v_pipeline FROM public.intern_recruitment_pipeline WHERE application_id = v_app;
  IF v_pipeline IS NULL THEN
    INSERT INTO public.intern_recruitment_pipeline(
      application_id, candidate_id, vacancy_id, programme_id, cohort_id, sla_target_hours,
      scoring_weight_set_id)
    VALUES (
      v_app, v_candidate, v_vacancy,
      coalesce(v_spec.programme_id, (SELECT id FROM public.intern_programmes WHERE code = 'YMEITA')),
      v_spec.cohort_id, 72,
      (SELECT id FROM public.intern_recruitment_weight_sets
        WHERE coalesce(vacancy_id, '00000000-0000-0000-0000-000000000000'::uuid)
              = coalesce(v_vacancy, '00000000-0000-0000-0000-000000000000'::uuid)
          AND status = 'ACTIVE' ORDER BY version DESC LIMIT 1))
    RETURNING id INTO v_pipeline;

    INSERT INTO public.intern_recruitment_transitions(
      pipeline_id, from_stage, to_stage, actor_id, reason, idempotency_key)
    VALUES (v_pipeline, NULL, 'APPLICATION_RECEIVED', NULL,
            'public internship application received', 'public-apply:' || v_app::text)
    ON CONFLICT DO NOTHING;
  END IF;

  INSERT INTO public.intern_public_application_links(application_id, pipeline_id, vacancy_id)
  VALUES (v_app, v_pipeline, v_vacancy)
  ON CONFLICT (application_id) DO NOTHING;

  PERFORM public.rec_public_announcement_track(
    nullif(trim(p_payload->>'vacancy_slug'), ''), 'APPLICATION_SUBMIT', nullif(p_payload->>'client_token',''), NULL, NULL);

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.rec_public_internship_apply(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_public_internship_apply(jsonb) TO anon, authenticated, service_role;