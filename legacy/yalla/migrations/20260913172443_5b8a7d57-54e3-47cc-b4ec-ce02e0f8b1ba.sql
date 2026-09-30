-- ============================================================
-- RENTAL POLICY DECISION ENGINE v2 (versioned, effective-dated)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rental_policy_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_code text NOT NULL REFERENCES public.rental_policies(policy_code) ON DELETE CASCADE,
  version integer NOT NULL,
  rule_type text NOT NULL DEFAULT 'CONFIGURABLE',
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  effective_from date NOT NULL DEFAULT current_date,
  effective_to date,
  state text NOT NULL DEFAULT 'PENDING_BUSINESS_APPROVAL'
    CHECK (state IN ('PENDING_BUSINESS_APPROVAL','ACTIVE','SUPERSEDED','REJECTED')),
  proposed_basis text,
  approval_authority text,
  proposed_by uuid,
  approved_by uuid,
  approved_at timestamptz,
  approval_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_code, version)
);

GRANT SELECT ON public.rental_policy_versions TO authenticated;
GRANT ALL ON public.rental_policy_versions TO service_role;
ALTER TABLE public.rental_policy_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rental_policy_versions_staff_read ON public.rental_policy_versions;
CREATE POLICY rental_policy_versions_staff_read ON public.rental_policy_versions
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'super_admin'));

CREATE INDEX IF NOT EXISTS rental_policy_versions_code_state_idx
  ON public.rental_policy_versions (policy_code, state, effective_from DESC);

DROP TRIGGER IF EXISTS trg_rental_policy_versions_touch ON public.rental_policy_versions;
CREATE TRIGGER trg_rental_policy_versions_touch
  BEFORE UPDATE ON public.rental_policy_versions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================================
-- APPEND-ONLY POLICY DECISION LOG
-- ============================================================
CREATE TABLE IF NOT EXISTS public.rental_policy_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  evaluation_point text NOT NULL,
  policy_code text NOT NULL,
  policy_version integer,
  version_state text,
  rule_type text,
  subject_type text,
  subject_ref text,
  correlation_id uuid,
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision text NOT NULL,
  reason text,
  binding boolean NOT NULL DEFAULT true,
  actor_kind text NOT NULL DEFAULT 'SYSTEM',
  actor_id uuid,
  decided_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.rental_policy_decisions TO authenticated;
GRANT ALL ON public.rental_policy_decisions TO service_role;
ALTER TABLE public.rental_policy_decisions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rental_policy_decisions_staff_read ON public.rental_policy_decisions;
CREATE POLICY rental_policy_decisions_staff_read ON public.rental_policy_decisions
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin')
      OR public.has_role(auth.uid(),'super_admin'));

CREATE INDEX IF NOT EXISTS rental_policy_decisions_subject_idx
  ON public.rental_policy_decisions (subject_ref, decided_at DESC);
CREATE INDEX IF NOT EXISTS rental_policy_decisions_corr_idx
  ON public.rental_policy_decisions (correlation_id);

CREATE OR REPLACE FUNCTION public._rental_policy_decisions_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  RAISE EXCEPTION 'POLICY_DECISION_LOG_IS_APPEND_ONLY';
END; $$;

DROP TRIGGER IF EXISTS trg_rental_policy_decisions_append_only ON public.rental_policy_decisions;
CREATE TRIGGER trg_rental_policy_decisions_append_only
  BEFORE UPDATE OR DELETE ON public.rental_policy_decisions
  FOR EACH ROW EXECUTE FUNCTION public._rental_policy_decisions_append_only();

-- ============================================================
-- SEED: version 1 for every existing policy (ACTIVE ones adopt current config)
-- ============================================================
INSERT INTO public.rental_policy_versions
  (policy_code, version, rule_type, config, state, proposed_basis, approval_authority, effective_from)
SELECT p.policy_code, 1, p.rule_type, coalesce(p.config,'{}'::jsonb),
       CASE WHEN p.state = 'ACTIVE' THEN 'ACTIVE' ELSE 'PENDING_BUSINESS_APPROVAL' END,
       CASE WHEN p.state = 'ACTIVE' THEN 'Adopted from the operating rule already enforced in the database.'
            ELSE 'Proposed Yalla commercial default; pending business approval.' END,
       'Owner / Commercial lead',
       current_date
