-- ============================================================
-- 1. PARTNER PORTAL — one private link per approved partner
-- ============================================================
CREATE TABLE public.partner_portal_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id uuid NOT NULL REFERENCES public.partner_applications(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  recipient_email text,
  recipient_name text,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by uuid,
  first_opened_at timestamptz,
  last_opened_at timestamptz,
  opens integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, UPDATE ON public.partner_portal_grants TO authenticated;
GRANT ALL ON public.partner_portal_grants TO service_role;

ALTER TABLE public.partner_portal_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY partner_portal_grants_read ON public.partner_portal_grants
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.crm.read'));

CREATE POLICY partner_portal_grants_write ON public.partner_portal_grants
  FOR UPDATE TO authenticated
  USING (public.has_staff_permission('staff.crm.manage'))
  WITH CHECK (public.has_staff_permission('staff.crm.manage'));

CREATE INDEX partner_portal_grants_application_idx
  ON public.partner_portal_grants (application_id, created_at DESC);

CREATE TRIGGER partner_portal_grants_touch
  BEFORE UPDATE ON public.partner_portal_grants
  FOR EACH ROW EXECUTE FUNCTION public._client_portal_touch();

-- Issue a link. Only approved applications may receive one.
CREATE OR REPLACE FUNCTION public.partner_portal_grant_create(
  _application uuid, _email text DEFAULT NULL, _name text DEFAULT NULL, _days integer DEFAULT 60
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_token text; v_id uuid; a public.partner_applications;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTHENTICATION_REQUIRED'); END IF;
  IF public.has_staff_permission('staff.crm.manage') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;
  SELECT * INTO a FROM public.partner_applications WHERE id = _application;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'APPLICATION_NOT_FOUND'); END IF;
  IF lower(coalesce(a.status,'')) <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'APPLICATION_NOT_APPROVED');
  END IF;

  v_token := replace(gen_random_uuid()::text,'-','') || replace(gen_random_uuid()::text,'-','');

  INSERT INTO public.partner_portal_grants
    (application_id, token_hash, recipient_email, recipient_name, expires_at, created_by, created_staff_id)
  VALUES (_application, encode(sha256(convert_to(v_token,'utf8')),'hex'),
          nullif(trim(coalesce(_email, a.contact_email, '')),''),
          nullif(trim(coalesce(_name, a.contact_name, '')),''),
          now() + make_interval(days => greatest(1, least(coalesce(_days,60), 180))),
          auth.uid(), public._my_staff_member_id())
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'grant_id', v_id, 'partner', a.organisation_name,
                            'token', v_token, 'path', '/my/partner/' || v_token);
END $$;

CREATE OR REPLACE FUNCTION public.partner_portal_grant_revoke(_grant uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'AUTHENTICATION_REQUIRED'); END IF;
  IF public.has_staff_permission('staff.crm.manage') IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED');
  END IF;
  UPDATE public.partner_portal_grants
     SET revoked_at = coalesce(revoked_at, now()), revoked_by = auth.uid()
   WHERE id = _grant;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'GRANT_NOT_FOUND'); END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- The link is the credential. Returns only this partner's own records.
