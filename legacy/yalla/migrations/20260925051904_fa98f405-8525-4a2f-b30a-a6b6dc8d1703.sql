CREATE TABLE public.comms_thread_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id uuid REFERENCES public.comms_threads(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('attachment','meeting','sheet','document','link')),
  label text NOT NULL CHECK (char_length(label) BETWEEN 1 AND 200),
  url text CHECK (url IS NULL OR url ~ '^https://'),
  storage_path text,
  mime_type text,
  size_bytes bigint CHECK (size_bytes IS NULL OR size_bytes <= 10485760),
  meeting_booking_id uuid REFERENCES public.public_meeting_bookings(id) ON DELETE SET NULL,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind='attachment' AND storage_path IS NOT NULL) OR (kind<>'attachment' AND url IS NOT NULL))
);
CREATE INDEX comms_thread_resources_thread_idx ON public.comms_thread_resources(thread_id);
GRANT SELECT, INSERT, DELETE ON public.comms_thread_resources TO authenticated;
GRANT ALL ON public.comms_thread_resources TO service_role;
ALTER TABLE public.comms_thread_resources ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Read resources on readable conversations" ON public.comms_thread_resources FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR (thread_id IS NOT NULL AND public.comms_can_read_thread(thread_id) IS TRUE));
CREATE POLICY "Add resources to readable conversations" ON public.comms_thread_resources FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND thread_id IS NOT NULL AND public.comms_can_read_thread(thread_id) IS TRUE
    AND (storage_path IS NULL OR split_part(storage_path,'/',1) = auth.uid()::text));
CREATE POLICY "Remove own resources" ON public.comms_thread_resources FOR DELETE TO authenticated USING (created_by = auth.uid());

CREATE POLICY "Staff upload own comms files" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id='comms-attachments' AND (storage.foldername(name))[1] = auth.uid()::text AND public.comms_my_staff_id() IS NOT NULL);
CREATE POLICY "Read comms files on readable conversations" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id='comms-attachments' AND ((storage.foldername(name))[1] = auth.uid()::text OR EXISTS (
    SELECT 1 FROM public.comms_thread_resources r WHERE r.storage_path = storage.objects.name AND r.thread_id IS NOT NULL AND public.comms_can_read_thread(r.thread_id) IS TRUE)));
