-- ============================ seed requirement catalogue ============================
INSERT INTO public.partner_onboarding_requirements (code, label, description, partner_types, is_mandatory, validity_months, sort_order)
VALUES
  ('CERT_INCORPORATION','Certificate of incorporation','Registrar certificate proving the legal entity exists.','{}',true,NULL,10),
  ('KRA_PIN','KRA PIN certificate','Tax identity of the contracting entity.','{}',true,NULL,20),
  ('TAX_COMPLIANCE','Tax compliance certificate','Valid KRA tax compliance certificate.','{}',true,12,30),
  ('CR12','CR12 / directors register','Current directors and shareholding.','{}',true,12,40),
  ('DIRECTOR_ID','Director identification','National ID or passport of the signing director.','{}',true,NULL,50),
  ('BANK_PROOF','Bank / settlement account proof','Bank letter or cancelled cheque for payouts.','{}',true,NULL,60),
  ('INSURANCE','Liability insurance','Public/passenger liability cover.','{TOUR_OPERATOR,DMC,AIR_CHARTER,LOGISTICS,COURIER}',true,12,70),
  ('TRA_LICENCE','Tourism regulatory licence','TRA licence for tour operators and DMCs.','{TOUR_OPERATOR,DMC,TRAVEL_AGENCY}',true,12,80),
  ('OPERATING_LICENCE','Operating licence','Sector operating licence where applicable.','{AIRLINE,AIR_CHARTER,LOGISTICS,COURIER}',true,12,90),
  ('SIGNED_AGREEMENT','Signed partnership agreement','Counter-signed Yalla Partners agreement.','{}',true,NULL,100)
ON CONFLICT (code) DO NOTHING;