CREATE OR REPLACE FUNCTION public.partner_portal_open(_token text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE g public.partner_portal_grants; a public.partner_applications;
        v_lead public.sales_leads; v_accounts uuid[];
        v_quotes jsonb; v_contracts jsonb; v_rides jsonb; v_corp uuid;
BEGIN
  IF coalesce(length(trim(coalesce(_token,''))),0) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK');
  END IF;
  SELECT * INTO g FROM public.partner_portal_grants
   WHERE token_hash = encode(sha256(convert_to(trim(_token),'utf8')),'hex');
  IF g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVALID_LINK'); END IF;
  IF g.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_REVOKED'); END IF;
  IF g.expires_at < now() THEN RETURN jsonb_build_object('ok', false, 'error', 'LINK_EXPIRED'); END IF;

  SELECT * INTO a FROM public.partner_applications WHERE id = g.application_id;
  IF a.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'APPLICATION_NOT_FOUND'); END IF;
  IF lower(coalesce(a.status,'')) <> 'approved' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'APPLICATION_NOT_APPROVED');
  END IF;

  UPDATE public.partner_portal_grants
     SET first_opened_at = coalesce(first_opened_at, now()), last_opened_at = now(), opens = opens + 1
   WHERE id = g.id;

  SELECT * INTO v_lead FROM public.sales_leads WHERE partner_application_id = a.id
   ORDER BY created_at LIMIT 1;

  SELECT coalesce(array_agg(DISTINCT x), '{}') INTO v_accounts FROM (
    SELECT v_lead.account_id AS x WHERE v_lead.account_id IS NOT NULL
  ) s WHERE x IS NOT NULL;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'quote_number', q.quote_number, 'total_amount', q.total_amount, 'currency', q.currency,
           'status', q.status, 'valid_until', q.valid_until, 'created_at', q.created_at
         ) ORDER BY q.created_at DESC), '[]'::jsonb)
    INTO v_quotes
    FROM public.commercial_quotations q
   WHERE cardinality(v_accounts) > 0 AND q.account_id = ANY (v_accounts);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'contract_number', c.contract_number, 'title', c.title, 'status', c.status,
           'value_amount', c.value_amount, 'currency', c.currency, 'value_type', c.value_type,
           'term_start', c.term_start, 'term_end', c.term_end, 'signature_date', c.signature_date,
           'payment_terms', c.payment_terms, 'created_at', c.created_at
         ) ORDER BY c.created_at DESC), '[]'::jsonb)
    INTO v_contracts
    FROM public.commercial_contract_instances c
   WHERE (v_lead.id IS NOT NULL AND c.lead_id = v_lead.id)
      OR (cardinality(v_accounts) > 0 AND c.account_id = ANY (v_accounts));

  SELECT ca.corporate_id INTO v_corp FROM public.crm_accounts ca
   WHERE cardinality(v_accounts) > 0 AND ca.id = ANY (v_accounts) AND ca.corporate_id IS NOT NULL
   LIMIT 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'booking_number', b.booking_number, 'pickup', b.pickup_address, 'dropoff', b.dropoff_address,
           'scheduled_for', b.scheduled_for, 'status', b.status, 'total_fare', b.total_fare,
           'currency', b.currency, 'payment_status', b.payment_status, 'created_at', b.created_at
         ) ORDER BY b.created_at DESC), '[]'::jsonb)
    INTO v_rides
    FROM public.corporate_ride_approvals ra
    JOIN public.trip_bookings b ON b.id = ra.booking_id
   WHERE v_corp IS NOT NULL AND ra.corporate_id = v_corp;

  RETURN jsonb_build_object(
    'ok', true,
    'partner', jsonb_build_object(
      'organisation', a.organisation_name, 'reference', a.reference,
      'partner_type', a.partner_type, 'commercial_model', a.commercial_model,
      'city', a.city, 'country', a.country, 'status', a.status,
      'applied_at', a.created_at, 'approved_at', a.reviewed_at),
    'enquiry', CASE WHEN v_lead.id IS NULL THEN NULL ELSE jsonb_build_object(
      'lead_ref', v_lead.lead_ref, 'stage', v_lead.stage,
      'service_interest', v_lead.service_interest,
      'meeting_held_at', v_lead.meeting_held_at, 'quote_shared_at', v_lead.quote_shared_at,
      'contract_shared_at', v_lead.contract_shared_at, 'contract_signed_at', v_lead.contract_signed_at,
      'waiting_on', v_lead.waiting_on, 'awaiting_item', v_lead.awaiting_item) END,
    'recipient_name', g.recipient_name,
    'recipient_email', g.recipient_email,
    'expires_at', g.expires_at,
    'quotes', v_quotes,
    'contracts', v_contracts,
    'rides', v_rides
  );
END $$;

