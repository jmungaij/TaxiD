-- =========================================================
-- Yalla authoritative payment + guarantee-backed credit engine
-- =========================================================

CREATE TYPE public.yalla_payment_mode AS ENUM ('CASH','CREDIT');

CREATE TYPE public.bank_guarantee_state AS ENUM (
  'UPLOADED','VALIDATING','DOCUMENT_VERIFICATION','BANK_VERIFICATION',
  'PENDING_APPROVAL','APPROVED','ACTIVE','SUSPENDED','EXPIRING',
  'EXPIRED','REVOKED','REJECTED'
);

CREATE TYPE public.credit_facility_state AS ENUM ('DRAFT','ACTIVE','SUSPENDED','EXPIRED','CLOSED');

CREATE TYPE public.payment_decision_type AS ENUM (
  'ALLOW_CASH_PAYMENT','ALLOW_GUARANTEED_CREDIT','PAYMENT_REQUIRED','APPROVAL_REQUIRED',
  'CREDIT_UNAVAILABLE','GUARANTEE_REQUIRED','GUARANTEE_NOT_VERIFIED','GUARANTEE_EXPIRED',
  'GUARANTEE_REVOKED','CREDIT_LIMIT_EXCEEDED','POLICY_LIMIT_EXCEEDED','DENIED','SYSTEM_EXCEPTION'
);

CREATE TYPE public.credit_reservation_state AS ENUM ('ACTIVE','UTILIZED','RELEASED','EXPIRED');

-- ---------- helper: finance authority ----------
CREATE OR REPLACE FUNCTION public.is_credit_authority(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT true FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('finance_admin','super_admin')
    LIMIT 1
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.is_credit_observer(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE((
    SELECT true FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('finance_admin','super_admin','admin','compliance_admin','director','general_manager')
    LIMIT 1
  ), false)
$$;

REVOKE ALL ON FUNCTION public.is_credit_authority(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_credit_observer(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_credit_authority(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_credit_observer(uuid) TO authenticated, service_role;

-- ---------- payment channels (cash collection truth) ----------
CREATE TABLE public.yalla_payment_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_type text NOT NULL CHECK (channel_type IN ('MPESA_PAYBILL','BANK_ACCOUNT')),
  display_name text NOT NULL,
  paybill_number text,
  bank_name text,
  account_name text,
  account_number text,
  branch text,
  reference_instructions text NOT NULL DEFAULT 'Use your booking reference as the account/reference.',
  currency text NOT NULL DEFAULT 'KES',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.yalla_payment_channels TO authenticated;
GRANT ALL ON public.yalla_payment_channels TO service_role;
ALTER TABLE public.yalla_payment_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY ypc_read ON public.yalla_payment_channels FOR SELECT TO authenticated USING (is_active OR public.is_credit_observer(auth.uid()));
CREATE POLICY ypc_write ON public.yalla_payment_channels FOR ALL TO authenticated
  USING (public.is_credit_authority(auth.uid())) WITH CHECK (public.is_credit_authority(auth.uid()));

-- ---------- bank guarantees ----------
CREATE TABLE public.corporate_bank_guarantees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  guarantee_number text NOT NULL,
  issuing_bank text NOT NULL,
  beneficiary text NOT NULL DEFAULT 'Yalla Mobility',
  legal_entity_name text NOT NULL,
  guaranteed_amount_cents bigint NOT NULL CHECK (guaranteed_amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  issue_date date NOT NULL,
  effective_date date NOT NULL,
  expiry_date date NOT NULL,
  claim_expiry_date date,
  document_reference text,
  document_storage_path text,
  document_sha256 text,
  state public.bank_guarantee_state NOT NULL DEFAULT 'UPLOADED',
  external_verification_required boolean NOT NULL DEFAULT true,
  verification_note text,
  rejection_reason text,
  created_by uuid,
  verified_by uuid,
  verified_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  activated_by uuid,
  activated_at timestamptz,
  suspended_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, guarantee_number)
);
CREATE INDEX cbg_corp_state_idx ON public.corporate_bank_guarantees (corporate_id, state);
GRANT SELECT, INSERT ON public.corporate_bank_guarantees TO authenticated;
GRANT ALL ON public.corporate_bank_guarantees TO service_role;
ALTER TABLE public.corporate_bank_guarantees ENABLE ROW LEVEL SECURITY;
CREATE POLICY cbg_read ON public.corporate_bank_guarantees FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.is_credit_observer(auth.uid()));
-- only an uploaded guarantee may be created directly; every later state change goes through RPC
CREATE POLICY cbg_insert ON public.corporate_bank_guarantees FOR INSERT TO authenticated
  WITH CHECK (
    state = 'UPLOADED'
    AND created_by = auth.uid()
    AND (public.is_corporate_manager_or_admin(auth.uid(), corporate_id) OR public.is_credit_authority(auth.uid()))
  );

CREATE TABLE public.corporate_bank_guarantee_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guarantee_id uuid NOT NULL REFERENCES public.corporate_bank_guarantees(id) ON DELETE RESTRICT,
  corporate_id uuid NOT NULL,
  event_type text NOT NULL,
  state_before public.bank_guarantee_state,
  state_after public.bank_guarantee_state,
  actor_id uuid,
  actor_role text,
  reason text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  correlation_id uuid,
  source text NOT NULL DEFAULT 'rpc',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cbge_guarantee_idx ON public.corporate_bank_guarantee_events (guarantee_id, created_at DESC);
GRANT SELECT ON public.corporate_bank_guarantee_events TO authenticated;
GRANT ALL ON public.corporate_bank_guarantee_events TO service_role;
ALTER TABLE public.corporate_bank_guarantee_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY cbge_read ON public.corporate_bank_guarantee_events FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.is_credit_observer(auth.uid()));

CREATE OR REPLACE FUNCTION public._cbge_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'corporate_bank_guarantee_events is append-only';
END $$;
CREATE TRIGGER cbge_append_only BEFORE UPDATE OR DELETE ON public.corporate_bank_guarantee_events
  FOR EACH ROW EXECUTE FUNCTION public._cbge_append_only();

-- ---------- credit facilities ----------
CREATE TABLE public.corporate_credit_facilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  guarantee_id uuid NOT NULL REFERENCES public.corporate_bank_guarantees(id) ON DELETE RESTRICT,
  approved_credit_limit_cents bigint NOT NULL CHECK (approved_credit_limit_cents >= 0),
  risk_margin_bps integer NOT NULL DEFAULT 3000 CHECK (risk_margin_bps BETWEEN 0 AND 10000),
  utilized_credit_cents bigint NOT NULL DEFAULT 0 CHECK (utilized_credit_cents >= 0),
  currency text NOT NULL DEFAULT 'KES',
  effective_date date NOT NULL,
  expiry_date date NOT NULL,
  state public.credit_facility_state NOT NULL DEFAULT 'DRAFT',
  max_transaction_cents bigint,
  daily_exposure_cents bigint,
  monthly_exposure_cents bigint,
  policy_reference text,
  approved_by uuid,
  approved_at timestamptz,
  activated_by uuid,
  activated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ccf_one_active_per_corp ON public.corporate_credit_facilities (corporate_id) WHERE state = 'ACTIVE';
GRANT SELECT ON public.corporate_credit_facilities TO authenticated;
GRANT ALL ON public.corporate_credit_facilities TO service_role;
ALTER TABLE public.corporate_credit_facilities ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccf_read ON public.corporate_credit_facilities FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.is_credit_observer(auth.uid()));

-- ---------- credit reservations ----------
CREATE TABLE public.corporate_credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL,
  facility_id uuid NOT NULL REFERENCES public.corporate_credit_facilities(id) ON DELETE RESTRICT,
  guarantee_id uuid NOT NULL REFERENCES public.corporate_bank_guarantees(id) ON DELETE RESTRICT,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  final_amount_cents bigint,
  currency text NOT NULL DEFAULT 'KES',
  state public.credit_reservation_state NOT NULL DEFAULT 'ACTIVE',
  idempotency_key text NOT NULL,
  booking_id uuid,
  trip_request_id uuid,
  requested_by uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  released_at timestamptz,
  utilized_at timestamptz,
  UNIQUE (corporate_id, idempotency_key)
);
CREATE INDEX ccr_active_idx ON public.corporate_credit_reservations (facility_id, state);
GRANT SELECT ON public.corporate_credit_reservations TO authenticated;
GRANT ALL ON public.corporate_credit_reservations TO service_role;
ALTER TABLE public.corporate_credit_reservations ENABLE ROW LEVEL SECURITY;
CREATE POLICY ccr_read ON public.corporate_credit_reservations FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.is_credit_observer(auth.uid()));

