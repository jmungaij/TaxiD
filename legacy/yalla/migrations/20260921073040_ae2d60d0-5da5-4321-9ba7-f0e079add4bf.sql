-- 1. Consent tracking + public display name
ALTER TABLE public.driver_success_stories
  ADD COLUMN IF NOT EXISTS display_name TEXT,
  ADD COLUMN IF NOT EXISTS consent_reference TEXT,
  ADD COLUMN IF NOT EXISTS consent_recorded_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS consent_evidence_url TEXT;

-- Public display name: first name + surname initial, never the full name.
UPDATE public.driver_success_stories
   SET display_name = split_part(driver_name, ' ', 1)
       || CASE WHEN split_part(driver_name, ' ', 2) <> ''
               THEN ' ' || left(split_part(driver_name, ' ', 2), 1) || '.'
               ELSE '' END
 WHERE display_name IS NULL;

-- 2. Publishing an earnings figure requires recorded consent.
CREATE OR REPLACE FUNCTION public.tg_driver_story_requires_consent()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.display_name IS NULL OR btrim(NEW.display_name) = '' THEN
    NEW.display_name := split_part(NEW.driver_name, ' ', 1)
      || CASE WHEN split_part(NEW.driver_name, ' ', 2) <> ''
              THEN ' ' || left(split_part(NEW.driver_name, ' ', 2), 1) || '.'
              ELSE '' END;
  END IF;

  IF NEW.is_published
     AND NEW.monthly_earnings_cents IS NOT NULL
     AND (NEW.consent_reference IS NULL OR btrim(NEW.consent_reference) = ''
          OR NEW.consent_recorded_at IS NULL) THEN
    RAISE EXCEPTION 'DRIVER_STORY_CONSENT_REQUIRED: publishing earnings for a named driver requires consent_reference and consent_recorded_at';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.tg_driver_story_requires_consent() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tg_driver_story_requires_consent() TO service_role;

DROP TRIGGER IF EXISTS trg_driver_story_consent ON public.driver_success_stories;
CREATE TRIGGER trg_driver_story_consent
  BEFORE INSERT OR UPDATE ON public.driver_success_stories
  FOR EACH ROW EXECUTE FUNCTION public.tg_driver_story_requires_consent();

-- 3. The base table is no longer a public read surface.
DROP POLICY IF EXISTS "Stories public" ON public.driver_success_stories;
REVOKE SELECT ON public.driver_success_stories FROM anon;

-- 4. Safe published feed: display name only, earnings as a band, band only with consent.
CREATE OR REPLACE FUNCTION public.driver_success_stories_published(_limit integer DEFAULT 6)
RETURNS TABLE (
  id uuid,
  display_name text,
  city text,
  vehicle_type text,
  headline text,
  body text,
  rating numeric,
  years_on_platform numeric,
  earnings_band text,
  avatar_url text,
  published_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.id,
         s.display_name,
         s.city,
         s.vehicle_type,
         s.headline,
         s.body,
         s.rating,
         s.years_on_platform,
         CASE
           WHEN s.monthly_earnings_cents IS NULL THEN NULL
           WHEN s.consent_reference IS NULL OR s.consent_recorded_at IS NULL THEN NULL
           WHEN s.monthly_earnings_cents < 5000000 THEN 'Under KES 50,000'
           WHEN s.monthly_earnings_cents < 10000000 THEN 'KES 50,000 - 100,000'
           WHEN s.monthly_earnings_cents < 15000000 THEN 'KES 100,000 - 150,000'
           ELSE 'KES 150,000+'
         END AS earnings_band,
         s.avatar_url,
         s.published_at
    FROM public.driver_success_stories s
   WHERE s.is_published
   ORDER BY s.published_at DESC
   LIMIT greatest(1, least(coalesce(_limit, 6), 24));
$$;

REVOKE EXECUTE ON FUNCTION public.driver_success_stories_published(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_success_stories_published(integer) TO anon, authenticated, service_role;
