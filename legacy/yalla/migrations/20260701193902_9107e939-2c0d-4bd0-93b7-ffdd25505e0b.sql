
CREATE TABLE IF NOT EXISTS public.corporate_registration_drafts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key       text UNIQUE NOT NULL,
  user_id           uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','abandoned')),
  current_step      int  NOT NULL DEFAULT 1 CHECK (current_step BETWEEN 1 AND 5),
  completed_steps   int[] NOT NULL DEFAULT '{}'::int[],
  business_registration_type text CHECK (business_registration_type IN ('limited_company','registered_business')),
  personal_info     jsonb NOT NULL DEFAULT '{}'::jsonb,
  business_info     jsonb NOT NULL DEFAULT '{}'::jsonb,
  documents         jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.corporate_registration_drafts TO anon, authenticated;
GRANT ALL ON public.corporate_registration_drafts TO service_role;

ALTER TABLE public.corporate_registration_drafts ENABLE ROW LEVEL SECURITY;

-- Anyone (anon or authenticated) can read/write ONLY the draft matching their
-- opaque session_key OR their auth.uid(). The session_key is a random 32-byte
-- token stored in localStorage on the client; treat it like a bearer token.
CREATE POLICY "read own draft"
  ON public.corporate_registration_drafts
  FOR SELECT TO anon, authenticated
  USING (
    session_key = current_setting('request.headers', true)::json->>'x-registration-session'
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
  );

CREATE POLICY "insert own draft"
  ON public.corporate_registration_drafts
  FOR INSERT TO anon, authenticated
  WITH CHECK (
    session_key = current_setting('request.headers', true)::json->>'x-registration-session'
  );

CREATE POLICY "update own draft"
  ON public.corporate_registration_drafts
  FOR UPDATE TO anon, authenticated
  USING (
    session_key = current_setting('request.headers', true)::json->>'x-registration-session'
    OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
  )
  WITH CHECK (
    status = 'draft'
    AND (
      session_key = current_setting('request.headers', true)::json->>'x-registration-session'
      OR (auth.uid() IS NOT NULL AND user_id = auth.uid())
    )
  );

-- keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_registration_draft() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_touch_registration_draft ON public.corporate_registration_drafts;
CREATE TRIGGER trg_touch_registration_draft
  BEFORE UPDATE ON public.corporate_registration_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_registration_draft();

CREATE INDEX IF NOT EXISTS idx_registration_drafts_status ON public.corporate_registration_drafts (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_registration_drafts_user   ON public.corporate_registration_drafts (user_id) WHERE user_id IS NOT NULL;
