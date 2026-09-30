
-- Authority helper: only platform admins author academy content.
CREATE OR REPLACE FUNCTION public._academy_may_manage()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(public.has_role(auth.uid(), 'admin'::app_role), false)
      OR coalesce(public.has_role(auth.uid(), 'super_admin'::app_role), false)
$$;
REVOKE ALL ON FUNCTION public._academy_may_manage() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._academy_may_manage() TO authenticated, service_role;

CREATE TABLE public.academy_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  track text NOT NULL DEFAULT 'workspace',
  level text NOT NULL DEFAULT 'foundation',
  audience_roles text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','retired')),
  version integer NOT NULL DEFAULT 1,
  estimated_minutes integer NOT NULL DEFAULT 0,
  sort_order numeric NOT NULL DEFAULT 100,
  is_mandatory boolean NOT NULL DEFAULT false,
  changelog text NOT NULL DEFAULT '',
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.academy_modules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  sort_order numeric NOT NULL DEFAULT 100,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (course_id, code)
);

CREATE TABLE public.academy_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_id uuid NOT NULL REFERENCES public.academy_modules(id) ON DELETE CASCADE,
  code text NOT NULL,
  title text NOT NULL,
  body_md text NOT NULL DEFAULT '',
  route_path text,
  minutes integer NOT NULL DEFAULT 5,
  sort_order numeric NOT NULL DEFAULT 100,
  resources jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module_id, code)
);

CREATE TABLE public.academy_enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_id uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','completed')),
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (user_id, course_id)
);

CREATE TABLE public.academy_lesson_progress (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  lesson_id uuid NOT NULL REFERENCES public.academy_lessons(id) ON DELETE CASCADE,
  course_id uuid NOT NULL REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lesson_id)
);

CREATE TABLE public.academy_manual_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version text NOT NULL UNIQUE,
  title text NOT NULL,
  summary text NOT NULL DEFAULT '',
  changelog text NOT NULL DEFAULT '',
  document_path text NOT NULL,
  page_count integer,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft','published','retired')),
  published_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.academy_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  course_id uuid REFERENCES public.academy_courses(id) ON DELETE CASCADE,
  lesson_id uuid REFERENCES public.academy_lessons(id) ON DELETE CASCADE,
  rating integer CHECK (rating BETWEEN 1 AND 5),
  comment text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.academy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor uuid,
  event_type text NOT NULL,
  entity text NOT NULL,
  entity_id uuid,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.academy_courses TO authenticated;
GRANT SELECT ON public.academy_modules TO authenticated;
GRANT SELECT ON public.academy_lessons TO authenticated;
GRANT SELECT ON public.academy_manual_versions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academy_enrollments TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.academy_lesson_progress TO authenticated;
GRANT SELECT, INSERT ON public.academy_feedback TO authenticated;
GRANT SELECT ON public.academy_events TO authenticated;
GRANT ALL ON public.academy_courses TO service_role;
GRANT ALL ON public.academy_modules TO service_role;
GRANT ALL ON public.academy_lessons TO service_role;
GRANT ALL ON public.academy_manual_versions TO service_role;
GRANT ALL ON public.academy_enrollments TO service_role;
GRANT ALL ON public.academy_lesson_progress TO service_role;
GRANT ALL ON public.academy_feedback TO service_role;
GRANT ALL ON public.academy_events TO service_role;

ALTER TABLE public.academy_courses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_modules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lessons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_manual_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_lesson_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY academy_courses_read ON public.academy_courses FOR SELECT TO authenticated
  USING (status = 'published' OR public._academy_may_manage());
CREATE POLICY academy_courses_manage ON public.academy_courses FOR ALL TO authenticated
  USING (public._academy_may_manage()) WITH CHECK (public._academy_may_manage());

CREATE POLICY academy_modules_read ON public.academy_modules FOR SELECT TO authenticated
  USING (public._academy_may_manage() OR EXISTS (
    SELECT 1 FROM public.academy_courses c WHERE c.id = course_id AND c.status = 'published'));
