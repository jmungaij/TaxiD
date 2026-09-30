
INSERT INTO public.training_categories (code, name, description, sort_order) VALUES
  ('ONBOARDING','Driver Onboarding','Orientation and platform basics',1),
  ('TRAFFIC','Kenyan Traffic Laws','Road signs, markings and the Highway Code',2),
  ('NTSA','NTSA & PSV Compliance','NTSA examinations and PSV regulatory requirements',3),
  ('DEFENSIVE','Defensive Driving','Hazard anticipation and safe driving practices',4),
  ('EMERGENCY','Safety & Emergency Response','Accidents, SOS and incident reporting',5),
  ('DIGITAL','Digital Driver Operations','Driver app, navigation, wallet and payouts',6)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.training_videos
  ADD COLUMN IF NOT EXISTS is_mandatory boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS checkpoint_count integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS external_code text;

CREATE OR REPLACE FUNCTION pg_temp.seed_academy_video(
  p_course_slug text, p_module_code text, p_module_title text,
  p_lesson_title text, p_video_title text, p_url text, p_provider text,
  p_min_pct int, p_duration int, p_external_code text
) RETURNS void LANGUAGE plpgsql AS $body$
DECLARE c uuid; m uuid; l uuid; v uuid;
BEGIN
  SELECT id INTO c FROM public.training_courses WHERE slug = p_course_slug;
  IF c IS NULL THEN RETURN; END IF;

  SELECT id INTO m FROM public.training_modules WHERE course_id=c AND code=p_module_code;
  IF m IS NULL THEN
    INSERT INTO public.training_modules (course_id, code, title, sort_order, duration_minutes, is_required)
    VALUES (c, p_module_code, p_module_title,
      COALESCE((SELECT MAX(sort_order)+1 FROM public.training_modules WHERE course_id=c),1),
      GREATEST(p_duration/60,5), true)
    RETURNING id INTO m;
  END IF;

  SELECT id INTO l FROM public.training_lessons WHERE module_id=m AND title=p_lesson_title;
  IF l IS NULL THEN
    INSERT INTO public.training_lessons (module_id, title, lesson_type, duration_minutes, sort_order, is_required)
    VALUES (m, p_lesson_title, 'video', GREATEST(p_duration/60,1),
      COALESCE((SELECT MAX(sort_order)+1 FROM public.training_lessons WHERE module_id=m),1), true)
    RETURNING id INTO l;
  END IF;

  SELECT id INTO v FROM public.training_videos WHERE external_code = p_external_code;
  IF v IS NULL THEN
    INSERT INTO public.training_videos
      (lesson_id, provider, url, title, duration_seconds, min_watch_percent,
       checkpoints, is_mandatory, sort_order, checkpoint_count, external_code)
    VALUES (l, p_provider, p_url, p_video_title, p_duration, p_min_pct,
      '[20,40,60,80,100]'::jsonb, true, 1, 5, p_external_code);
  ELSE
    UPDATE public.training_videos
      SET lesson_id = l, url = p_url, title = p_video_title, provider = p_provider,
          duration_seconds = p_duration, min_watch_percent = p_min_pct,
          checkpoints = '[20,40,60,80,100]'::jsonb
      WHERE id = v;
  END IF;
END $body$;

SELECT pg_temp.seed_academy_video('driver-onboarding-foundation','ORIENTATION','Driver Orientation',
  'Introduction to Yalla Ride','Introduction to Professional Driving',
  'https://www.youtube.com/watch?v=YTXtL3-MDIk','youtube',90,900,'ORIENTATION_001');

SELECT pg_temp.seed_academy_video('driver-onboarding-foundation','TRAFFIC','Kenyan Traffic Laws',
  'Road Signs and Road Markings','Kenyan Road Signs Fundamentals',
  'https://www.youtube.com/results?search_query=kenya+road+signs+ntsa','youtube',95,1200,'TRAFFIC_001');

SELECT pg_temp.seed_academy_video('driver-onboarding-foundation','NTSA','NTSA Theory Preparation',
  'NTSA Examination Preparation','NTSA Real Exam Questions',
  'https://www.youtube.com/watch?v=aBwrxFxTxy0','youtube',90,1500,'NTSA_001');

SELECT pg_temp.seed_academy_video('advanced-safety-driver','DEFENSIVE','Defensive Driving',
  'Defensive Driving Foundations','Defensive Driving Training',
  'https://www.youtube.com/watch?v=YTXtL3-MDIk','youtube',95,1800,'DEFENSIVE_001');

SELECT pg_temp.seed_academy_video('certified-yalla-driver','SERVICE','Passenger Service Excellence',
  'Customer Service for Mobility Professionals','Customer Care in Transportation',
  'https://www.youtube.com/results?search_query=customer+service+transportation+training','youtube',85,1200,'SERVICE_001');

SELECT pg_temp.seed_academy_video('advanced-safety-driver','EMERGENCY','Safety & Emergency Response',
  'Road Incident Management','Road Safety and Emergency Response',
  'https://www.youtube.com/results?search_query=road+safety+emergency+response+training','youtube',95,1500,'SAFETY_001');

SELECT pg_temp.seed_academy_video('certified-yalla-driver','DIGITAL','Digital Driver Operations',
  'Driver App Mastery','Driver Platform Operations',
  'internal_yalla_training_video','yalla',100,900,'DIGITAL_001');

SELECT pg_temp.seed_academy_video('financial-literacy-certification','FINANCE','Financial Literacy',
  'Financial Wellness for Drivers','Financial Literacy Fundamentals',
  'https://www.youtube.com/results?search_query=financial+literacy+for+drivers','youtube',85,1200,'FINANCE_001');
