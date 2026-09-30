
-- =========================================================
-- finance_distribution_lists
-- =========================================================
CREATE TABLE public.finance_distribution_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT,
  severity_threshold TEXT NOT NULL DEFAULT 'LOW' CHECK (severity_threshold IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (department, email)
);
GRANT SELECT ON public.finance_distribution_lists TO authenticated;
GRANT ALL ON public.finance_distribution_lists TO service_role;
ALTER TABLE public.finance_distribution_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage distribution lists" ON public.finance_distribution_lists
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated read distribution lists" ON public.finance_distribution_lists
  FOR SELECT TO authenticated USING (active = true);

-- =========================================================
-- notification_templates
-- =========================================================
CREATE TABLE public.notification_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_code TEXT NOT NULL UNIQUE,
  subject TEXT NOT NULL,
  body_html TEXT NOT NULL,
  body_text TEXT NOT NULL,
  variables JSONB NOT NULL DEFAULT '[]'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT ON public.notification_templates TO authenticated;
GRANT ALL ON public.notification_templates TO service_role;
ALTER TABLE public.notification_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage notification templates" ON public.notification_templates
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Authenticated read active templates" ON public.notification_templates
  FOR SELECT TO authenticated USING (active = true);

-- =========================================================
-- wallet_freezes
-- =========================================================
CREATE TABLE public.wallet_freezes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_id UUID,
  corporate_id UUID REFERENCES public.corporate_accounts(id) ON DELETE CASCADE,
  reconciliation_id UUID REFERENCES public.corporate_financial_reconciliation(id) ON DELETE SET NULL,
  case_id UUID REFERENCES public.reconciliation_cases(id) ON DELETE SET NULL,
  reason TEXT NOT NULL,
  freeze_type TEXT NOT NULL DEFAULT 'WITHDRAWAL_ONLY' CHECK (freeze_type IN ('FULL','PARTIAL','WITHDRAWAL_ONLY','TOPUP_ONLY')),
  initiated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  initiated_by_system BOOLEAN NOT NULL DEFAULT false,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  released_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  release_reason TEXT
);
CREATE INDEX idx_wallet_freezes_corp_active ON public.wallet_freezes(corporate_id) WHERE active = true;
CREATE INDEX idx_wallet_freezes_created ON public.wallet_freezes(created_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.wallet_freezes TO authenticated;
GRANT ALL ON public.wallet_freezes TO service_role;
ALTER TABLE public.wallet_freezes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage wallet freezes" ON public.wallet_freezes
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Corporates view own freezes" ON public.wallet_freezes
  FOR SELECT TO authenticated USING (
    corporate_id IN (
      SELECT corporate_id FROM public.corporate_employees WHERE user_id = auth.uid()
    )
  );

-- =========================================================
-- reconciliation_evidence
-- =========================================================
CREATE TABLE public.reconciliation_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id UUID REFERENCES public.reconciliation_cases(id) ON DELETE SET NULL,
  reconciliation_id UUID REFERENCES public.corporate_financial_reconciliation(id) ON DELETE SET NULL,
  corporate_id UUID REFERENCES public.corporate_accounts(id) ON DELETE SET NULL,
  file_name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_type TEXT,
  mime_type TEXT,
  file_size BIGINT,
  uploaded_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_email TEXT,
  description TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  checksum TEXT,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_recon_evidence_case ON public.reconciliation_evidence(case_id, created_at DESC);
CREATE INDEX idx_recon_evidence_recon ON public.reconciliation_evidence(reconciliation_id);
CREATE INDEX idx_recon_evidence_corp ON public.reconciliation_evidence(corporate_id);
GRANT SELECT, INSERT, UPDATE ON public.reconciliation_evidence TO authenticated;
GRANT ALL ON public.reconciliation_evidence TO service_role;
ALTER TABLE public.reconciliation_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins full access evidence" ON public.reconciliation_evidence
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
CREATE POLICY "Corporates view own evidence" ON public.reconciliation_evidence
  FOR SELECT TO authenticated USING (
    corporate_id IN (
      SELECT corporate_id FROM public.corporate_employees WHERE user_id = auth.uid()
    )
  );
CREATE POLICY "Corporates upload own evidence" ON public.reconciliation_evidence
  FOR INSERT TO authenticated WITH CHECK (
    corporate_id IN (
      SELECT corporate_id FROM public.corporate_employees WHERE user_id = auth.uid()
    )
    AND uploaded_by = auth.uid()
  );

-- =========================================================
-- Auto-freeze trigger on FRAUD_ALERT
-- =========================================================
CREATE OR REPLACE FUNCTION public.auto_freeze_on_fraud_alert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing UUID;
  v_case_id UUID;
BEGIN
  IF NEW.reconciliation_status = 'FRAUD_ALERT'
     AND (OLD.reconciliation_status IS DISTINCT FROM 'FRAUD_ALERT')
     AND NEW.corporate_id IS NOT NULL THEN

    -- Skip if already actively frozen
    SELECT id INTO v_existing FROM public.wallet_freezes
    WHERE corporate_id = NEW.corporate_id AND active = true
    LIMIT 1;

    IF v_existing IS NULL THEN
      SELECT id INTO v_case_id FROM public.reconciliation_cases
      WHERE reconciliation_id = NEW.id LIMIT 1;

      INSERT INTO public.wallet_freezes (
        corporate_id, reconciliation_id, case_id, reason, freeze_type,
        initiated_by_system, active
      ) VALUES (
        NEW.corporate_id, NEW.id, v_case_id,
        COALESCE('Auto-freeze: ' || NEW.mismatch_reason, 'Auto-freeze: FRAUD_ALERT'),
        'WITHDRAWAL_ONLY', true, true
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_freeze_on_fraud_alert ON public.corporate_financial_reconciliation;
CREATE TRIGGER trg_auto_freeze_on_fraud_alert
AFTER INSERT OR UPDATE OF reconciliation_status ON public.corporate_financial_reconciliation
FOR EACH ROW EXECUTE FUNCTION public.auto_freeze_on_fraud_alert();

-- =========================================================
-- Realtime
-- =========================================================
ALTER TABLE public.corporate_financial_reconciliation REPLICA IDENTITY FULL;
ALTER TABLE public.reconciliation_cases REPLICA IDENTITY FULL;
ALTER TABLE public.reconciliation_case_activities REPLICA IDENTITY FULL;
ALTER TABLE public.wallet_freezes REPLICA IDENTITY FULL;
ALTER TABLE public.reconciliation_evidence REPLICA IDENTITY FULL;

DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables
   WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='corporate_financial_reconciliation';
  IF NOT FOUND THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.corporate_financial_reconciliation;
  END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='reconciliation_cases';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_cases; END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='reconciliation_case_activities';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_case_activities; END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='wallet_freezes';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_freezes; END IF;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM pg_publication_tables WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='reconciliation_evidence';
  IF NOT FOUND THEN ALTER PUBLICATION supabase_realtime ADD TABLE public.reconciliation_evidence; END IF;
END $$;

-- =========================================================
-- Seed distribution lists (placeholders — replace later)
-- =========================================================
INSERT INTO public.finance_distribution_lists (department, email, role, severity_threshold) VALUES
  ('finance',        'finance@yallabeena.info',    'Finance Team',       'LOW'),
  ('treasury',       'treasury@yallabeena.info',   'Treasury',           'MEDIUM'),
  ('compliance',     'compliance@yallabeena.info', 'Compliance',         'MEDIUM'),
  ('risk',           'risk@yallabeena.info',       'Risk',               'HIGH'),
  ('internal_audit', 'audit@yallabeena.info',      'Internal Audit',     'HIGH'),
  ('cfo',            'cfo@yallabeena.info',        'Chief Financial Officer', 'CRITICAL')
ON CONFLICT (department, email) DO NOTHING;

-- =========================================================
-- Seed notification templates
-- =========================================================
INSERT INTO public.notification_templates (template_code, subject, body_html, body_text, variables) VALUES
('reconciliation-success', '[RECONCILED] {{corp_reference}} Successfully Reconciled',
 '<p>Reconciliation completed for <strong>{{corp_reference}}</strong>.</p><p>Amount: KES {{amount}}</p>',
 'Reconciliation completed for {{corp_reference}}. Amount: KES {{amount}}',
 '["corp_reference","amount"]'::jsonb),
('mismatch-alert', '[MISMATCH] Immediate Review Required - {{corp_reference}}',
 '<p>Mismatch detected for <strong>{{corp_reference}}</strong>.</p><p>Reason: {{reason}}</p><p>Difference: KES {{difference}}</p>',
 'Mismatch detected for {{corp_reference}}. Reason: {{reason}}. Difference: KES {{difference}}',
 '["corp_reference","reason","difference"]'::jsonb),
('fraud-alert', '[FRAUD ALERT] {{reason}} - {{corp_reference}}',
 '<p style="color:#b00">URGENT FRAUD ALERT</p><p>Reference: <strong>{{corp_reference}}</strong></p><p>Reason: {{reason}}</p><p>M-Pesa: {{mpesa_receipt}}</p><p>Wallet automatically frozen pending investigation.</p>',
 'URGENT FRAUD ALERT - {{corp_reference}} - {{reason}} - M-Pesa {{mpesa_receipt}}. Wallet automatically frozen.',
 '["corp_reference","reason","mpesa_receipt"]'::jsonb),
('case-assigned', '[CASE] Assigned - {{case_number}}',
 '<p>Case <strong>{{case_number}}</strong> assigned to {{assignee}}.</p>',
 'Case {{case_number}} assigned to {{assignee}}.',
 '["case_number","assignee"]'::jsonb),
('case-escalated', '[ESCALATED] Reconciliation Case - {{case_number}}',
 '<p>Case <strong>{{case_number}}</strong> escalated to level {{level}}.</p>',
 'Case {{case_number}} escalated to level {{level}}.',
 '["case_number","level"]'::jsonb),
('case-resolved', '[RESOLVED] Case {{case_number}}',
 '<p>Case <strong>{{case_number}}</strong> resolved.</p><p>{{notes}}</p>',
 'Case {{case_number}} resolved. {{notes}}',
 '["case_number","notes"]'::jsonb),
('wallet-frozen', '[WALLET FROZEN] {{corp_reference}}',
 '<p>Wallet for <strong>{{corp_reference}}</strong> has been frozen.</p><p>Type: {{freeze_type}}</p><p>Reason: {{reason}}</p>',
 'Wallet for {{corp_reference}} frozen. Type: {{freeze_type}}. Reason: {{reason}}',
 '["corp_reference","freeze_type","reason"]'::jsonb),
('wallet-unfrozen', '[WALLET RELEASED] {{corp_reference}}',
 '<p>Wallet for <strong>{{corp_reference}}</strong> has been released.</p>',
 'Wallet for {{corp_reference}} released.',
 '["corp_reference"]'::jsonb)
ON CONFLICT (template_code) DO NOTHING;
