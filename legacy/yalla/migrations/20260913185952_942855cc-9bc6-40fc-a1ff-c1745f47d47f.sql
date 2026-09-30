-- ============ Corporate rental portal: membership, budgets, balance, submission ============

CREATE OR REPLACE FUNCTION public.rental_corporate_member_role(_account_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN NULL
    WHEN public.has_role(auth.uid(),'admin') = true THEN 'STAFF'
    WHEN public.has_role(auth.uid(),'super_admin') = true THEN 'STAFF'
    WHEN public.has_role(auth.uid(),'finance_admin') = true THEN 'STAFF'
    ELSE (
      SELECT CASE WHEN bool_or(e.role = 'corporate_admin') THEN 'CORPORATE_ADMIN' ELSE 'CORPORATE_MEMBER' END
        FROM public.rental_corporate_accounts a
        JOIN public.corporate_employees e ON e.corporate_id = a.corporate_id
       WHERE a.id = _account_id AND e.user_id = auth.uid() AND e.status = 'active'
    )
  END
$$;
REVOKE ALL ON FUNCTION public.rental_corporate_member_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rental_corporate_member_role(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rental_corporate_member_role(uuid) TO authenticated, service_role;

CREATE TABLE IF NOT EXISTS public.rental_corporate_budgets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES public.rental_corporate_accounts(id) ON DELETE CASCADE,
  period_month date NOT NULL,
  budget_kes numeric(14,2) NOT NULL CHECK (budget_kes >= 0),
  note text,
  set_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, period_month)
);

GRANT SELECT ON public.rental_corporate_budgets TO authenticated;
GRANT ALL ON public.rental_corporate_budgets TO service_role;
ALTER TABLE public.rental_corporate_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rental_corp_budget_member_read" ON public.rental_corporate_budgets
  FOR SELECT TO authenticated
  USING (public.rental_corporate_member_role(account_id) IS NOT NULL);

CREATE TRIGGER trg_rental_corporate_budgets_touch
  BEFORE UPDATE ON public.rental_corporate_budgets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE VIEW public.v_rental_corporate_budget AS
WITH months AS (
  SELECT a.id AS account_id, a.account_code, a.legal_name, a.match_names,
         (date_trunc('month', (now() AT TIME ZONE 'Africa/Nairobi'))::date
            - (make_interval(months => g))::interval)::date AS period_month
    FROM public.rental_corporate_accounts a
    CROSS JOIN generate_series(0, 5) AS g
), committed AS (
  SELECT ap.account_id, date_trunc('month', ap.created_at AT TIME ZONE 'Africa/Nairobi')::date AS period_month,
         coalesce(sum(ap.amount_kes) FILTER (WHERE ap.state = 'REQUESTED'), 0) AS pending_kes,
         coalesce(sum(ap.amount_kes) FILTER (WHERE ap.state = 'APPROVED'), 0)  AS approved_kes,
         count(*) FILTER (WHERE ap.state = 'REQUESTED') AS pending_requests
    FROM public.rental_corporate_approvals ap
   GROUP BY 1,2
), booked AS (
  SELECT m.account_id, m.period_month,
         coalesce(sum(b.total_kes), 0) AS booked_kes,
         count(b.id) AS bookings
    FROM months m
    LEFT JOIN public.rental_bookings b
           ON lower(coalesce(b.company_name,'')) = ANY (m.match_names)
          AND date_trunc('month', b.start_date)::date = m.period_month
          AND coalesce(b.status,'') <> 'CANCELLED'
   GROUP BY 1,2
)
SELECT m.account_id, m.account_code, m.legal_name, m.period_month,
       coalesce(bg.budget_kes, 0)::numeric AS budget_kes,
       (bg.id IS NOT NULL) AS budget_set,
       bg.note AS budget_note,
       coalesce(c.pending_kes, 0)::numeric  AS pending_approval_kes,
       coalesce(c.approved_kes, 0)::numeric AS approved_kes,
       coalesce(c.pending_requests, 0)::bigint AS pending_requests,
       coalesce(bk.booked_kes, 0)::numeric  AS booked_kes,
       coalesce(bk.bookings, 0)::bigint     AS bookings,
       (coalesce(bk.booked_kes,0) + coalesce(c.pending_kes,0) + coalesce(c.approved_kes,0))::numeric AS consumed_kes,
       CASE WHEN bg.id IS NULL THEN NULL
            ELSE (bg.budget_kes - (coalesce(bk.booked_kes,0) + coalesce(c.pending_kes,0) + coalesce(c.approved_kes,0)))
       END::numeric AS available_budget_kes
  FROM months m
  LEFT JOIN public.rental_corporate_budgets bg ON bg.account_id = m.account_id AND bg.period_month = m.period_month
  LEFT JOIN committed c ON c.account_id = m.account_id AND c.period_month = m.period_month
  LEFT JOIN booked bk   ON bk.account_id = m.account_id AND bk.period_month = m.period_month
 WHERE public.rental_corporate_member_role(m.account_id) IS NOT NULL;

