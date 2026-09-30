-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 2
-- Saga runs with compensation, exception policies, autonomous sweeper.
-- =====================================================================

CREATE TABLE public.rental_saga_runs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  saga           text NOT NULL,
  correlation_id uuid NOT NULL,
  subject_type   text NOT NULL,
  subject_id     uuid,
  subject_ref    text,
  state          text NOT NULL DEFAULT 'RUNNING'
                   CHECK (state IN ('RUNNING','COMPENSATING','COMPENSATED','COMPLETED','ESCALATED')),
  last_error     text,
  started_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  closed_at      timestamptz
);
CREATE INDEX idx_rental_saga_runs_state ON public.rental_saga_runs (state, started_at);
CREATE INDEX idx_rental_saga_runs_subject ON public.rental_saga_runs (subject_type, subject_ref);

GRANT SELECT ON public.rental_saga_runs TO authenticated;
GRANT ALL ON public.rental_saga_runs TO service_role;
ALTER TABLE public.rental_saga_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental saga runs" ON public.rental_saga_runs
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER trg_rental_saga_touch BEFORE UPDATE ON public.rental_saga_runs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.rental_saga_steps (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id       uuid NOT NULL REFERENCES public.rental_saga_runs(id) ON DELETE CASCADE,
  step         text NOT NULL,
  state        text NOT NULL CHECK (state IN ('DONE','FAILED','COMPENSATED','SKIPPED')),
  compensation text,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_rental_saga_steps_run ON public.rental_saga_steps (run_id, created_at);
GRANT SELECT ON public.rental_saga_steps TO authenticated;
GRANT ALL ON public.rental_saga_steps TO service_role;
ALTER TABLE public.rental_saga_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental saga steps" ON public.rental_saga_steps
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE OR REPLACE FUNCTION public._rental_saga_steps_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN RAISE EXCEPTION 'RENTAL_SAGA_STEPS_ARE_APPEND_ONLY'; END; $$;
REVOKE ALL ON FUNCTION public._rental_saga_steps_append_only() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._rental_saga_steps_append_only() TO service_role;
CREATE TRIGGER trg_rental_saga_steps_append_only
  BEFORE DELETE ON public.rental_saga_steps
  FOR EACH ROW EXECUTE FUNCTION public._rental_saga_steps_append_only();

-- ------------------------------------------------ exception policies
CREATE TABLE public.rental_exception_policies (
  exception_code   text PRIMARY KEY,
  label            text NOT NULL,
  severity         text NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  autonomous       boolean NOT NULL DEFAULT false,
  action           text NOT NULL,
  max_attempts     integer NOT NULL DEFAULT 0,
  never_auto_retry boolean NOT NULL DEFAULT false,
  human_authority  text,
  note             text
);
COMMENT ON TABLE public.rental_exception_policies IS
  'What the platform is allowed to do by itself, and what must reach a human. Routine exceptions are autonomous; money judgement, fraud, dispute and compliance are not.';
GRANT SELECT ON public.rental_exception_policies TO authenticated;
GRANT ALL ON public.rental_exception_policies TO service_role;
ALTER TABLE public.rental_exception_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental exception policies" ON public.rental_exception_policies
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_exception_policies
  (exception_code, label, severity, autonomous, action, max_attempts, never_auto_retry, human_authority, note) VALUES
 ('QUOTE_VALIDITY_ELAPSED','Unpaid quotation past validity','P3', true,'EXPIRE_QUOTE',1,false,NULL,'Routine housekeeping.'),
 ('PAYMENT_CALLBACK_MISSING','Verified payment with no settlement','P1', true,'REPLAY_SETTLEMENT',5,false,NULL,'Provider record exists; settlement is replayed idempotently.'),
 ('ALLOCATION_PENDING','Paid booking without a vehicle','P1', true,'RETRY_ALLOCATION',10,false,'Commercial staff if allocation keeps failing','Retried automatically; escalates after the attempt budget.'),
 ('VEHICLE_LOST_AFTER_BOOKING','Allocated vehicle no longer lettable','P1', true,'REALLOCATE_VEHICLE',3,false,'Commercial staff','Compensates by releasing the hold and reallocating.'),
 ('PAYMENT_SHORTFALL','Amount paid below the quotation','P1', false,'ESCALATE',0,true,'Finance','Never auto-settled; a human decides top-up or refund.'),
 ('DUPLICATE_PAYMENT','More than one verified payment for one quotation','P0', false,'ESCALATE',0,true,'Finance','Never auto-refunded.'),
 ('REFUND_STUCK','Refund not completed within its window','P0', false,'ESCALATE',0,true,'Finance','Requires human authorisation.'),
 ('REFUND_POLICY_REQUIRED','Cancellation refund needs a rule that does not exist','P1', false,'ESCALATE',0,true,'Owner / Finance','Cancellation, refund and deposit rules are not yet defined — POLICY_REQUIRED.'),
 ('RECONCILIATION_BREAK','Booking, ledger and provider record disagree','P0', false,'ESCALATE',0,true,'Finance','Investigated by a human, never auto-adjusted.'),
 ('FRAUD_SUSPECTED','Fraud signal on a rental','P0', false,'ESCALATE',0,true,'Trust & Safety',NULL),
 ('DAMAGE_DISPUTE','Damage or condition dispute','P1', false,'ESCALATE',0,true,'Trust & Safety / Finance',NULL),
 ('COMPLIANCE_EXCEPTION','Vehicle or provider compliance lapse','P1', false,'ESCALATE',0,true,'Compliance',NULL),
 ('CUSTOMER_NO_SHOW','Customer did not collect the vehicle','P2', false,'ESCALATE',0,false,'Commercial staff','Fee treatment depends on undefined policy.'),
 ('RETURN_OVERDUE','Vehicle not returned by the agreed date','P1', false,'ESCALATE',0,false,'Commercial staff','Late charges undefined — POLICY_REQUIRED.'),
 ('SERIOUS_OPERATIONAL_FAILURE','Serious operational failure on a rental','P0', false,'ESCALATE',0,true,'Operations lead',NULL);

-- ------------------------------------------------------- exceptions
CREATE TABLE public.rental_exceptions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  exception_code text NOT NULL REFERENCES public.rental_exception_policies(exception_code),
  subject_type   text NOT NULL,
  subject_id     uuid,
  subject_ref    text,
  correlation_id uuid,
  saga_run_id    uuid REFERENCES public.rental_saga_runs(id) ON DELETE SET NULL,
  state          text NOT NULL DEFAULT 'OPEN'
                   CHECK (state IN ('OPEN','AUTO_RESOLVED','ESCALATED','RESOLVED','PARKED')),
  severity       text NOT NULL,
  attempts       integer NOT NULL DEFAULT 0,
  detail         jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution     text,
  resolved_by    uuid,
  opened_at      timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);
