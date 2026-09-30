
-- Audit table for accepted privileged updates
CREATE TABLE IF NOT EXISTS public.privileged_update_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  actor_role text,
  target_table text NOT NULL,
  target_row_id text NOT NULL,
  changed_columns text[] NOT NULL DEFAULT '{}',
  old_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  new_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_source text,
  ip_address inet,
  user_agent text
);
CREATE INDEX IF NOT EXISTS idx_pua_target ON public.privileged_update_audit(target_table, target_row_id);
CREATE INDEX IF NOT EXISTS idx_pua_actor_time ON public.privileged_update_audit(actor_user_id, occurred_at DESC);
GRANT SELECT ON public.privileged_update_audit TO authenticated;
GRANT ALL ON public.privileged_update_audit TO service_role;
ALTER TABLE public.privileged_update_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY pua_admin_read ON public.privileged_update_audit FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'finance_admin'::app_role]));

-- Forbidden update attempts
CREATE TABLE IF NOT EXISTS public.forbidden_update_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid,
  target_table text NOT NULL,
  target_row_id text,
  attempted_columns text[] NOT NULL DEFAULT '{}',
  reason text NOT NULL,
  ip_address inet,
  user_agent text,
  request_path text
);
CREATE INDEX IF NOT EXISTS idx_fua_actor_time ON public.forbidden_update_attempts(actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_fua_table_time ON public.forbidden_update_attempts(target_table, occurred_at DESC);
GRANT SELECT ON public.forbidden_update_attempts TO authenticated;
GRANT ALL ON public.forbidden_update_attempts TO service_role;
ALTER TABLE public.forbidden_update_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY fua_admin_read ON public.forbidden_update_attempts FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role, 'super_admin'::app_role, 'finance_admin'::app_role]));

