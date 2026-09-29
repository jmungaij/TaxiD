ALTER TABLE public.business_organisations
  ADD COLUMN IF NOT EXISTS contact_phone text;

ALTER TABLE public.business_requests
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

CREATE TABLE public.business_organisation_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organisation_id uuid NOT NULL REFERENCES public.business_organisations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  member_role text NOT NULL DEFAULT 'member' CHECK (member_role IN ('owner','admin','member')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organisation_id, user_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.business_organisation_members TO authenticated;
GRANT ALL ON public.business_organisation_members TO service_role;
ALTER TABLE public.business_organisation_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY business_members_read ON public.business_organisation_members
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR EXISTS (SELECT 1 FROM public.business_organisations o WHERE o.id = organisation_id AND o.owner_id = auth.uid())
  OR public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[])
);
CREATE POLICY business_members_owner_manage ON public.business_organisation_members
FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.business_organisations o WHERE o.id = organisation_id AND o.owner_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.business_organisations o WHERE o.id = organisation_id AND o.owner_id = auth.uid()));

INSERT INTO public.business_organisation_members (organisation_id, user_id, member_role)
SELECT id, owner_id, 'owner' FROM public.business_organisations
ON CONFLICT (organisation_id, user_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.add_business_owner_membership()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.business_organisation_members (organisation_id, user_id, member_role)
  VALUES (NEW.id, NEW.owner_id, 'owner')
  ON CONFLICT (organisation_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS business_org_add_owner ON public.business_organisations;
CREATE TRIGGER business_org_add_owner
AFTER INSERT ON public.business_organisations
FOR EACH ROW EXECUTE FUNCTION public.add_business_owner_membership();

CREATE POLICY business_org_staff_read ON public.business_organisations
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));
CREATE POLICY business_requests_staff_read ON public.business_requests
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.admin_review_business_organisation(
  _organisation_id uuid,
  _status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('pending','approved','declined') THEN
    RAISE EXCEPTION 'Invalid organisation status';
  END IF;
  UPDATE public.business_organisations
  SET status = _status, updated_at = now()
  WHERE id = _organisation_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Organisation not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_review_business_organisation(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_review_business_organisation(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_business_request(
  _request_id uuid,
  _status text,
  _admin_notes text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _status NOT IN ('pending','in_review','completed','cancelled') THEN
    RAISE EXCEPTION 'Invalid request status';
  END IF;
  IF _admin_notes IS NOT NULL AND char_length(_admin_notes) > 3000 THEN
    RAISE EXCEPTION 'Administrative notes are too long';
  END IF;
  UPDATE public.business_requests
  SET status = _status,
      admin_notes = NULLIF(btrim(_admin_notes), ''),
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      updated_at = now()
  WHERE id = _request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.admin_update_business_request(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_update_business_request(uuid,text,text) TO authenticated;

CREATE TABLE public.app_download_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audience text NOT NULL CHECK (audience IN ('rider','driver')),
  platform text NOT NULL CHECK (platform = 'android'),
  placement text NOT NULL CHECK (char_length(placement) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT INSERT ON public.app_download_clicks TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_download_clicks TO service_role;
ALTER TABLE public.app_download_clicks ENABLE ROW LEVEL SECURITY;
CREATE POLICY app_download_clicks_public_create ON public.app_download_clicks
FOR INSERT TO anon, authenticated
WITH CHECK (audience IN ('rider','driver') AND platform = 'android' AND char_length(placement) BETWEEN 1 AND 80);
CREATE INDEX app_download_clicks_audience_created_idx ON public.app_download_clicks(audience, created_at DESC);

CREATE TABLE public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid,
  actor_email text,
  action text NOT NULL,
  resource_type text NOT NULL,
  resource_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.admin_audit_log TO authenticated;
GRANT ALL ON public.admin_audit_log TO service_role;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY admin_audit_staff_read ON public.admin_audit_log
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::public.app_role[]));

CREATE OR REPLACE FUNCTION public.admin_assign_role(_target_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _target_user_id = auth.uid() AND _role = 'super_admin' THEN RAISE EXCEPTION 'Super admins cannot change their own super-admin assignment'; END IF;
  SELECT email::text INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.user_roles(user_id, role) VALUES (_target_user_id, _role) ON CONFLICT DO NOTHING;
  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, resource_type, resource_id, metadata)
  VALUES(auth.uid(), v_email, 'user_roles.assign', 'user_role', _target_user_id::text, jsonb_build_object('role', _role));
END;
$$;
CREATE OR REPLACE FUNCTION public.admin_revoke_role(_target_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_email text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN RAISE EXCEPTION 'Forbidden'; END IF;
  IF _target_user_id = auth.uid() AND _role = 'super_admin' THEN RAISE EXCEPTION 'Super admins cannot revoke their own super-admin assignment'; END IF;
  SELECT email::text INTO v_email FROM auth.users WHERE id = auth.uid();
  DELETE FROM public.user_roles WHERE user_id = _target_user_id AND role = _role;
  INSERT INTO public.admin_audit_log(actor_id, actor_email, action, resource_type, resource_id, metadata)
  VALUES(auth.uid(), v_email, 'user_roles.revoke', 'user_role', _target_user_id::text, jsonb_build_object('role', _role));
END;
$$;
REVOKE ALL ON FUNCTION public.admin_assign_role(uuid,public.app_role) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_revoke_role(uuid,public.app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_assign_role(uuid,public.app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_revoke_role(uuid,public.app_role) TO authenticated;

CREATE POLICY airport_bookings_staff_read ON public.airport_bookings
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin','support']::public.app_role[]));

CREATE INDEX IF NOT EXISTS business_requests_status_created_idx ON public.business_requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS business_organisations_status_created_idx ON public.business_organisations(status, created_at DESC);