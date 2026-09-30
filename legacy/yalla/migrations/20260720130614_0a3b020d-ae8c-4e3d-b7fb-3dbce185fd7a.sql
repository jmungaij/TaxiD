
-- ============================================================================
-- Phase D5.3 — Canonical Payment State & Projection Sync
-- ============================================================================

-- 1) Projection registry ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_projection_registry (
  projection_name text PRIMARY KEY,
  table_name      text NOT NULL,
  sync_fn         text NOT NULL,
  weight          numeric NOT NULL DEFAULT 1,
  enabled         boolean NOT NULL DEFAULT true,
  description     text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.payment_projection_registry TO authenticated;
GRANT ALL    ON public.payment_projection_registry TO service_role;
ALTER TABLE public.payment_projection_registry ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ppr_admin_read ON public.payment_projection_registry;
CREATE POLICY ppr_admin_read ON public.payment_projection_registry FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'finance_admin'));

-- 2) Sync-run log -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_projection_sync_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id  uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE CASCADE,
  projection_name     text NOT NULL REFERENCES public.payment_projection_registry(projection_name),
  status              text NOT NULL CHECK (status IN ('started','completed','failed','skipped')),
  attempts            int  NOT NULL DEFAULT 1,
  last_error          text,
  correlation_id      text,
  trace_id            text,
  before_state        text,
  after_state         text,
  duration_ms         int,
  started_at          timestamptz NOT NULL DEFAULT now(),
  completed_at        timestamptz,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_ppsr_attempt ON public.payment_projection_sync_runs(payment_attempt_id, projection_name, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_ppsr_status  ON public.payment_projection_sync_runs(status, started_at DESC);

GRANT SELECT ON public.payment_projection_sync_runs TO authenticated;
GRANT ALL    ON public.payment_projection_sync_runs TO service_role;
ALTER TABLE public.payment_projection_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ppsr_admin_read ON public.payment_projection_sync_runs;
CREATE POLICY ppsr_admin_read ON public.payment_projection_sync_runs FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'finance_admin'));

-- 3) Incident tracker ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_projection_incidents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_attempt_id  uuid NOT NULL REFERENCES public.payment_attempts(id) ON DELETE CASCADE,
  projection_name     text NOT NULL,
  expected_state      text NOT NULL,
  actual_state        text,
  severity            text NOT NULL DEFAULT 'high' CHECK (severity IN ('low','medium','high','critical')),
  opened_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  resolution_notes    text,
  metadata            jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_ppi_open
  ON public.payment_projection_incidents(payment_attempt_id, projection_name)
  WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_ppi_open ON public.payment_projection_incidents(opened_at DESC) WHERE resolved_at IS NULL;

GRANT SELECT ON public.payment_projection_incidents TO authenticated;
GRANT ALL    ON public.payment_projection_incidents TO service_role;
ALTER TABLE public.payment_projection_incidents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ppi_admin_read ON public.payment_projection_incidents;
CREATE POLICY ppi_admin_read ON public.payment_projection_incidents FOR SELECT
  TO authenticated
  USING (has_role(auth.uid(),'admin') OR has_role(auth.uid(),'super_admin') OR has_role(auth.uid(),'finance_admin'));

-- 4) Seed projection registry -------------------------------------------------
INSERT INTO public.payment_projection_registry(projection_name, table_name, sync_fn, weight, description)
VALUES
  ('mpesa_transactions','public.mpesa_transactions','sync_mpesa_transactions_projection',3,'M-Pesa transaction mirror of canonical payment attempt'),
  ('wallet_transactions','public.wallet_transactions','sync_wallet_transactions_projection',5,'Wallet ledger credit — exactly-once')
ON CONFLICT (projection_name) DO UPDATE
  SET table_name = EXCLUDED.table_name,
      sync_fn    = EXCLUDED.sync_fn,
      weight     = EXCLUDED.weight,
      description= EXCLUDED.description;

