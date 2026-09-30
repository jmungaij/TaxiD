-- ============================================================
-- YALLA MOBILITY — SOCIAL PUBLISHING & DISTRIBUTION PLATFORM
-- ============================================================

CREATE OR REPLACE FUNCTION public.social_can_edit()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')
      OR has_role(auth.uid(),'operations_admin')
$$;

CREATE OR REPLACE FUNCTION public.social_can_approve()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')
$$;

CREATE TABLE IF NOT EXISTS public.social_provider_capabilities (
  platform_slug      text PRIMARY KEY REFERENCES public.social_platforms(slug) ON DELETE CASCADE,
  api_version        text,
  auth_kind          text NOT NULL DEFAULT 'OAUTH2',
  supports_text      boolean NOT NULL DEFAULT false,
  supports_image     boolean NOT NULL DEFAULT false,
  supports_video     boolean NOT NULL DEFAULT false,
  supports_carousel  boolean NOT NULL DEFAULT false,
  supports_document  boolean NOT NULL DEFAULT false,
  supports_delete    boolean NOT NULL DEFAULT false,
  supports_analytics boolean NOT NULL DEFAULT false,
  direct_publish     text NOT NULL DEFAULT 'API_DEPENDENT'
                     CHECK (direct_publish IN ('SUPPORTED','API_DEPENDENT','REQUIRES_AUDIT','NOT_SUPPORTED')),
  requires_audit     boolean NOT NULL DEFAULT false,
  caption_max        integer,
  media_max_mb       integer,
  scheduling_owner   text NOT NULL DEFAULT 'APP',
  cost_model         text NOT NULL DEFAULT 'UNKNOWN',
  docs_url           text,
  notes              text,
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_connections (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL UNIQUE REFERENCES public.social_accounts(id) ON DELETE CASCADE,
  platform_slug       text NOT NULL REFERENCES public.social_platforms(slug) ON DELETE RESTRICT,
  state               text NOT NULL DEFAULT 'NOT_CONNECTED'
                      CHECK (state IN ('NOT_CONNECTED','NOT_CONFIGURED','CONNECTING','CONNECTED',
                                       'TOKEN_EXPIRING','TOKEN_EXPIRED','REAUTH_REQUIRED','SUSPENDED','DISCONNECTED')),
  external_account_id text,
  external_account_name text,
  granted_scopes      text[] NOT NULL DEFAULT '{}',
  token_expires_at    timestamptz,
  last_sync_at        timestamptz,
  last_publication_at timestamptz,
  last_error_code     text,
  last_error_message  text,
  connected_by        uuid,
  connected_at        timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_credentials (
  connection_id  uuid PRIMARY KEY REFERENCES public.social_connections(id) ON DELETE CASCADE,
  access_token   text,
  refresh_token  text,
  token_type     text,
  expires_at     timestamptz,
  scopes         text[],
  rotated_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_media_assets (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename      text NOT NULL,
  mime_type     text NOT NULL,
  size_bytes    bigint,
  width         integer,
  height        integer,
  duration_ms   integer,
  checksum      text,
  storage_path  text NOT NULL,
  campaign_id   uuid REFERENCES public.social_campaigns(id) ON DELETE SET NULL,
  license       text,
  status        text NOT NULL DEFAULT 'READY' CHECK (status IN ('UPLOADING','PROCESSING','READY','BLOCKED','ARCHIVED')),
  validation    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.social_posts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id    uuid REFERENCES public.social_campaigns(id) ON DELETE SET NULL,
  title          text NOT NULL,
  master_caption text NOT NULL DEFAULT '',
  internal_notes text,
  market         text NOT NULL DEFAULT 'GLOBAL',
  template_key   text,
  ai_assisted    boolean NOT NULL DEFAULT false,
  status         text NOT NULL DEFAULT 'DRAFT'
                 CHECK (status IN ('DRAFT','SUBMITTED','IN_REVIEW','CHANGES_REQUESTED','APPROVED','SCHEDULED','PUBLISHING','PUBLISHED','PARTIALLY_PUBLISHED','FAILED','ARCHIVED')),
  version        integer NOT NULL DEFAULT 1,
  approved_version integer,
  approved_by    uuid,
  approved_at    timestamptz,
  scheduled_at   timestamptz,
  published_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_posts_status_idx ON public.social_posts(status, scheduled_at);

CREATE TABLE IF NOT EXISTS public.social_post_variants (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id          uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  platform_slug    text NOT NULL REFERENCES public.social_platforms(slug) ON DELETE RESTRICT,
  account_id       uuid NOT NULL REFERENCES public.social_accounts(id) ON DELETE RESTRICT,
  caption          text NOT NULL DEFAULT '',
  headline         text,
  media_asset_ids  uuid[] NOT NULL DEFAULT '{}',
  destination_url  text,
  platform_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  status           text NOT NULL DEFAULT 'DRAFT'
                   CHECK (status IN ('DRAFT','VALIDATED','APPROVED','SCHEDULED','QUEUED','PUBLISHING','PUBLISHED','FAILED','CANCELLED','DELETED')),
  version          integer NOT NULL DEFAULT 1,
  content_hash     text,
  approved_hash    text,
  external_post_id text,
  external_url     text,
  published_at     timestamptz,
  failure_code     text,
  failure_message  text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (post_id, platform_slug, account_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS social_post_variants_external_idx
  ON public.social_post_variants(platform_slug, external_post_id) WHERE external_post_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.social_publication_jobs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id       uuid NOT NULL REFERENCES public.social_post_variants(id) ON DELETE CASCADE,
  post_id          uuid NOT NULL REFERENCES public.social_posts(id) ON DELETE CASCADE,
  platform_slug    text NOT NULL,
  account_id       uuid NOT NULL,
  idempotency_key  text NOT NULL UNIQUE,
  state            text NOT NULL DEFAULT 'QUEUED'
                   CHECK (state IN ('QUEUED','VALIDATING','MEDIA_UPLOADING','PUBLISHING','PLATFORM_ACCEPTED','PUBLISHED',
                                    'FAILED','RETRY_PENDING','RETRYING','FAILED_PERMANENTLY','CANCELLED','DEAD_LETTER')),
  dry_run          boolean NOT NULL DEFAULT false,
  attempt          integer NOT NULL DEFAULT 0,
  max_attempts     integer NOT NULL DEFAULT 5,
  scheduled_for    timestamptz NOT NULL DEFAULT now(),
  next_attempt_at  timestamptz NOT NULL DEFAULT now(),
  locked_by        text,
  locked_at        timestamptz,
  error_code       text,
  error_message    text,
  provider_ref     jsonb,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_jobs_due_idx ON public.social_publication_jobs(state, next_attempt_at);

CREATE TABLE IF NOT EXISTS public.social_post_metrics (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id    uuid NOT NULL REFERENCES public.social_post_variants(id) ON DELETE CASCADE,
  platform_slug text NOT NULL,
  metric        text NOT NULL,
  value         numeric NOT NULL,
  source        text NOT NULL DEFAULT 'PROVIDER_API',
  captured_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, metric, captured_at)
);

CREATE TABLE IF NOT EXISTS public.social_webhook_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider        text NOT NULL,
  event_id        text NOT NULL,
  signature_valid boolean NOT NULL DEFAULT false,
  payload         jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at    timestamptz,
  error           text,
  received_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, event_id)
);

CREATE TABLE IF NOT EXISTS public.social_content_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  post_id       uuid,
  variant_id    uuid,
  job_id        uuid,
  account_id    uuid,
  actor_user_id uuid,
  action        text NOT NULL,
  result        text NOT NULL DEFAULT 'OK',
  detail        jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS social_content_events_post_idx ON public.social_content_events(post_id, created_at DESC);

GRANT SELECT ON public.social_provider_capabilities TO anon, authenticated;
GRANT ALL    ON public.social_provider_capabilities TO service_role;
GRANT SELECT ON public.social_connections TO authenticated;
GRANT ALL    ON public.social_connections TO service_role;
GRANT ALL    ON public.social_credentials TO service_role;
GRANT SELECT ON public.social_media_assets TO authenticated;
GRANT ALL    ON public.social_media_assets TO service_role;
GRANT SELECT ON public.social_posts TO authenticated;
GRANT ALL    ON public.social_posts TO service_role;
GRANT SELECT ON public.social_post_variants TO authenticated;
GRANT ALL    ON public.social_post_variants TO service_role;
GRANT SELECT ON public.social_publication_jobs TO authenticated;
GRANT ALL    ON public.social_publication_jobs TO service_role;
GRANT SELECT ON public.social_post_metrics TO authenticated;
GRANT ALL    ON public.social_post_metrics TO service_role;
GRANT SELECT ON public.social_webhook_events TO authenticated;
GRANT ALL    ON public.social_webhook_events TO service_role;
GRANT SELECT ON public.social_content_events TO authenticated;
GRANT ALL    ON public.social_content_events TO service_role;

ALTER TABLE public.social_provider_capabilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_connections           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_credentials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_media_assets          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_posts                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_variants         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_publication_jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_post_metrics          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_webhook_events        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.social_content_events        ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS social_caps_public_read ON public.social_provider_capabilities;
CREATE POLICY social_caps_public_read ON public.social_provider_capabilities
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS social_connections_staff_read ON public.social_connections;
CREATE POLICY social_connections_staff_read ON public.social_connections
  FOR SELECT TO authenticated USING (social_can_edit());
DROP POLICY IF EXISTS social_media_staff_read ON public.social_media_assets;
CREATE POLICY social_media_staff_read ON public.social_media_assets
  FOR SELECT TO authenticated USING (social_can_edit());
DROP POLICY IF EXISTS social_posts_staff_read ON public.social_posts;
CREATE POLICY social_posts_staff_read ON public.social_posts
  FOR SELECT TO authenticated USING (social_can_edit());
DROP POLICY IF EXISTS social_variants_staff_read ON public.social_post_variants;
CREATE POLICY social_variants_staff_read ON public.social_post_variants
  FOR SELECT TO authenticated USING (social_can_edit());
DROP POLICY IF EXISTS social_jobs_staff_read ON public.social_publication_jobs;
CREATE POLICY social_jobs_staff_read ON public.social_publication_jobs
  FOR SELECT TO authenticated USING (social_can_edit());
DROP POLICY IF EXISTS social_metrics_staff_read ON public.social_post_metrics;
CREATE POLICY social_metrics_staff_read ON public.social_post_metrics
  FOR SELECT TO authenticated USING (social_can_edit());
DROP POLICY IF EXISTS social_webhooks_admin_read ON public.social_webhook_events;
CREATE POLICY social_webhooks_admin_read ON public.social_webhook_events
  FOR SELECT TO authenticated USING (social_can_approve());
DROP POLICY IF EXISTS social_content_events_staff_read ON public.social_content_events;
CREATE POLICY social_content_events_staff_read ON public.social_content_events
  FOR SELECT TO authenticated USING (social_can_edit());

CREATE OR REPLACE FUNCTION public.social_content_events_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'social_content_events is append-only';
END $$;
DROP TRIGGER IF EXISTS social_content_events_append_only_trg ON public.social_content_events;
CREATE TRIGGER social_content_events_append_only_trg
  BEFORE UPDATE OR DELETE ON public.social_content_events
  FOR EACH ROW EXECUTE FUNCTION public.social_content_events_append_only();

INSERT INTO public.social_provider_capabilities
  (platform_slug, api_version, supports_text, supports_image, supports_video, supports_carousel, supports_document,
   supports_delete, supports_analytics, direct_publish, requires_audit, caption_max, media_max_mb, cost_model, docs_url, notes)
VALUES
  ('linkedin','202401', true,  true,  true,  true,  true,  true,  true,  'SUPPORTED',    false, 3000, 200,'INCLUDED',
   'https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api',
   'Organization posting requires w_organization_social and an authorised organisation ACL.'),
  ('facebook','v19.0',   true,  true,  true,  true,  false, true,  true,  'API_DEPENDENT', false, 63206, 1024,'INCLUDED',
   'https://developers.facebook.com/docs/pages-api','Page publishing requires pages_manage_posts and app review.'),
  ('instagram','v19.0',  true,  true,  true,  true,  false, false, true,  'API_DEPENDENT', false, 2200, 100,'INCLUDED',
   'https://developers.facebook.com/docs/instagram-api','Content publishing requires an approved Instagram Business account.'),
  ('youtube','v3',       false, false, true,  false, false, true,  true,  'SUPPORTED',    false, 5000, 256000,'QUOTA',
   'https://developers.google.com/youtube/v3/docs/videos/insert','Video insert consumes a large daily quota per upload.'),
  ('tiktok','v2',        true,  true,  true,  false, false, false, true,  'REQUIRES_AUDIT', true, 2200, 4096,'INCLUDED',
   'https://developers.tiktok.com/doc/content-posting-api-get-started',
   'Direct public posting requires the Content Posting API product and client audit.'),
  ('x','v2',             true,  true,  true,  false, false, true,  true,  'API_DEPENDENT', false, 280, 512,'USAGE_PRICED',
   'https://developer.x.com','Usage-priced developer platform - publication consumes paid quota.'),
  ('whatsapp','v19.0',   true,  true,  true,  false, true,  false, true,  'API_DEPENDENT', false, 4096, 100,'PER_CONVERSATION',
   'https://developers.facebook.com/docs/whatsapp/cloud-api',
   'Messaging channel, not a feed publisher: outbound sends use approved templates.')
ON CONFLICT (platform_slug) DO UPDATE SET
  api_version = EXCLUDED.api_version, supports_text = EXCLUDED.supports_text,
  supports_image = EXCLUDED.supports_image, supports_video = EXCLUDED.supports_video,
  supports_carousel = EXCLUDED.supports_carousel, supports_document = EXCLUDED.supports_document,
  supports_delete = EXCLUDED.supports_delete, supports_analytics = EXCLUDED.supports_analytics,
  direct_publish = EXCLUDED.direct_publish, requires_audit = EXCLUDED.requires_audit,
  caption_max = EXCLUDED.caption_max, media_max_mb = EXCLUDED.media_max_mb,
  cost_model = EXCLUDED.cost_model, docs_url = EXCLUDED.docs_url, notes = EXCLUDED.notes,
  updated_at = now();

INSERT INTO public.social_connections (account_id, platform_slug)
SELECT a.id, a.platform_slug FROM public.social_accounts a
ON CONFLICT (account_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.social_content_hash(_caption text, _headline text, _media uuid[], _url text, _opts jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT md5(coalesce(_caption,'') || '|' || coalesce(_headline,'') || '|' ||
             coalesce(array_to_string(_media,','),'') || '|' || coalesce(_url,'') || '|' ||
             coalesce(_opts::text,'{}'))
$$;

CREATE OR REPLACE FUNCTION public.social_log(_post uuid, _variant uuid, _job uuid, _account uuid, _action text, _result text, _detail jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.social_content_events(post_id, variant_id, job_id, account_id, actor_user_id, action, result, detail)
  VALUES (_post, _variant, _job, _account, auth.uid(), _action, coalesce(_result,'OK'), _detail)
$$;

CREATE OR REPLACE FUNCTION public.social_save_post(
  _id uuid, _title text, _master_caption text, _campaign uuid, _market text, _notes text, _ai_assisted boolean
) RETURNS public.social_posts
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.social_posts;
BEGIN
  IF NOT social_can_edit() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF coalesce(trim(_title),'') = '' THEN RAISE EXCEPTION 'title_required'; END IF;

  IF _id IS NULL THEN
    INSERT INTO public.social_posts(title, master_caption, campaign_id, market, internal_notes, ai_assisted, created_by)
    VALUES (_title, coalesce(_master_caption,''), _campaign, coalesce(_market,'GLOBAL'), _notes, coalesce(_ai_assisted,false), auth.uid())
    RETURNING * INTO row;
    PERFORM social_log(row.id, NULL, NULL, NULL, 'post_created','OK', jsonb_build_object('title',_title));
  ELSE
    SELECT * INTO row FROM public.social_posts WHERE id = _id FOR UPDATE;
    IF row.id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
    IF row.status IN ('PUBLISHING','PUBLISHED') THEN RAISE EXCEPTION 'post_locked'; END IF;

    UPDATE public.social_posts SET
      title = _title, master_caption = coalesce(_master_caption,''), campaign_id = _campaign,
      market = coalesce(_market, market), internal_notes = _notes, ai_assisted = coalesce(_ai_assisted, ai_assisted),
      version = version + 1,
      status = CASE WHEN status IN ('APPROVED','SCHEDULED') THEN 'CHANGES_REQUESTED' ELSE status END,
      approved_version = CASE WHEN status IN ('APPROVED','SCHEDULED') THEN NULL ELSE approved_version END,
      updated_at = now()
    WHERE id = _id RETURNING * INTO row;

    UPDATE public.social_publication_jobs SET state = 'CANCELLED', updated_at = now()
      WHERE post_id = _id AND state IN ('QUEUED','RETRY_PENDING');
    PERFORM social_log(row.id, NULL, NULL, NULL, 'post_edited','OK', jsonb_build_object('version',row.version));
  END IF;
  RETURN row;
END $$;

CREATE OR REPLACE FUNCTION public.social_save_variant(
  _id uuid, _post uuid, _platform text, _account uuid, _caption text, _headline text,
  _media uuid[], _destination text, _options jsonb
) RETURNS public.social_post_variants
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.social_post_variants; h text; acct public.social_accounts; post public.social_posts;
BEGIN
  IF NOT social_can_edit() THEN RAISE EXCEPTION 'not_authorised'; END IF;

  SELECT * INTO post FROM public.social_posts WHERE id = _post;
  IF post.id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;

  SELECT * INTO acct FROM public.social_accounts WHERE id = _account;
  IF acct.id IS NULL THEN RAISE EXCEPTION 'account_not_found'; END IF;
  IF acct.platform_slug <> _platform THEN RAISE EXCEPTION 'account_platform_mismatch'; END IF;
  IF acct.market <> 'GLOBAL' AND post.market <> 'GLOBAL' AND acct.market <> post.market THEN
    RAISE EXCEPTION 'account_market_mismatch';
  END IF;
  IF _destination IS NOT NULL AND _destination <> '' AND _destination !~* '^https://[a-z0-9.-]+\.[a-z]{2,}(/[^\s<>"'']*)?$' THEN
    RAISE EXCEPTION 'invalid_destination_url';
  END IF;

  h := social_content_hash(_caption, _headline, coalesce(_media,'{}'), _destination, coalesce(_options,'{}'::jsonb));

  INSERT INTO public.social_post_variants(id, post_id, platform_slug, account_id, caption, headline, media_asset_ids,
                                          destination_url, platform_options, content_hash)
  VALUES (coalesce(_id, gen_random_uuid()), _post, _platform, _account, coalesce(_caption,''), _headline,
          coalesce(_media,'{}'), _destination, coalesce(_options,'{}'::jsonb), h)
  ON CONFLICT (post_id, platform_slug, account_id) DO UPDATE SET
    caption = EXCLUDED.caption, headline = EXCLUDED.headline, media_asset_ids = EXCLUDED.media_asset_ids,
    destination_url = EXCLUDED.destination_url, platform_options = EXCLUDED.platform_options,
    content_hash = EXCLUDED.content_hash,
    version = public.social_post_variants.version + 1,
    status = CASE WHEN public.social_post_variants.status IN ('PUBLISHED','PUBLISHING') THEN public.social_post_variants.status ELSE 'DRAFT' END,
    updated_at = now()
  RETURNING * INTO row;

  PERFORM social_log(_post, row.id, NULL, _account, 'variant_saved','OK', jsonb_build_object('platform',_platform));
  RETURN row;
END $$;

CREATE OR REPLACE FUNCTION public.social_submit_post(_post uuid, _note text)
RETURNS public.social_posts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.social_posts; n integer;
BEGIN
  IF NOT social_can_edit() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT count(*) INTO n FROM public.social_post_variants WHERE post_id = _post;
  IF n = 0 THEN RAISE EXCEPTION 'no_platform_variants'; END IF;
  UPDATE public.social_posts SET status = 'SUBMITTED', updated_at = now()
    WHERE id = _post AND status IN ('DRAFT','CHANGES_REQUESTED') RETURNING * INTO row;
  IF row.id IS NULL THEN RAISE EXCEPTION 'invalid_state_transition'; END IF;
  PERFORM social_log(_post, NULL, NULL, NULL, 'post_submitted','OK', jsonb_build_object('note',_note));
  RETURN row;
END $$;

CREATE OR REPLACE FUNCTION public.social_review_post(_post uuid, _decision text, _note text)
RETURNS public.social_posts LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.social_posts;
BEGIN
  IF NOT social_can_approve() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  IF _decision NOT IN ('APPROVED','CHANGES_REQUESTED','IN_REVIEW') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF coalesce(trim(_note),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  SELECT * INTO row FROM public.social_posts WHERE id = _post FOR UPDATE;
  IF row.id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  IF row.status NOT IN ('SUBMITTED','IN_REVIEW') THEN RAISE EXCEPTION 'invalid_state_transition'; END IF;
  IF _decision = 'APPROVED' AND row.created_by = auth.uid() AND NOT has_role(auth.uid(),'super_admin') THEN
    RAISE EXCEPTION 'two_person_control_required';
  END IF;

  UPDATE public.social_posts SET
    status = _decision,
    approved_version = CASE WHEN _decision = 'APPROVED' THEN version ELSE NULL END,
    approved_by      = CASE WHEN _decision = 'APPROVED' THEN auth.uid() ELSE NULL END,
    approved_at      = CASE WHEN _decision = 'APPROVED' THEN now() ELSE NULL END,
    updated_at = now()
  WHERE id = _post RETURNING * INTO row;

  IF _decision = 'APPROVED' THEN
    UPDATE public.social_post_variants SET status = 'APPROVED', approved_hash = content_hash, updated_at = now()
      WHERE post_id = _post AND status NOT IN ('PUBLISHED','PUBLISHING');
  END IF;
  PERFORM social_log(_post, NULL, NULL, NULL, 'post_reviewed', _decision, jsonb_build_object('note',_note));
  RETURN row;
END $$;

CREATE OR REPLACE FUNCTION public.social_schedule_post(_post uuid, _when timestamptz, _dry_run boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE post public.social_posts; v record; created integer := 0; conn public.social_connections; key text;
BEGIN
  IF NOT social_can_edit() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT * INTO post FROM public.social_posts WHERE id = _post FOR UPDATE;
  IF post.id IS NULL THEN RAISE EXCEPTION 'post_not_found'; END IF;
  IF post.status <> 'APPROVED' AND NOT coalesce(_dry_run,false) THEN RAISE EXCEPTION 'content_not_approved'; END IF;

  FOR v IN SELECT * FROM public.social_post_variants WHERE post_id = _post AND status NOT IN ('PUBLISHED','CANCELLED') LOOP
    IF NOT coalesce(_dry_run,false) THEN
      IF v.approved_hash IS DISTINCT FROM v.content_hash THEN RAISE EXCEPTION 'variant_changed_after_approval'; END IF;
      SELECT * INTO conn FROM public.social_connections WHERE account_id = v.account_id;
      IF conn.state <> 'CONNECTED' THEN RAISE EXCEPTION 'account_not_connected:%', v.platform_slug; END IF;
    END IF;

    key := v.post_id::text || ':' || v.platform_slug || ':' || v.account_id::text || ':' || v.version::text
           || CASE WHEN coalesce(_dry_run,false) THEN ':dryrun' ELSE '' END;

    INSERT INTO public.social_publication_jobs(variant_id, post_id, platform_slug, account_id, idempotency_key,
                                               scheduled_for, next_attempt_at, dry_run, created_by)
    VALUES (v.id, _post, v.platform_slug, v.account_id, key,
            coalesce(_when, now()), coalesce(_when, now()), coalesce(_dry_run,false), auth.uid())
    ON CONFLICT (idempotency_key) DO NOTHING;
    IF FOUND THEN created := created + 1; END IF;

    IF NOT coalesce(_dry_run,false) THEN
      UPDATE public.social_post_variants SET status = 'SCHEDULED', updated_at = now() WHERE id = v.id;
    END IF;
  END LOOP;

  IF NOT coalesce(_dry_run,false) THEN
    UPDATE public.social_posts SET status = 'SCHEDULED', scheduled_at = coalesce(_when, now()), updated_at = now()
      WHERE id = _post;
  END IF;
  PERFORM social_log(_post, NULL, NULL, NULL,
    CASE WHEN coalesce(_dry_run,false) THEN 'post_dry_run' ELSE 'post_scheduled' END, 'OK',
    jsonb_build_object('jobs', created, 'scheduled_for', _when));
  RETURN created;
END $$;

CREATE OR REPLACE FUNCTION public.social_cancel_jobs(_post uuid, _reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n integer;
BEGIN
  IF NOT social_can_edit() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  UPDATE public.social_publication_jobs SET state = 'CANCELLED', updated_at = now()
    WHERE post_id = _post AND state IN ('QUEUED','RETRY_PENDING');
  GET DIAGNOSTICS n = ROW_COUNT;
  UPDATE public.social_post_variants SET status = 'APPROVED', updated_at = now()
    WHERE post_id = _post AND status = 'SCHEDULED';
  UPDATE public.social_posts SET status = 'APPROVED', scheduled_at = NULL, updated_at = now()
    WHERE id = _post AND status = 'SCHEDULED';
  PERFORM social_log(_post, NULL, NULL, NULL, 'schedule_cancelled','OK', jsonb_build_object('cancelled',n,'reason',_reason));
  RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.social_claim_jobs(_worker text, _limit integer)
RETURNS SETOF public.social_publication_jobs
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'worker_only'; END IF;
  RETURN QUERY
  WITH due AS (
    SELECT id FROM public.social_publication_jobs
     WHERE state IN ('QUEUED','RETRY_PENDING')
       AND next_attempt_at <= now()
       AND (locked_at IS NULL OR locked_at < now() - interval '10 minutes')
     ORDER BY next_attempt_at
     LIMIT greatest(1, coalesce(_limit,5))
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.social_publication_jobs j
     SET state = 'PUBLISHING', attempt = j.attempt + 1, locked_by = _worker, locked_at = now(), updated_at = now()
    FROM due WHERE j.id = due.id
  RETURNING j.*;
END $$;

CREATE OR REPLACE FUNCTION public.social_complete_job(
  _job uuid, _external_id text, _external_url text, _provider_ref jsonb
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.social_publication_jobs; remaining integer;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'worker_only'; END IF;
  SELECT * INTO j FROM public.social_publication_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;

  IF j.dry_run THEN
    UPDATE public.social_publication_jobs SET state = 'PLATFORM_ACCEPTED', locked_by = NULL, provider_ref = _provider_ref, updated_at = now()
      WHERE id = _job;
    RETURN;
  END IF;

  IF coalesce(_external_id,'') = '' THEN RAISE EXCEPTION 'external_id_required'; END IF;

  UPDATE public.social_publication_jobs
     SET state = 'PUBLISHED', locked_by = NULL, provider_ref = _provider_ref, error_code = NULL, error_message = NULL, updated_at = now()
   WHERE id = _job;
  UPDATE public.social_post_variants
     SET status = 'PUBLISHED', external_post_id = _external_id, external_url = _external_url,
         published_at = now(), failure_code = NULL, failure_message = NULL, updated_at = now()
   WHERE id = j.variant_id;
  UPDATE public.social_connections SET last_publication_at = now(), updated_at = now() WHERE account_id = j.account_id;

  SELECT count(*) INTO remaining FROM public.social_post_variants
    WHERE post_id = j.post_id AND status NOT IN ('PUBLISHED','CANCELLED');
  UPDATE public.social_posts
     SET status = CASE WHEN remaining = 0 THEN 'PUBLISHED' ELSE 'PARTIALLY_PUBLISHED' END,
         published_at = CASE WHEN remaining = 0 THEN now() ELSE published_at END,
         updated_at = now()
   WHERE id = j.post_id;

  INSERT INTO public.social_content_events(post_id, variant_id, job_id, account_id, action, result, detail)
  VALUES (j.post_id, j.variant_id, j.id, j.account_id, 'publication_success','OK',
          jsonb_build_object('external_post_id',_external_id,'external_url',_external_url));
END $$;

CREATE OR REPLACE FUNCTION public.social_fail_job(_job uuid, _code text, _message text, _retryable boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE j public.social_publication_jobs; next_state text; delay interval;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN RAISE EXCEPTION 'worker_only'; END IF;
  SELECT * INTO j FROM public.social_publication_jobs WHERE id = _job FOR UPDATE;
  IF j.id IS NULL THEN RAISE EXCEPTION 'job_not_found'; END IF;

  IF coalesce(_retryable,false) AND j.attempt < j.max_attempts THEN
    next_state := 'RETRY_PENDING';
    delay := (power(2, least(j.attempt, 6)) * interval '1 minute');
  ELSIF coalesce(_retryable,false) THEN
    next_state := 'DEAD_LETTER';
  ELSE
    next_state := 'FAILED_PERMANENTLY';
  END IF;

  UPDATE public.social_publication_jobs
     SET state = next_state, locked_by = NULL,
         next_attempt_at = CASE WHEN next_state = 'RETRY_PENDING' THEN now() + delay ELSE next_attempt_at END,
         error_code = _code, error_message = left(coalesce(_message,''), 1000), updated_at = now()
   WHERE id = _job;

  IF next_state <> 'RETRY_PENDING' THEN
    UPDATE public.social_post_variants
       SET status = 'FAILED', failure_code = _code, failure_message = left(coalesce(_message,''), 1000), updated_at = now()
     WHERE id = j.variant_id;
    UPDATE public.social_posts SET status = 'FAILED', updated_at = now()
     WHERE id = j.post_id AND status IN ('SCHEDULED','PUBLISHING');
  END IF;

  INSERT INTO public.social_content_events(post_id, variant_id, job_id, account_id, action, result, detail)
  VALUES (j.post_id, j.variant_id, j.id, j.account_id, 'publication_failure', next_state,
          jsonb_build_object('code',_code,'message',left(coalesce(_message,''),500),'attempt',j.attempt));
END $$;

CREATE OR REPLACE FUNCTION public.social_requeue_job(_job uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT social_can_approve() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  UPDATE public.social_publication_jobs
     SET state = 'QUEUED', attempt = 0, next_attempt_at = now(), locked_by = NULL, locked_at = NULL, updated_at = now()
   WHERE id = _job AND state IN ('DEAD_LETTER','FAILED','FAILED_PERMANENTLY','CANCELLED');
  PERFORM social_log(NULL, NULL, _job, NULL, 'job_requeued','OK', jsonb_build_object('reason',_reason));
END $$;

CREATE OR REPLACE FUNCTION public.social_set_connection_state(
  _account uuid, _state text, _external_id text, _external_name text, _scopes text[],
  _expires timestamptz, _error_code text, _error_message text
) RETURNS public.social_connections LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE row public.social_connections;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' AND NOT social_can_approve() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  UPDATE public.social_connections SET
    state = _state,
    external_account_id = coalesce(_external_id, external_account_id),
    external_account_name = coalesce(_external_name, external_account_name),
    granted_scopes = coalesce(_scopes, granted_scopes),
    token_expires_at = coalesce(_expires, token_expires_at),
    last_error_code = _error_code, last_error_message = _error_message,
    connected_at = CASE WHEN _state = 'CONNECTED' THEN now() ELSE connected_at END,
    connected_by = CASE WHEN _state = 'CONNECTED' THEN coalesce(auth.uid(), connected_by) ELSE connected_by END,
    last_sync_at = now(), updated_at = now()
  WHERE account_id = _account RETURNING * INTO row;
  IF row.id IS NULL THEN RAISE EXCEPTION 'connection_not_found'; END IF;
  INSERT INTO public.social_account_events(account_id, platform_slug, actor_user_id, action, new_value, reason)
  VALUES (_account, row.platform_slug, auth.uid(), 'connection_state', jsonb_build_object('state',_state), _error_code);
  RETURN row;
END $$;

CREATE OR REPLACE FUNCTION public.social_disconnect_account(_account uuid, _reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE cid uuid;
BEGIN
  IF NOT social_can_approve() THEN RAISE EXCEPTION 'not_authorised'; END IF;
  SELECT id INTO cid FROM public.social_connections WHERE account_id = _account;
  DELETE FROM public.social_credentials WHERE connection_id = cid;
  UPDATE public.social_connections SET state = 'DISCONNECTED', granted_scopes = '{}', token_expires_at = NULL,
         external_account_id = NULL, external_account_name = NULL, updated_at = now()
   WHERE account_id = _account;
  INSERT INTO public.social_account_events(account_id, actor_user_id, action, reason)
  VALUES (_account, auth.uid(), 'account_disconnected', _reason);
END $$;

CREATE OR REPLACE FUNCTION public.social_queue_summary()
RETURNS TABLE (state text, jobs bigint, oldest timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT j.state, count(*)::bigint, min(j.created_at)
    FROM public.social_publication_jobs j
   WHERE public.social_can_edit()
   GROUP BY j.state
$$;

GRANT EXECUTE ON FUNCTION public.social_save_post(uuid,text,text,uuid,text,text,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_save_variant(uuid,uuid,text,uuid,text,text,uuid[],text,jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_submit_post(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_review_post(uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_schedule_post(uuid,timestamptz,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_cancel_jobs(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_requeue_job(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_disconnect_account(uuid,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_queue_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.social_set_connection_state(uuid,text,text,text,text[],timestamptz,text,text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.social_claim_jobs(text,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_complete_job(uuid,text,text,jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.social_fail_job(uuid,text,text,boolean) TO service_role;

-- ============================================================
-- SECURITY: trip_bookings financial field tampering
-- ============================================================
CREATE OR REPLACE FUNCTION public.trip_bookings_guard_financials()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL
     OR has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin')
     OR has_role(auth.uid(),'finance_admin') THEN
    RETURN NEW;
  END IF;
  NEW.total_fare                := OLD.total_fare;
  NEW.currency                  := OLD.currency;
  NEW.tax_cents                 := OLD.tax_cents;
  NEW.commission_bps            := OLD.commission_bps;
  NEW.commission_cents          := OLD.commission_cents;
  NEW.partner_entitlement_cents := OLD.partner_entitlement_cents;
  NEW.surge_multiplier          := OLD.surge_multiplier;
  NEW.payment_status            := OLD.payment_status;
  NEW.payment_provider          := OLD.payment_provider;
  NEW.payment_reference         := OLD.payment_reference;
  NEW.paid_at                   := OLD.paid_at;
  NEW.financials_source         := OLD.financials_source;
  NEW.financials_captured_at    := OLD.financials_captured_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trip_bookings_guard_financials_trg ON public.trip_bookings;
CREATE TRIGGER trip_bookings_guard_financials_trg
  BEFORE UPDATE ON public.trip_bookings
  FOR EACH ROW EXECUTE FUNCTION public.trip_bookings_guard_financials();