-- ============================ internal helpers ============================
CREATE OR REPLACE FUNCTION public.yp_audit(_action text, _entity text, _entity_id uuid, _after jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  INSERT INTO public.audit_logs (actor_user_id, entity_type, entity_id, action, after_data)
  VALUES (auth.uid(), _entity, _entity_id, _action, _after);
END $$;
REVOKE ALL ON FUNCTION public.yp_audit(text,text,uuid,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.yp_audit(text,text,uuid,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.yp_require_staff()
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.yp_is_staff() THEN RAISE EXCEPTION 'not_authorised: Yalla staff role required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.yp_require_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.yp_require_staff() TO authenticated, service_role;

-- Post one ledger entry and move the wallet balance atomically.
CREATE OR REPLACE FUNCTION public.partner_ledger_post(
  _partner_id uuid, _kind public.partner_ledger_kind, _direction public.ledger_direction,
  _amount numeric, _memo text, _order_id uuid DEFAULT NULL, _settlement_id uuid DEFAULT NULL,
  _reference text DEFAULT NULL, _idempotency_key text DEFAULT NULL, _move_balance boolean DEFAULT true
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  w public.partner_wallets%ROWTYPE;
  new_balance numeric;
  entry_id uuid;
BEGIN
  IF _amount IS NULL OR _amount < 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;

  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO entry_id FROM public.partner_ledger_entries WHERE idempotency_key = _idempotency_key;
    IF entry_id IS NOT NULL THEN RETURN entry_id; END IF;
  END IF;

  SELECT * INTO w FROM public.partner_wallets WHERE partner_id = _partner_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.partner_wallets (partner_id) VALUES (_partner_id) RETURNING * INTO w;
  END IF;

  new_balance := w.balance;
  IF _move_balance THEN
    new_balance := w.balance + CASE WHEN _direction = 'CREDIT' THEN _amount ELSE -_amount END;
    IF new_balance + w.credit_limit < 0 THEN
      RAISE EXCEPTION 'insufficient_wallet_balance: available %, required %', w.balance + w.credit_limit, _amount;
    END IF;
    UPDATE public.partner_wallets SET balance = new_balance WHERE id = w.id;
  END IF;

  INSERT INTO public.partner_ledger_entries
    (partner_id, wallet_id, order_id, settlement_id, entry_kind, direction, amount, currency,
     balance_after, memo, reference, idempotency_key, created_by)
  VALUES (_partner_id, w.id, _order_id, _settlement_id, _kind, _direction, _amount, w.currency,
     new_balance, _memo, _reference, _idempotency_key, auth.uid())
  RETURNING id INTO entry_id;

  RETURN entry_id;
END $$;
REVOKE ALL ON FUNCTION public.partner_ledger_post(uuid,public.partner_ledger_kind,public.ledger_direction,numeric,text,uuid,uuid,text,text,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.partner_ledger_post(uuid,public.partner_ledger_kind,public.ledger_direction,numeric,text,uuid,uuid,text,text,boolean) TO service_role;

-- ============================ work queue ============================
CREATE OR REPLACE FUNCTION public.partner_case_open(
  _queue text, _title text, _detail text DEFAULT NULL, _priority text DEFAULT 'medium',
  _sla_minutes integer DEFAULT 240, _partner_id uuid DEFAULT NULL, _order_id uuid DEFAULT NULL,
  _journey_id uuid DEFAULT NULL, _application_id uuid DEFAULT NULL, _settlement_id uuid DEFAULT NULL,
  _compliance_flags text[] DEFAULT '{}', _risk_score numeric DEFAULT 0, _dedupe_key text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE existing uuid; new_id uuid; code text;
BEGIN
  IF _dedupe_key IS NOT NULL THEN
    SELECT id INTO existing FROM public.partner_work_items WHERE dedupe_key = _dedupe_key;
    IF existing IS NOT NULL THEN RETURN existing; END IF;
  END IF;
  code := 'PW-' || to_char(now(),'YYMM') || '-' || upper(substr(md5(gen_random_uuid()::text),1,6));
  INSERT INTO public.partner_work_items
    (work_code, queue, title, detail, priority, sla_minutes, partner_id, order_id, journey_id,
     application_id, settlement_id, compliance_flags, risk_score, dedupe_key, created_by)
  VALUES (code, _queue, _title, _detail, _priority, _sla_minutes, _partner_id, _order_id, _journey_id,
     _application_id, _settlement_id, COALESCE(_compliance_flags,'{}'), COALESCE(_risk_score,0), _dedupe_key, auth.uid())
  RETURNING id INTO new_id;

  INSERT INTO public.partner_work_events (work_item_id, action, to_state, note, actor_id)
  VALUES (new_id, 'opened', 'open', _detail, auth.uid());
  RETURN new_id;
END $$;
REVOKE ALL ON FUNCTION public.partner_case_open(text,text,text,text,integer,uuid,uuid,uuid,uuid,uuid,text[],numeric,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_case_open(text,text,text,text,integer,uuid,uuid,uuid,uuid,uuid,text[],numeric,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_case_action(
  _case_id uuid, _action text, _note text DEFAULT NULL, _assign_to uuid DEFAULT NULL
) RETURNS public.partner_work_items LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE row public.partner_work_items%ROWTYPE; prev public.partner_case_state; next_state public.partner_case_state;
BEGIN
  PERFORM public.yp_require_staff();
  SELECT * INTO row FROM public.partner_work_items WHERE id = _case_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'case_not_found'; END IF;
  prev := row.state;

  next_state := CASE _action
    WHEN 'claim' THEN 'in_progress' WHEN 'start' THEN 'in_progress'
    WHEN 'wait' THEN 'waiting' WHEN 'escalate' THEN 'escalated'
    WHEN 'resolve' THEN 'resolved' WHEN 'close' THEN 'closed'
    WHEN 'reopen' THEN 'open' WHEN 'assign' THEN row.state WHEN 'note' THEN row.state
    ELSE NULL END;
  IF next_state IS NULL THEN RAISE EXCEPTION 'unknown_action: %', _action; END IF;

  IF _action IN ('escalate','resolve','close','wait') AND COALESCE(btrim(_note),'') = '' THEN
    RAISE EXCEPTION 'reason_required: % needs a recorded reason', _action;
  END IF;
  IF prev = 'closed' AND _action <> 'reopen' THEN RAISE EXCEPTION 'case_closed'; END IF;

  UPDATE public.partner_work_items SET
    state = next_state,
    assigned_to = CASE WHEN _action IN ('claim') THEN auth.uid()
                       WHEN _assign_to IS NOT NULL THEN _assign_to ELSE assigned_to END,
    escalated_at = CASE WHEN _action = 'escalate' THEN now() ELSE escalated_at END,
    escalation_reason = CASE WHEN _action = 'escalate' THEN _note ELSE escalation_reason END,
    priority = CASE WHEN _action = 'escalate' THEN
        CASE priority WHEN 'low' THEN 'medium' WHEN 'medium' THEN 'high' ELSE 'critical' END
      ELSE priority END,
    resolved_at = CASE WHEN _action IN ('resolve','close') THEN now() ELSE resolved_at END,
    resolution_notes = CASE WHEN _action IN ('resolve','close') THEN _note ELSE resolution_notes END
  WHERE id = _case_id RETURNING * INTO row;

  INSERT INTO public.partner_work_events (work_item_id, action, from_state, to_state, note, actor_id)
  VALUES (_case_id, _action, prev, row.state, _note, auth.uid());

  PERFORM public.yp_audit('partner_case_' || _action, 'partner_work_items', _case_id,
    jsonb_build_object('from', prev, 'to', row.state, 'note', _note));
  RETURN row;
END $$;
REVOKE ALL ON FUNCTION public.partner_case_action(uuid,text,text,uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_case_action(uuid,text,text,uuid) TO authenticated, service_role;

-- ============================ onboarding ============================
CREATE OR REPLACE FUNCTION public.partner_application_promote(
  _application_id uuid, _partner_margin_pct numeric DEFAULT 10,
  _commission_model public.partner_commission_model DEFAULT 'COMMISSION'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE app public.partner_applications%ROWTYPE; pid uuid; code text; r record;
BEGIN
  PERFORM public.yp_require_staff();
  SELECT * INTO app FROM public.partner_applications WHERE id = _application_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'application_not_found'; END IF;
  IF app.partner_id IS NOT NULL THEN RETURN app.partner_id; END IF;

  code := 'YP-' || upper(substr(md5(app.id::text),1,6));
  INSERT INTO public.partners (
    partner_code, legal_name, trading_name, partner_type, status, verification_status,
    commercial_model, commission_model, partner_margin_pct, primary_contact_name,
    primary_contact_email, primary_contact_phone, country, city, onboarding_stage, created_by)
  VALUES (code, app.organisation_name, app.organisation_name, app.partner_type, 'pending', 'in_review',
    app.commercial_model, _commission_model, GREATEST(0, COALESCE(_partner_margin_pct,10)),
    app.contact_name, app.contact_email, app.contact_phone, COALESCE(app.country,'KE'), app.city,
    'documents_pending', auth.uid())
  RETURNING id INTO pid;

  INSERT INTO public.partner_wallets (partner_id) VALUES (pid) ON CONFLICT (partner_id) DO NOTHING;

  UPDATE public.partner_applications
     SET partner_id = pid, status = 'approved', reviewed_at = now(), reviewed_by = auth.uid()
   WHERE id = _application_id;

  UPDATE public.partner_documents SET partner_id = pid WHERE application_id = _application_id;

  -- one compliance case per mandatory requirement still missing
  FOR r IN
    SELECT req.code, req.label FROM public.partner_onboarding_requirements req
    WHERE req.is_active AND req.is_mandatory
      AND (cardinality(req.partner_types) = 0 OR app.partner_type = ANY (req.partner_types))
      AND NOT EXISTS (SELECT 1 FROM public.partner_documents d
                      WHERE d.partner_id = pid AND d.requirement_code = req.code AND d.status <> 'rejected')
  LOOP
    PERFORM public.partner_case_open('onboarding', 'Awaiting ' || r.label,
      'Mandatory onboarding document not yet supplied.', 'medium', 2880, pid, NULL, NULL,
      _application_id, NULL, ARRAY['document_missing'], 20, 'doc:' || pid || ':' || r.code);
  END LOOP;

  INSERT INTO public.partner_events (partner_id, event_type, title, detail, severity, actor_id)
  VALUES (pid, 'onboarding', 'Partner record created from application', app.reference, 'info', auth.uid());

  PERFORM public.yp_audit('partner_promoted', 'partners', pid,
    jsonb_build_object('application_id', _application_id, 'partner_code', code));
  RETURN pid;
END $$;
REVOKE ALL ON FUNCTION public.partner_application_promote(uuid,numeric,public.partner_commission_model) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_application_promote(uuid,numeric,public.partner_commission_model) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_document_review(
  _document_id uuid, _decision public.partner_doc_status, _notes text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE d public.partner_documents%ROWTYPE;
BEGIN
  IF NOT public.yp_is_compliance() THEN RAISE EXCEPTION 'not_authorised: compliance role required'; END IF;
  IF _decision NOT IN ('approved','rejected','expired') THEN RAISE EXCEPTION 'invalid_decision'; END IF;
  IF _decision = 'rejected' AND COALESCE(btrim(_notes),'') = '' THEN RAISE EXCEPTION 'reason_required'; END IF;

  UPDATE public.partner_documents
     SET status = _decision, review_notes = _notes, reviewed_by = auth.uid(), reviewed_at = now()
   WHERE id = _document_id RETURNING * INTO d;
  IF NOT FOUND THEN RAISE EXCEPTION 'document_not_found'; END IF;

  IF d.partner_id IS NOT NULL THEN
    IF _decision = 'approved' THEN
      UPDATE public.partner_work_items SET state = 'resolved', resolved_at = now(),
             resolution_notes = 'Document approved'
       WHERE dedupe_key = 'doc:' || d.partner_id || ':' || d.requirement_code AND state <> 'closed';
    ELSIF _decision = 'rejected' THEN
      PERFORM public.partner_case_open('compliance', 'Rejected document: ' || d.requirement_code,
        COALESCE(_notes,'Document rejected'), 'high', 1440, d.partner_id, NULL, NULL, NULL, NULL,
        ARRAY['document_rejected'], 40, 'docrej:' || d.id);
    END IF;

    INSERT INTO public.partner_events (partner_id, event_type, title, detail, severity, actor_id)
    VALUES (d.partner_id, 'compliance', 'Document ' || _decision || ': ' || d.requirement_code,
            _notes, CASE WHEN _decision = 'approved' THEN 'info' ELSE 'warning' END, auth.uid());
  END IF;

  PERFORM public.yp_audit('partner_document_' || _decision, 'partner_documents', _document_id,
    jsonb_build_object('requirement', d.requirement_code, 'notes', _notes));
END $$;
REVOKE ALL ON FUNCTION public.partner_document_review(uuid,public.partner_doc_status,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_document_review(uuid,public.partner_doc_status,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_onboarding_gaps(_partner_id uuid)
RETURNS TABLE(code text, label text, is_mandatory boolean, doc_status text, expires_at date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT req.code, req.label, req.is_mandatory,
         COALESCE(d.status::text, 'missing') AS doc_status, d.expires_at
    FROM public.partner_onboarding_requirements req
    CROSS JOIN LATERAL (SELECT p.partner_type FROM public.partners p WHERE p.id = _partner_id) pt
    LEFT JOIN LATERAL (
      SELECT dd.status, dd.expires_at FROM public.partner_documents dd
       WHERE dd.partner_id = _partner_id AND dd.requirement_code = req.code
       ORDER BY (dd.status = 'approved') DESC, dd.created_at DESC LIMIT 1
    ) d ON true
   WHERE req.is_active
     AND (cardinality(req.partner_types) = 0 OR pt.partner_type = ANY (req.partner_types))
     AND (public.yp_is_staff() OR public.is_partner_member(_partner_id))
   ORDER BY req.sort_order;
$$;
REVOKE ALL ON FUNCTION public.partner_onboarding_gaps(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_onboarding_gaps(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_advance_onboarding(
  _partner_id uuid, _stage public.partner_onboarding_stage, _note text DEFAULT NULL
) RETURNS public.partners LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.partners%ROWTYPE; missing integer;
BEGIN
  PERFORM public.yp_require_staff();
  SELECT * INTO p FROM public.partners WHERE id = _partner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'partner_not_found'; END IF;

  IF _stage IN ('verified','activation') THEN
    SELECT count(*) INTO missing FROM public.partner_onboarding_gaps(_partner_id) g
     WHERE g.is_mandatory AND g.doc_status <> 'approved';
    IF missing > 0 THEN
      RAISE EXCEPTION 'documents_incomplete: % mandatory document(s) not approved', missing;
    END IF;
  END IF;
  IF _stage IN ('rejected','suspended') AND COALESCE(btrim(_note),'') = '' THEN
    RAISE EXCEPTION 'reason_required';
  END IF;

  UPDATE public.partners SET
    onboarding_stage = _stage,
    verification_status = CASE _stage
      WHEN 'verified' THEN 'verified'::public.partner_verification_status
      WHEN 'rejected' THEN 'rejected'::public.partner_verification_status
      WHEN 'applied' THEN 'unverified'::public.partner_verification_status
      ELSE 'in_review'::public.partner_verification_status END,
    status = CASE _stage
      WHEN 'verified' THEN 'active'::public.partner_status
      WHEN 'rejected' THEN 'terminated'::public.partner_status
      WHEN 'suspended' THEN 'suspended'::public.partner_status
      ELSE 'pending'::public.partner_status END,
    contract_signed_at = CASE WHEN _stage IN ('activation','verified') THEN COALESCE(contract_signed_at, now()) ELSE contract_signed_at END,
    activated_at = CASE WHEN _stage = 'verified' THEN COALESCE(activated_at, now()) ELSE activated_at END,
    notes = COALESCE(_note, notes)
  WHERE id = _partner_id RETURNING * INTO p;

  INSERT INTO public.partner_wallets (partner_id) VALUES (_partner_id) ON CONFLICT (partner_id) DO NOTHING;

  INSERT INTO public.partner_events (partner_id, event_type, title, detail, severity, actor_id)
  VALUES (_partner_id, 'onboarding', 'Onboarding stage → ' || _stage, _note,
          CASE WHEN _stage IN ('rejected','suspended') THEN 'warning' ELSE 'info' END, auth.uid());

  PERFORM public.yp_audit('partner_stage_' || _stage, 'partners', _partner_id,
    jsonb_build_object('stage', _stage, 'note', _note));
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.partner_advance_onboarding(uuid,public.partner_onboarding_stage,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_advance_onboarding(uuid,public.partner_onboarding_stage,text) TO authenticated, service_role;

-- ============================ money ============================
CREATE OR REPLACE FUNCTION public.partner_wallet_topup(
  _partner_id uuid, _amount numeric, _reference text, _memo text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE eid uuid;
BEGIN
  IF NOT public.yp_is_finance() THEN RAISE EXCEPTION 'not_authorised: finance role required'; END IF;
  IF _amount IS NULL OR _amount <= 0 THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  IF COALESCE(btrim(_reference),'') = '' THEN RAISE EXCEPTION 'reference_required'; END IF;

  eid := public.partner_ledger_post(_partner_id, 'wallet_topup', 'CREDIT', _amount,
    COALESCE(_memo, 'Wallet top-up'), NULL, NULL, _reference, 'topup:' || _reference);
  PERFORM public.yp_audit('partner_wallet_topup', 'partner_wallets', _partner_id,
    jsonb_build_object('amount', _amount, 'reference', _reference));
  RETURN eid;
END $$;
REVOKE ALL ON FUNCTION public.partner_wallet_topup(uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_wallet_topup(uuid,numeric,text,text) TO authenticated, service_role;

/**
 * Records the money movement for one order transition.
 * confirm  → hold the customer price against the pre-funded wallet
 * complete → capture the hold and book supplier cost, margins and tax
 * cancel   → release the hold
 */
CREATE OR REPLACE FUNCTION public.partner_order_post_financials(_order_id uuid, _event text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE o public.mobility_orders%ROWTYPE;
BEGIN
  PERFORM public.yp_require_staff();
  SELECT * INTO o FROM public.mobility_orders WHERE id = _order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
  IF o.partner_id IS NULL THEN RAISE EXCEPTION 'order_has_no_partner'; END IF;

  IF _event = 'confirm' THEN
    PERFORM public.partner_ledger_post(o.partner_id, 'order_hold', 'DEBIT', o.customer_price,
      'Hold for order ' || o.order_code, o.id, NULL, o.order_code, 'hold:' || o.id);
    UPDATE public.mobility_orders SET status = 'CONFIRMED' WHERE id = o.id AND status <> 'CONFIRMED';

  ELSIF _event = 'complete' THEN
    PERFORM public.partner_ledger_post(o.partner_id, 'order_capture', 'DEBIT', 0,
      'Capture for order ' || o.order_code, o.id, NULL, o.order_code, 'capture:' || o.id, false);
    PERFORM public.partner_ledger_post(o.partner_id, 'supplier_cost', 'DEBIT', o.supplier_cost,
      'Supplier cost', o.id, NULL, o.order_code, 'cost:' || o.id, false);
    PERFORM public.partner_ledger_post(o.partner_id, 'yalla_margin', 'CREDIT', o.yalla_margin,
      'Yalla margin', o.id, NULL, o.order_code, 'ymargin:' || o.id, false);
    PERFORM public.partner_ledger_post(o.partner_id, 'partner_margin', 'CREDIT', o.partner_margin,
      'Partner margin payable', o.id, NULL, o.order_code, 'pmargin:' || o.id, false);
    PERFORM public.partner_ledger_post(o.partner_id, 'tax', 'CREDIT', o.taxes,
      'VAT on customer price', o.id, NULL, o.order_code, 'tax:' || o.id, false);
    UPDATE public.mobility_orders SET status = 'COMPLETED' WHERE id = o.id AND status <> 'COMPLETED';

  ELSIF _event = 'cancel' THEN
    PERFORM public.partner_ledger_post(o.partner_id, 'order_release', 'CREDIT', o.customer_price,
      'Hold released for order ' || o.order_code, o.id, NULL, o.order_code, 'release:' || o.id);
    UPDATE public.mobility_orders SET status = 'CANCELLED' WHERE id = o.id;
  ELSE
    RAISE EXCEPTION 'unknown_event: %', _event;
  END IF;

  PERFORM public.yp_audit('partner_order_' || _event, 'mobility_orders', o.id,
    jsonb_build_object('order_code', o.order_code, 'customer_price', o.customer_price));
END $$;
REVOKE ALL ON FUNCTION public.partner_order_post_financials(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_order_post_financials(uuid,text) TO authenticated, service_role;

-- ============================ settlement ============================
CREATE OR REPLACE FUNCTION public.partner_settlement_generate(
  _partner_id uuid, _period_start date, _period_end date
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE sid uuid; code text; t record;
BEGIN
  IF NOT public.yp_is_finance() THEN RAISE EXCEPTION 'not_authorised: finance role required'; END IF;

  SELECT id INTO sid FROM public.partner_settlements
   WHERE partner_id = _partner_id AND period_start = _period_start AND period_end = _period_end;
  IF sid IS NULL THEN
    code := 'PS-' || to_char(_period_end,'YYMM') || '-' || upper(substr(md5(_partner_id::text || _period_start::text),1,6));
    INSERT INTO public.partner_settlements (settlement_code, partner_id, period_start, period_end, generated_by)
    VALUES (code, _partner_id, _period_start, _period_end, auth.uid()) RETURNING id INTO sid;
  ELSE
    IF (SELECT status FROM public.partner_settlements WHERE id = sid) NOT IN ('open','pending_review') THEN
      RAISE EXCEPTION 'settlement_locked';
    END IF;
    DELETE FROM public.partner_settlement_lines WHERE settlement_id = sid;
  END IF;

  INSERT INTO public.partner_settlement_lines
    (settlement_id, order_id, partner_id, customer_price, supplier_cost, yalla_margin, partner_margin, taxes)
  SELECT sid, o.id, o.partner_id, o.customer_price, o.supplier_cost, o.yalla_margin, o.partner_margin, o.taxes
    FROM public.mobility_orders o
   WHERE o.partner_id = _partner_id
     AND o.status IN ('COMPLETED','RECONCILING')
     AND o.created_at >= _period_start::timestamptz
     AND o.created_at < (_period_end + 1)::timestamptz
     AND NOT EXISTS (
       SELECT 1 FROM public.partner_settlement_lines l
        JOIN public.partner_settlements s ON s.id = l.settlement_id
        WHERE l.order_id = o.id AND l.settlement_id <> sid)
  ON CONFLICT DO NOTHING;

  SELECT count(*) AS n, COALESCE(sum(customer_price),0) gross, COALESCE(sum(supplier_cost),0) cost,
         COALESCE(sum(yalla_margin),0) ym, COALESCE(sum(partner_margin),0) pm, COALESCE(sum(taxes),0) tx
    INTO t FROM public.partner_settlement_lines WHERE settlement_id = sid;

  UPDATE public.partner_settlements SET
    orders_count = t.n, gross_value = t.gross, supplier_cost = t.cost, yalla_margin = t.ym,
    partner_margin = t.pm, taxes = t.tx, payout_amount = t.pm,
    status = CASE WHEN t.n > 0 THEN 'pending_review' ELSE 'open' END
  WHERE id = sid;

  UPDATE public.mobility_orders SET status = 'RECONCILING'
   WHERE id IN (SELECT order_id FROM public.partner_settlement_lines WHERE settlement_id = sid)
     AND status = 'COMPLETED';

  PERFORM public.yp_audit('partner_settlement_generated', 'partner_settlements', sid,
    jsonb_build_object('orders', t.n, 'payout', t.pm));
  RETURN sid;
END $$;
REVOKE ALL ON FUNCTION public.partner_settlement_generate(uuid,date,date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_settlement_generate(uuid,date,date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_settlement_approve(_settlement_id uuid, _note text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NOT public.yp_is_finance() THEN RAISE EXCEPTION 'not_authorised: finance role required'; END IF;
  UPDATE public.partner_settlements
     SET status = 'approved', approved_by = auth.uid(), approved_at = now(), notes = COALESCE(_note, notes)
   WHERE id = _settlement_id AND status IN ('pending_review','disputed');
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_approvable'; END IF;
  PERFORM public.yp_audit('partner_settlement_approved', 'partner_settlements', _settlement_id, jsonb_build_object('note', _note));
END $$;
REVOKE ALL ON FUNCTION public.partner_settlement_approve(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_settlement_approve(uuid,text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_settlement_reconcile(
  _settlement_id uuid, _paid_amount numeric, _payment_reference text, _note text DEFAULT NULL
) RETURNS public.partner_settlements LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE s public.partner_settlements%ROWTYPE; variance numeric;
BEGIN
  IF NOT public.yp_is_finance() THEN RAISE EXCEPTION 'not_authorised: finance role required'; END IF;
  SELECT * INTO s FROM public.partner_settlements WHERE id = _settlement_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'settlement_not_found'; END IF;
  IF s.status NOT IN ('approved','paid','disputed') THEN RAISE EXCEPTION 'settlement_not_approved'; END IF;
  IF COALESCE(btrim(_payment_reference),'') = '' THEN RAISE EXCEPTION 'reference_required'; END IF;

  variance := ROUND(COALESCE(_paid_amount,0) - s.payout_amount, 2);

  PERFORM public.partner_ledger_post(s.partner_id, 'settlement_payout', 'DEBIT', COALESCE(_paid_amount,0),
    'Settlement payout ' || s.settlement_code, NULL, s.id, _payment_reference,
    'payout:' || s.id || ':' || _payment_reference, false);

  UPDATE public.partner_settlements SET
    paid_amount = COALESCE(_paid_amount,0), variance_amount = variance,
    payment_reference = _payment_reference, notes = COALESCE(_note, notes),
    paid_at = COALESCE(paid_at, now()),
    reconciled_at = CASE WHEN abs(variance) < 1 THEN now() ELSE NULL END,
    status = CASE WHEN abs(variance) < 1 THEN 'reconciled'::public.partner_settlement_state
                  ELSE 'disputed'::public.partner_settlement_state END
  WHERE id = _settlement_id RETURNING * INTO s;

  IF abs(variance) < 1 THEN
    UPDATE public.mobility_orders SET status = 'SETTLED'
     WHERE id IN (SELECT order_id FROM public.partner_settlement_lines WHERE settlement_id = _settlement_id);
  ELSE
    PERFORM public.partner_case_open('finance', 'Settlement variance on ' || s.settlement_code,
      'Expected ' || s.payout_amount || ', paid ' || COALESCE(_paid_amount,0) || ' (variance ' || variance || ').',
      'high', 720, s.partner_id, NULL, NULL, NULL, s.id, ARRAY['settlement_variance'], 60,
      'variance:' || s.id || ':' || _payment_reference);
  END IF;

  PERFORM public.yp_audit('partner_settlement_reconciled', 'partner_settlements', _settlement_id,
    jsonb_build_object('paid', _paid_amount, 'variance', variance, 'reference', _payment_reference));
  RETURN s;
END $$;
REVOKE ALL ON FUNCTION public.partner_settlement_reconcile(uuid,numeric,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_settlement_reconcile(uuid,numeric,text,text) TO authenticated, service_role;

-- ============================ server-side reporting ============================
CREATE OR REPLACE FUNCTION public.partner_performance_kpis(_partner_id uuid DEFAULT NULL, _days integer DEFAULT 90)
RETURNS TABLE(
  partner_id uuid, partner_code text, partner_name text, onboarding_stage text, status text,
  wallet_balance numeric, orders bigint, open_orders bigint, completed bigint, exceptions bigint,
  gross_value numeric, partner_earnings numeric, yalla_margin numeric,
  completion_rate numeric, open_cases bigint, breached_cases bigint,
  unsettled_payout numeric, last_order_at timestamptz
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH scope AS (
    SELECT p.* FROM public.partners p
     WHERE (_partner_id IS NULL OR p.id = _partner_id)
       AND (public.yp_is_staff() OR public.is_partner_member(p.id))
  ), o AS (
    SELECT mo.partner_id,
           count(*) AS orders,
           count(*) FILTER (WHERE mo.status IN ('QUOTE_REQUESTED','QUOTED','CUSTOMER_APPROVAL','PAYMENT_PENDING','CONFIRMED','ALLOCATING','ASSIGNED','EN_ROUTE','IN_SERVICE')) AS open_orders,
           count(*) FILTER (WHERE mo.status IN ('COMPLETED','SETTLED','RECONCILING')) AS completed,
           count(*) FILTER (WHERE mo.status IN ('FAILED','REASSIGNMENT_REQUIRED','SUPPLIER_NO_SHOW','CUSTOMER_NO_SHOW','DISPUTED')) AS exceptions,
           COALESCE(sum(mo.customer_price),0) AS gross_value,
           COALESCE(sum(mo.partner_margin),0) AS partner_earnings,
           COALESCE(sum(mo.yalla_margin),0) AS yalla_margin,
           max(mo.created_at) AS last_order_at
      FROM public.mobility_orders mo
     WHERE mo.created_at >= now() - make_interval(days => GREATEST(1, COALESCE(_days,90)))
     GROUP BY mo.partner_id
  ), c AS (
    SELECT w.partner_id,
           count(*) FILTER (WHERE w.state NOT IN ('resolved','closed')) AS open_cases,
           count(*) FILTER (WHERE w.state NOT IN ('resolved','closed') AND w.due_at < now()) AS breached_cases
      FROM public.partner_work_items w GROUP BY w.partner_id
  ), s AS (
    SELECT ps.partner_id, COALESCE(sum(ps.payout_amount),0) AS unsettled_payout
      FROM public.partner_settlements ps
     WHERE ps.status IN ('open','pending_review','approved','disputed')
     GROUP BY ps.partner_id
  )
  SELECT sc.id, sc.partner_code, COALESCE(NULLIF(sc.trading_name,''), sc.legal_name),
         sc.onboarding_stage::text, sc.status::text,
         COALESCE(pw.balance, 0),
         COALESCE(o.orders,0), COALESCE(o.open_orders,0), COALESCE(o.completed,0), COALESCE(o.exceptions,0),
         COALESCE(o.gross_value,0), COALESCE(o.partner_earnings,0), COALESCE(o.yalla_margin,0),
         CASE WHEN COALESCE(o.completed,0) + COALESCE(o.exceptions,0) = 0 THEN NULL
              ELSE ROUND(100.0 * o.completed / (o.completed + o.exceptions), 1) END,
         COALESCE(c.open_cases,0), COALESCE(c.breached_cases,0),
         COALESCE(s.unsettled_payout,0), o.last_order_at
    FROM scope sc
    LEFT JOIN public.partner_wallets pw ON pw.partner_id = sc.id
    LEFT JOIN o ON o.partner_id = sc.id
    LEFT JOIN c ON c.partner_id = sc.id
    LEFT JOIN s ON s.partner_id = sc.id
   ORDER BY COALESCE(o.gross_value,0) DESC;
$$;
REVOKE ALL ON FUNCTION public.partner_performance_kpis(uuid,integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_performance_kpis(uuid,integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.partner_queue_load()
RETURNS TABLE(queue text, open_cases bigint, breached bigint, at_risk bigint, escalated bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT w.queue,
         count(*) FILTER (WHERE w.state NOT IN ('resolved','closed')),
         count(*) FILTER (WHERE w.state NOT IN ('resolved','closed') AND w.due_at < now()),
         count(*) FILTER (WHERE w.state NOT IN ('resolved','closed') AND w.due_at >= now()
                          AND w.due_at < now() + make_interval(mins => (w.sla_minutes * 0.2)::int)),
         count(*) FILTER (WHERE w.state = 'escalated')
    FROM public.partner_work_items w
   WHERE public.yp_is_staff()
   GROUP BY w.queue ORDER BY 2 DESC;
$$;
REVOKE ALL ON FUNCTION public.partner_queue_load() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.partner_queue_load() TO authenticated, service_role;
