DROP FUNCTION IF EXISTS public.rec_document_requirements(uuid, text, text, integer, boolean);

CREATE FUNCTION public.rec_document_requirements(
  p_vacancy_id uuid,
  p_education_status text DEFAULT NULL::text,
  p_qualification_level text DEFAULT NULL::text,
  p_completed_years integer DEFAULT NULL::integer,
  p_consolidated boolean DEFAULT false)
RETURNS TABLE(
  rule_id uuid, doc_key text, requirement_key text, label text, doc_class text, doc_type text,
  mandatory boolean, academic_year integer, consolidated boolean, requires_verification boolean,
  why_required text, ord integer, requirement_text text, hard_requirement boolean,
  evidence_kind text, accepted_evidence_types text[], declaration_prompt text, response_required boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.rec_document_requirements_versioned(
    p_vacancy_id, NULL::uuid[], p_education_status, p_qualification_level,
    p_completed_years, p_consolidated);
$$;

REVOKE ALL ON FUNCTION public.rec_document_requirements(uuid, text, text, integer, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rec_document_requirements(uuid, text, text, integer, boolean) TO anon, authenticated, service_role;