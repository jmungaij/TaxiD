ALTER TABLE public.rec_skills
  ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'PENDING_REVIEW',
  ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

ALTER TABLE public.rec_skills DROP CONSTRAINT IF EXISTS rec_skills_moderation_status_chk;
ALTER TABLE public.rec_skills
  ADD CONSTRAINT rec_skills_moderation_status_chk
  CHECK (moderation_status IN ('PENDING_REVIEW','APPROVED','REJECTED'));

-- curate existing rows: single-line, reasonably short names stay public
UPDATE public.rec_skills
   SET moderation_status = 'APPROVED',
       reviewed_at = now()
 WHERE name ~ '^[A-Za-z0-9][A-Za-z0-9 ,.&/()+#-]{1,79}$';

CREATE OR REPLACE FUNCTION public._rec_skill_moderation_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_name text;
BEGIN
  v_name := btrim(regexp_replace(regexp_replace(coalesce(NEW.name, ''), '[\r\n\t]+', ' ', 'g'), '\s{2,}', ' ', 'g'));
  v_name := left(v_name, 80);
  IF char_length(v_name) < 2 THEN
    RAISE EXCEPTION 'invalid skill name';
  END IF;
  NEW.name := v_name;
  NEW.slug := btrim(regexp_replace(regexp_replace(lower(v_name), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'));

  IF NEW.moderation_status IS NULL OR NEW.moderation_status NOT IN ('PENDING_REVIEW','APPROVED','REJECTED') THEN
    NEW.moderation_status := 'PENDING_REVIEW';
  END IF;

  -- only recruitment staff may publish a skill to the public catalogue
  IF NEW.moderation_status = 'APPROVED' AND NOT coalesce(public.rec_can_write(), false) THEN
    NEW.moderation_status := 'PENDING_REVIEW';
  END IF;

  IF NEW.moderation_status = 'APPROVED' THEN
    NEW.reviewed_by := coalesce(NEW.reviewed_by, auth.uid());
    NEW.reviewed_at := coalesce(NEW.reviewed_at, now());
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rec_skill_moderation_guard ON public.rec_skills;
CREATE TRIGGER rec_skill_moderation_guard
  BEFORE INSERT OR UPDATE ON public.rec_skills
  FOR EACH ROW EXECUTE FUNCTION public._rec_skill_moderation_guard();

DROP POLICY IF EXISTS "skills are public reference data" ON public.rec_skills;
CREATE POLICY "approved skills are public reference data"
  ON public.rec_skills FOR SELECT
  USING (moderation_status = 'APPROVED');

COMMENT ON TABLE public.rec_skills IS 'Public skill catalogue. Only moderation_status = APPROVED rows are publicly readable; application-sourced names are normalised and start as PENDING_REVIEW until recruitment staff approve them.';