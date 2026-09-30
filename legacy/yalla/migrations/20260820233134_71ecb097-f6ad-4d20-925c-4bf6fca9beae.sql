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
  required_documents text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    s.vacancy_id,
    pv.public_slug,
    s.internship_type,
    s.duration_weeks,
    s.start_date,
    s.end_date,
    s.application_deadline,
    s.host_function,
    s.business_unit,
    s.programme_purpose,
    NULLIF(s.public_preview->>'summary', '') AS summary,
    NULLIF(s.public_preview->>'what_you_will_do', '') AS what_you_will_do,
    NULLIF(s.public_preview->>'what_you_will_learn', '') AS what_you_will_learn,
    NULLIF(s.public_preview->>'who_should_apply', '') AS who_should_apply,
    COALESCE(s.learning_outcomes, '[]'::jsonb) AS learning_outcomes,
    COALESCE(s.practical_capabilities, '{}'::text[]) AS practical_capabilities,
    COALESCE(s.success_profile, '{}'::text[]) AS success_profile,
    COALESCE(s.required_documents, '{}'::text[]) AS required_documents
  FROM public.rec_public_vacancy(p_slug) pv
  JOIN public.rec_internship_specs s ON s.vacancy_id = pv.id
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.rec_public_internship(text) FROM public;
GRANT EXECUTE ON FUNCTION public.rec_public_internship(text) TO anon, authenticated;