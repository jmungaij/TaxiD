
CREATE TYPE public.regulator AS ENUM ('KRA','CBK','INTERNAL_AUDIT','EXTERNAL_AUDIT','CORPORATE_CLIENT','OTHER');
CREATE TYPE public.reg_report_kind AS ENUM ('VAT','WHT','REVENUE','DRIVER_EARNINGS','CORPORATE_SPEND','SETTLEMENT','AUDIT','CUSTOM');
CREATE TYPE public.reg_export_format AS ENUM ('CSV','JSON','PDF','XML','XBRL');
CREATE TYPE public.reg_submission_status AS ENUM ('DRAFT','SUBMITTED','ACKNOWLEDGED','REJECTED');

CREATE TABLE public.regulatory_reports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        public.reg_report_kind NOT NULL,
  name        text NOT NULL,
  regulator   public.regulator NOT NULL,
  jurisdiction text NOT NULL DEFAULT 'KE',
  cadence     text NOT NULL DEFAULT 'monthly',     -- monthly|quarterly|annual|adhoc
  definition  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- SQL or rules
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.regulatory_reports TO authenticated;
GRANT ALL ON public.regulatory_reports TO service_role;
ALTER TABLE public.regulatory_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_reports FORCE ROW LEVEL SECURITY;
CREATE POLICY "regrep_finance_read" ON public.regulatory_reports FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE POLICY "regrep_admin_manage" ON public.regulatory_reports FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TRIGGER trg_regrep_updated_at BEFORE UPDATE ON public.regulatory_reports
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed canonical reports
INSERT INTO public.regulatory_reports (kind, name, regulator, jurisdiction, cadence) VALUES
('VAT','KRA VAT Return','KRA','KE','monthly'),
('WHT','KRA Withholding Tax','KRA','KE','monthly'),
('REVENUE','Platform Revenue','INTERNAL_AUDIT','KE','monthly'),
('DRIVER_EARNINGS','Driver Earnings Summary','INTERNAL_AUDIT','KE','monthly'),
('CORPORATE_SPEND','Corporate Spend Statement','CORPORATE_CLIENT','KE','monthly'),
('SETTLEMENT','M-Pesa Settlement Reconciliation','CBK','KE','monthly'),
('AUDIT','Annual Financial Audit Pack','EXTERNAL_AUDIT','KE','annual');

CREATE TABLE public.regulatory_exports (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   uuid NOT NULL REFERENCES public.regulatory_reports(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end   date NOT NULL,
  format      public.reg_export_format NOT NULL DEFAULT 'CSV',
  file_path   text,           -- storage bucket path
  sha256      text,
  totals      jsonb NOT NULL DEFAULT '{}'::jsonb,
  generated_at timestamptz NOT NULL DEFAULT now(),
  generated_by uuid,
  signature_id uuid REFERENCES public.digital_signatures(id),
  UNIQUE (report_id, period_start, period_end, format)
);
CREATE INDEX idx_reg_exports_period ON public.regulatory_exports(report_id, period_end DESC);
GRANT SELECT, INSERT ON public.regulatory_exports TO authenticated;
GRANT ALL ON public.regulatory_exports TO service_role;
ALTER TABLE public.regulatory_exports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_exports FORCE ROW LEVEL SECURITY;
CREATE POLICY "regexp_finance" ON public.regulatory_exports FOR SELECT TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));

CREATE TABLE public.regulatory_submissions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  export_id   uuid NOT NULL REFERENCES public.regulatory_exports(id) ON DELETE CASCADE,
  regulator   public.regulator NOT NULL,
  submitted_at timestamptz,
  submitted_by uuid,
  acknowledgement_ref text,
  status      public.reg_submission_status NOT NULL DEFAULT 'DRAFT',
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.regulatory_submissions TO authenticated;
GRANT ALL ON public.regulatory_submissions TO service_role;
ALTER TABLE public.regulatory_submissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regulatory_submissions FORCE ROW LEVEL SECURITY;
CREATE POLICY "regsub_finance" ON public.regulatory_submissions FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]));
CREATE TRIGGER trg_regsub_updated_at BEFORE UPDATE ON public.regulatory_submissions
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- VAT report aggregation RPC: sums posted credits to VAT Payable in period
CREATE OR REPLACE FUNCTION public.generate_vat_report(_period_start date, _period_end date)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _data jsonb;
BEGIN
  IF NOT public.has_any_role(auth.uid(), ARRAY['admin','finance_admin','super_admin']::app_role[]) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  SELECT jsonb_build_object(
    'period_start', _period_start, 'period_end', _period_end,
    'vat_collected_cents',
      COALESCE(sum(CASE WHEN e.direction='CREDIT' THEN e.amount_cents ELSE -e.amount_cents END),0),
    'currency','KES',
    'entry_count', count(*)
  ) INTO _data
  FROM public.ledger_entries e
  JOIN public.journals j ON j.id=e.journal_id AND j.status='POSTED'
  JOIN public.ledger_accounts la ON la.id=e.account_id
  WHERE la.coa_code='2210'
    AND e.created_at::date BETWEEN _period_start AND _period_end;
  RETURN _data;
END $$;
GRANT EXECUTE ON FUNCTION public.generate_vat_report(date, date) TO authenticated, service_role;