CREATE UNIQUE INDEX uq_rental_exception_open
  ON public.rental_exceptions (exception_code, coalesce(subject_ref, subject_id::text))
  WHERE state IN ('OPEN','ESCALATED');
CREATE INDEX idx_rental_exceptions_state ON public.rental_exceptions (state, severity, opened_at);

GRANT SELECT, UPDATE ON public.rental_exceptions TO authenticated;
GRANT ALL ON public.rental_exceptions TO service_role;
ALTER TABLE public.rental_exceptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental exceptions" ON public.rental_exceptions
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER trg_rental_exceptions_touch BEFORE UPDATE ON public.rental_exceptions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------- routines
CREATE OR REPLACE FUNCTION public.rental_saga_start(
  _saga text, _subject_type text, _subject_id uuid, _subject_ref text, _correlation_id uuid DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE id uuid;
BEGIN
  INSERT INTO public.rental_saga_runs (saga, correlation_id, subject_type, subject_id, subject_ref)
  VALUES (_saga, coalesce(_correlation_id, gen_random_uuid()), _subject_type, _subject_id, _subject_ref)
  RETURNING rental_saga_runs.id INTO id;
  RETURN id;
END; $$;
REVOKE ALL ON FUNCTION public.rental_saga_start(text,text,uuid,text,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_saga_start(text,text,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_saga_record_step(
  _run_id uuid, _step text, _state text, _compensation text DEFAULT NULL, _detail jsonb DEFAULT '{}'::jsonb
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.rental_saga_steps (run_id, step, state, compensation, detail)
  VALUES (_run_id, _step, upper(_state), _compensation, coalesce(_detail,'{}'::jsonb));
END; $$;
REVOKE ALL ON FUNCTION public.rental_saga_record_step(uuid,text,text,text,jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_saga_record_step(uuid,text,text,text,jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_saga_close(
  _run_id uuid, _state text, _error text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rental_saga_runs
     SET state = upper(_state), last_error = _error,
         closed_at = CASE WHEN upper(_state) IN ('COMPLETED','COMPENSATED','ESCALATED') THEN now() ELSE NULL END
   WHERE id = _run_id;
END; $$;
REVOKE ALL ON FUNCTION public.rental_saga_close(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_saga_close(uuid,text,text) TO service_role;

-- Open (or find) an exception and apply its policy.
CREATE OR REPLACE FUNCTION public.rental_exception_open(
  _code text, _subject_type text, _subject_id uuid, _subject_ref text,
  _correlation_id uuid DEFAULT NULL, _detail jsonb DEFAULT '{}'::jsonb, _saga_run_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pol public.rental_exception_policies; ex public.rental_exceptions;
BEGIN
  SELECT * INTO pol FROM public.rental_exception_policies WHERE exception_code = _code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'UNKNOWN_EXCEPTION_CODE');
  END IF;

  SELECT * INTO ex FROM public.rental_exceptions
   WHERE exception_code = _code
     AND coalesce(subject_ref, subject_id::text) = coalesce(_subject_ref, _subject_id::text)
     AND state IN ('OPEN','ESCALATED')
   FOR UPDATE;

  IF FOUND THEN
    UPDATE public.rental_exceptions
       SET attempts = attempts + 1, detail = ex.detail || coalesce(_detail,'{}'::jsonb)
     WHERE id = ex.id RETURNING * INTO ex;
  ELSE
    INSERT INTO public.rental_exceptions (
      exception_code, subject_type, subject_id, subject_ref, correlation_id,
      saga_run_id, severity, state, attempts, detail)
    VALUES (_code, _subject_type, _subject_id, _subject_ref, _correlation_id, _saga_run_id,
            pol.severity,
            CASE WHEN pol.autonomous AND NOT pol.never_auto_retry THEN 'OPEN' ELSE 'ESCALATED' END,
            1, coalesce(_detail,'{}'::jsonb))
    RETURNING * INTO ex;
  END IF;

  -- Attempt budget exhausted on an autonomous policy → hand to a human.
  IF pol.autonomous AND pol.max_attempts > 0 AND ex.attempts > pol.max_attempts AND ex.state = 'OPEN' THEN
    UPDATE public.rental_exceptions SET state = 'ESCALATED' WHERE id = ex.id RETURNING * INTO ex;
  END IF;

  IF ex.state = 'ESCALATED' THEN
    PERFORM public.rental_emit_event(
      CASE _code
        WHEN 'PAYMENT_SHORTFALL' THEN 'PaymentShortfall'
        WHEN 'DUPLICATE_PAYMENT' THEN 'PaymentFailed'
        WHEN 'REFUND_STUCK' THEN 'RefundStuck'
        WHEN 'REFUND_POLICY_REQUIRED' THEN 'RefundRequested'
        WHEN 'RECONCILIATION_BREAK' THEN 'ReconciliationBreak'
        WHEN 'DAMAGE_DISPUTE' THEN 'DamageReported'
        WHEN 'RETURN_OVERDUE' THEN 'ReturnException'
        WHEN 'VEHICLE_LOST_AFTER_BOOKING' THEN 'VehicleLostAfterBooking'
        WHEN 'FRAUD_SUSPECTED' THEN 'FraudSuspected'
        ELSE 'ReservationFailed'
      END,
      _subject_type, _subject_id, _subject_ref, _correlation_id,
      jsonb_build_object('exception_code', _code, 'exception_id', ex.id,
                         'human_authority', pol.human_authority, 'severity', pol.severity) || coalesce(_detail,'{}'::jsonb),
      NULL, NULL, ex.id::text);
  END IF;

  RETURN jsonb_build_object('ok', true, 'exception_id', ex.id, 'state', ex.state,
                            'severity', ex.severity, 'attempts', ex.attempts,
                            'autonomous', pol.autonomous, 'action', pol.action,
                            'never_auto_retry', pol.never_auto_retry);
END; $$;
REVOKE ALL ON FUNCTION public.rental_exception_open(text,text,uuid,text,uuid,jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_exception_open(text,text,uuid,text,uuid,jsonb,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.rental_exception_close(
  _exception_id uuid, _state text, _resolution text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rental_exceptions
     SET state = upper(_state), resolution = _resolution,
         resolved_at = CASE WHEN upper(_state) IN ('AUTO_RESOLVED','RESOLVED') THEN now() ELSE NULL END
   WHERE id = _exception_id;
END; $$;
REVOKE ALL ON FUNCTION public.rental_exception_close(uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rental_exception_close(uuid,text,text) TO service_role;

-- Staff resolution of an escalated exception (human-in-the-loop boundary).
CREATE OR REPLACE FUNCTION public.rental_exception_staff_resolve(
  _exception_id uuid, _resolution text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE ex public.rental_exceptions;
BEGIN
  IF NOT public.has_staff_permission('staff.commercial.write') THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'NOT_AUTHORISED');
  END IF;
  IF coalesce(btrim(_resolution),'') = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'RESOLUTION_NOTE_REQUIRED');
  END IF;
  UPDATE public.rental_exceptions
     SET state = 'RESOLVED', resolution = _resolution, resolved_by = auth.uid(), resolved_at = now()
   WHERE id = _exception_id AND state IN ('OPEN','ESCALATED','PARKED')
   RETURNING * INTO ex;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason_code', 'EXCEPTION_NOT_OPEN');
  END IF;
  RETURN jsonb_build_object('ok', true, 'exception_id', ex.id, 'state', ex.state);
END; $$;
REVOKE ALL ON FUNCTION public.rental_exception_staff_resolve(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_exception_staff_resolve(uuid,text) TO authenticated, service_role;