-- ---------- payment / credit decisions ----------
CREATE TABLE public.corporate_payment_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL,
  requested_mode public.yalla_payment_mode NOT NULL,
  decision public.payment_decision_type NOT NULL,
  requested_amount_cents bigint NOT NULL,
  available_credit_cents bigint,
  guarantee_id uuid,
  facility_id uuid,
  policy_id uuid,
  policy_version integer,
  reason_codes text[] NOT NULL DEFAULT '{}',
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  actor_id uuid,
  correlation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cpd_corp_idx ON public.corporate_payment_decisions (corporate_id, created_at DESC);
GRANT SELECT ON public.corporate_payment_decisions TO authenticated;
GRANT ALL ON public.corporate_payment_decisions TO service_role;
ALTER TABLE public.corporate_payment_decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpd_read ON public.corporate_payment_decisions FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.is_credit_observer(auth.uid()));
CREATE OR REPLACE FUNCTION public._cpd_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'corporate_payment_decisions is append-only';
END $$;
CREATE TRIGGER cpd_append_only BEFORE UPDATE OR DELETE ON public.corporate_payment_decisions
  FOR EACH ROW EXECUTE FUNCTION public._cpd_append_only();

-- ---------- versioned payment policy ----------
CREATE TABLE public.corporate_payment_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  credit_rule text NOT NULL DEFAULT 'CREDIT_NOT_ALLOWED'
    CHECK (credit_rule IN ('CASH_ONLY','CREDIT_NOT_ALLOWED','CREDIT_IF_GUARANTEED','CREDIT_ALLOWED_WITHIN_LIMIT')),
  max_transaction_cents bigint,
  daily_credit_exposure_cents bigint,
  monthly_credit_exposure_cents bigint,
  approval_threshold_cents bigint,
  required_approval_role public.app_role,
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','RETIRED')),
  business_approval text NOT NULL DEFAULT 'PENDING_BUSINESS_APPROVAL',
  proposed_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (corporate_id, version),
  CONSTRAINT cpp_active_needs_approval CHECK (status <> 'ACTIVE' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL))
);
CREATE UNIQUE INDEX cpp_one_active ON public.corporate_payment_policies (corporate_id) WHERE status = 'ACTIVE';
GRANT SELECT ON public.corporate_payment_policies TO authenticated;
GRANT ALL ON public.corporate_payment_policies TO service_role;
ALTER TABLE public.corporate_payment_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY cpp_read ON public.corporate_payment_policies FOR SELECT TO authenticated
  USING (public.is_corporate_member(auth.uid(), corporate_id) OR public.is_credit_observer(auth.uid()));

