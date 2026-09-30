-- 1) cta_events: bind user_id to the caller, keep field sanity checks
DROP POLICY IF EXISTS "public can insert CTA events" ON public.cta_events;
CREATE POLICY "public can insert CTA events"
  ON public.cta_events FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (user_id IS NULL OR user_id = auth.uid())
    AND button_name IS NOT NULL AND length(button_name) BETWEEN 1 AND 200
    AND action_type IS NOT NULL AND length(action_type) BETWEEN 1 AND 100
    AND (target IS NULL OR length(target) <= 500)
    AND (page_source IS NULL OR length(page_source) <= 500)
    AND (session_id IS NULL OR length(session_id) <= 128)
    AND (campaign_source IS NULL OR length(campaign_source) <= 200)
    AND (utm_source IS NULL OR length(utm_source) <= 200)
    AND (utm_medium IS NULL OR length(utm_medium) <= 200)
    AND (utm_campaign IS NULL OR length(utm_campaign) <= 200)
    AND (user_role IS NULL OR length(user_role) <= 64)
    AND converted = false
    AND converted_at IS NULL
    AND conversion_value IS NULL
    AND pg_column_size(metadata) <= 8192
  );

-- 2) partner_applications: validate public intake payloads and bind submitted_by
DROP POLICY IF EXISTS "partner_applications_insert" ON public.partner_applications;
CREATE POLICY "partner_applications_insert"
  ON public.partner_applications FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    (submitted_by IS NULL OR submitted_by = auth.uid())
    AND status = 'submitted'
    AND review_notes IS NULL
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND partner_id IS NULL
    AND length(btrim(organisation_name)) BETWEEN 2 AND 200
    AND length(btrim(contact_name)) BETWEEN 2 AND 150
    AND btrim(contact_email) ~ '^[^@[:space:]]+@[^@[:space:]]+\.[A-Za-z]{2,}$'
    AND length(btrim(contact_email)) <= 254
    AND length(btrim(contact_phone)) BETWEEN 7 AND 30
    AND length(btrim(country)) BETWEEN 2 AND 100
    AND (city IS NULL OR length(city) <= 120)
    AND (website IS NULL OR length(website) <= 500)
    AND (category IS NULL OR length(category) <= 120)
    AND (requirements IS NULL OR length(requirements) <= 5000)
    AND (intent_bring IS NULL OR length(intent_bring) <= 2000)
    AND (network_category IS NULL OR length(network_category) <= 120)
    AND (maturity_level IS NULL OR length(maturity_level) <= 60)
    AND (lifecycle_stage IS NULL OR length(lifecycle_stage) <= 60)
    AND (ab_variant IS NULL OR length(ab_variant) <= 60)
    AND (session_id IS NULL OR length(session_id) <= 128)
    AND (monthly_volume_estimate IS NULL OR (monthly_volume_estimate >= 0 AND monthly_volume_estimate <= 10000000))
  );