ALTER VIEW public.v_rental_corporate_budget SET (security_invoker = true);
GRANT SELECT ON public.v_rental_corporate_budget TO authenticated;

CREATE OR REPLACE FUNCTION public.rental_corporate_budget_set(
  _account_id uuid, _period_month date, _budget_kes numeric, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r text; pm date; row_out public.rental_corporate_budgets;
BEGIN
  r := public.rental_corporate_member_role(_account_id);
  IF r IS NULL OR r = 'CORPORATE_MEMBER' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','NOT_AUTHORISED');
  END IF;
  IF _budget_kes IS NULL OR _budget_kes < 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','INVALID_BUDGET_AMOUNT');
  END IF;
  pm := date_trunc('month', coalesce(_period_month, (now() AT TIME ZONE 'Africa/Nairobi')::date))::date;

  INSERT INTO public.rental_corporate_budgets (account_id, period_month, budget_kes, note, set_by)
  VALUES (_account_id, pm, _budget_kes, _note, auth.uid())
  ON CONFLICT (account_id, period_month)
    DO UPDATE SET budget_kes = excluded.budget_kes, note = excluded.note,
                  set_by = excluded.set_by, updated_at = now()
  RETURNING * INTO row_out;

  INSERT INTO public.rental_policy_decisions
    (evaluation_point, policy_code, policy_version, rule_type, subject_type, subject_ref,
     input, decision, reason, actor_kind, actor_id)
  VALUES ('CORPORATE_BUDGET','CORPORATE_BUDGET', NULL, 'CONFIGURATION',
          'corporate_account', _account_id::text,
          jsonb_build_object('period_month', pm, 'budget_kes', _budget_kes, 'note', _note),
          'BUDGET_SET', 'Set by ' || r, 'HUMAN', auth.uid());

  RETURN jsonb_build_object('ok', true, 'budget_id', row_out.id,
                            'period_month', row_out.period_month, 'budget_kes', row_out.budget_kes);
END; $$;
REVOKE ALL ON FUNCTION public.rental_corporate_budget_set(uuid, date, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rental_corporate_budget_set(uuid, date, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rental_corporate_budget_set(uuid, date, numeric, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rental_corporate_portal(_account_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE acc uuid; r text; out_json jsonb;
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason_code','NOT_SIGNED_IN'); END IF;

  SELECT a.id INTO acc
    FROM public.rental_corporate_accounts a
   WHERE (_account_id IS NULL OR a.id = _account_id)
     AND public.rental_corporate_member_role(a.id) IS NOT NULL
   ORDER BY (a.id = _account_id) DESC, a.legal_name
   LIMIT 1;

  IF acc IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason_code','NO_CORPORATE_ACCOUNT'); END IF;
  r := public.rental_corporate_member_role(acc);

  SELECT jsonb_build_object(
    'ok', true,
    'member_role', r,
    'accounts', (SELECT coalesce(jsonb_agg(jsonb_build_object('account_id', a.id, 'account_code', a.account_code,
                          'legal_name', a.legal_name) ORDER BY a.legal_name), '[]'::jsonb)
                   FROM public.rental_corporate_accounts a
                  WHERE public.rental_corporate_member_role(a.id) IS NOT NULL),
    'account', (SELECT to_jsonb(x) FROM (
                  SELECT a.id AS account_id, a.account_code, a.legal_name, a.status, a.credit_state,
                         a.credit_limit_kes, a.payment_terms_days, a.cost_centre,
                         a.auto_approve_below_kes, a.elevated_approval_above_kes,
                         a.approver_name, a.approver_email
                    FROM public.rental_corporate_accounts a WHERE a.id = acc) x),
    'exposure', (SELECT to_jsonb(e) FROM public.v_rental_corporate_exposure e WHERE e.account_id = acc),
    'budgets', (SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.period_month DESC), '[]'::jsonb)
                  FROM public.v_rental_corporate_budget b WHERE b.account_id = acc),
    'approvals', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'id', ap.id, 'quote_reference', ap.quote_reference, 'booking_reference', ap.booking_reference,
                        'amount_kes', ap.amount_kes, 'required_level', ap.required_level, 'state', ap.state,
                        'reason', ap.reason, 'decision_note', ap.decision_note,
                        'decided_at', ap.decided_at, 'created_at', ap.created_at) ORDER BY ap.created_at DESC), '[]'::jsonb)
                    FROM (SELECT * FROM public.rental_corporate_approvals
                           WHERE account_id = acc ORDER BY created_at DESC LIMIT 50) ap),
    'bookings', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'booking_reference', b.booking_reference, 'category', b.category, 'band_label', b.band_label,
                        'start_date', b.start_date, 'end_date', b.end_date, 'status', b.status,
                        'total_kes', b.total_kes, 'amount_paid_kes', b.amount_paid_kes,
                        'contact_name', b.contact_name) ORDER BY b.start_date DESC), '[]'::jsonb)
                    FROM (SELECT b.* FROM public.rental_bookings b
                           JOIN public.rental_corporate_accounts a ON a.id = acc
                          WHERE lower(coalesce(b.company_name,'')) = ANY (a.match_names)
                          ORDER BY b.start_date DESC LIMIT 50) b)
  ) INTO out_json;

  RETURN out_json;