FROM public.rental_policies p
WHERE NOT EXISTS (SELECT 1 FROM public.rental_policy_versions v WHERE v.policy_code = p.policy_code);

-- Proposed commercial defaults for the eight outstanding rules
UPDATE public.rental_policy_versions v SET
  rule_type = 'CONFIGURABLE',
  config = CASE v.policy_code
    WHEN 'CANCELLATION_WINDOW' THEN jsonb_build_object(
      'tiers', jsonb_build_array(
        jsonb_build_object('min_hours_before_pickup', 48, 'refund_percent', 100),
        jsonb_build_object('min_hours_before_pickup', 24, 'refund_percent', 75),
        jsonb_build_object('min_hours_before_pickup', 0,  'refund_percent', 50)),
      'no_show_refund_percent', 0,
      'yalla_or_provider_cancellation_refund_percent', 100,
      'force_majeure', 'CASE_BY_CASE_APPROVAL',
      'corporate_negotiated_terms_override', true)
    WHEN 'REFUND_BASIS' THEN jsonb_build_object(
      'lifecycle', jsonb_build_array('REFUND_REQUESTED','ELIGIBILITY_CHECK','APPROVAL','REFUND_INITIATED','PROVIDER_CONFIRMED','REFUNDED','RECONCILED'),
      'basis', 'CANCELLATION_WINDOW_TIER',
      'approval_threshold_kes', 100000,
      'second_approver_above_kes', 100000,
      'manual_amount_entry_allowed', false)
    WHEN 'SECURITY_DEPOSIT' THEN jsonb_build_object(
      'separate_from_rental_revenue', true,
      'hold_kind', 'PREAUTHORISATION_OR_COLLECTED_HOLD',
      'deposit_by_asset_class', jsonb_build_object('ECONOMY', 20000, 'STANDARD', 30000, 'PREMIUM', 60000, 'SUV', 60000),
      'release_target_days_after_return', 3,
      'deductions_require_inspection_evidence', true)
    WHEN 'LATE_RETURN_CHARGE' THEN jsonb_build_object(
      'grace_minutes', 60,
      'hourly_charge_percent_of_daily_rate', 15,
      'daily_cap_percent_of_daily_rate', 100,
      'chargeable_causes', jsonb_build_array('CUSTOMER_CAUSED'),
      'non_chargeable_causes', jsonb_build_array('YALLA_CAUSED','PROVIDER_CAUSED','FORCE_MAJEURE','OPERATIONAL_INCIDENT'))
    WHEN 'EXCESS_MILEAGE_CHARGE' THEN jsonb_build_object(
      'included_km_per_day_by_asset_class', jsonb_build_object('ECONOMY', 200, 'STANDARD', 200, 'PREMIUM', 150, 'SUV', 150),
      'excess_rate_kes_per_km_by_asset_class', jsonb_build_object('ECONOMY', 25, 'STANDARD', 25, 'PREMIUM', 45, 'SUV', 45),
      'unlimited_option_available', false,
      'must_be_shown_on_quote', true)
    WHEN 'DRIVER_LICENCE_VERIFICATION' THEN jsonb_build_object(
      'required_for', jsonb_build_array('SELF_DRIVE'),
      'gate', 'HARD_GATE_BEFORE_CONFIRMATION',
      'steps', jsonb_build_array('IDENTITY_VERIFIED','LICENCE_CAPTURED','LICENCE_VALID','CLASS_ELIGIBLE','AGE_ELIGIBLE'),
      'minimum_age_years', 25,
      'minimum_licence_years', 2,
      'checkout_bypass_allowed', false)
    WHEN 'CORPORATE_APPROVAL' THEN jsonb_build_object(
      'auto_approve_below_kes', 50000,
      'designated_approver_below_kes', 300000,
      'elevated_approval_above_kes', 300000,
      'always_require_approval_when_out_of_policy', true)
    WHEN 'CORPORATE_CREDIT_LIMIT' THEN jsonb_build_object(
      'credit_requires_approved_limit', true,
      'default_limit_kes', 0,
      'payment_terms_days', 30,
      'block_when_available_credit_below_booking_value', true,
      'block_when_overdue_days_exceed', 30)
    ELSE v.config END,
  proposed_basis = 'Proposed Yalla commercial default from the 2026 rental policy framework; not legal advice, pending business approval.'
