DO $d$ DECLARE r record; v text; BEGIN
  FOR r IN SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname IN ('_client_inbox','client_portal_reply') LOOP
    v := pg_get_functiondef(r.oid);
    v := replace(v, '(''sales@yalla.africa'',''notify@yalla.africa'')', '(''sales@yalla.africa'',''notify@yalla.africa'',''finance@yalla.africa'')');
    EXECUTE v;
  END LOOP; END $d$;

CREATE OR REPLACE FUNCTION public.admin_client_booking_links()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $f$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PERMITTED'); END IF;
  WITH b AS (
    SELECT rider_user_id uid, booking_number ref, 'ride' kind, status::text status, created_at, NULL::numeric amount, NULL::text currency, NULL::text payment_status, NULL::timestamptz paid_at
      FROM public.trip_bookings WHERE booking_number IS NOT NULL AND rider_user_id IS NOT NULL
    UNION ALL SELECT user_id, reference, 'charter', status, created_at, amount, currency, payment_status, paid_at
      FROM public.charter_bookings WHERE reference IS NOT NULL AND user_id IS NOT NULL
  ), c AS (
    SELECT b.uid, u.email, p.full_name,
      jsonb_agg(jsonb_build_object('ref', b.ref, 'kind', b.kind, 'status', b.status, 'created_at', b.created_at,
        'amount', b.amount, 'currency', b.currency, 'payment_status', b.payment_status, 'paid_at', b.paid_at,
        'threads', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('thread_id', t.id, 'subject', t.subject, 'mailbox', ac.mailbox_address, 'last_at', t.last_activity_at)), '[]'::jsonb)
           FROM public.comms_messages m JOIN public.comms_threads t ON t.id = m.thread_id JOIN public.comms_accounts ac ON ac.id = m.account_id
           WHERE position(b.ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0)
      ) ORDER BY b.created_at DESC) bookings, max(b.created_at) last_at
    FROM b JOIN auth.users u ON u.id = b.uid LEFT JOIN public.profiles p ON p.user_id = b.uid
    GROUP BY b.uid, u.email, p.full_name
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'email', email, 'name', full_name, 'bookings', bookings) ORDER BY last_at DESC), '[]'::jsonb)
    INTO v_out FROM (SELECT * FROM c ORDER BY last_at DESC LIMIT 300) s;
  RETURN jsonb_build_object('ok', true, 'clients', v_out);
END $f$;
REVOKE ALL ON FUNCTION public.admin_client_booking_links() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_client_booking_links() TO authenticated;

CREATE TABLE public.comms_reply_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  account_id uuid NOT NULL REFERENCES public.comms_accounts(id) ON DELETE CASCADE,
  thread_id uuid REFERENCES public.comms_threads(id) ON DELETE SET NULL,
  to_address text NOT NULL,
  subject text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','failed')),
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.comms_reply_drafts TO authenticated;
GRANT ALL ON public.comms_reply_drafts TO service_role;
ALTER TABLE public.comms_reply_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own reply drafts" ON public.comms_reply_drafts FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND coalesce(public.comms_can_read_account(account_id), false));