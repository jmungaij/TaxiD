-- Normalise "not declared" academic facts to NULL and keep them that way.
UPDATE public.intern_academic_profiles
SET qualification_level = NULLIF(btrim(qualification_level), ''),
    programme           = NULLIF(btrim(programme), ''),
    institution         = NULLIF(btrim(institution), '')
WHERE btrim(coalesce(qualification_level, '')) = ''
   OR btrim(coalesce(programme, '')) = ''
   OR btrim(coalesce(institution, '')) = ''
   OR qualification_level <> btrim(qualification_level)
   OR programme <> btrim(programme)
   OR institution <> btrim(institution);

CREATE OR REPLACE FUNCTION public._intern_academic_profile_normalise()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.qualification_level := NULLIF(btrim(NEW.qualification_level), '');
  NEW.programme           := NULLIF(btrim(NEW.programme), '');
  NEW.institution         := NULLIF(btrim(NEW.institution), '');
  NEW.specialisation      := NULLIF(btrim(NEW.specialisation), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_intern_academic_profile_normalise ON public.intern_academic_profiles;
CREATE TRIGGER trg_intern_academic_profile_normalise
BEFORE INSERT OR UPDATE ON public.intern_academic_profiles
FOR EACH ROW EXECUTE FUNCTION public._intern_academic_profile_normalise();

CREATE INDEX IF NOT EXISTS idx_intern_academic_profiles_qualification_missing
  ON public.intern_academic_profiles (created_at DESC)
  WHERE qualification_level IS NULL;