WHERE v.policy_code IN ('CANCELLATION_WINDOW','REFUND_BASIS','SECURITY_DEPOSIT','LATE_RETURN_CHARGE',
                        'EXCESS_MILEAGE_CHARGE','DRIVER_LICENCE_VERIFICATION','CORPORATE_APPROVAL','CORPORATE_CREDIT_LIMIT')
  AND v.state = 'PENDING_BUSINESS_APPROVAL';

-- ============================================================
-- RESOLVE the version that governs a policy right now
-- ============================================================
CREATE OR REPLACE FUNCTION public.rental_policy_resolve(_policy_code text, _on date DEFAULT current_date)
RETURNS public.rental_policy_versions
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT * FROM public.rental_policy_versions v
   WHERE v.policy_code = _policy_code
     AND v.state IN ('ACTIVE','PENDING_BUSINESS_APPROVAL')
     AND v.effective_from <= _on
     AND (v.effective_to IS NULL OR v.effective_to >= _on)
   ORDER BY (v.state = 'ACTIVE') DESC, v.version DESC
   LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.rental_policy_resolve(text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_policy_resolve(text, date) TO authenticated, service_role;

-- ============================================================
-- PROPOSE / DECIDE a policy version
-- ============================================================
CREATE OR REPLACE FUNCTION public.rental_policy_version_propose(
  _policy_code text, _config jsonb, _scope jsonb DEFAULT '{}'::jsonb,
  _effective_from date DEFAULT current_date, _basis text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE nv integer; row_out public.rental_policy_versions;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') = true
       OR public.has_role(auth.uid(),'super_admin') = true
       OR public.has_staff_permission('staff.commercial.write') = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','NOT_AUTHORISED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.rental_policies WHERE policy_code = _policy_code) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','UNKNOWN_POLICY_CODE');
  END IF;

  SELECT coalesce(max(version),0) + 1 INTO nv
    FROM public.rental_policy_versions WHERE policy_code = _policy_code;

  INSERT INTO public.rental_policy_versions
    (policy_code, version, rule_type, scope, config, effective_from, state,
     proposed_basis, approval_authority, proposed_by)
  VALUES (_policy_code, nv, 'CONFIGURABLE', coalesce(_scope,'{}'::jsonb), coalesce(_config,'{}'::jsonb),
          coalesce(_effective_from, current_date), 'PENDING_BUSINESS_APPROVAL',
          _basis, 'Owner / Commercial lead', auth.uid())
  RETURNING * INTO row_out;

  RETURN jsonb_build_object('ok', true, 'policy_code', _policy_code, 'version', row_out.version,
                            'state', row_out.state);
END; $$;
REVOKE ALL ON FUNCTION public.rental_policy_version_propose(text, jsonb, jsonb, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_policy_version_propose(text, jsonb, jsonb, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.rental_policy_version_decide(
  _policy_code text, _version integer, _decision text, _note text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v public.rental_policy_versions; d text := upper(coalesce(_decision,''));
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin') = true
       OR public.has_role(auth.uid(),'super_admin') = true
       OR public.has_role(auth.uid(),'finance_admin') = true) THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','NOT_AUTHORISED');
  END IF;
  IF d NOT IN ('APPROVE','REJECT') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','UNKNOWN_DECISION');
  END IF;

  SELECT * INTO v FROM public.rental_policy_versions
   WHERE policy_code = _policy_code AND version = _version FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'reason_code','VERSION_NOT_FOUND'); END IF;
  IF v.state <> 'PENDING_BUSINESS_APPROVAL' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code','VERSION_NOT_PENDING', 'state', v.state);
  END IF;

  IF d = 'REJECT' THEN
    UPDATE public.rental_policy_versions
       SET state='REJECTED', approved_by=auth.uid(), approved_at=now(), approval_note=_note
     WHERE id = v.id;
    RETURN jsonb_build_object('ok', true, 'policy_code', _policy_code, 'version', _version, 'state','REJECTED');
  END IF;

  UPDATE public.rental_policy_versions
     SET state='SUPERSEDED', effective_to = least(coalesce(effective_to, v.effective_from - 1), v.effective_from - 1)
   WHERE policy_code = _policy_code AND state='ACTIVE' AND id <> v.id;

  UPDATE public.rental_policy_versions
     SET state='ACTIVE', approved_by=auth.uid(), approved_at=now(), approval_note=_note
   WHERE id = v.id RETURNING * INTO v;

  UPDATE public.rental_policies
     SET state='ACTIVE', config = v.config,
         owner_decision = coalesce(_note, 'Approved policy version ' || v.version::text),
         updated_at = now()
   WHERE policy_code = _policy_code;

  RETURN jsonb_build_object('ok', true, 'policy_code', _policy_code, 'version', v.version, 'state','ACTIVE');
END; $$;
REVOKE ALL ON FUNCTION public.rental_policy_version_decide(text, integer, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_policy_version_decide(text, integer, text, text) TO authenticated, service_role;

-- ============================================================
-- EXCEPTION DECISION CLASS + SLA
-- ============================================================
ALTER TABLE public.rental_exception_policies
  ADD COLUMN IF NOT EXISTS decision_class text NOT NULL DEFAULT 'HUMAN_REVIEW'
    CHECK (decision_class IN ('AUTOMATED','HUMAN_REVIEW','APPROVAL_REQUIRED','SYSTEM_EXCEPTION')),
  ADD COLUMN IF NOT EXISTS sla_minutes integer NOT NULL DEFAULT 240,
  ADD COLUMN IF NOT EXISTS owner_role text,
  ADD COLUMN IF NOT EXISTS escalation_role text;

UPDATE public.rental_exception_policies SET
  decision_class = CASE exception_code
    WHEN 'QUOTE_VALIDITY_ELAPSED' THEN 'AUTOMATED'
    WHEN 'PAYMENT_CALLBACK_MISSING' THEN 'AUTOMATED'
    WHEN 'ALLOCATION_PENDING' THEN 'SYSTEM_EXCEPTION'
    WHEN 'VEHICLE_LOST_AFTER_BOOKING' THEN 'SYSTEM_EXCEPTION'
    WHEN 'RECONCILIATION_BREAK' THEN 'SYSTEM_EXCEPTION'
    WHEN 'DUPLICATE_PAYMENT' THEN 'APPROVAL_REQUIRED'
    WHEN 'PAYMENT_SHORTFALL' THEN 'APPROVAL_REQUIRED'
    WHEN 'REFUND_POLICY_REQUIRED' THEN 'APPROVAL_REQUIRED'
    WHEN 'REFUND_STUCK' THEN 'APPROVAL_REQUIRED'
    WHEN 'COMPLIANCE_EXCEPTION' THEN 'APPROVAL_REQUIRED'
    ELSE 'HUMAN_REVIEW' END,
  sla_minutes = CASE severity WHEN 'P0' THEN 15 WHEN 'P1' THEN 60 WHEN 'P2' THEN 480 ELSE 1440 END,
  owner_role = coalesce(human_authority, 'Rental Operations'),
  escalation_role = CASE severity
    WHEN 'P0' THEN 'Finance + Operations Manager'
    WHEN 'P1' THEN 'Operations Manager'
    ELSE 'Rental Operations lead' END;

ALTER TABLE public.rental_exceptions
  ADD COLUMN IF NOT EXISTS decision_class text,
  ADD COLUMN IF NOT EXISTS owner_role text,
  ADD COLUMN IF NOT EXISTS sla_minutes integer,
  ADD COLUMN IF NOT EXISTS sla_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS sla_breached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS escalated_at timestamptz,
  ADD COLUMN IF NOT EXISTS escalated_to text;

UPDATE public.rental_exceptions e SET
  decision_class = p.decision_class,
  owner_role = p.owner_role,
  sla_minutes = p.sla_minutes,
  sla_due_at = e.opened_at + make_interval(mins => p.sla_minutes)
FROM public.rental_exception_policies p
WHERE p.exception_code = e.exception_code AND e.sla_due_at IS NULL;

-- stamp SLA on every newly opened exception
CREATE OR REPLACE FUNCTION public._rental_exception_stamp_sla()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE p public.rental_exception_policies;
BEGIN
  SELECT * INTO p FROM public.rental_exception_policies WHERE exception_code = NEW.exception_code;
  IF FOUND THEN
    NEW.decision_class := coalesce(NEW.decision_class, p.decision_class);
    NEW.owner_role     := coalesce(NEW.owner_role, p.owner_role);
    NEW.sla_minutes    := coalesce(NEW.sla_minutes, p.sla_minutes);
    NEW.sla_due_at     := coalesce(NEW.sla_due_at, coalesce(NEW.opened_at, now()) + make_interval(mins => p.sla_minutes));
    NEW.escalated_to   := coalesce(NEW.escalated_to, p.escalation_role);
  END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_rental_exception_stamp_sla ON public.rental_exceptions;
CREATE TRIGGER trg_rental_exception_stamp_sla
  BEFORE INSERT ON public.rental_exceptions
  FOR EACH ROW EXECUTE FUNCTION public._rental_exception_stamp_sla();

-- live SLA view
DROP VIEW IF EXISTS public.v_rental_exception_sla;
CREATE VIEW public.v_rental_exception_sla AS
SELECT e.id, e.exception_code, p.label, e.severity, e.decision_class, e.state,
       e.subject_type, e.subject_ref, e.correlation_id, e.attempts,
       e.owner_role, e.escalated_to, e.opened_at, e.sla_due_at, e.resolved_at,
       e.sla_minutes,
       CASE WHEN e.resolved_at IS NOT NULL THEN 'RESOLVED'
            WHEN e.sla_due_at IS NULL THEN 'NO_SLA'
            WHEN now() > e.sla_due_at THEN 'BREACHED'
            WHEN now() > e.sla_due_at - make_interval(mins => greatest(e.sla_minutes / 4, 5)) THEN 'AT_RISK'
            ELSE 'ON_TRACK' END AS sla_status,
       GREATEST(0, round(EXTRACT(epoch FROM (e.sla_due_at - now())) / 60)::int) AS minutes_remaining,
       CASE WHEN e.resolved_at IS NOT NULL
            THEN round(EXTRACT(epoch FROM (e.resolved_at - e.opened_at)) / 60)::int END AS minutes_to_resolve,
       e.detail, e.resolution
  FROM public.rental_exceptions e
  LEFT JOIN public.rental_exception_policies p ON p.exception_code = e.exception_code;
ALTER VIEW public.v_rental_exception_sla SET (security_invoker = true);
GRANT SELECT ON public.v_rental_exception_sla TO authenticated;

-- SLA sweep: mark breaches and escalate
CREATE OR REPLACE FUNCTION public.rental_exception_sla_sweep()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE breached int := 0; escalated int := 0;
BEGIN
  UPDATE public.rental_exceptions e
     SET sla_breached = true
   WHERE e.resolved_at IS NULL AND e.sla_due_at IS NOT NULL
     AND now() > e.sla_due_at AND e.sla_breached = false;
  GET DIAGNOSTICS breached = ROW_COUNT;

  UPDATE public.rental_exceptions e
     SET state = 'ESCALATED', escalated_at = now()
   WHERE e.resolved_at IS NULL AND e.sla_breached = true
     AND e.state = 'OPEN' AND e.escalated_at IS NULL;
  GET DIAGNOSTICS escalated = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'newly_breached', breached, 'newly_escalated', escalated,
                            'swept_at', now());
END; $$;
REVOKE ALL ON FUNCTION public.rental_exception_sla_sweep() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_exception_sla_sweep() TO service_role;