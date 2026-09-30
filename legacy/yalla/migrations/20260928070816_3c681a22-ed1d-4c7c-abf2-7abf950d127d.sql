CREATE OR REPLACE FUNCTION public.fin_dashboard(_from date, _to date) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT COALESCE(public._fin_is_team(), false) THEN RETURN jsonb_build_object('ok',false,'error','NOT_PERMITTED'); END IF;
  SELECT jsonb_build_object('ok', true, 'can_verify', public._fin_is_verifier(), 'me', auth.uid(),
    'reports', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.paid_on DESC, r.created_at DESC) FROM public.fin_payment_reports r
        WHERE r.paid_on BETWEEN _from AND _to OR r.status = 'reported'), '[]'::jsonb),
    'emails', coalesce((SELECT jsonb_agg(jsonb_build_object('id', m.id, 'subject', m.subject, 'direction', m.direction, 'from', m.from_address,
        'to', m.to_addresses, 'at', m.occurred_at, 'source', m.source) ORDER BY m.occurred_at DESC)
        FROM public.comms_messages m JOIN public.comms_accounts ac ON ac.id = m.account_id
        WHERE lower(ac.mailbox_address) = 'finance@yalla.africa' AND (m.occurred_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN _from AND _to), '[]'::jsonb),
    'billed', (SELECT coalesce(sum(amount),0) FROM public.charter_bookings WHERE (created_at AT TIME ZONE 'Africa/Nairobi')::date BETWEEN _from AND _to),
    'driver', (SELECT jsonb_build_object(
        'income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='verified'),0),
        'expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='verified'),0),
        'pending_income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='pending'),0),
        'pending_expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='pending'),0),
        'entries', count(*), 'pending', count(*) FILTER (WHERE verification_status='pending'))
        FROM public.driver_self_reports WHERE audience='driver' AND entry_date BETWEEN _from AND _to),
    'rider', (SELECT jsonb_build_object(
        'income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='verified'),0),
        'expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='verified'),0),
        'pending_income', coalesce(sum(amount) FILTER (WHERE kind='income' AND verification_status='pending'),0),
        'pending_expense', coalesce(sum(amount) FILTER (WHERE kind='expense' AND verification_status='pending'),0),
        'entries', count(*), 'pending', count(*) FILTER (WHERE verification_status='pending'))
        FROM public.driver_self_reports WHERE audience='rider' AND entry_date BETWEEN _from AND _to),
    'log_queue', coalesce((SELECT jsonb_agg(jsonb_build_object('id', s.id, 'user_id', s.user_id, 'audience', s.audience, 'kind', s.kind,
        'category', s.category, 'amount', s.amount, 'entry_date', s.entry_date, 'note', s.note,
        'name', coalesce(p.full_name, 'NOT STATED')) ORDER BY s.entry_date DESC)
        FROM public.driver_self_reports s LEFT JOIN public.profiles p ON p.user_id = s.user_id
        WHERE s.verification_status = 'pending'), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;