-- 5) Helper: canonical -> mpesa_status mapping --------------------------------
CREATE OR REPLACE FUNCTION public._canonical_to_mpesa_status(_s public.payment_state)
RETURNS public.mpesa_status
LANGUAGE sql IMMUTABLE
AS $$
  SELECT CASE _s
    WHEN 'COMPLETED'  THEN 'SUCCESS'::public.mpesa_status
    WHEN 'RECONCILED' THEN 'SUCCESS'::public.mpesa_status
    WHEN 'FAILED'     THEN 'FAILED'::public.mpesa_status
    WHEN 'TIMED_OUT'  THEN 'FAILED'::public.mpesa_status
    WHEN 'CANCELLED'  THEN 'CANCELLED'::public.mpesa_status
    WHEN 'REVERSED'   THEN 'REVERSED'::public.mpesa_status
    ELSE 'PENDING'::public.mpesa_status
  END;
$$;

-- 6) Projection sync: mpesa_transactions --------------------------------------
CREATE OR REPLACE FUNCTION public.sync_mpesa_transactions_projection(_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a public.payment_attempts%ROWTYPE;
  before_status public.mpesa_status;
  target_status public.mpesa_status;
  rows_updated  int := 0;
BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id = _attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason','attempt_not_found');
  END IF;
  IF a.checkout_request_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', true, 'reason','no_checkout_id');
  END IF;

  target_status := public._canonical_to_mpesa_status(a.state);

  SELECT status INTO before_status
    FROM public.mpesa_transactions
    WHERE checkout_request_id = a.checkout_request_id
    ORDER BY created_at DESC LIMIT 1;

  UPDATE public.mpesa_transactions
     SET status         = target_status,
         result_desc    = COALESCE(result_desc, a.failure_reason),
         mpesa_receipt  = COALESCE(mpesa_receipt, a.mpesa_receipt_number),
         provider_transaction_id = COALESCE(provider_transaction_id, a.mpesa_receipt_number),
         updated_at     = now()
   WHERE checkout_request_id = a.checkout_request_id
     AND status IS DISTINCT FROM target_status;
  GET DIAGNOSTICS rows_updated = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'before', before_status,
    'after', target_status,
    'rows_updated', rows_updated
  );
END;
$$;

REVOKE ALL ON FUNCTION public.sync_mpesa_transactions_projection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_mpesa_transactions_projection(uuid) TO service_role, authenticated;

-- 7) Projection sync: wallet_transactions (idempotent) ------------------------
--    Delegates to the existing exactly-once credit RPC on success paths;
--    for non-success canonical states, ensures no wallet credit exists.
CREATE OR REPLACE FUNCTION public.sync_wallet_transactions_projection(_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a public.payment_attempts%ROWTYPE;
  wtx_status text;
  had_credit boolean := false;
  credit_err text;
BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id = _attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason','attempt_not_found');
  END IF;

  IF a.state IN ('COMPLETED','RECONCILED') THEN
    IF a.mpesa_receipt_number IS NULL OR a.checkout_request_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'reason','missing_receipt_or_checkout');
    END IF;

    SELECT true INTO had_credit
      FROM public.wallet_transactions
     WHERE mpesa_receipt = a.mpesa_receipt_number
       AND direction     = 'credit'
       AND kind          = 'topup'
     LIMIT 1;

    IF had_credit IS TRUE THEN
      -- Ensure status is completed on already-posted row
      UPDATE public.wallet_transactions
         SET status='completed', updated_at = now()
       WHERE mpesa_receipt = a.mpesa_receipt_number
         AND status <> 'completed';
      RETURN jsonb_build_object('ok', true, 'already_credited', true);
    END IF;

    BEGIN
      PERFORM public.credit_wallet_exactly_once(
        a.checkout_request_id, a.mpesa_receipt_number, a.amount_cents
      );
    EXCEPTION WHEN OTHERS THEN
      credit_err := SQLERRM;
      RETURN jsonb_build_object('ok', false, 'reason','credit_failed', 'error', credit_err);
    END;
    -- Ensure wallet_posted flag reflects reality
    UPDATE public.payment_attempts SET wallet_posted = true, updated_at = now()
     WHERE id = _attempt_id AND wallet_posted = false;
    RETURN jsonb_build_object('ok', true, 'credited', true);
  END IF;

  -- Non-success canonical: refuse to credit and detect orphan credits
  IF a.mpesa_receipt_number IS NOT NULL THEN
    SELECT status INTO wtx_status
      FROM public.wallet_transactions
      WHERE mpesa_receipt = a.mpesa_receipt_number
      ORDER BY created_at DESC LIMIT 1;
    IF wtx_status = 'completed' THEN
      RETURN jsonb_build_object('ok', false, 'reason','orphan_wallet_credit');
    END IF;
  END IF;
  RETURN jsonb_build_object('ok', true, 'skipped', true);