CREATE POLICY academy_modules_manage ON public.academy_modules FOR ALL TO authenticated
  USING (public._academy_may_manage()) WITH CHECK (public._academy_may_manage());

CREATE POLICY academy_lessons_read ON public.academy_lessons FOR SELECT TO authenticated
  USING (public._academy_may_manage() OR EXISTS (
    SELECT 1 FROM public.academy_modules m
    JOIN public.academy_courses c ON c.id = m.course_id
    WHERE m.id = module_id AND c.status = 'published'));
CREATE POLICY academy_lessons_manage ON public.academy_lessons FOR ALL TO authenticated
  USING (public._academy_may_manage()) WITH CHECK (public._academy_may_manage());

CREATE POLICY academy_manual_read ON public.academy_manual_versions FOR SELECT TO authenticated
  USING (status = 'published' OR public._academy_may_manage());
CREATE POLICY academy_manual_manage ON public.academy_manual_versions FOR ALL TO authenticated
  USING (public._academy_may_manage()) WITH CHECK (public._academy_may_manage());

CREATE POLICY academy_enrollments_own ON public.academy_enrollments FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public._academy_may_manage())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY academy_progress_own ON public.academy_lesson_progress FOR ALL TO authenticated
  USING (user_id = auth.uid() OR public._academy_may_manage())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY academy_feedback_own ON public.academy_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public._academy_may_manage());
CREATE POLICY academy_feedback_insert ON public.academy_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY academy_events_read ON public.academy_events FOR SELECT TO authenticated
  USING (actor = auth.uid() OR public._academy_may_manage());

-- Append-only activity log.
CREATE OR REPLACE FUNCTION public._academy_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'academy_events is append-only';
END $$;
CREATE TRIGGER academy_events_no_change BEFORE UPDATE OR DELETE ON public.academy_events
  FOR EACH ROW EXECUTE FUNCTION public._academy_events_append_only();

CREATE OR REPLACE FUNCTION public._academy_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
CREATE TRIGGER academy_courses_touch BEFORE UPDATE ON public.academy_courses FOR EACH ROW EXECUTE FUNCTION public._academy_touch();
CREATE TRIGGER academy_modules_touch BEFORE UPDATE ON public.academy_modules FOR EACH ROW EXECUTE FUNCTION public._academy_touch();
CREATE TRIGGER academy_lessons_touch BEFORE UPDATE ON public.academy_lessons FOR EACH ROW EXECUTE FUNCTION public._academy_touch();