-- =========================================================
-- Authoritative credit snapshot
-- =========================================================
CREATE OR REPLACE FUNCTION public.corp_credit_snapshot(_corporate_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; f record; reserved bigint; avail bigint; guarantee_cap bigint;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_corporate_member(auth.uid(), _corporate_id)
     AND NOT public.is_credit_observer(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;

  SELECT * INTO g FROM public.corporate_bank_guarantees
   WHERE corporate_id = _corporate_id AND state = 'ACTIVE'
     AND effective_date <= current_date AND expiry_date >= current_date
   ORDER BY expiry_date DESC LIMIT 1;

  IF g.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'credit_available', false,
      'reason_codes', ARRAY['NO_ACTIVE_BANK_GUARANTEE'],
      'guarantee', NULL, 'facility', NULL, 'available_credit_cents', 0);
  END IF;

  SELECT * INTO f FROM public.corporate_credit_facilities
   WHERE corporate_id = _corporate_id AND guarantee_id = g.id AND state = 'ACTIVE'
     AND effective_date <= current_date AND expiry_date >= current_date
   LIMIT 1;

  IF f.id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'credit_available', false,
      'reason_codes', ARRAY['NO_ACTIVE_CREDIT_FACILITY'],
      'guarantee', jsonb_build_object('id', g.id, 'state', g.state, 'expiry_date', g.expiry_date,
                                      'amount_cents', g.guaranteed_amount_cents, 'currency', g.currency),
      'facility', NULL, 'available_credit_cents', 0);
  END IF;

  SELECT COALESCE(SUM(amount_cents), 0) INTO reserved
    FROM public.corporate_credit_reservations
   WHERE facility_id = f.id AND state = 'ACTIVE';

  guarantee_cap := g.guaranteed_amount_cents - (g.guaranteed_amount_cents * f.risk_margin_bps / 10000);
  avail := LEAST(f.approved_credit_limit_cents, guarantee_cap) - f.utilized_credit_cents - reserved;
  IF avail < 0 THEN avail := 0; END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'credit_available', avail > 0,
    'reason_codes', ARRAY[]::text[],
    'available_credit_cents', avail,
    'reserved_cents', reserved,
    'guarantee', jsonb_build_object('id', g.id, 'state', g.state, 'expiry_date', g.expiry_date,
                                    'amount_cents', g.guaranteed_amount_cents, 'currency', g.currency,
                                    'issuing_bank', g.issuing_bank),
    'facility', jsonb_build_object('id', f.id, 'state', f.state, 'currency', f.currency,
                                   'approved_credit_limit_cents', f.approved_credit_limit_cents,
                                   'utilized_credit_cents', f.utilized_credit_cents,
                                   'expiry_date', f.expiry_date,
                                   'max_transaction_cents', f.max_transaction_cents)
  );