REVOKE ALL ON FUNCTION public.partner_portal_grant_create(uuid, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_portal_grant_revoke(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.partner_portal_open(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.partner_portal_grant_create(uuid, text, text, integer) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_portal_grant_revoke(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.partner_portal_open(text) TO anon, authenticated, service_role;

-- ============================================================
-- 2. TOMORROW — what the specialist has already promised
-- ============================================================
CREATE OR REPLACE FUNCTION public.sales_tomorrow_plan(_staff uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_staff uuid; v_today date; v_tomorrow date;
        v_promises jsonb; v_services jsonb; v_contracts jsonb; v_stale jsonb;
BEGIN
  v_staff := coalesce(_staff, public._my_staff_member_id());
  IF v_staff IS NULL THEN RAISE EXCEPTION 'NO_STAFF_IDENTITY'; END IF;
  IF _staff IS NOT NULL AND _staff <> coalesce(public._my_staff_member_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     AND public._sales_desk_leader() IS NOT TRUE THEN
    RAISE EXCEPTION 'NOT_IN_YOUR_REPORTING_LINE';
  END IF;

  v_today := (now() AT TIME ZONE 'Africa/Nairobi')::date;
  v_tomorrow := v_today + 1;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'lead_ref', l.lead_ref, 'organisation', l.organisation_name,
           'stage', l.stage, 'awaiting_item', l.awaiting_item, 'waiting_on', l.waiting_on,
           'due_date', l.awaiting_due_date, 'overdue', l.awaiting_due_date < v_tomorrow,
           'value_kes', l.estimated_value_kes
         ) ORDER BY l.awaiting_due_date), '[]'::jsonb)
    INTO v_promises
    FROM public.sales_leads l
   WHERE l.sales_staff_id = v_staff AND coalesce(l.is_test,false) = false
     AND l.awaiting_due_date IS NOT NULL AND l.awaiting_due_date <= v_tomorrow
     AND l.stage NOT IN ('WON','LOST');

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'lead_ref', l.lead_ref, 'organisation', l.organisation_name,
           'stage', l.stage, 'service_date', l.service_date,
           'origin', l.origin_label, 'destination', l.destination_label,
           'value_kes', l.estimated_value_kes
         ) ORDER BY l.service_date), '[]'::jsonb)
    INTO v_services
    FROM public.sales_leads l
   WHERE l.sales_staff_id = v_staff AND coalesce(l.is_test,false) = false
     AND l.service_date = v_tomorrow;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'contract_number', c.contract_number, 'organisation', ca.name,
           'status', c.status, 'value_kes', c.value_amount,
           'waiting_on', CASE WHEN c.signature_date IS NULL THEN 'SIGNATURE' ELSE 'ACTIVATION' END
         ) ORDER BY c.created_at), '[]'::jsonb)
    INTO v_contracts
    FROM public.commercial_contract_instances c
    LEFT JOIN public.crm_accounts ca ON ca.id = c.account_id
    LEFT JOIN public.sales_leads l ON l.id = c.lead_id
   WHERE coalesce(c.is_test,false) = false
     AND c.activated_at IS NULL
     AND (l.sales_staff_id = v_staff OR ca.owner_staff_id = v_staff);

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'lead_id', l.id, 'lead_ref', l.lead_ref, 'organisation', l.organisation_name,
           'stage', l.stage, 'idle_days', extract(day from now() - l.updated_at)::int,
           'value_kes', l.estimated_value_kes
         ) ORDER BY l.updated_at), '[]'::jsonb)
    INTO v_stale
    FROM public.sales_leads l
   WHERE l.sales_staff_id = v_staff AND coalesce(l.is_test,false) = false
     AND l.stage NOT IN ('WON','LOST')
     AND l.updated_at < now() - interval '7 days';

  RETURN jsonb_build_object(
    'staff_id', v_staff,
    'today', v_today,
    'tomorrow', v_tomorrow,
    'promises', v_promises,
    'services', v_services,
    'contracts_waiting', v_contracts,
    'untouched_over_a_week', v_stale
  );
END $$;