-- Shared audit helper
CREATE OR REPLACE FUNCTION public.record_privileged_update(
  p_table text,
  p_row_id text,
  p_changed_columns text[],
  p_old jsonb,
  p_new jsonb
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT string_agg(role::text, ',') INTO v_role FROM public.user_roles WHERE user_id = auth.uid();
  INSERT INTO public.privileged_update_audit(
    actor_user_id, actor_role, target_table, target_row_id,
    changed_columns, old_values, new_values, request_source
  ) VALUES (
    auth.uid(), COALESCE(v_role, 'service_role'), p_table, p_row_id,
    p_changed_columns, COALESCE(p_old,'{}'::jsonb), COALESCE(p_new,'{}'::jsonb),
    current_setting('request.jwt.claim.role', true)
  );
END;
$$;

-- Alert helper
CREATE OR REPLACE FUNCTION public.flag_repeated_forbidden_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT count(*) INTO v_count
  FROM public.forbidden_update_attempts
  WHERE actor_user_id = NEW.actor_user_id
    AND occurred_at > now() - interval '10 minutes';
  IF v_count >= 5 THEN
    INSERT INTO public.alerts_events(
      alert_type, severity, title, description, source, metadata
    ) VALUES (
      'repeated_forbidden_updates',
      'high',
      'Repeated forbidden update attempts',
      format('User %s made %s forbidden update attempts against %s in 10m',
             NEW.actor_user_id, v_count, NEW.target_table),
      'privileged_update_audit',
      jsonb_build_object(
        'actor_user_id', NEW.actor_user_id,
        'target_table', NEW.target_table,
        'attempt_count', v_count
      )
    );
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- alerts_events schema differences shouldn't block insertion
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_flag_repeated_forbidden ON public.forbidden_update_attempts;
CREATE TRIGGER trg_flag_repeated_forbidden
  AFTER INSERT ON public.forbidden_update_attempts
  FOR EACH ROW EXECUTE FUNCTION public.flag_repeated_forbidden_updates();

-- Table-specific audit triggers
-- corporate_ride_approvals: audit decision fields
CREATE OR REPLACE FUNCTION public.audit_corp_ride_approval_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN v_cols := array_append(v_cols,'approved_by'); END IF;
  IF NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason THEN v_cols := array_append(v_cols,'rejection_reason'); END IF;
  IF array_length(v_cols,1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_privileged_update(
    'corporate_ride_approvals', NEW.id::text, v_cols,
    to_jsonb(OLD) - 'updated_at', to_jsonb(NEW) - 'updated_at'
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_corp_ride_approval ON public.corporate_ride_approvals;
CREATE TRIGGER trg_audit_corp_ride_approval
  AFTER UPDATE ON public.corporate_ride_approvals
  FOR EACH ROW EXECUTE FUNCTION public.audit_corp_ride_approval_update();

-- mpesa_transactions: audit status/receipt/amount
CREATE OR REPLACE FUNCTION public.audit_mpesa_txn_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NEW.mpesa_receipt IS DISTINCT FROM OLD.mpesa_receipt THEN v_cols := array_append(v_cols,'mpesa_receipt'); END IF;
  IF NEW.amount_cents IS DISTINCT FROM OLD.amount_cents THEN v_cols := array_append(v_cols,'amount_cents'); END IF;
  IF NEW.result_code IS DISTINCT FROM OLD.result_code THEN v_cols := array_append(v_cols,'result_code'); END IF;
  IF array_length(v_cols,1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_privileged_update(
    'mpesa_transactions', NEW.id::text, v_cols,
    jsonb_build_object('status',OLD.status,'mpesa_receipt',OLD.mpesa_receipt,'amount_cents',OLD.amount_cents,'result_code',OLD.result_code),
    jsonb_build_object('status',NEW.status,'mpesa_receipt',NEW.mpesa_receipt,'amount_cents',NEW.amount_cents,'result_code',NEW.result_code)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_mpesa_txn ON public.mpesa_transactions;
CREATE TRIGGER trg_audit_mpesa_txn
  AFTER UPDATE ON public.mpesa_transactions
  FOR EACH ROW EXECUTE FUNCTION public.audit_mpesa_txn_update();

-- trip_bookings: audit protected financial fields
CREATE OR REPLACE FUNCTION public.audit_trip_booking_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cols text[] := ARRAY[]::text[];
BEGIN
  IF NEW.total_fare IS DISTINCT FROM OLD.total_fare THEN v_cols := array_append(v_cols,'total_fare'); END IF;
  IF NEW.base_fare IS DISTINCT FROM OLD.base_fare THEN v_cols := array_append(v_cols,'base_fare'); END IF;
  IF NEW.surge_multiplier IS DISTINCT FROM OLD.surge_multiplier THEN v_cols := array_append(v_cols,'surge_multiplier'); END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN v_cols := array_append(v_cols,'payment_method'); END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN v_cols := array_append(v_cols,'currency'); END IF;
  IF array_length(v_cols,1) IS NULL THEN RETURN NEW; END IF;
  PERFORM public.record_privileged_update(
    'trip_bookings', NEW.id::text, v_cols,
    jsonb_build_object('total_fare',OLD.total_fare,'base_fare',OLD.base_fare,'surge_multiplier',OLD.surge_multiplier,'status',OLD.status,'payment_method',OLD.payment_method,'currency',OLD.currency),
    jsonb_build_object('total_fare',NEW.total_fare,'base_fare',NEW.base_fare,'surge_multiplier',NEW.surge_multiplier,'status',NEW.status,'payment_method',NEW.payment_method,'currency',NEW.currency)
  );
  RETURN NEW;
END; $$;

DROP TRIGGER IF EXISTS trg_audit_trip_booking ON public.trip_bookings;
CREATE TRIGGER trg_audit_trip_booking
  AFTER UPDATE ON public.trip_bookings
  FOR EACH ROW EXECUTE FUNCTION public.audit_trip_booking_update();

-- Modify trip_bookings guard trigger to log forbidden attempts before raising
CREATE OR REPLACE FUNCTION public.trip_bookings_guard_financial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  is_privileged boolean;
  v_cols text[] := ARRAY[]::text[];
BEGIN
  is_privileged := (
    auth.uid() IS NULL
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'finance_admin'::app_role)
  );
  IF is_privileged THEN
    RETURN NEW;
  END IF;

  IF NEW.total_fare IS DISTINCT FROM OLD.total_fare THEN v_cols := array_append(v_cols,'total_fare'); END IF;
  IF NEW.base_fare IS DISTINCT FROM OLD.base_fare THEN v_cols := array_append(v_cols,'base_fare'); END IF;
  IF NEW.surge_multiplier IS DISTINCT FROM OLD.surge_multiplier THEN v_cols := array_append(v_cols,'surge_multiplier'); END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN v_cols := array_append(v_cols,'status'); END IF;
  IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN v_cols := array_append(v_cols,'payment_method'); END IF;
  IF NEW.currency IS DISTINCT FROM OLD.currency THEN v_cols := array_append(v_cols,'currency'); END IF;
  IF NEW.rider_user_id IS DISTINCT FROM OLD.rider_user_id THEN v_cols := array_append(v_cols,'rider_user_id'); END IF;
  IF NEW.driver_id IS DISTINCT FROM OLD.driver_id THEN v_cols := array_append(v_cols,'driver_id'); END IF;

  IF array_length(v_cols,1) IS NOT NULL THEN
    INSERT INTO public.forbidden_update_attempts(actor_user_id, target_table, target_row_id, attempted_columns, reason)
    VALUES (auth.uid(), 'trip_bookings', NEW.id::text, v_cols, 'protected_field_modification');
    RAISE EXCEPTION 'Not allowed to modify financial or ownership fields on trip_bookings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;