END;
$$;

REVOKE ALL ON FUNCTION public.sync_wallet_transactions_projection(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_wallet_transactions_projection(uuid) TO service_role, authenticated;

-- 8) Verification -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_verify_projections(_attempt_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  a public.payment_attempts%ROWTYPE;
  mpesa_row public.mpesa_transactions%ROWTYPE;
  wtx_status text;
  expected_mpesa public.mpesa_status;
  results jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO a FROM public.payment_attempts WHERE id = _attempt_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason','attempt_not_found');
  END IF;
  expected_mpesa := public._canonical_to_mpesa_status(a.state);

  SELECT * INTO mpesa_row FROM public.mpesa_transactions
    WHERE checkout_request_id = a.checkout_request_id
    ORDER BY created_at DESC LIMIT 1;
  results := results || jsonb_build_array(jsonb_build_object(
    'projection','mpesa_transactions',
    'expected', expected_mpesa,
    'actual',   COALESCE(mpesa_row.status::text, 'MISSING'),
    'ok',       (mpesa_row.status = expected_mpesa)
  ));

  SELECT status INTO wtx_status
    FROM public.wallet_transactions
    WHERE mpesa_receipt = a.mpesa_receipt_number
    ORDER BY created_at DESC LIMIT 1;
  results := results || jsonb_build_array(jsonb_build_object(
    'projection','wallet_transactions',
    'expected', CASE WHEN a.state IN ('COMPLETED','RECONCILED') THEN 'completed'
                     WHEN a.state IN ('FAILED','CANCELLED','TIMED_OUT') THEN 'absent_or_not_completed'
                     ELSE 'n/a' END,
    'actual',   COALESCE(wtx_status, 'MISSING'),
    'ok', CASE
      WHEN a.state IN ('COMPLETED','RECONCELED') THEN wtx_status = 'completed'
      WHEN a.state IN ('FAILED','CANCELLED','TIMED_OUT') THEN wtx_status IS DISTINCT FROM 'completed'
      ELSE true END
  ));

  RETURN jsonb_build_object(
    'ok', NOT (results::text ILIKE '%"ok": false%'),
    'attempt_id', a.id,
    'canonical_state', a.state,
    'projections', results
  );
END;
$$;

REVOKE ALL ON FUNCTION public.payment_verify_projections(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_verify_projections(uuid) TO service_role, authenticated;

-- 9) Replay orchestrator ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.payment_replay_projection(
  _attempt_id     uuid,
  _correlation_id text DEFAULT NULL,
  _trace_id       text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  rec RECORD;
  res jsonb;
  t0  timestamptz;
  outcome text;
  err_msg text;
  run_id  uuid;
  results jsonb := '[]'::jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.payment_attempts WHERE id = _attempt_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason','attempt_not_found');
  END IF;

  FOR rec IN SELECT * FROM public.payment_projection_registry WHERE enabled ORDER BY weight DESC LOOP
    t0 := clock_timestamp();
    err_msg := NULL;
    BEGIN
      EXECUTE format('SELECT public.%I($1)', rec.sync_fn) INTO res USING _attempt_id;
      outcome := CASE WHEN (res->>'ok')::boolean IS TRUE THEN 'completed' ELSE 'failed' END;
    EXCEPTION WHEN OTHERS THEN
      outcome := 'failed';
      err_msg := SQLERRM;
      res := jsonb_build_object('ok', false, 'error', err_msg);
    END;

    INSERT INTO public.payment_projection_sync_runs(
      payment_attempt_id, projection_name, status, last_error,
      correlation_id, trace_id, duration_ms, completed_at, metadata
    ) VALUES (
      _attempt_id, rec.projection_name, outcome, err_msg,
      _correlation_id, _trace_id,
      EXTRACT(MILLISECOND FROM clock_timestamp() - t0)::int,
      now(), COALESCE(res,'{}'::jsonb)
    ) RETURNING id INTO run_id;

    -- open/close incident based on outcome
    IF outcome = 'failed' OR (res ? 'reason' AND res->>'reason' IN ('orphan_wallet_credit','credit_failed')) THEN
      INSERT INTO public.payment_projection_incidents(
        payment_attempt_id, projection_name, expected_state, actual_state, severity, metadata
      ) VALUES (
        _attempt_id, rec.projection_name,
        (SELECT state::text FROM public.payment_attempts WHERE id = _attempt_id),
        COALESCE(res->>'actual','unknown'),
        'critical',
        jsonb_build_object('run_id', run_id, 'result', res)
      )
      ON CONFLICT (payment_attempt_id, projection_name) WHERE resolved_at IS NULL
      DO UPDATE SET metadata = EXCLUDED.metadata, expected_state = EXCLUDED.expected_state;
    ELSE
      UPDATE public.payment_projection_incidents
         SET resolved_at = now(),
             resolution_notes = COALESCE(resolution_notes,'') || format('resolved by run %s at %s;', run_id, now())
       WHERE payment_attempt_id = _attempt_id
         AND projection_name    = rec.projection_name
         AND resolved_at IS NULL;
    END IF;

    results := results || jsonb_build_array(jsonb_build_object(
      'projection', rec.projection_name, 'outcome', outcome, 'result', res, 'run_id', run_id
    ));
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'attempt_id', _attempt_id, 'projections', results);
END;
$$;

REVOKE ALL ON FUNCTION public.payment_replay_projection(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.payment_replay_projection(uuid, text, text) TO service_role, authenticated;

-- 10) Trigger: run replay when payment_attempts hits terminal state -----------
CREATE OR REPLACE FUNCTION public._payment_attempts_projection_trigger()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NEW.state IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED','RECONCILED')
     AND (TG_OP = 'INSERT' OR NEW.state IS DISTINCT FROM OLD.state) THEN
    PERFORM public.payment_replay_projection(NEW.id, NEW.correlation_id, NEW.request_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_attempts_projection ON public.payment_attempts;
CREATE TRIGGER trg_payment_attempts_projection
  AFTER INSERT OR UPDATE OF state ON public.payment_attempts
  FOR EACH ROW EXECUTE FUNCTION public._payment_attempts_projection_trigger();

-- 11) Backfill: heal every historical divergence -----------------------------
DO $$
DECLARE r RECORD; BEGIN
  FOR r IN
    SELECT pa.id
      FROM public.payment_attempts pa
      LEFT JOIN LATERAL (
        SELECT status FROM public.mpesa_transactions mt
         WHERE mt.checkout_request_id = pa.checkout_request_id
         ORDER BY mt.created_at DESC LIMIT 1
      ) mt ON true
     WHERE pa.state IN ('COMPLETED','FAILED','CANCELLED','TIMED_OUT','REVERSED','RECONCILED')
       AND pa.checkout_request_id IS NOT NULL
       AND (mt.status IS NULL OR mt.status = public._canonical_to_mpesa_status(pa.state)) IS NOT TRUE
  LOOP
    PERFORM public.payment_replay_projection(r.id, 'backfill_d5.3', NULL);
  END LOOP;
END $$;