REVOKE ALL ON FUNCTION public.sales_tomorrow_plan(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_tomorrow_plan(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. KPI CLOSE EMAILS — one email per frozen close, once
-- ============================================================
CREATE TABLE public.sales_kpi_close_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  close_id uuid NOT NULL UNIQUE REFERENCES public.sales_kpi_closes(id) ON DELETE CASCADE,
  staff_member_id uuid NOT NULL,
  grain text NOT NULL,
  period_start date NOT NULL,
  recipient_email text,
  status text NOT NULL DEFAULT 'PENDING',
  attempts integer NOT NULL DEFAULT 0,
  error_text text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_kpi_close_emails_status_chk
    CHECK (status IN ('PENDING','SENT','FAILED','NO_EMAIL_ON_RECORD'))
);

GRANT SELECT ON public.sales_kpi_close_emails TO authenticated;
GRANT ALL ON public.sales_kpi_close_emails TO service_role;

ALTER TABLE public.sales_kpi_close_emails ENABLE ROW LEVEL SECURITY;

CREATE POLICY sales_kpi_close_emails_read ON public.sales_kpi_close_emails
  FOR SELECT TO authenticated
  USING (
    public._sales_desk_leader()
    OR staff_member_id = public._my_staff_member_id()
  );

CREATE INDEX sales_kpi_close_emails_pending_idx
  ON public.sales_kpi_close_emails (status, created_at);

-- Queue every frozen close that has never been queued. Automation only.
CREATE OR REPLACE FUNCTION public.sales_kpi_close_email_queue(_since date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_queued integer;
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;

  WITH inserted AS (
    INSERT INTO public.sales_kpi_close_emails
      (close_id, staff_member_id, grain, period_start, recipient_email, status)
    SELECT c.id, c.staff_member_id, c.grain::text, c.period_start,
           nullif(trim(coalesce(s.work_email,'')),''),
           CASE WHEN nullif(trim(coalesce(s.work_email,'')),'') IS NULL
                THEN 'NO_EMAIL_ON_RECORD' ELSE 'PENDING' END
      FROM public.sales_kpi_closes c
      LEFT JOIN public.staff_members s ON s.id = c.staff_member_id
     WHERE c.period_start >= coalesce(_since, (now() AT TIME ZONE 'Africa/Nairobi')::date - 7)
       AND c.grain::text IN ('DAY','WEEK','MONTH')
    ON CONFLICT (close_id) DO NOTHING
    RETURNING 1
  )
  SELECT count(*) INTO v_queued FROM inserted;

  RETURN jsonb_build_object('ok', true, 'queued', v_queued);
END $$;

CREATE OR REPLACE FUNCTION public.sales_kpi_close_email_mark(
  _id uuid, _status text, _error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF current_setting('role', true) IS DISTINCT FROM 'service_role'
     AND auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED';
  END IF;
  IF _status NOT IN ('PENDING','SENT','FAILED','NO_EMAIL_ON_RECORD') THEN
    RAISE EXCEPTION 'UNKNOWN_STATUS';
  END IF;
  UPDATE public.sales_kpi_close_emails
     SET status = _status,
         attempts = attempts + 1,
         error_text = _error,
         sent_at = CASE WHEN _status = 'SENT' THEN now() ELSE sent_at END,
         updated_at = now()
   WHERE id = _id;
  RETURN jsonb_build_object('ok', FOUND);
END $$;

REVOKE ALL ON FUNCTION public.sales_kpi_close_email_queue(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sales_kpi_close_email_mark(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sales_kpi_close_email_queue(date) TO service_role;
GRANT EXECUTE ON FUNCTION public.sales_kpi_close_email_mark(uuid, text, text) TO service_role;

-- 7:05 PM Nairobi, five minutes after the freeze.
SELECT cron.schedule(
  'sales-kpi-close-email-1905-nairobi',
  '5 16 * * *',
  $cron$
  SELECT public.invoke_scheduled_function(
    'sales-kpi-close-email-1905-nairobi', 'sales-kpi-close-email',
    'https://axwgyvhkuzalfqzribtz.supabase.co/functions/v1/sales-kpi-close-email',
    jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_z1MyXWiuUGK3CFE6D2lvrg_IIF8HstZ',
      'x-internal-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'internal_job_secret')
    ),
    jsonb_build_object('trigger','cron')
  );
  $cron$
);

-- ============================================================
-- 4. LIVE LEAD MOVEMENT
-- ============================================================
ALTER TABLE public.sales_leads REPLICA IDENTITY FULL;
ALTER TABLE public.sales_lead_events REPLICA IDENTITY FULL;
ALTER TABLE public.commercial_lifecycle REPLICA IDENTITY FULL;
ALTER TABLE public.partner_applications REPLICA IDENTITY FULL;

DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_leads; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_lead_events; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.commercial_lifecycle; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.partner_applications; EXCEPTION WHEN duplicate_object THEN NULL; END;
END $$;