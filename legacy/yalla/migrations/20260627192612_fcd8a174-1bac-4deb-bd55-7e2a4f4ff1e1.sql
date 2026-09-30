
-- 1. paybill_reference on corporate_accounts
ALTER TABLE public.corporate_accounts ADD COLUMN IF NOT EXISTS paybill_reference text;
UPDATE public.corporate_accounts
SET paybill_reference = 'CORP-' || upper(substring(replace(id::text,'-','') from 1 for 8))
WHERE paybill_reference IS NULL;
ALTER TABLE public.corporate_accounts ALTER COLUMN paybill_reference SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS corporate_accounts_paybill_reference_key ON public.corporate_accounts (paybill_reference);

CREATE OR REPLACE FUNCTION public.set_corporate_paybill_reference()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.paybill_reference IS NULL OR NEW.paybill_reference = '' THEN
    NEW.paybill_reference := 'CORP-' || upper(substring(replace(NEW.id::text,'-','') from 1 for 8));
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_corp_paybill_ref ON public.corporate_accounts;
CREATE TRIGGER trg_corp_paybill_ref BEFORE INSERT ON public.corporate_accounts
  FOR EACH ROW EXECUTE FUNCTION public.set_corporate_paybill_reference();

-- 2. Cash ledger
DO $$ BEGIN
  CREATE TYPE public.corp_ledger_entry_type AS ENUM ('top_up','ride_charge','refund','adjustment','reversal');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.corporate_cash_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE RESTRICT,
  entry_type public.corp_ledger_entry_type NOT NULL,
  amount_cents bigint NOT NULL,
  balance_after_cents bigint NOT NULL,
  currency text NOT NULL DEFAULT 'KES',
  reference text,
  description text,
  source_kind text,
  source_id uuid,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.corporate_cash_ledger TO authenticated;
