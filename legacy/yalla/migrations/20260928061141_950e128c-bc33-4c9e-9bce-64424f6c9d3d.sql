
CREATE TABLE public.fin_payment_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_ref text NOT NULL,
  charter_booking_id uuid REFERENCES public.charter_bookings(id) ON DELETE SET NULL,
  amount numeric(14,2) NOT NULL CHECK (amount > 0 AND amount < 100000000),
  currency text NOT NULL DEFAULT 'KES',
  paid_on date NOT NULL,
  method text NOT NULL DEFAULT 'mpesa' CHECK (method IN ('mpesa','bank','cash','card','other')),
  payment_reference text,
  note text CHECK (char_length(note) <= 1000),
  source text NOT NULL CHECK (source IN ('client','team','email','mpesa')),
  status text NOT NULL DEFAULT 'reported' CHECK (status IN ('reported','verified','rejected')),
  reported_by uuid,
  source_message_id uuid UNIQUE,
  verified_by uuid,
  verified_at timestamptz,
  decision_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX fin_payment_reports_mpesa_uq ON public.fin_payment_reports(payment_reference) WHERE source = 'mpesa';
CREATE INDEX fin_payment_reports_booking_idx ON public.fin_payment_reports(charter_booking_id);
GRANT SELECT ON public.fin_payment_reports TO authenticated;
GRANT ALL ON public.fin_payment_reports TO service_role;
ALTER TABLE public.fin_payment_reports ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public._fin_is_team() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)
    OR coalesce(public.has_role(auth.uid(),'finance_admin'),false) OR coalesce(public.comms_is_unified_reader(),false));
$$;
CREATE OR REPLACE FUNCTION public._fin_is_verifier() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT auth.uid() IS NOT NULL AND (
    coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)
    OR coalesce(public.has_role(auth.uid(),'finance_admin'),false));
$$;
REVOKE ALL ON FUNCTION public._fin_is_team(), public._fin_is_verifier() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._fin_is_team(), public._fin_is_verifier() TO authenticated, service_role;

CREATE POLICY "Finance team reads all payment reports" ON public.fin_payment_reports FOR SELECT TO authenticated USING (public._fin_is_team());
CREATE POLICY "Clients read reports on their bookings" ON public.fin_payment_reports FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.charter_bookings cb WHERE cb.id = charter_booking_id AND cb.user_id = auth.uid()));