CREATE POLICY "Delete own comms files" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id='comms-attachments' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE OR REPLACE FUNCTION public.meeting_ops_dashboard(_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE d int := least(greatest(coalesce(_days,30),7),90);
BEGIN
  IF public.meetings_is_manager() IS NOT TRUE THEN RAISE EXCEPTION 'NOT_AUTHORISED'; END IF;
  RETURN jsonb_build_object(
    'days', d,
    'series', (SELECT jsonb_agg(jsonb_build_object(
        'day', to_char(g,'YYYY-MM-DD'),
        'meetings', (SELECT count(*) FROM public_meeting_bookings b WHERE b.status<>'failed' AND b.starts_at >= g AND b.starts_at < g + interval '1 day'),
        'leads', (SELECT count(*) FROM sales_leads l WHERE coalesce(l.is_test,false)=false AND l.created_at >= g AND l.created_at < g + interval '1 day'),
        'payments_kes', (SELECT coalesce(sum(amount_cents),0)/100.0 FROM mpesa_transactions p WHERE p.status::text = 'SUCCESS' AND p.deleted_at IS NULL AND p.created_at >= g AND p.created_at < g + interval '1 day'),
        'payments', (SELECT count(*) FROM mpesa_transactions p WHERE p.status::text = 'SUCCESS' AND p.deleted_at IS NULL AND p.created_at >= g AND p.created_at < g + interval '1 day')
      ) ORDER BY g) FROM generate_series(date_trunc('day', now() at time zone 'Africa/Nairobi') - ((d-1)||' days')::interval, date_trunc('day', now() at time zone 'Africa/Nairobi'), interval '1 day') g),
    'meeting_status', (SELECT coalesce(jsonb_object_agg(status, n),'{}') FROM (SELECT status, count(*) n FROM public_meeting_bookings WHERE created_at > now() - (d||' days')::interval GROUP BY status) s),
    'lead_stages', (SELECT coalesce(jsonb_object_agg(stage, n),'{}') FROM (SELECT stage::text stage, count(*) n FROM sales_leads WHERE coalesce(is_test,false)=false GROUP BY stage) s),
    'payment_status', (SELECT coalesce(jsonb_object_agg(status, n),'{}') FROM (SELECT status, count(*) n FROM mpesa_transactions WHERE deleted_at IS NULL AND created_at > now() - (d||' days')::interval GROUP BY status) s),
    'calendar_load', (SELECT coalesce(jsonb_agg(x ORDER BY x->>'name'),'[]') FROM (
       SELECT DISTINCT ON (h.staff_id) jsonb_build_object('name', h.public_name, 'max_per_day', h.max_per_day,
         'meetings_next_7', (SELECT count(*) FROM public_meeting_bookings b WHERE b.host_staff_id=h.staff_id AND b.status='confirmed' AND b.starts_at BETWEEN now() AND now()+interval '7 days'),
         'blocks_next_7', (SELECT count(*) FROM staff_calendar_blocks k WHERE k.staff_id=h.staff_id AND k.starts_at BETWEEN now() AND now()+interval '7 days'),
         'shared', (SELECT status FROM staff_calendar_connections c WHERE c.staff_id=h.staff_id AND provider='shared_freebusy')) x
       FROM meeting_type_hosts h ORDER BY h.staff_id) q)
  );
END $$;
REVOKE ALL ON FUNCTION public.meeting_ops_dashboard(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meeting_ops_dashboard(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.my_client_portal()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _email text; _confirmed timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'SIGN_IN_REQUIRED'; END IF;
  SELECT lower(email), email_confirmed_at INTO _email, _confirmed FROM auth.users WHERE id = _uid;
  IF _email IS NULL OR _confirmed IS NULL THEN
    RETURN jsonb_build_object('email', _email, 'verified', false, 'leads', '[]'::jsonb, 'invoices', '[]'::jsonb, 'bookings', '[]'::jsonb, 'meetings', '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'email', _email, 'verified', true,
    'leads', coalesce((SELECT jsonb_agg(jsonb_build_object('ref', l.lead_ref, 'organisation', l.organisation_name, 'service', l.service_interest,
        'stage', l.stage, 'service_date', l.service_date, 'created_at', l.created_at) ORDER BY l.created_at DESC)
      FROM sales_leads l WHERE lower(l.contact_email) = _email AND coalesce(l.is_test,false) = false), '[]'::jsonb),
    'invoices', coalesce((SELECT jsonb_agg(jsonb_build_object('number', p.proforma_no, 'status', p.status, 'company', p.customer_company,
        'issue_date', p.issue_date, 'valid_until', p.valid_until, 'total_cents', p.total_cents, 'currency', p.currency) ORDER BY p.issue_date DESC NULLS LAST)
      FROM proforma_invoices p WHERE lower(p.customer_email) = _email AND coalesce(p.is_test,false) = false AND p.status NOT IN ('draft','void','pending_approval')), '[]'::jsonb),
    'bookings', coalesce((SELECT jsonb_agg(jsonb_build_object('reference', b.reference, 'asset', b.asset_name, 'status', b.status,
        'payment_status', b.payment_status, 'amount', b.amount, 'currency', b.currency, 'created_at', b.created_at) ORDER BY b.created_at DESC)
      FROM charter_bookings b WHERE b.user_id = _uid), '[]'::jsonb),
    'meetings', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'topic', m.topic, 'starts_at', m.starts_at, 'status', m.status, 'join_url', m.join_url, 'type', (SELECT name FROM meeting_types t WHERE t.id = m.meeting_type_id), 'lead_ref', (SELECT l2.lead_ref FROM sales_leads l2 WHERE l2.id = m.lead_id), 'lead_service', (SELECT l2.service_interest FROM sales_leads l2 WHERE l2.id = m.lead_id), 'lead_stage', (SELECT l2.stage::text FROM sales_leads l2 WHERE l2.id = m.lead_id), 'duration', m.duration_minutes, 'host', (SELECT public_name FROM meeting_type_hosts h WHERE h.staff_id = m.host_staff_id LIMIT 1)) ORDER BY m.starts_at DESC)
      FROM public_meeting_bookings m WHERE lower(m.client_email) = _email), '[]'::jsonb)
  );
END $function$;