GRANT ALL ON public.corporate_cash_ledger TO service_role;
ALTER TABLE public.corporate_cash_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corp_ledger_read_members" ON public.corporate_cash_ledger
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.corporate_employees ce
            WHERE ce.corporate_id = corporate_cash_ledger.corporate_id
              AND ce.user_id = auth.uid() AND ce.status = 'active')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "corp_ledger_admin_write" ON public.corporate_cash_ledger
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE INDEX IF NOT EXISTS corporate_cash_ledger_corp_idx
  ON public.corporate_cash_ledger (corporate_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION public.deny_ledger_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Cash ledger entries are immutable. Post a reversal entry.'; END $$;

DROP TRIGGER IF EXISTS deny_cash_ledger_mutation ON public.corporate_cash_ledger;
CREATE TRIGGER deny_cash_ledger_mutation BEFORE UPDATE OR DELETE ON public.corporate_cash_ledger
  FOR EACH ROW EXECUTE FUNCTION public.deny_ledger_mutation();

-- 3. Paybill proofs
DO $$ BEGIN
  CREATE TYPE public.paybill_proof_status AS ENUM ('pending','approved','rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.corporate_paybill_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  corporate_id uuid NOT NULL REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  mpesa_code text NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'KES',
  payer_phone text,
  paid_at timestamptz,
  proof_file_path text,
  paybill_reference text NOT NULL,
  status public.paybill_proof_status NOT NULL DEFAULT 'pending',
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  ledger_entry_id uuid REFERENCES public.corporate_cash_ledger(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS corporate_paybill_proofs_mpesa_code_key
  ON public.corporate_paybill_proofs (mpesa_code);

GRANT SELECT, INSERT, UPDATE ON public.corporate_paybill_proofs TO authenticated;
GRANT ALL ON public.corporate_paybill_proofs TO service_role;
ALTER TABLE public.corporate_paybill_proofs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "corp_proof_read_members" ON public.corporate_paybill_proofs
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.corporate_employees ce
            WHERE ce.corporate_id = corporate_paybill_proofs.corporate_id
              AND ce.user_id = auth.uid() AND ce.status = 'active')
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
  );

CREATE POLICY "corp_proof_insert_members" ON public.corporate_paybill_proofs
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid() AND status = 'pending'
    AND (
      EXISTS (SELECT 1 FROM public.corporate_employees ce
              WHERE ce.corporate_id = corporate_paybill_proofs.corporate_id
                AND ce.user_id = auth.uid() AND ce.status = 'active')
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
  );

CREATE POLICY "corp_proof_admin_update" ON public.corporate_paybill_proofs
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE OR REPLACE FUNCTION public.touch_corporate_paybill_proofs()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

DROP TRIGGER IF EXISTS trg_corp_proof_updated ON public.corporate_paybill_proofs;
CREATE TRIGGER trg_corp_proof_updated BEFORE UPDATE ON public.corporate_paybill_proofs
  FOR EACH ROW EXECUTE FUNCTION public.touch_corporate_paybill_proofs();

-- 4. Approve / reject RPCs
CREATE OR REPLACE FUNCTION public.approve_corporate_paybill_proof(_proof_id uuid, _notes text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _proof public.corporate_paybill_proofs%ROWTYPE; _balance bigint; _ledger_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can approve paybill proofs'; END IF;
  SELECT * INTO _proof FROM public.corporate_paybill_proofs WHERE id = _proof_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Proof not found'; END IF;
  IF _proof.status <> 'pending' THEN RAISE EXCEPTION 'Proof already %', _proof.status; END IF;

  SELECT COALESCE(balance_after_cents,0) INTO _balance
  FROM public.corporate_cash_ledger
  WHERE corporate_id = _proof.corporate_id
  ORDER BY occurred_at DESC, created_at DESC LIMIT 1;
  _balance := COALESCE(_balance,0) + _proof.amount_cents;

  INSERT INTO public.corporate_cash_ledger
    (corporate_id, entry_type, amount_cents, balance_after_cents, currency,
     reference, description, source_kind, source_id, created_by, metadata)
  VALUES
    (_proof.corporate_id, 'top_up', _proof.amount_cents, _balance, _proof.currency,
     _proof.mpesa_code,
     'M-Pesa Paybill top-up (' || _proof.paybill_reference || ')',
     'paybill_proof', _proof.id, auth.uid(),
     jsonb_build_object('payer_phone', _proof.payer_phone, 'paid_at', _proof.paid_at))
  RETURNING id INTO _ledger_id;

  UPDATE public.corporate_paybill_proofs
  SET status='approved', reviewed_by=auth.uid(), reviewed_at=now(),
      review_notes=COALESCE(_notes, review_notes), ledger_entry_id=_ledger_id
  WHERE id = _proof_id;

  RETURN _ledger_id;
END $$;

REVOKE ALL ON FUNCTION public.approve_corporate_paybill_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_corporate_paybill_proof(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_corporate_paybill_proof(_proof_id uuid, _notes text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can reject paybill proofs'; END IF;
  UPDATE public.corporate_paybill_proofs
  SET status='rejected', reviewed_by=auth.uid(), reviewed_at=now(), review_notes=_notes
  WHERE id=_proof_id AND status='pending';
END $$;

REVOKE ALL ON FUNCTION public.reject_corporate_paybill_proof(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_corporate_paybill_proof(uuid, text) TO authenticated;

-- 5. Pre-billing summary
CREATE OR REPLACE FUNCTION public.corporate_tentative_bill_summary(_corporate_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _balance bigint; _pa bigint; _paa bigint; _if bigint; _ifa bigint;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.corporate_employees ce
               WHERE ce.corporate_id = _corporate_id AND ce.user_id = auth.uid() AND ce.status='active')
  ) THEN RAISE EXCEPTION 'Not authorised'; END IF;

  SELECT COALESCE(balance_after_cents,0) INTO _balance
  FROM public.corporate_cash_ledger
  WHERE corporate_id = _corporate_id
  ORDER BY occurred_at DESC, created_at DESC LIMIT 1;
  _balance := COALESCE(_balance,0);

  SELECT COUNT(*), COALESCE(SUM(estimated_fare_cents),0) INTO _pa, _paa
  FROM public.corporate_ride_approvals
  WHERE corporate_id = _corporate_id AND status='pending';

  SELECT COUNT(*), COALESCE(SUM(COALESCE(fare_cents, estimated_fare_cents, 0)),0) INTO _if, _ifa
  FROM public.trip_bookings tb
  WHERE tb.corporate_id = _corporate_id
    AND tb.status IN ('pending','accepted','driver_arrived','in_progress');

  RETURN jsonb_build_object(
    'balance_cents', _balance,
    'pending_approvals_count', _pa,
    'pending_approvals_amount_cents', _paa,
    'inflight_trips_count', _if,
    'inflight_trips_amount_cents', _ifa,
    'tentative_total_cents', _paa + _ifa,
    'projected_balance_cents', _balance - (_paa + _ifa)
  );
END $$;

REVOKE ALL ON FUNCTION public.corporate_tentative_bill_summary(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corporate_tentative_bill_summary(uuid) TO authenticated;