-- Enrol the caller on a published course (idempotent).
CREATE OR REPLACE FUNCTION public.academy_enroll(p_course_code text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course uuid; v_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT id INTO v_course FROM public.academy_courses WHERE code = p_course_code AND status = 'published';
  IF v_course IS NULL THEN RAISE EXCEPTION 'course not available: %', p_course_code; END IF;
  INSERT INTO public.academy_enrollments (user_id, course_id)
  VALUES (auth.uid(), v_course)
  ON CONFLICT (user_id, course_id) DO UPDATE SET status = public.academy_enrollments.status
  RETURNING id INTO v_id;
  INSERT INTO public.academy_events (actor, event_type, entity, entity_id)
  VALUES (auth.uid(), 'enrolled', 'course', v_course);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.academy_enroll(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_enroll(text) TO authenticated, service_role;

-- Record that the caller finished a lesson; completes the course when all lessons are done.
CREATE OR REPLACE FUNCTION public.academy_lesson_complete(p_lesson_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course uuid; v_total int; v_done int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'authentication required'; END IF;
  SELECT c.id INTO v_course
  FROM public.academy_lessons l
  JOIN public.academy_modules m ON m.id = l.module_id
  JOIN public.academy_courses c ON c.id = m.course_id
  WHERE l.id = p_lesson_id AND c.status = 'published';
  IF v_course IS NULL THEN RAISE EXCEPTION 'lesson not available'; END IF;

  INSERT INTO public.academy_enrollments (user_id, course_id) VALUES (auth.uid(), v_course)
  ON CONFLICT (user_id, course_id) DO NOTHING;

  INSERT INTO public.academy_lesson_progress (user_id, lesson_id, course_id)
  VALUES (auth.uid(), p_lesson_id, v_course)
  ON CONFLICT (user_id, lesson_id) DO NOTHING;

  SELECT count(*) INTO v_total FROM public.academy_lessons l
    JOIN public.academy_modules m ON m.id = l.module_id WHERE m.course_id = v_course;
  SELECT count(*) INTO v_done FROM public.academy_lesson_progress
    WHERE user_id = auth.uid() AND course_id = v_course;

  IF v_total > 0 AND v_done >= v_total THEN
    UPDATE public.academy_enrollments
      SET status = 'completed', completed_at = coalesce(completed_at, now())
      WHERE user_id = auth.uid() AND course_id = v_course;
  END IF;

  INSERT INTO public.academy_events (actor, event_type, entity, entity_id, detail)
  VALUES (auth.uid(), 'lesson_completed', 'lesson', p_lesson_id,
          jsonb_build_object('course_id', v_course, 'completed', v_done, 'total', v_total));

  RETURN jsonb_build_object('course_id', v_course, 'completed', v_done, 'total', v_total,
                            'course_completed', (v_total > 0 AND v_done >= v_total));
END $$;
REVOKE ALL ON FUNCTION public.academy_lesson_complete(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_lesson_complete(uuid) TO authenticated, service_role;

-- Caller's own learning record across every published course.
CREATE OR REPLACE FUNCTION public.academy_my_progress()
RETURNS TABLE (course_id uuid, course_code text, title text, status text, total_lessons bigint, completed_lessons bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT c.id, c.code, c.title,
         coalesce(e.status, 'not_started') AS status,
         (SELECT count(*) FROM public.academy_lessons l JOIN public.academy_modules m ON m.id = l.module_id WHERE m.course_id = c.id),
         (SELECT count(*) FROM public.academy_lesson_progress p WHERE p.course_id = c.id AND p.user_id = auth.uid())
  FROM public.academy_courses c
  LEFT JOIN public.academy_enrollments e ON e.course_id = c.id AND e.user_id = auth.uid()
  WHERE c.status = 'published'
  ORDER BY c.sort_order, c.title
$$;
REVOKE ALL ON FUNCTION public.academy_my_progress() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_my_progress() TO authenticated, service_role;

-- Administrative content authoring: upsert a whole course from one document.
CREATE OR REPLACE FUNCTION public.academy_course_upsert(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_course uuid; v_module uuid; m jsonb; l jsonb;
BEGIN
  IF NOT public._academy_may_manage() THEN RAISE EXCEPTION 'not authorised to author academy content'; END IF;

  INSERT INTO public.academy_courses (code, title, summary, track, level, audience_roles, status,
                                      estimated_minutes, sort_order, is_mandatory, changelog, created_by,
                                      published_at)
  VALUES (p->>'code', p->>'title', coalesce(p->>'summary',''), coalesce(p->>'track','workspace'),
          coalesce(p->>'level','foundation'),
          coalesce((SELECT array_agg(value::text) FROM jsonb_array_elements_text(coalesce(p->'audience_roles','[]'::jsonb)) value), '{}'),
          coalesce(p->>'status','draft'), coalesce((p->>'estimated_minutes')::int, 0),
          coalesce((p->>'sort_order')::numeric, 100), coalesce((p->>'is_mandatory')::boolean, false),
          coalesce(p->>'changelog',''), auth.uid(),
          CASE WHEN coalesce(p->>'status','draft') = 'published' THEN now() ELSE NULL END)
  ON CONFLICT (code) DO UPDATE SET
    title = excluded.title, summary = excluded.summary, track = excluded.track, level = excluded.level,
    audience_roles = excluded.audience_roles, status = excluded.status,
    estimated_minutes = excluded.estimated_minutes, sort_order = excluded.sort_order,
    is_mandatory = excluded.is_mandatory, changelog = excluded.changelog,
    version = public.academy_courses.version + 1,
    published_at = CASE WHEN excluded.status = 'published' THEN coalesce(public.academy_courses.published_at, now()) ELSE public.academy_courses.published_at END
  RETURNING id INTO v_course;

  IF p ? 'modules' THEN
    DELETE FROM public.academy_modules WHERE course_id = v_course
      AND code NOT IN (SELECT value->>'code' FROM jsonb_array_elements(p->'modules') value);

    FOR m IN SELECT * FROM jsonb_array_elements(p->'modules') LOOP
      INSERT INTO public.academy_modules (course_id, code, title, summary, sort_order)
      VALUES (v_course, m->>'code', m->>'title', coalesce(m->>'summary',''), coalesce((m->>'sort_order')::numeric, 100))
      ON CONFLICT (course_id, code) DO UPDATE SET title = excluded.title, summary = excluded.summary,
        sort_order = excluded.sort_order
      RETURNING id INTO v_module;

      DELETE FROM public.academy_lessons WHERE module_id = v_module
        AND code NOT IN (SELECT value->>'code' FROM jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) value);

      FOR l IN SELECT * FROM jsonb_array_elements(coalesce(m->'lessons','[]'::jsonb)) LOOP
        INSERT INTO public.academy_lessons (module_id, code, title, body_md, route_path, minutes, sort_order, resources)
        VALUES (v_module, l->>'code', l->>'title', coalesce(l->>'body_md',''), l->>'route_path',
                coalesce((l->>'minutes')::int, 5), coalesce((l->>'sort_order')::numeric, 100),
                coalesce(l->'resources','[]'::jsonb))
        ON CONFLICT (module_id, code) DO UPDATE SET title = excluded.title, body_md = excluded.body_md,
          route_path = excluded.route_path, minutes = excluded.minutes, sort_order = excluded.sort_order,
          resources = excluded.resources;
      END LOOP;
    END LOOP;
  END IF;

  INSERT INTO public.academy_events (actor, event_type, entity, entity_id, detail)
  VALUES (auth.uid(), 'course_upserted', 'course', v_course, jsonb_build_object('code', p->>'code', 'status', p->>'status'));

  RETURN v_course;
END $$;
REVOKE ALL ON FUNCTION public.academy_course_upsert(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_course_upsert(jsonb) TO authenticated, service_role;

-- Publish a training-manual release; the previous published release is retired.
CREATE OR REPLACE FUNCTION public.academy_manual_publish(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public._academy_may_manage() THEN RAISE EXCEPTION 'not authorised to publish the training manual'; END IF;
  UPDATE public.academy_manual_versions SET status = 'retired'
    WHERE status = 'published' AND version <> (p->>'version');
  INSERT INTO public.academy_manual_versions (version, title, summary, changelog, document_path, page_count, status, created_by)
  VALUES (p->>'version', p->>'title', coalesce(p->>'summary',''), coalesce(p->>'changelog',''),
          p->>'document_path', (p->>'page_count')::int, 'published', auth.uid())
  ON CONFLICT (version) DO UPDATE SET title = excluded.title, summary = excluded.summary,
    changelog = excluded.changelog, document_path = excluded.document_path,
    page_count = excluded.page_count, status = 'published', published_at = now()
  RETURNING id INTO v_id;
  INSERT INTO public.academy_events (actor, event_type, entity, entity_id, detail)
  VALUES (auth.uid(), 'manual_published', 'manual', v_id, jsonb_build_object('version', p->>'version'));
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.academy_manual_publish(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.academy_manual_publish(jsonb) TO authenticated, service_role;
