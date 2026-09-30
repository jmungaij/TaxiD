
-- Immutable audit log for Cash Ledger postings & paybill proof reviews
CREATE TABLE IF NOT EXISTS public.corporate_cash_ledger_audit (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  corporate_id UUID NOT NULL,
  event_type TEXT NOT NULL, -- 'ledger_post' | 'proof_approved' | 'proof_rejected'
  ledger_entry_id UUID,
  proof_id UUID,
  amount_cents BIGINT,
  balance_after_cents BIGINT,
  reference TEXT,
  paybill_reference TEXT,
  actor_user_id UUID,
  actor_email TEXT,
  notes TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.corporate_cash_ledger_audit TO authenticated;
GRANT ALL ON public.corporate_cash_ledger_audit TO service_role;

ALTER TABLE public.corporate_cash_ledger_audit ENABLE ROW LEVEL SECURITY;

-- Members of the corporate can read their own audit trail
CREATE POLICY "ccla_read_members" ON public.corporate_cash_ledger_audit
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.corporate_employees ce
    WHERE ce.corporate_id = corporate_cash_ledger_audit.corporate_id
      AND ce.user_id = auth.uid()
      AND ce.status = 'active'
  )
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'super_admin')
);

-- Only service role/triggers insert. No update, no delete (immutable).
CREATE POLICY "ccla_no_update" ON public.corporate_cash_ledger_audit
FOR UPDATE TO authenticated USING (false) WITH CHECK (false);

CREATE POLICY "ccla_no_delete" ON public.corporate_cash_ledger_audit
FOR DELETE TO authenticated USING (false);

-- Block all updates/deletes at row level even for service_role-ish definers via trigger
CREATE OR REPLACE FUNCTION public.corporate_cash_ledger_audit_block_mutations()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'corporate_cash_ledger_audit is immutable (% blocked)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS ccla_block_update ON public.corporate_cash_ledger_audit;
CREATE TRIGGER ccla_block_update BEFORE UPDATE ON public.corporate_cash_ledger_audit
FOR EACH ROW EXECUTE FUNCTION public.corporate_cash_ledger_audit_block_mutations();

DROP TRIGGER IF EXISTS ccla_block_delete ON public.corporate_cash_ledger_audit;
CREATE TRIGGER ccla_block_delete BEFORE DELETE ON public.corporate_cash_ledger_audit
FOR EACH ROW EXECUTE FUNCTION public.corporate_cash_ledger_audit_block_mutations();

-- Auto-audit every cash ledger insert
CREATE OR REPLACE FUNCTION public.audit_corporate_cash_ledger_insert()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _paybill_ref TEXT;
  _actor_email TEXT;
BEGIN
  SELECT paybill_reference INTO _paybill_ref FROM public.corporate_accounts WHERE id = NEW.corporate_id;
  SELECT email INTO _actor_email FROM auth.users WHERE id = auth.uid();

  INSERT INTO public.corporate_cash_ledger_audit (
    corporate_id, event_type, ledger_entry_id, amount_cents, balance_after_cents,
    reference, paybill_reference, actor_user_id, actor_email, notes, payload
  ) VALUES (
    NEW.corporate_id, 'ledger_post', NEW.id, NEW.amount_cents, NEW.balance_after_cents,
    NEW.reference, _paybill_ref, auth.uid(), _actor_email, NEW.description,
    jsonb_build_object('entry_type', NEW.entry_type, 'source_kind', NEW.source_kind, 'currency', NEW.currency)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_corp_cash_ledger ON public.corporate_cash_ledger;
CREATE TRIGGER trg_audit_corp_cash_ledger
AFTER INSERT ON public.corporate_cash_ledger
FOR EACH ROW EXECUTE FUNCTION public.audit_corporate_cash_ledger_insert();

-- Audit every paybill proof status change
CREATE OR REPLACE FUNCTION public.audit_corporate_paybill_proof_review()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _actor_email TEXT;
  _paybill_ref TEXT;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF NEW.status NOT IN ('approved','rejected') THEN RETURN NEW; END IF;

  SELECT email INTO _actor_email FROM auth.users WHERE id = COALESCE(NEW.reviewed_by, auth.uid());
  SELECT paybill_reference INTO _paybill_ref FROM public.corporate_accounts WHERE id = NEW.corporate_id;

  INSERT INTO public.corporate_cash_ledger_audit (
    corporate_id, event_type, proof_id, amount_cents,
    reference, paybill_reference, actor_user_id, actor_email, notes, payload
  ) VALUES (
    NEW.corporate_id,
    CASE WHEN NEW.status = 'approved' THEN 'proof_approved' ELSE 'proof_rejected' END,
    NEW.id, NEW.amount_cents,
    NEW.mpesa_code, COALESCE(NEW.paybill_reference, _paybill_ref),
    COALESCE(NEW.reviewed_by, auth.uid()), _actor_email, NEW.review_notes,
    jsonb_build_object('payer_phone', NEW.payer_phone, 'paid_at', NEW.paid_at, 'proof_file_path', NEW.proof_file_path)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_corp_paybill_proof ON public.corporate_paybill_proofs;
CREATE TRIGGER trg_audit_corp_paybill_proof
AFTER UPDATE ON public.corporate_paybill_proofs
FOR EACH ROW EXECUTE FUNCTION public.audit_corporate_paybill_proof_review();

CREATE INDEX IF NOT EXISTS idx_ccla_corporate_created ON public.corporate_cash_ledger_audit(corporate_id, created_at DESC);