CREATE TRIGGER fin_payment_reports_touch BEFORE UPDATE ON public.fin_payment_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Post a record into the finance@ mailbox so it reaches Finance inbox + client portal inbox.
CREATE OR REPLACE FUNCTION public._fin_post_finance_record(_to text, _subject text, _body text, _meta jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_acc uuid; v_thread uuid;
BEGIN
  SELECT id INTO v_acc FROM public.comms_accounts WHERE lower(mailbox_address) = 'finance@yalla.africa' LIMIT 1;
  IF v_acc IS NULL OR _to IS NULL THEN RETURN; END IF;
  SELECT id INTO v_thread FROM public.comms_threads WHERE account_id = v_acc AND subject = _subject AND lower(counterparty_email) = lower(_to) LIMIT 1;
  IF v_thread IS NULL THEN
    INSERT INTO public.comms_threads(account_id, subject, counterparty_email, counterparty_name, message_count, outbound_count, last_direction)
      VALUES (v_acc, _subject, lower(_to), NULL, 0, 0, 'outbound') RETURNING id INTO v_thread;
  END IF;
  INSERT INTO public.comms_messages(thread_id, account_id, direction, source, from_address, from_name, to_addresses, subject, body_preview, delivery_status, metadata)
    VALUES (v_thread, v_acc, 'outbound', 'finance_ledger', 'finance@yalla.africa', 'Yalla Finance', ARRAY[lower(_to)], _subject, left(_body, 2000), 'recorded', _meta);
  UPDATE public.comms_threads SET message_count = message_count + 1, outbound_count = outbound_count + 1,
    last_activity_at = now(), last_direction = 'outbound' WHERE id = v_thread;
END $$;
REVOKE ALL ON FUNCTION public._fin_post_finance_record(text,text,text,jsonb) FROM PUBLIC, anon, authenticated;

-- Recompute the booking's paid state from verified payments only.
CREATE OR REPLACE FUNCTION public._fin_apply_verified(_booking uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_amount numeric; v_paid numeric; v_status text;
BEGIN
  SELECT amount, payment_status INTO v_amount, v_status FROM public.charter_bookings WHERE id = _booking;
  IF NOT FOUND OR v_amount IS NULL THEN RETURN; END IF;
  SELECT coalesce(sum(amount),0) INTO v_paid FROM public.fin_payment_reports WHERE charter_booking_id = _booking AND status = 'verified';
  IF lower(coalesce(v_status,'')) IN ('paid','settled','completed') THEN RETURN; END IF;
  IF v_paid >= v_amount THEN
    UPDATE public.charter_bookings SET payment_status = 'paid', paid_at = coalesce(paid_at, now()) WHERE id = _booking;
  ELSIF v_paid > 0 THEN
    UPDATE public.charter_bookings SET payment_status = 'partially_paid' WHERE id = _booking;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public._fin_apply_verified(uuid) FROM PUBLIC, anon, authenticated;

-- Report a payment (client for own booking, or finance team for any booking). Always pending.
CREATE OR REPLACE FUNCTION public.fin_report_payment(_booking_ref text, _amount numeric, _paid_on date, _method text, _reference text, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_bk public.charter_bookings; v_team boolean; v_id uuid;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok',false,'error','AUTH_REQUIRED'); END IF;
  v_team := public._fin_is_team();
  SELECT * INTO v_bk FROM public.charter_bookings WHERE reference = upper(trim(_booking_ref));
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); END IF;
  IF NOT v_team AND v_bk.user_id IS DISTINCT FROM v_uid THEN RETURN jsonb_build_object('ok',false,'error','BOOKING_NOT_FOUND'); END IF;
  IF _amount IS NULL OR _amount <= 0 OR _amount >= 100000000 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_AMOUNT'); END IF;
  IF _paid_on IS NULL OR _paid_on > (now() AT TIME ZONE 'Africa/Nairobi')::date OR _paid_on < current_date - 400 THEN RETURN jsonb_build_object('ok',false,'error','INVALID_DATE'); END IF;
  IF _method NOT IN ('mpesa','bank','cash','card','other') THEN RETURN jsonb_build_object('ok',false,'error','INVALID_METHOD'); END IF;
  IF length(coalesce(_reference,'')) > 60 OR length(coalesce(_note,'')) > 1000 THEN RETURN jsonb_build_object('ok',false,'error','TOO_LONG'); END IF;
  IF NOT v_team AND (SELECT count(*) FROM public.fin_payment_reports WHERE reported_by = v_uid AND created_at > now() - interval '1 hour') >= 10 THEN
    RETURN jsonb_build_object('ok',false,'error','RATE_LIMITED'); END IF;
  INSERT INTO public.fin_payment_reports(booking_ref, charter_booking_id, amount, currency, paid_on, method, payment_reference, note, source, reported_by)
    VALUES (v_bk.reference, v_bk.id, round(_amount,2), coalesce(v_bk.currency,'KES'), _paid_on, _method, nullif(trim(_reference),''), nullif(trim(_note),''),
            CASE WHEN v_team THEN 'team' ELSE 'client' END, v_uid) RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok',true,'id',v_id,'status','reported');
END $$;
REVOKE ALL ON FUNCTION public.fin_report_payment(text,numeric,date,text,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_report_payment(text,numeric,date,text,text,text) TO authenticated;

-- Verify or reject (four-eyes: never your own entry).
CREATE OR REPLACE FUNCTION public.fin_decide_payment(_id uuid, _verify boolean, _note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); r public.fin_payment_reports; v_email text;
BEGIN
  IF NOT public._fin_is_verifier() THEN RETURN jsonb_build_object('ok',false,'error','NOT_PERMITTED'); END IF;
  SELECT * INTO r FROM public.fin_payment_reports WHERE id = _id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','NOT_FOUND'); END IF;
  IF r.status <> 'reported' THEN RETURN jsonb_build_object('ok',false,'error','ALREADY_DECIDED'); END IF;
  IF r.reported_by = v_uid THEN RETURN jsonb_build_object('ok',false,'error','OWN_ENTRY'); END IF;
  IF NOT _verify AND length(trim(coalesce(_note,''))) < 3 THEN RETURN jsonb_build_object('ok',false,'error','NOTE_REQUIRED'); END IF;
  UPDATE public.fin_payment_reports SET status = CASE WHEN _verify THEN 'verified' ELSE 'rejected' END,
    verified_by = v_uid, verified_at = now(), decision_note = nullif(trim(_note),'') WHERE id = _id;
  IF _verify AND r.charter_booking_id IS NOT NULL THEN
    PERFORM public._fin_apply_verified(r.charter_booking_id);
    SELECT u.email INTO v_email FROM public.charter_bookings cb JOIN auth.users u ON u.id = cb.user_id WHERE cb.id = r.charter_booking_id;
    PERFORM public._fin_post_finance_record(v_email, 'Payment verified — booking ' || r.booking_ref,
      format('We have verified your payment of %s %s for booking %s (paid %s, %s%s). Thank you.', r.currency, to_char(r.amount,'FM999,999,990.00'),
        r.booking_ref, r.paid_on, r.method, coalesce(', ref ' || r.payment_reference, '')),
      jsonb_build_object('payment_report_id', r.id, 'kind', 'payment_verified'));
  END IF;
  RETURN jsonb_build_object('ok',true);
END $$;
REVOKE ALL ON FUNCTION public.fin_decide_payment(uuid,boolean,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_decide_payment(uuid,boolean,text) TO authenticated;

-- finance@ inbound email mentioning a booking + KES amount → pending report.
CREATE OR REPLACE FUNCTION public._fin_email_to_report() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_text text; v_ref text; v_amt text; v_bk public.charter_bookings;
BEGIN
  IF NEW.direction::text <> 'inbound' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.comms_accounts WHERE id = NEW.account_id AND lower(mailbox_address) = 'finance@yalla.africa') THEN RETURN NEW; END IF;
  v_text := coalesce(NEW.subject,'') || ' ' || coalesce(NEW.body_preview,'');
  v_ref := upper((regexp_match(v_text, '(CH-[A-Za-z0-9]{6,})'))[1]);
  v_amt := replace((regexp_match(v_text, '(?:KES|KSh|Ksh)\.?\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)', 'i'))[1], ',', '');
  IF v_ref IS NULL OR v_amt IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO v_bk FROM public.charter_bookings WHERE reference = v_ref;
  IF NOT FOUND OR v_amt::numeric <= 0 OR v_amt::numeric >= 100000000 THEN RETURN NEW; END IF;
  INSERT INTO public.fin_payment_reports(booking_ref, charter_booking_id, amount, currency, paid_on, method, note, source, source_message_id)
    VALUES (v_ref, v_bk.id, v_amt::numeric, coalesce(v_bk.currency,'KES'), (NEW.occurred_at AT TIME ZONE 'Africa/Nairobi')::date, 'other',
            left('From email: ' || coalesce(NEW.subject,''), 1000), 'email', NEW.id)
    ON CONFLICT (source_message_id) DO NOTHING;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $$;
CREATE TRIGGER fin_email_to_report AFTER INSERT ON public.comms_messages FOR EACH ROW EXECUTE FUNCTION public._fin_email_to_report();

-- Confirmed M-Pesa (callback sets mpesa_receipt + paid) → verified report + finance@ record.
CREATE OR REPLACE FUNCTION public._fin_mpesa_to_report() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_email text; v_id uuid;
BEGIN
  IF NEW.mpesa_receipt IS NULL OR lower(coalesce(NEW.payment_status,'')) <> 'paid' THEN RETURN NEW; END IF;
  IF OLD.mpesa_receipt IS NOT DISTINCT FROM NEW.mpesa_receipt AND lower(coalesce(OLD.payment_status,'')) = 'paid' THEN RETURN NEW; END IF;
  INSERT INTO public.fin_payment_reports(booking_ref, charter_booking_id, amount, currency, paid_on, method, payment_reference, source, status, verified_at, decision_note)
    VALUES (NEW.reference, NEW.id, coalesce(NEW.amount, 0.01), coalesce(NEW.currency,'KES'), (coalesce(NEW.paid_at, now()) AT TIME ZONE 'Africa/Nairobi')::date,
            'mpesa', NEW.mpesa_receipt, 'mpesa', 'verified', now(), 'Verified by M-Pesa callback')
    ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    SELECT email INTO v_email FROM auth.users WHERE id = NEW.user_id;
    PERFORM public._fin_post_finance_record(v_email, 'M-Pesa payment received — booking ' || NEW.reference,
      format('M-Pesa payment %s received for booking %s: %s %s.', NEW.mpesa_receipt, NEW.reference, coalesce(NEW.currency,'KES'), to_char(coalesce(NEW.amount,0),'FM999,999,990.00')),
      jsonb_build_object('payment_report_id', v_id, 'kind', 'mpesa_received'));
  END IF;
  RETURN NEW;
EXCEPTION WHEN others THEN RETURN NEW;
END $$;
CREATE TRIGGER fin_mpesa_to_report AFTER UPDATE OF payment_status, mpesa_receipt ON public.charter_bookings FOR EACH ROW EXECUTE FUNCTION public._fin_mpesa_to_report();

-- Finance dashboard
CREATE OR REPLACE FUNCTION public.fin_dashboard(_from date, _to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public._fin_is_team() THEN RETURN jsonb_build_object('ok',false,'error','NOT_PERMITTED'); END IF;
  SELECT jsonb_build_object('ok', true, 'can_verify', public._fin_is_verifier(), 'me', auth.uid(),
    'reports', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.paid_on DESC, r.created_at DESC) FROM public.fin_payment_reports r
        WHERE r.paid_on BETWEEN _from AND _to OR r.status = 'reported'), '[]'::jsonb),
    'emails', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'subject', m.subject, 'direction', m.direction, 'from', m.from_address,
        'to', m.to_addresses, 'at', m.occurred_at, 'source', m.source) ORDER BY m.occurred_at DESC)
        FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
        WHERE lower(ac.mailbox_address) = 'finance@yalla.africa' AND (m.occurred_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN _from AND _to), '[]'::jsonb),
    'billed', (SELECT coalesce(sum(amount),0) FROM public.charter_bookings WHERE (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN _from AND _to),
    'driver', (SELECT jsonb_build_object('income', coalesce(sum(amount) FILTER (WHERE kind='income'),0), 'expense', coalesce(sum(amount) FILTER (WHERE kind='expense'),0), 'entries', count(*))
        FROM public.driver_self_reports WHERE entry_date BETWEEN _from AND _to)
  ) INTO v;
  RETURN v;