END $$;
REVOKE ALL ON FUNCTION public.corp_credit_snapshot(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_credit_snapshot(uuid) TO authenticated, service_role;

-- =========================================================
-- Authoritative payment decision
-- =========================================================
CREATE OR REPLACE FUNCTION public.corp_payment_decide(
  _corporate_id uuid,
  _amount_cents bigint,
  _requested_mode text DEFAULT 'CASH',
  _correlation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  mode public.yalla_payment_mode;
  snap jsonb; pol record; decision public.payment_decision_type; reasons text[] := '{}';
  avail bigint := 0; gid uuid; fid uuid; acct record;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.is_corporate_member(auth.uid(), _corporate_id)
     AND NOT public.is_credit_observer(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _amount_cents IS NULL OR _amount_cents <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_amount');
  END IF;

  BEGIN mode := upper(_requested_mode)::public.yalla_payment_mode;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unsupported_payment_mode');
  END;

  SELECT * INTO acct FROM public.corporate_accounts WHERE id = _corporate_id;
  SELECT * INTO pol FROM public.corporate_payment_policies
    WHERE corporate_id = _corporate_id AND status = 'ACTIVE' LIMIT 1;

  IF mode = 'CASH' THEN
    decision := 'ALLOW_CASH_PAYMENT';
    reasons := ARRAY['CASH_IS_DEFAULT','PAYMENT_VERIFICATION_REQUIRED'];
  ELSE
    snap := public.corp_credit_snapshot(_corporate_id);
    avail := COALESCE((snap->>'available_credit_cents')::bigint, 0);
    gid := NULLIF(snap#>>'{guarantee,id}','')::uuid;
    fid := NULLIF(snap#>>'{facility,id}','')::uuid;

    IF acct.id IS NULL OR COALESCE(upper(acct.status),'') NOT IN ('ACTIVE','APPROVED') THEN
      decision := 'DENIED'; reasons := ARRAY['CORPORATE_ACCOUNT_NOT_ACTIVE'];
    ELSIF pol.id IS NULL OR pol.credit_rule IN ('CASH_ONLY','CREDIT_NOT_ALLOWED') THEN
      decision := 'CREDIT_UNAVAILABLE';
      reasons := ARRAY[CASE WHEN pol.id IS NULL THEN 'NO_ACTIVE_PAYMENT_POLICY' ELSE 'POLICY_FORBIDS_CREDIT' END];
    ELSIF gid IS NULL THEN
      decision := 'GUARANTEE_REQUIRED'; reasons := ARRAY['NO_ACTIVE_BANK_GUARANTEE'];
    ELSIF fid IS NULL THEN
      decision := 'CREDIT_UNAVAILABLE'; reasons := ARRAY['NO_ACTIVE_CREDIT_FACILITY'];
    ELSIF pol.max_transaction_cents IS NOT NULL AND _amount_cents > pol.max_transaction_cents THEN
      decision := 'POLICY_LIMIT_EXCEEDED'; reasons := ARRAY['POLICY_MAX_TRANSACTION_EXCEEDED'];
    ELSIF avail < _amount_cents THEN
      decision := 'CREDIT_LIMIT_EXCEEDED'; reasons := ARRAY['DENY_CREDIT_INSUFFICIENT_COVERAGE'];
    ELSIF pol.approval_threshold_cents IS NOT NULL AND _amount_cents > pol.approval_threshold_cents THEN
      decision := 'APPROVAL_REQUIRED'; reasons := ARRAY['ABOVE_APPROVAL_THRESHOLD'];
    ELSE
      decision := 'ALLOW_GUARANTEED_CREDIT';
      reasons := ARRAY['GUARANTEE_ACTIVE','FACILITY_ACTIVE','SUFFICIENT_AVAILABLE_CREDIT','POLICY_PERMITS_CREDIT'];
    END IF;
  END IF;

  INSERT INTO public.corporate_payment_decisions (
    corporate_id, requested_mode, decision, requested_amount_cents, available_credit_cents,
    guarantee_id, facility_id, policy_id, policy_version, reason_codes, detail, actor_id, correlation_id
  ) VALUES (
    _corporate_id, mode, decision, _amount_cents, CASE WHEN mode='CREDIT' THEN avail ELSE NULL END,
    gid, fid, pol.id, pol.version, reasons,
    jsonb_build_object('snapshot', snap, 'credit_rule', pol.credit_rule), auth.uid(), _correlation_id
  );

  RETURN jsonb_build_object(
    'ok', true, 'decision', decision, 'requested_mode', mode,
    'requested_amount_cents', _amount_cents,
    'available_credit_cents', CASE WHEN mode='CREDIT' THEN avail ELSE NULL END,
    'reason_codes', reasons, 'correlation_id', _correlation_id,
    'policy_id', pol.id, 'policy_version', pol.version,
    'cash_fallback', CASE WHEN decision IN ('ALLOW_CASH_PAYMENT','ALLOW_GUARANTEED_CREDIT') THEN NULL
                          ELSE 'Corporate credit is unavailable. Pay using Yalla M-Pesa PayBill or bank transfer.' END
  );
END $$;
REVOKE ALL ON FUNCTION public.corp_payment_decide(uuid, bigint, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_payment_decide(uuid, bigint, text, uuid) TO authenticated, service_role;

-- =========================================================
-- Concurrency-safe credit reservation / release / utilisation
-- =========================================================
CREATE OR REPLACE FUNCTION public.corp_credit_reserve(
  _corporate_id uuid,
  _amount_cents bigint,
  _idempotency_key text,
  _booking_id uuid DEFAULT NULL,
  _trip_request_id uuid DEFAULT NULL,
  _correlation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE existing record; f record; g record; reserved bigint; avail bigint; cap bigint; res_id uuid;
BEGIN
  IF _idempotency_key IS NULL OR length(_idempotency_key) < 8 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'idempotency_key_required');
  END IF;

  SELECT * INTO existing FROM public.corporate_credit_reservations
    WHERE corporate_id = _corporate_id AND idempotency_key = _idempotency_key;
  IF existing.id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'reservation_id', existing.id,
                              'state', existing.state, 'amount_cents', existing.amount_cents);
  END IF;

  SELECT * INTO g FROM public.corporate_bank_guarantees
    WHERE corporate_id = _corporate_id AND state = 'ACTIVE'
      AND effective_date <= current_date AND expiry_date >= current_date
    ORDER BY expiry_date DESC LIMIT 1;
  IF g.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'decision', 'GUARANTEE_REQUIRED', 'error', 'no_active_bank_guarantee');
  END IF;

  SELECT * INTO f FROM public.corporate_credit_facilities
    WHERE corporate_id = _corporate_id AND guarantee_id = g.id AND state = 'ACTIVE'
      AND effective_date <= current_date AND expiry_date >= current_date
    FOR UPDATE;
  IF f.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'decision', 'CREDIT_UNAVAILABLE', 'error', 'no_active_credit_facility');
  END IF;

  IF f.max_transaction_cents IS NOT NULL AND _amount_cents > f.max_transaction_cents THEN
    RETURN jsonb_build_object('ok', false, 'decision', 'POLICY_LIMIT_EXCEEDED', 'error', 'max_transaction_exceeded');
  END IF;

  SELECT COALESCE(SUM(amount_cents),0) INTO reserved FROM public.corporate_credit_reservations
    WHERE facility_id = f.id AND state = 'ACTIVE';
  cap := g.guaranteed_amount_cents - (g.guaranteed_amount_cents * f.risk_margin_bps / 10000);
  avail := LEAST(f.approved_credit_limit_cents, cap) - f.utilized_credit_cents - reserved;

  IF avail < _amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'decision', 'CREDIT_LIMIT_EXCEEDED',
                              'error', 'insufficient_available_credit', 'available_credit_cents', avail);
  END IF;

  INSERT INTO public.corporate_credit_reservations (
    corporate_id, facility_id, guarantee_id, amount_cents, currency, idempotency_key,
    booking_id, trip_request_id, requested_by, correlation_id
  ) VALUES (
    _corporate_id, f.id, g.id, _amount_cents, f.currency, _idempotency_key,
    _booking_id, _trip_request_id, auth.uid(), _correlation_id
  ) RETURNING id INTO res_id;

  RETURN jsonb_build_object('ok', true, 'decision', 'ALLOW_GUARANTEED_CREDIT',
                            'reservation_id', res_id, 'amount_cents', _amount_cents,
                            'available_credit_cents', avail - _amount_cents);
END $$;
REVOKE ALL ON FUNCTION public.corp_credit_reserve(uuid, bigint, text, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_credit_reserve(uuid, bigint, text, uuid, uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.corp_credit_release(_reservation_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record;
BEGIN
  SELECT * INTO r FROM public.corporate_credit_reservations WHERE id = _reservation_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'state', r.state);
  END IF;
  UPDATE public.corporate_credit_reservations
     SET state = 'RELEASED', released_at = now(), updated_at = now() WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'state', 'RELEASED');
END $$;
REVOKE ALL ON FUNCTION public.corp_credit_release(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_credit_release(uuid, text) TO service_role;

CREATE OR REPLACE FUNCTION public.corp_credit_utilize(_reservation_id uuid, _final_amount_cents bigint)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE r record; f record; reserved bigint; cap bigint; avail bigint; g record;
BEGIN
  SELECT * INTO r FROM public.corporate_credit_reservations WHERE id = _reservation_id FOR UPDATE;
  IF r.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF r.state = 'UTILIZED' THEN
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'final_amount_cents', r.final_amount_cents);
  END IF;
  IF r.state <> 'ACTIVE' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reservation_not_active', 'state', r.state);
  END IF;

  SELECT * INTO f FROM public.corporate_credit_facilities WHERE id = r.facility_id FOR UPDATE;
  SELECT * INTO g FROM public.corporate_bank_guarantees WHERE id = r.guarantee_id;

  IF _final_amount_cents > r.amount_cents THEN
    SELECT COALESCE(SUM(amount_cents),0) INTO reserved FROM public.corporate_credit_reservations
      WHERE facility_id = f.id AND state = 'ACTIVE' AND id <> r.id;
    cap := g.guaranteed_amount_cents - (g.guaranteed_amount_cents * f.risk_margin_bps / 10000);
    avail := LEAST(f.approved_credit_limit_cents, cap) - f.utilized_credit_cents - reserved;
    IF avail < _final_amount_cents THEN
      RETURN jsonb_build_object('ok', false, 'decision', 'CREDIT_LIMIT_EXCEEDED',
        'error', 'final_fare_exceeds_available_credit', 'available_credit_cents', avail,
        'action_required', 'ADDITIONAL_AUTHORISATION_OR_CASH');
    END IF;
  END IF;

  UPDATE public.corporate_credit_reservations
     SET state = 'UTILIZED', final_amount_cents = _final_amount_cents,
         utilized_at = now(), updated_at = now()
   WHERE id = r.id;
  UPDATE public.corporate_credit_facilities
     SET utilized_credit_cents = utilized_credit_cents + _final_amount_cents, updated_at = now()
   WHERE id = f.id;

  RETURN jsonb_build_object('ok', true, 'state', 'UTILIZED', 'final_amount_cents', _final_amount_cents);
END $$;
REVOKE ALL ON FUNCTION public.corp_credit_utilize(uuid, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_credit_utilize(uuid, bigint) TO service_role;

-- =========================================================
-- Guarantee lifecycle (RBAC-gated, audited)
-- =========================================================
CREATE OR REPLACE FUNCTION public.corp_guarantee_transition(
  _guarantee_id uuid, _action text, _reason text DEFAULT NULL, _correlation_id uuid DEFAULT gen_random_uuid()
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; nxt public.bank_guarantee_state; act text := upper(_action); authority boolean; owner boolean;
BEGIN
  SELECT * INTO g FROM public.corporate_bank_guarantees WHERE id = _guarantee_id FOR UPDATE;
  IF g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;

  authority := public.is_credit_authority(auth.uid());
  owner := public.is_corporate_manager_or_admin(auth.uid(), g.corporate_id);

  IF act = 'SUBMIT_VERIFICATION' THEN
    IF NOT (owner OR authority) THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authorised'); END IF;
    IF g.state <> 'UPLOADED' THEN RETURN jsonb_build_object('ok', false, 'error', 'invalid_state', 'state', g.state); END IF;
    nxt := 'VALIDATING';
  ELSE
    IF NOT authority THEN RETURN jsonb_build_object('ok', false, 'error', 'requires_credit_authority'); END IF;
    IF act = 'START_DOCUMENT_VERIFICATION' AND g.state = 'VALIDATING' THEN nxt := 'DOCUMENT_VERIFICATION';
    ELSIF act = 'START_BANK_VERIFICATION' AND g.state = 'DOCUMENT_VERIFICATION' THEN nxt := 'BANK_VERIFICATION';
    ELSIF act = 'VERIFY' AND g.state = 'BANK_VERIFICATION' THEN
      IF g.external_verification_required THEN
        RETURN jsonb_build_object('ok', false, 'error', 'EXTERNAL_VERIFICATION_REQUIRED',
          'message', 'Independent bank confirmation must be recorded before this guarantee can be verified.');
      END IF;
      nxt := 'PENDING_APPROVAL';
    ELSIF act = 'APPROVE' AND g.state = 'PENDING_APPROVAL' THEN nxt := 'APPROVED';
    ELSIF act = 'ACTIVATE' AND g.state = 'APPROVED' THEN
      IF g.expiry_date < current_date THEN RETURN jsonb_build_object('ok', false, 'error', 'guarantee_expired'); END IF;
      nxt := 'ACTIVE';
    ELSIF act = 'SUSPEND' AND g.state IN ('ACTIVE','EXPIRING') THEN nxt := 'SUSPENDED';
    ELSIF act = 'REINSTATE' AND g.state = 'SUSPENDED' THEN nxt := 'ACTIVE';
    ELSIF act = 'REVOKE' AND g.state NOT IN ('REVOKED','REJECTED') THEN nxt := 'REVOKED';
    ELSIF act = 'REJECT' AND g.state NOT IN ('ACTIVE','REVOKED','REJECTED') THEN nxt := 'REJECTED';
    ELSIF act = 'RECORD_EXTERNAL_VERIFICATION' THEN
      UPDATE public.corporate_bank_guarantees
         SET external_verification_required = false, verification_note = _reason, updated_at = now()
       WHERE id = g.id;
      INSERT INTO public.corporate_bank_guarantee_events (guarantee_id, corporate_id, event_type, state_before, state_after, actor_id, reason, correlation_id)
      VALUES (g.id, g.corporate_id, 'GuaranteeExternalVerificationRecorded', g.state, g.state, auth.uid(), _reason, _correlation_id);
      RETURN jsonb_build_object('ok', true, 'state', g.state, 'external_verification_required', false);
    ELSE
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_transition', 'state', g.state, 'action', act);
    END IF;
  END IF;

  UPDATE public.corporate_bank_guarantees SET
    state = nxt,
    verified_by = CASE WHEN nxt = 'PENDING_APPROVAL' THEN auth.uid() ELSE verified_by END,
    verified_at = CASE WHEN nxt = 'PENDING_APPROVAL' THEN now() ELSE verified_at END,
    approved_by = CASE WHEN nxt = 'APPROVED' THEN auth.uid() ELSE approved_by END,
    approved_at = CASE WHEN nxt = 'APPROVED' THEN now() ELSE approved_at END,
    activated_by = CASE WHEN nxt = 'ACTIVE' THEN auth.uid() ELSE activated_by END,
    activated_at = CASE WHEN nxt = 'ACTIVE' THEN now() ELSE activated_at END,
    suspended_at = CASE WHEN nxt = 'SUSPENDED' THEN now() ELSE suspended_at END,
    revoked_at = CASE WHEN nxt = 'REVOKED' THEN now() ELSE revoked_at END,
    rejection_reason = CASE WHEN nxt = 'REJECTED' THEN _reason ELSE rejection_reason END,
    updated_at = now()
  WHERE id = g.id;

  -- credit facility follows the guarantee: no active guarantee, no active facility
  IF nxt IN ('SUSPENDED','REVOKED','EXPIRED','REJECTED') THEN
    UPDATE public.corporate_credit_facilities
       SET state = CASE WHEN nxt = 'SUSPENDED' THEN 'SUSPENDED'::public.credit_facility_state
                        ELSE 'CLOSED'::public.credit_facility_state END,
           updated_at = now()
     WHERE guarantee_id = g.id AND state IN ('ACTIVE','DRAFT','SUSPENDED');
  END IF;

  INSERT INTO public.corporate_bank_guarantee_events (
    guarantee_id, corporate_id, event_type, state_before, state_after, actor_id, reason, correlation_id
  ) VALUES (
    g.id, g.corporate_id, 'Guarantee' || initcap(replace(act, '_', ' ')), g.state, nxt, auth.uid(), _reason, _correlation_id
  );

  RETURN jsonb_build_object('ok', true, 'state', nxt);
END $$;
REVOKE ALL ON FUNCTION public.corp_guarantee_transition(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_guarantee_transition(uuid, text, text, uuid) TO authenticated, service_role;

-- credit facility creation / activation (finance authority only)
CREATE OR REPLACE FUNCTION public.corp_credit_facility_upsert(
  _guarantee_id uuid, _approved_limit_cents bigint, _effective_date date, _expiry_date date,
  _risk_margin_bps integer DEFAULT 3000, _max_transaction_cents bigint DEFAULT NULL,
  _policy_reference text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE g record; fid uuid;
BEGIN
  IF NOT public.is_credit_authority(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'requires_credit_authority');
  END IF;
  SELECT * INTO g FROM public.corporate_bank_guarantees WHERE id = _guarantee_id;
  IF g.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'guarantee_not_found'); END IF;
  IF g.state NOT IN ('APPROVED','ACTIVE') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guarantee_not_approved', 'state', g.state);
  END IF;
  IF _approved_limit_cents > g.guaranteed_amount_cents THEN
    RETURN jsonb_build_object('ok', false, 'error', 'limit_exceeds_guarantee');
  END IF;

  SELECT id INTO fid FROM public.corporate_credit_facilities
    WHERE guarantee_id = g.id AND state IN ('DRAFT','ACTIVE','SUSPENDED') LIMIT 1;

  IF fid IS NULL THEN
    INSERT INTO public.corporate_credit_facilities (
      corporate_id, guarantee_id, approved_credit_limit_cents, risk_margin_bps, currency,
      effective_date, expiry_date, state, max_transaction_cents, policy_reference, approved_by, approved_at
    ) VALUES (
      g.corporate_id, g.id, _approved_limit_cents, _risk_margin_bps, g.currency,
      _effective_date, _expiry_date, 'DRAFT', _max_transaction_cents, _policy_reference, auth.uid(), now()
    ) RETURNING id INTO fid;
  ELSE
    UPDATE public.corporate_credit_facilities
       SET approved_credit_limit_cents = _approved_limit_cents, risk_margin_bps = _risk_margin_bps,
           effective_date = _effective_date, expiry_date = _expiry_date,
           max_transaction_cents = _max_transaction_cents, policy_reference = _policy_reference,
           approved_by = auth.uid(), approved_at = now(), updated_at = now()
     WHERE id = fid;
  END IF;

  INSERT INTO public.corporate_bank_guarantee_events (guarantee_id, corporate_id, event_type, state_before, state_after, actor_id, reason, after_snapshot)
  VALUES (g.id, g.corporate_id, 'CreditFacilityConfigured', g.state, g.state, auth.uid(), _policy_reference,
          jsonb_build_object('facility_id', fid, 'approved_credit_limit_cents', _approved_limit_cents));

  RETURN jsonb_build_object('ok', true, 'facility_id', fid, 'state', 'DRAFT');
END $$;
REVOKE ALL ON FUNCTION public.corp_credit_facility_upsert(uuid, bigint, date, date, integer, bigint, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_credit_facility_upsert(uuid, bigint, date, date, integer, bigint, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.corp_credit_facility_transition(_facility_id uuid, _action text, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE f record; g record; nxt public.credit_facility_state; act text := upper(_action);
BEGIN
  IF NOT public.is_credit_authority(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'requires_credit_authority');
  END IF;
  SELECT * INTO f FROM public.corporate_credit_facilities WHERE id = _facility_id FOR UPDATE;
  IF f.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  SELECT * INTO g FROM public.corporate_bank_guarantees WHERE id = f.guarantee_id;

  IF act = 'ACTIVATE' THEN
    IF g.state <> 'ACTIVE' THEN RETURN jsonb_build_object('ok', false, 'error', 'guarantee_not_active', 'state', g.state); END IF;
    IF f.expiry_date < current_date THEN RETURN jsonb_build_object('ok', false, 'error', 'facility_expired'); END IF;
    nxt := 'ACTIVE';
  ELSIF act = 'SUSPEND' THEN nxt := 'SUSPENDED';
  ELSIF act = 'CLOSE' THEN nxt := 'CLOSED';
  ELSE RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;

  UPDATE public.corporate_credit_facilities
     SET state = nxt,
         activated_by = CASE WHEN nxt='ACTIVE' THEN auth.uid() ELSE activated_by END,
         activated_at = CASE WHEN nxt='ACTIVE' THEN now() ELSE activated_at END,
         updated_at = now()
   WHERE id = f.id;

  INSERT INTO public.corporate_bank_guarantee_events (guarantee_id, corporate_id, event_type, state_before, state_after, actor_id, reason, after_snapshot)
  VALUES (g.id, f.corporate_id, 'CreditFacility' || initcap(act), g.state, g.state, auth.uid(), _reason,
          jsonb_build_object('facility_id', f.id, 'facility_state', nxt));

  RETURN jsonb_build_object('ok', true, 'state', nxt);
END $$;
REVOKE ALL ON FUNCTION public.corp_credit_facility_transition(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_credit_facility_transition(uuid, text, text) TO authenticated, service_role;

-- payment policy proposal / approval
CREATE OR REPLACE FUNCTION public.corp_payment_policy_propose(
  _corporate_id uuid, _credit_rule text, _max_transaction_cents bigint DEFAULT NULL,
  _daily_cents bigint DEFAULT NULL, _monthly_cents bigint DEFAULT NULL,
  _approval_threshold_cents bigint DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v integer; pid uuid;
BEGIN
  IF NOT (public.is_corporate_manager_or_admin(auth.uid(), _corporate_id) OR public.is_credit_authority(auth.uid())) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_authorised');
  END IF;
  IF _credit_rule NOT IN ('CASH_ONLY','CREDIT_NOT_ALLOWED','CREDIT_IF_GUARANTEED','CREDIT_ALLOWED_WITHIN_LIMIT') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_credit_rule');
  END IF;
  UPDATE public.corporate_payment_policies SET status = 'RETIRED', updated_at = now()
    WHERE corporate_id = _corporate_id AND status = 'DRAFT';
  SELECT COALESCE(MAX(version), 0) + 1 INTO v FROM public.corporate_payment_policies WHERE corporate_id = _corporate_id;
  INSERT INTO public.corporate_payment_policies (
    corporate_id, version, credit_rule, max_transaction_cents, daily_credit_exposure_cents,
    monthly_credit_exposure_cents, approval_threshold_cents, status, proposed_by
  ) VALUES (
    _corporate_id, v, _credit_rule, _max_transaction_cents, _daily_cents, _monthly_cents,
    _approval_threshold_cents, 'DRAFT', auth.uid()
  ) RETURNING id INTO pid;
  RETURN jsonb_build_object('ok', true, 'policy_id', pid, 'version', v, 'status', 'DRAFT');
END $$;
REVOKE ALL ON FUNCTION public.corp_payment_policy_propose(uuid, text, bigint, bigint, bigint, bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_payment_policy_propose(uuid, text, bigint, bigint, bigint, bigint) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.corp_payment_policy_approve(_policy_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE p record;
BEGIN
  IF NOT public.is_credit_authority(auth.uid()) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'requires_credit_authority');
  END IF;
  SELECT * INTO p FROM public.corporate_payment_policies WHERE id = _policy_id FOR UPDATE;
  IF p.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_found'); END IF;
  IF p.status <> 'DRAFT' THEN RETURN jsonb_build_object('ok', false, 'error', 'not_draft', 'status', p.status); END IF;
  UPDATE public.corporate_payment_policies SET status = 'RETIRED', updated_at = now()
    WHERE corporate_id = p.corporate_id AND status = 'ACTIVE';
  UPDATE public.corporate_payment_policies
     SET status = 'ACTIVE', approved_by = auth.uid(), approved_at = now(),
         business_approval = 'APPROVED', updated_at = now()
   WHERE id = p.id;
  RETURN jsonb_build_object('ok', true, 'status', 'ACTIVE', 'version', p.version);
END $$;
REVOKE ALL ON FUNCTION public.corp_payment_policy_approve(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_payment_policy_approve(uuid) TO authenticated, service_role;

-- expiry sweep
CREATE OR REPLACE FUNCTION public.corp_guarantee_expiry_sweep(_expiring_window_days integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE expired_n integer := 0; expiring_n integer := 0;
BEGIN
  WITH x AS (
    UPDATE public.corporate_bank_guarantees
       SET state = 'EXPIRED', expired_at = now(), updated_at = now()
     WHERE state IN ('ACTIVE','EXPIRING','APPROVED','PENDING_APPROVAL') AND expiry_date < current_date
     RETURNING id, corporate_id, state
  ) SELECT count(*) INTO expired_n FROM x;

  UPDATE public.corporate_credit_facilities f
     SET state = 'CLOSED', updated_at = now()
   FROM public.corporate_bank_guarantees g
   WHERE f.guarantee_id = g.id AND g.state = 'EXPIRED' AND f.state IN ('ACTIVE','DRAFT','SUSPENDED');

  UPDATE public.corporate_credit_facilities
     SET state = 'EXPIRED', updated_at = now()
   WHERE state = 'ACTIVE' AND expiry_date < current_date;

  WITH y AS (
    UPDATE public.corporate_bank_guarantees
       SET state = 'EXPIRING', updated_at = now()
     WHERE state = 'ACTIVE' AND expiry_date <= current_date + _expiring_window_days
     RETURNING id
  ) SELECT count(*) INTO expiring_n FROM y;

  RETURN jsonb_build_object('ok', true, 'expired', expired_n, 'expiring', expiring_n, 'swept_at', now());
END $$;
REVOKE ALL ON FUNCTION public.corp_guarantee_expiry_sweep(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.corp_guarantee_expiry_sweep(integer) TO service_role;

-- keep updated_at fresh
CREATE TRIGGER cbg_touch BEFORE UPDATE ON public.corporate_bank_guarantees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER ccf_touch BEFORE UPDATE ON public.corporate_credit_facilities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER ypc_touch BEFORE UPDATE ON public.yalla_payment_channels
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();