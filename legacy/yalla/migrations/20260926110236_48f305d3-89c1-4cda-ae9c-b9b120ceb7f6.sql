
CREATE TABLE public.crm_account_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  grantee_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('view','edit')),
  reason text NOT NULL,
  granted_by uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX crm_account_access_grants_idx ON public.crm_account_access_grants(grantee_staff_id, account_id);
GRANT SELECT ON public.crm_account_access_grants TO authenticated;
GRANT ALL ON public.crm_account_access_grants TO service_role;
ALTER TABLE public.crm_account_access_grants ENABLE ROW LEVEL SECURITY;

CREATE TABLE public.crm_account_access_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  requester_staff_id uuid NOT NULL REFERENCES public.staff_members(id) ON DELETE CASCADE,
  access_level text NOT NULL CHECK (access_level IN ('view','edit')),
  reason text NOT NULL CHECK (length(trim(reason)) BETWEEN 10 AND 1000),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','refused','withdrawn')),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  grant_id uuid REFERENCES public.crm_account_access_grants(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX crm_account_access_requests_pending_uq
  ON public.crm_account_access_requests(account_id, requester_staff_id) WHERE status = 'pending';
GRANT SELECT ON public.crm_account_access_requests TO authenticated;
GRANT ALL ON public.crm_account_access_requests TO service_role;
ALTER TABLE public.crm_account_access_requests ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._crm_my_staff_id(_user uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.staff_members WHERE user_id = _user
   AND employment_status IN ('active','onboarding') LIMIT 1
$$;

-- Strict boolean: owner, owner's manager, approved grant, CRM managers, admins.
CREATE OR REPLACE FUNCTION public.crm_can_access_account(_user uuid, _account uuid, _edit boolean)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; a record;
BEGIN
  IF _user IS NULL OR _account IS NULL THEN RETURN false; END IF;
  IF coalesce(public.has_role(_user,'admin'),false) OR coalesce(public.has_role(_user,'super_admin'),false) THEN RETURN true; END IF;
  me := public._crm_my_staff_id(_user);
  IF me IS NULL THEN RETURN false; END IF;
  IF _user = auth.uid() AND coalesce(public.has_staff_permission('staff.crm.manage'),false) THEN RETURN true; END IF;
  SELECT owner_staff_id, strategic_owner_staff_id INTO a FROM public.crm_accounts WHERE id = _account;
  IF NOT FOUND THEN RETURN false; END IF;
  IF me IN (a.owner_staff_id, a.strategic_owner_staff_id) THEN RETURN true; END IF;
  IF EXISTS (SELECT 1 FROM public.staff_members s WHERE s.id IN (a.owner_staff_id, a.strategic_owner_staff_id) AND s.manager_staff_id = me) THEN RETURN true; END IF;
  RETURN coalesce(EXISTS (SELECT 1 FROM public.crm_account_access_grants g
     WHERE g.account_id = _account AND g.grantee_staff_id = me AND g.revoked_at IS NULL AND g.expires_at > now()
       AND (NOT _edit OR g.access_level = 'edit')), false);
END $$;

-- Who may decide a request: admins, the account owner, the owner's manager.
CREATE OR REPLACE FUNCTION public.crm_can_decide_account_access(_user uuid, _account uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; a record;
BEGIN
  IF _user IS NULL OR _account IS NULL THEN RETURN false; END IF;
  IF coalesce(public.has_role(_user,'admin'),false) OR coalesce(public.has_role(_user,'super_admin'),false) THEN RETURN true; END IF;
  me := public._crm_my_staff_id(_user);
  IF me IS NULL THEN RETURN false; END IF;
  SELECT owner_staff_id, strategic_owner_staff_id INTO a FROM public.crm_accounts WHERE id = _account;
  IF NOT FOUND THEN RETURN false; END IF;
  IF me IN (a.owner_staff_id, a.strategic_owner_staff_id) THEN RETURN true; END IF;
  RETURN coalesce(EXISTS (SELECT 1 FROM public.staff_members s WHERE s.id IN (a.owner_staff_id, a.strategic_owner_staff_id) AND s.manager_staff_id = me), false);
END $$;

CREATE POLICY crm_access_grants_read ON public.crm_account_access_grants FOR SELECT TO authenticated
  USING (grantee_staff_id = public._crm_my_staff_id(auth.uid()) OR public.crm_can_decide_account_access(auth.uid(), account_id));
CREATE POLICY crm_access_requests_read ON public.crm_account_access_requests FOR SELECT TO authenticated
  USING (requester_staff_id = public._crm_my_staff_id(auth.uid()) OR public.crm_can_decide_account_access(auth.uid(), account_id));

CREATE TRIGGER crm_access_grants_touch BEFORE UPDATE ON public.crm_account_access_grants FOR EACH ROW EXECUTE FUNCTION public._client_portal_touch();
CREATE TRIGGER crm_access_requests_touch BEFORE UPDATE ON public.crm_account_access_requests FOR EACH ROW EXECUTE FUNCTION public._client_portal_touch();

CREATE OR REPLACE FUNCTION public.crm_request_account_access(_account uuid, _level text, _reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid; r uuid;
BEGIN
  me := public._crm_my_staff_id(auth.uid());
  IF me IS NULL THEN RAISE EXCEPTION 'STAFF_REQUIRED'; END IF;
  IF _level NOT IN ('view','edit') THEN RAISE EXCEPTION 'ACCESS_LEVEL_INVALID'; END IF;
  IF length(trim(coalesce(_reason,''))) < 10 THEN RAISE EXCEPTION 'REASON_REQUIRED'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.crm_accounts WHERE id = _account) THEN RAISE EXCEPTION 'ACCOUNT_NOT_FOUND'; END IF;
  IF public.crm_can_access_account(auth.uid(), _account, _level = 'edit') THEN RAISE EXCEPTION 'ALREADY_HAS_ACCESS'; END IF;
  INSERT INTO public.crm_account_access_requests(account_id, requester_staff_id, access_level, reason)
  VALUES (_account, me, _level, trim(_reason))
  ON CONFLICT (account_id, requester_staff_id) WHERE status = 'pending'
  DO UPDATE SET access_level = EXCLUDED.access_level, reason = EXCLUDED.reason
  RETURNING id INTO r;
  RETURN jsonb_build_object('id', r, 'status', 'pending');
END $$;

CREATE OR REPLACE FUNCTION public.crm_decide_account_access(_request uuid, _approve boolean, _note text, _days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE q public.crm_account_access_requests; g uuid;
BEGIN
  SELECT * INTO q FROM public.crm_account_access_requests WHERE id = _request FOR UPDATE;
  IF q.id IS NULL THEN RAISE EXCEPTION 'REQUEST_NOT_FOUND'; END IF;
  IF q.status <> 'pending' THEN RAISE EXCEPTION 'REQUEST_ALREADY_DECIDED'; END IF;
  IF NOT public.crm_can_decide_account_access(auth.uid(), q.account_id) THEN RAISE EXCEPTION 'DECISION_NOT_PERMITTED'; END IF;
  IF q.requester_staff_id = public._crm_my_staff_id(auth.uid()) THEN RAISE EXCEPTION 'SELF_APPROVAL_NOT_PERMITTED'; END IF;
  IF NOT _approve AND length(trim(coalesce(_note,''))) < 3 THEN RAISE EXCEPTION 'REFUSAL_REASON_REQUIRED'; END IF;
  IF _approve THEN
    INSERT INTO public.crm_account_access_grants(account_id, grantee_staff_id, access_level, reason, granted_by, expires_at)
    VALUES (q.account_id, q.requester_staff_id, q.access_level, q.reason, auth.uid(), now() + make_interval(days => greatest(1, least(coalesce(_days,30), 180))))
    RETURNING id INTO g;
  END IF;
  UPDATE public.crm_account_access_requests
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'refused' END,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(_note,'')),''), grant_id = g
   WHERE id = q.id;
  RETURN jsonb_build_object('id', q.id, 'status', CASE WHEN _approve THEN 'approved' ELSE 'refused' END, 'grant_id', g);
END $$;

CREATE OR REPLACE FUNCTION public.crm_revoke_account_access(_grant uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE a uuid;
BEGIN
  SELECT account_id INTO a FROM public.crm_account_access_grants WHERE id = _grant AND revoked_at IS NULL;
  IF a IS NULL THEN RAISE EXCEPTION 'GRANT_NOT_FOUND'; END IF;
  IF NOT public.crm_can_decide_account_access(auth.uid(), a) THEN RAISE EXCEPTION 'DECISION_NOT_PERMITTED'; END IF;
  UPDATE public.crm_account_access_grants SET revoked_at = now(), revoked_by = auth.uid() WHERE id = _grant;
END $$;

-- Queue for the UI: my own requests plus those I may decide, with names.
CREATE OR REPLACE FUNCTION public.crm_account_access_queue()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'account_id', r.account_id, 'account_name', a.name, 'access_level', r.access_level,
    'reason', r.reason, 'status', r.status, 'requester', s.full_name, 'created_at', r.created_at,
    'decided_at', r.decided_at, 'decision_note', r.decision_note,
    'mine', r.requester_staff_id = public._crm_my_staff_id(auth.uid()),
    'can_decide', r.status = 'pending' AND r.requester_staff_id <> coalesce(public._crm_my_staff_id(auth.uid()), '00000000-0000-0000-0000-000000000000'::uuid)
                  AND public.crm_can_decide_account_access(auth.uid(), r.account_id),
    'grant_expires_at', g.expires_at, 'grant_revoked_at', g.revoked_at
  ) ORDER BY r.created_at DESC), '[]'::jsonb)
  FROM public.crm_account_access_requests r
  JOIN public.crm_accounts a ON a.id = r.account_id
  JOIN public.staff_members s ON s.id = r.requester_staff_id
  LEFT JOIN public.crm_account_access_grants g ON g.id = r.grant_id
  WHERE r.requester_staff_id = public._crm_my_staff_id(auth.uid())
     OR public.crm_can_decide_account_access(auth.uid(), r.account_id)
