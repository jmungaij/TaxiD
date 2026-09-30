ALTER TABLE public.mpesa_transactions
  ADD COLUMN IF NOT EXISTS last_touched_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_touched_by uuid,
  ADD COLUMN IF NOT EXISTS last_touched_label text;

CREATE OR REPLACE FUNCTION public._mpesa_txn_last_touch()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _label text;
BEGIN
  IF _uid IS NOT NULL THEN
    SELECT coalesce(sm.full_name, u.email) INTO _label
    FROM auth.users u LEFT JOIN public.staff_members sm ON sm.user_id = u.id WHERE u.id = _uid LIMIT 1;
  ELSIF coalesce(auth.role()::text,'') = 'service_role' THEN
    _label := 'System (Safaricom confirmation / payment worker)';
  ELSE
    _label := 'System';
  END IF;
  NEW.last_touched_at := now();
  NEW.last_touched_by := _uid;
  NEW.last_touched_label := coalesce(_label, 'Unknown user');
  RETURN NEW;
END $$;
REVOKE EXECUTE ON FUNCTION public._mpesa_txn_last_touch() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_mpesa_txn_last_touch ON public.mpesa_transactions;
CREATE TRIGGER trg_mpesa_txn_last_touch BEFORE INSERT OR UPDATE ON public.mpesa_transactions
FOR EACH ROW EXECUTE FUNCTION public._mpesa_txn_last_touch();

-- Client portal: a signed-in client reads only records tied to their own verified account email / user id.
CREATE OR REPLACE FUNCTION public.my_client_portal()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
    'meetings', coalesce((SELECT jsonb_agg(jsonb_build_object('topic', m.topic, 'starts_at', m.starts_at, 'status', m.status, 'join_url', m.join_url) ORDER BY m.starts_at DESC)
      FROM public_meeting_bookings m WHERE lower(m.client_email) = _email), '[]'::jsonb)
  );
END $$;
REVOKE EXECUTE ON FUNCTION public.my_client_portal() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_client_portal() TO authenticated;