END $$;

-- Driver self-reported income & expenses
CREATE TABLE public.driver_self_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid(),
  kind text NOT NULL CHECK (kind IN ('income','expense')),
  category text NOT NULL DEFAULT 'other' CHECK (char_length(category) BETWEEN 1 AND 40),
  amount numeric(12,2) NOT NULL CHECK (amount > 0 AND amount < 10000000),
  entry_date date NOT NULL,
  note text CHECK (char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_self_reports TO authenticated;
GRANT ALL ON public.driver_self_reports TO service_role;
ALTER TABLE public.driver_self_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Drivers manage own entries" ON public.driver_self_reports FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid() AND entry_date <= current_date + 1);
CREATE POLICY "Finance team reads driver entries" ON public.driver_self_reports FOR SELECT TO authenticated USING (public._fin_is_team());
CREATE TRIGGER driver_self_reports_touch BEFORE UPDATE ON public.driver_self_reports FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON FUNCTION public.fin_dashboard(date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fin_dashboard(date,date) TO authenticated;

-- Portal balance from verified payments
CREATE OR REPLACE FUNCTION public.client_portal_dashboard()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid := auth.uid(); v_base jsonb; v_email text; v_inv jsonb; v_prof jsonb; v_bk jsonb;
BEGIN
  v_base := public.client_portal_my_inbox();
  IF NOT (v_base->>'ok')::boolean THEN RETURN v_base; END IF;
  v_email := v_base->>'email';
  SELECT coalesce(jsonb_agg(i ORDER BY i->>'issued_at' DESC NULLS LAST), '[]'::jsonb) INTO v_inv FROM (
    SELECT jsonb_build_object('number', coalesce(invoice_number, kra_invoice_number), 'status', status, 'currency', currency,
      'total', total_cents / 100.0, 'paid', NULL, 'issued_at', issued_at, 'kind', 'tax') i
      FROM public.etims_invoices WHERE customer_user_id = v_uid OR lower(customer_email) = v_email
    UNION ALL SELECT jsonb_build_object('number', invoice_number, 'status', status, 'currency', currency,
      'total', total, 'paid', paid_total, 'issued_at', issued_at, 'kind', 'freight')
      FROM public.freight_invoices WHERE customer_user_id = v_uid
  ) s;
  SELECT coalesce(jsonb_agg(
    CASE WHEN cb.reference IS NULL THEN b ELSE b || jsonb_build_object(
      'amount', cb.amount, 'currency', cb.currency, 'payment_status', cb.payment_status, 'paid_at', cb.paid_at,
      'verified_paid', vp.v, 'pending_paid', vp.p,
      'balance', CASE WHEN lower(coalesce(cb.payment_status,'')) IN ('paid','completed','settled') THEN 0 ELSE greatest(cb.amount - vp.v, 0) END,
      'payments', vp.list,
      'finance_emails', (SELECT count(*) FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
          WHERE lower(ac.mailbox_address) = 'finance@yalla.africa'
            AND position(cb.reference in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0))
    END ORDER BY b->>'created_at' DESC), '[]'::jsonb)
    INTO v_bk
    FROM jsonb_array_elements(coalesce(v_base->'bookings','[]'::jsonb)) b
    LEFT JOIN public.charter_bookings cb ON cb.reference = b->>'ref' AND cb.user_id = v_uid
    LEFT JOIN LATERAL (SELECT coalesce(sum(amount) FILTER (WHERE status='verified'),0) v, coalesce(sum(amount) FILTER (WHERE status='reported'),0) p,
        coalesce(jsonb_agg(jsonb_build_object('amount',amount,'paid_on',paid_on,'method',method,'status',status,'source',source) ORDER BY created_at DESC),'[]'::jsonb) list
        FROM public.fin_payment_reports WHERE charter_booking_id = cb.id) vp ON true;
  SELECT jsonb_build_object('full_name', p.full_name, 'phone', p.phone,
     'company_name', cp.company_name, 'preferred_contact', coalesce(cp.preferred_contact,'email'),
     'email_updates', coalesce(cp.email_updates,true), 'sms_updates', coalesce(cp.sms_updates,false),
     'marketing_updates', coalesce(cp.marketing_updates,false))
    INTO v_prof FROM (SELECT v_uid u) x
    LEFT JOIN public.profiles p ON p.user_id = x.u
    LEFT JOIN public.client_portal_preferences cp ON cp.user_id = x.u;
  RETURN v_base || jsonb_build_object('invoices', v_inv, 'profile', v_prof, 'bookings', v_bk);
END $function$;

CREATE OR REPLACE FUNCTION public.admin_client_booking_links()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_out jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT (coalesce(public.has_role(auth.uid(),'admin'),false) OR coalesce(public.has_role(auth.uid(),'super_admin'),false)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_PERMITTED'); END IF;
  WITH b AS (
    SELECT rider_user_id uid, booking_number ref, 'ride' kind, status::text status, created_at, NULL::numeric amount, NULL::text currency, NULL::text payment_status, NULL::timestamptz paid_at, NULL::uuid cid
      FROM public.trip_bookings WHERE booking_number IS NOT NULL AND rider_user_id IS NOT NULL
    UNION ALL SELECT user_id, reference, 'charter', status, created_at, amount, currency, payment_status, paid_at, id
      FROM public.charter_bookings WHERE reference IS NOT NULL AND user_id IS NOT NULL
  ), bv AS (
    SELECT b.*, CASE WHEN lower(coalesce(b.payment_status,'')) IN ('paid','completed','settled') THEN b.amount
       ELSE least(coalesce((SELECT sum(amount) FROM public.fin_payment_reports r WHERE r.charter_booking_id = b.cid AND r.status='verified'),0), coalesce(b.amount,0)) END paid_amt
    FROM b
  ), c AS (
    SELECT bv.uid, u.email, p.full_name,
      jsonb_agg(jsonb_build_object('ref', bv.ref, 'kind', bv.kind, 'status', bv.status, 'created_at', bv.created_at,
        'amount', bv.amount, 'currency', bv.currency, 'payment_status', bv.payment_status, 'paid_at', bv.paid_at, 'paid_amount', bv.paid_amt,
        'pending_reports', (SELECT count(*) FROM public.fin_payment_reports r WHERE r.charter_booking_id = bv.cid AND r.status='reported'),
        'finance_emails', (SELECT count(*) FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
           WHERE lower(ac.mailbox_address) = 'finance@yalla.africa'
             AND position(bv.ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0),
        'threads', (SELECT coalesce(jsonb_agg(DISTINCT jsonb_build_object('thread_id', t.id, 'subject', t.subject, 'mailbox', ac.mailbox_address, 'last_at', t.last_activity_at)), '[]'::jsonb)
           FROM public.comms_messages m JOIN public.comms_threads t ON t.id = m.thread_id JOIN public.comms_accounts ac ON ac.id = m.account_id
           WHERE position(bv.ref in coalesce(m.subject,'')||' '||coalesce(m.body_preview,'')) > 0)
      ) ORDER BY bv.created_at DESC) bookings, max(bv.created_at) last_at,
      sum(bv.amount) total_amount, sum(bv.paid_amt) paid_amount
    FROM bv JOIN auth.users u ON u.id = bv.uid LEFT JOIN public.profiles p ON p.user_id = bv.uid
    GROUP BY bv.uid, u.email, p.full_name
  )
  SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', uid, 'email', email, 'name', full_name, 'bookings', bookings,
      'total_amount', total_amount, 'paid_amount', paid_amount) ORDER BY last_at DESC), '[]'::jsonb)
    INTO v_out FROM (SELECT * FROM c ORDER BY last_at DESC LIMIT 300) s;
  RETURN jsonb_build_object('ok', true, 'clients', v_out);
END $function$;
