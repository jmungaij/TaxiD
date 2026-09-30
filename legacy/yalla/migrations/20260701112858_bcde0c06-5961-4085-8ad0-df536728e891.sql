
CREATE TABLE IF NOT EXISTS public.payment_slos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_key text NOT NULL UNIQUE,
  name text NOT NULL,
  category text NOT NULL,
  description text,
  target_value numeric(14,4) NOT NULL,
  unit text NOT NULL DEFAULT 'percent',           -- 'percent' or 'ms'
  comparator text NOT NULL DEFAULT '>=',          -- '>=' or '<='
  window_minutes integer NOT NULL DEFAULT 60,
  metric_query text NOT NULL,
  severity text NOT NULL DEFAULT 'high',
  active boolean NOT NULL DEFAULT true,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.payment_slos TO authenticated;
GRANT ALL ON public.payment_slos TO service_role;
ALTER TABLE public.payment_slos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slos read finance/admin" ON public.payment_slos FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'finance_admin'::app_role]));
CREATE POLICY "slos write admin" ON public.payment_slos FOR ALL TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.payment_slo_measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_id uuid NOT NULL REFERENCES public.payment_slos(id) ON DELETE CASCADE,
  measured_at timestamptz NOT NULL DEFAULT now(),
  window_start timestamptz NOT NULL,
  window_end timestamptz NOT NULL,
  numerator bigint NOT NULL,
  denominator bigint NOT NULL,
  actual_value numeric(14,4) NOT NULL,
  target_value numeric(14,4) NOT NULL,
  compliant boolean NOT NULL,
  burn_rate numeric(10,3),
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_slo_meas_slo_time ON public.payment_slo_measurements (slo_id, measured_at DESC);
GRANT SELECT ON public.payment_slo_measurements TO authenticated;
GRANT ALL ON public.payment_slo_measurements TO service_role;
ALTER TABLE public.payment_slo_measurements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "slo meas read finance/admin" ON public.payment_slo_measurements FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'finance_admin'::app_role]));

CREATE TABLE IF NOT EXISTS public.payment_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slo_id uuid REFERENCES public.payment_slos(id) ON DELETE SET NULL,
  alert_key text NOT NULL,
  severity text NOT NULL DEFAULT 'high',
  status text NOT NULL DEFAULT 'FIRING' CHECK (status IN ('FIRING','ACKNOWLEDGED','RESOLVED')),
  title text NOT NULL,
  message text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  fired_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  resolved_at timestamptz,
  pagerduty_dedup_key text,
  pagerduty_delivered boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_alert_key_active
  ON public.payment_alerts (alert_key) WHERE status <> 'RESOLVED';
CREATE INDEX IF NOT EXISTS ix_pa_alerts_status ON public.payment_alerts (status, fired_at DESC);
GRANT SELECT, UPDATE ON public.payment_alerts TO authenticated;
GRANT ALL ON public.payment_alerts TO service_role;
ALTER TABLE public.payment_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "alerts read finance/admin" ON public.payment_alerts FOR SELECT TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'finance_admin'::app_role]));
CREATE POLICY "alerts ack finance/admin" ON public.payment_alerts FOR UPDATE TO authenticated
  USING (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'finance_admin'::app_role]))
  WITH CHECK (has_any_role(auth.uid(), ARRAY['admin'::app_role,'super_admin'::app_role,'finance_admin'::app_role]));

CREATE OR REPLACE FUNCTION public._touch_payment_alerts_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_pa_alerts_upd ON public.payment_alerts;
CREATE TRIGGER trg_pa_alerts_upd BEFORE UPDATE ON public.payment_alerts
  FOR EACH ROW EXECUTE FUNCTION public._touch_payment_alerts_updated_at();

CREATE OR REPLACE FUNCTION public._touch_payment_slos_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_pa_slos_upd ON public.payment_slos;
CREATE TRIGGER trg_pa_slos_upd BEFORE UPDATE ON public.payment_slos
  FOR EACH ROW EXECUTE FUNCTION public._touch_payment_slos_updated_at();

INSERT INTO public.payment_slos (slo_key, name, category, description, target_value, unit, comparator, window_minutes, metric_query, severity)
VALUES
  ('stk_push_success', 'STK Push success rate', 'availability',
   'Fraction of mpesa-stkpush calls returning 2xx over the window.',
   99.5000, 'percent', '>=', 60, 'edge_success_ratio:mpesa-stkpush', 'critical'),
  ('callback_latency_p95', 'Callback latency p95 < 5s', 'latency',
   'p95 latency_ms of mpesa-callback invocations.',
   5000.0000, 'ms', '<=', 60, 'edge_latency_p95:mpesa-callback', 'high'),
  ('reconciliation_match_rate', 'Wallet reconciliation match rate', 'correctness',
   'Fraction of COMPLETED payment_attempts with a matching wallet credit.',
   99.9000, 'percent', '>=', 240, 'payment_reconciliation_match_rate', 'critical'),
  ('fraud_false_positive_rate', 'Fraud false-positive rate < 5%', 'quality',
   'Fraction of BLOCK/CHALLENGE decisions later dismissed by an admin.',
   5.0000, 'percent', '<=', 1440, 'fraud_false_positive_rate', 'medium')
ON CONFLICT (slo_key) DO NOTHING;