$$;

REVOKE ALL ON FUNCTION public._crm_my_staff_id(uuid), public.crm_can_access_account(uuid,uuid,boolean),
  public.crm_can_decide_account_access(uuid,uuid), public.crm_request_account_access(uuid,text,text),
  public.crm_decide_account_access(uuid,boolean,text,integer), public.crm_revoke_account_access(uuid),
  public.crm_account_access_queue() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._crm_my_staff_id(uuid), public.crm_can_access_account(uuid,uuid,boolean),
  public.crm_can_decide_account_access(uuid,uuid), public.crm_request_account_access(uuid,text,text),
  public.crm_decide_account_access(uuid,boolean,text,integer), public.crm_revoke_account_access(uuid),
  public.crm_account_access_queue() TO authenticated, service_role;

-- Which customer a stored file belongs to.
CREATE OR REPLACE FUNCTION public.crm_storage_account(_name text)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE p text; r uuid;
BEGIN
  IF split_part(_name,'/',1) = 'organisation' THEN
    p := split_part(_name,'/',2);
    IF p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN p::uuid; END IF;
  END IF;
  SELECT d.account_id INTO r FROM public.crm_document_versions v JOIN public.crm_documents d ON d.id = v.document_id
   WHERE v.storage_path = _name AND d.account_id IS NOT NULL LIMIT 1;
  RETURN r;