END; $$;
REVOKE ALL ON FUNCTION public.rental_corporate_portal(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rental_corporate_portal(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rental_corporate_portal(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rental_corporate_submit_booking(
  _account_id uuid, _quote_reference text, _purpose text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r text; q public.rental_quote_requests; bud record; gate jsonb; pm date; corr uuid;
BEGIN
  r := public.rental_corporate_member_role(_account_id);
  IF r IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason_code','NOT_AUTHORISED'); END IF;

  SELECT * INTO q FROM public.rental_quote_requests
   WHERE reference = upper(trim(coalesce(_quote_reference,''))) LIMIT 1;
  IF q.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'reason_code','QUOTE_NOT_FOUND'); END IF;
  IF q.status = 'CANCELLED' THEN RETURN jsonb_build_object('ok', false, 'reason_code','QUOTE_CANCELLED'); END IF;
  IF q.expires_at IS NOT NULL AND q.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','QUOTE_EXPIRED');
  END IF;

  corr := coalesce(q.correlation_id, gen_random_uuid());
  pm := date_trunc('month', q.start_date)::date;
  SELECT * INTO bud FROM public.v_rental_corporate_budget
   WHERE account_id = _account_id AND period_month = pm;

  IF bud.account_id IS NULL OR bud.budget_set = false THEN
    INSERT INTO public.rental_policy_decisions
      (evaluation_point, policy_code, rule_type, subject_type, subject_ref, correlation_id,
       input, decision, reason, actor_kind, actor_id)
    VALUES ('CORPORATE_BOOKING','CORPORATE_BUDGET','HARD_GATE','quote', q.reference, corr,
            jsonb_build_object('period_month', pm, 'amount_kes', q.total_kes),
            'REFUSED','NO_BUDGET_FOR_PERIOD','MACHINE', auth.uid());
    RETURN jsonb_build_object('ok', false, 'reason_code','NO_BUDGET_FOR_PERIOD', 'period_month', pm);
  END IF;

  IF bud.available_budget_kes < q.total_kes THEN
    INSERT INTO public.rental_policy_decisions
      (evaluation_point, policy_code, rule_type, subject_type, subject_ref, correlation_id,
       input, decision, reason, actor_kind, actor_id)
    VALUES ('CORPORATE_BOOKING','CORPORATE_BUDGET','HARD_GATE','quote', q.reference, corr,
            jsonb_build_object('period_month', pm, 'amount_kes', q.total_kes,
                               'available_budget_kes', bud.available_budget_kes),
            'REFUSED','BUDGET_EXCEEDED','MACHINE', auth.uid());
    RETURN jsonb_build_object('ok', false, 'reason_code','BUDGET_EXCEEDED',
                              'available_budget_kes', bud.available_budget_kes,
                              'amount_kes', q.total_kes, 'period_month', pm);
  END IF;

  gate := public.rental_corporate_gate(
            (SELECT legal_name FROM public.rental_corporate_accounts WHERE id = _account_id),
            q.total_kes, q.id, q.reference, corr);

  UPDATE public.rental_corporate_approvals
     SET reason = coalesce(reason,'') ||
                  CASE WHEN _purpose IS NULL OR _purpose = '' THEN '' ELSE ' | purpose: ' || _purpose END
   WHERE account_id = _account_id AND quote_id = q.id AND state = 'REQUESTED';

  RETURN jsonb_build_object('ok', true, 'quote_reference', q.reference, 'amount_kes', q.total_kes,
                            'period_month', pm, 'available_budget_kes', bud.available_budget_kes,
                            'gate', gate);
END; $$;
REVOKE ALL ON FUNCTION public.rental_corporate_submit_booking(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.rental_corporate_submit_booking(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.rental_corporate_submit_booking(uuid, text, text) TO authenticated, service_role;