END $$;
REVOKE ALL ON FUNCTION public.crm_storage_account(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_storage_account(text) TO authenticated, service_role;

-- Document authority: customer documents follow account access.
CREATE OR REPLACE FUNCTION public.crm_document_authority(_user_id uuid, _document_id uuid, _verb crm_doc_verb)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE d record; explicit boolean;
BEGIN
  SELECT * INTO d FROM public.crm_documents WHERE id = _document_id;
  IF d.id IS NULL THEN RETURN false; END IF;
  IF coalesce(public.has_role(_user_id,'admin'),false) OR coalesce(public.has_role(_user_id,'super_admin'),false) THEN RETURN true; END IF;
  IF d.account_id IS NOT NULL AND NOT public.crm_can_access_account(_user_id, d.account_id,
       _verb NOT IN ('view','download','use_template')) THEN
    RETURN false;
  END IF;
  SELECT bool_or(allowed) INTO explicit FROM public.crm_document_permissions p
  WHERE p.verb = _verb AND p.role IS NOT NULL AND public.has_role(_user_id, p.role)
    AND (p.document_id = _document_id OR p.document_id IS NULL)
    AND (p.doc_class IS NULL OR p.doc_class = d.doc_class)
    AND (p.doc_type IS NULL OR p.doc_type = d.doc_type);
  IF explicit IS NOT NULL THEN RETURN explicit; END IF;
  IF d.account_id IS NOT NULL AND _verb IN ('view','download','use_template','create_version','share','submit','edit') THEN
    RETURN true;  -- account access already proven above
  END IF;
  IF d.doc_class = 'customer_instance' AND _verb IN ('view','download','use_template','create_version','share','submit')
     AND coalesce(public.crm_can_write_commercial(_user_id),false) THEN RETURN true; END IF;
  IF _verb IN ('view','download','use_template') AND coalesce(public.is_staff_portal_member(_user_id),false) THEN RETURN true; END IF;
  RETURN false;
END; $function$;

DROP POLICY IF EXISTS "Staff can read documents" ON public.crm_documents;
CREATE POLICY "Staff read templates or own customers' documents" ON public.crm_documents FOR SELECT TO authenticated
  USING (coalesce(has_staff_permission('staff.crm.read'),false)
         AND (account_id IS NULL OR public.crm_can_access_account(auth.uid(), account_id, false)));
DROP POLICY IF EXISTS "Authorised staff can update documents" ON public.crm_documents;
CREATE POLICY "Authorised staff can update documents" ON public.crm_documents FOR UPDATE TO authenticated
  USING (crm_document_authority(auth.uid(), id, 'edit'::crm_doc_verb))
  WITH CHECK (crm_document_authority(auth.uid(), id, 'edit'::crm_doc_verb)
              AND (account_id IS NULL OR public.crm_can_access_account(auth.uid(), account_id, true)));
DROP POLICY IF EXISTS "Staff can read document versions" ON public.crm_document_versions;
CREATE POLICY "Staff read versions they may open" ON public.crm_document_versions FOR SELECT TO authenticated
  USING (coalesce(has_staff_permission('staff.crm.read'),false)
         AND crm_document_authority(auth.uid(), document_id, 'view'::crm_doc_verb));

DROP POLICY IF EXISTS "Staff can read crm document files" ON storage.objects;
DROP POLICY IF EXISTS "Linked commercial staff read organisation documents" ON storage.objects;
DROP POLICY IF EXISTS "Linked commercial staff upload organisation documents" ON storage.objects;
DROP POLICY IF EXISTS "Commercial staff can upload crm document files" ON storage.objects;
CREATE POLICY "Staff read own customers' crm files" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'crm-documents' AND (
    CASE WHEN public.crm_storage_account(name) IS NOT NULL
         THEN public.crm_can_access_account(auth.uid(), public.crm_storage_account(name), false)
         ELSE (owner = auth.uid() OR coalesce(public.has_role(auth.uid(),'admin'),false)
               OR coalesce(public.has_role(auth.uid(),'super_admin'),false)
               OR coalesce(public.has_staff_permission('staff.crm.manage'),false)) END));
CREATE POLICY "Staff upload to own customers' crm files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-documents' AND (
    CASE WHEN public.crm_storage_account(name) IS NOT NULL
         THEN public.crm_can_access_account(auth.uid(), public.crm_storage_account(name), true)
         ELSE (coalesce(public.crm_can_write_commercial(auth.uid()),false) OR coalesce(public.is_linked_commercial_staff(),false)) END));

-- Portal inbox: whole conversation (Yalla's emails + the client's own replies).
CREATE OR REPLACE FUNCTION public.client_portal_inbox(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g public.client_portal_grants; a public.crm_accounts; v_emails text[]; v_out jsonb;
BEGIN
  IF coalesce(length(trim(coalesce(_token,''))),0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  SELECT * INTO g FROM public.client_portal_grants
   WHERE token_hash = encode(sha256(convert_to(trim(_token),'utf8')),'hex');
  IF g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF g.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;
  SELECT * INTO a FROM public.crm_accounts WHERE id = g.account_id;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'ACCOUNT_NOT_FOUND'); END IF;

  SELECT array_agg(DISTINCT lower(e)) INTO v_emails FROM (
    SELECT g.recipient_email e
    UNION SELECT c.email FROM public.crm_contacts c WHERE c.account_id = a.id AND c.is_active
    UNION SELECT l.contact_email FROM public.sales_leads l WHERE l.account_id = a.id
  ) s WHERE e IS NOT NULL AND e LIKE '%@%';
  IF v_emails IS NULL THEN RETURN jsonb_build_object('ok', true, 'emails', '[]'::jsonb); END IF;

  SELECT coalesce(jsonb_agg(x ORDER BY (x->>'sent_at') DESC), '[]'::jsonb) INTO v_out FROM (
    SELECT jsonb_build_object(
      'id', m.id, 'thread_id', m.thread_id, 'direction', m.direction,
      'subject', coalesce(m.subject, '(no subject)'), 'from_name', m.from_name,
      'preview', left(m.body_preview, 400), 'sent_at', m.occurred_at,
      'booking_refs', (SELECT coalesce(jsonb_agg(DISTINCT b.booking_number), '[]'::jsonb)
          FROM public.corporate_ride_approvals ra JOIN public.trip_bookings b ON b.id = ra.booking_id
          WHERE a.corporate_id IS NOT NULL AND ra.corporate_id = a.corporate_id
            AND b.booking_number IS NOT NULL AND position(b.booking_number in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0),
      'enquiry_refs', (SELECT coalesce(jsonb_agg(DISTINCT r), '[]'::jsonb) FROM (
          SELECT l.lead_ref r FROM public.sales_leads l WHERE l.account_id = a.id AND l.lead_ref IS NOT NULL
            AND position(l.lead_ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0
          UNION SELECT q.quote_number FROM public.commercial_quotations q WHERE q.account_id = a.id
            AND position(q.quote_number in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0
          UNION SELECT t.lead_ref FROM public.comms_email_tasks et JOIN public.sales_leads t ON t.id = et.sales_lead_id
            WHERE et.message_id = m.id AND t.account_id = a.id) rr)
    ) x
    FROM public.comms_messages m
    JOIN public.comms_accounts ac ON ac.id = m.account_id
    WHERE NOT ac.is_privileged AND (
      (m.direction = 'outbound' AND EXISTS (SELECT 1 FROM unnest(m.to_addresses || m.cc_addresses) t
          WHERE lower(trim(t)) = ANY(v_emails) OR lower(substring(t from '<([^>]+)>')) = ANY(v_emails)))
      OR (m.direction = 'inbound' AND lower(trim(coalesce(m.from_address,''))) = ANY(v_emails)))
    ORDER BY m.occurred_at DESC LIMIT 200
  ) s;
  RETURN jsonb_build_object('ok', true, 'emails', v_out);
END $$;
REVOKE ALL ON FUNCTION public.client_portal_inbox(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.client_portal_inbox(text) TO anon, authenticated, service_role;

