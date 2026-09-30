CREATE TABLE public.staff_intelligence_metrics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_label text NOT NULL DEFAULT 'staff360-intelligence-v1',
  surface text NOT NULL,
  entity_key text NOT NULL DEFAULT 'global',
  metric_key text NOT NULL,
  metric_label text NOT NULL,
  value_text text NOT NULL,
  unit text,
  source text NOT NULL,
  state text NOT NULL DEFAULT 'modelled',
  hint text,
  period_start date,
  period_end date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_intelligence_metrics_state_chk CHECK (state IN ('live','modelled')),
  CONSTRAINT staff_intelligence_metrics_unique UNIQUE (batch_label, surface, entity_key, metric_key)
);

CREATE TABLE public.staff_attention_signals (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  batch_label text NOT NULL DEFAULT 'staff360-intelligence-v1',
  domain text NOT NULL,
  severity text NOT NULL DEFAULT 'watch',
  title text NOT NULL,
  why text NOT NULL,
  evidence text[] NOT NULL DEFAULT '{}',
  confidence numeric(4,3) NOT NULL,
  expected_impact text NOT NULL,
  recommended_action text NOT NULL,
  owner text NOT NULL,
  source text NOT NULL,
  state text NOT NULL DEFAULT 'modelled',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_attention_signals_severity_chk CHECK (severity IN ('info','watch','critical')),
  CONSTRAINT staff_attention_signals_state_chk CHECK (state IN ('live','modelled')),
  CONSTRAINT staff_attention_signals_conf_chk CHECK (confidence >= 0 AND confidence <= 1)
);

GRANT SELECT ON public.staff_intelligence_metrics TO authenticated;
GRANT SELECT ON public.staff_attention_signals TO authenticated;
GRANT ALL ON public.staff_intelligence_metrics TO service_role;
GRANT ALL ON public.staff_attention_signals TO service_role;

ALTER TABLE public.staff_intelligence_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.staff_attention_signals ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_staff_portal_member(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin','super_admin','finance_admin','operations_admin','compliance_admin','pricing_manager','dispatch_manager','corporate_manager')
  )
$$;

CREATE POLICY "Staff can read seeded intelligence metrics"
  ON public.staff_intelligence_metrics FOR SELECT TO authenticated
  USING (public.is_staff_portal_member(auth.uid()));

CREATE POLICY "Staff can read seeded attention signals"
  ON public.staff_attention_signals FOR SELECT TO authenticated
  USING (public.is_staff_portal_member(auth.uid()));

CREATE TRIGGER staff_intelligence_metrics_touch
  BEFORE UPDATE ON public.staff_intelligence_metrics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER staff_attention_signals_touch
  BEFORE UPDATE ON public.staff_attention_signals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ---------------------------------------------------------------- seed data
INSERT INTO public.staff_intelligence_metrics (surface, entity_key, metric_key, metric_label, value_text, unit, source, hint, period_start, period_end) VALUES
  ('impact','global','customers','Customers','1 284','accounts influenced','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','revenue','Revenue','KES 41.6M','recognised in scope','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','marketplace','Marketplace','92.4%','match rate contribution','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','service_quality','Service quality','4.72 / 5','customer rating','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','efficiency','Efficiency','-18.3%','cost per completed job','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','innovation','Innovation','6','experiments contributed','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','risk_reduction','Risk reduction','23','exceptions prevented','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),
  ('impact','global','retention','Retention','96.1%','accounts retained','seed batch staff360-intelligence-v1','Seeded contribution measure linked to your position.',date_trunc('month', now())::date - 90, CURRENT_DATE),

  ('marketplace','global','match_rate','Match rate','92.4%','matched / qualified demand','seed batch staff360-intelligence-v1',NULL,date_trunc('month', now())::date - 30, CURRENT_DATE),
  ('marketplace','global','unmet_demand','Unmet demand','7.6%','unmatched qualified demand','seed batch staff360-intelligence-v1',NULL,date_trunc('month', now())::date - 30, CURRENT_DATE),
  ('marketplace','global','verified_supply','Verified supply availability','1 862','compliance-verified participants','seed batch staff360-intelligence-v1',NULL,date_trunc('month', now())::date - 30, CURRENT_DATE),
  ('marketplace','global','time_to_match','Time to match','3 m 41 s','median','seed batch staff360-intelligence-v1',NULL,date_trunc('month', now())::date - 30, CURRENT_DATE),

  ('innovation','global','ideas_submitted','Ideas submitted','74','ideas','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('innovation','global','in_experiment','In experiment','11','initiatives','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('innovation','global','in_pilot','In pilot','5','initiatives','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('innovation','global','scaled','Scaled','3','initiatives','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),

  ('customer_segment','individual','accounts','Accounts in scope','38 412','riders','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','individual','ltv','Lifetime value','KES 34 800','median 12-month LTV','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','corporate','accounts','Accounts in scope','214','corporate accounts','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','corporate','ltv','Lifetime value','KES 6.4M','median contract LTV','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','business_logistics','accounts','Accounts in scope','126','shippers','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','business_logistics','ltv','Lifetime value','KES 2.1M','median 12-month LTV','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','rental_leasing','accounts','Accounts in scope','89','rental & lease customers','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','rental_leasing','ltv','Lifetime value','KES 3.8M','median lease LTV','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','charter_travel','accounts','Accounts in scope','57','charter clients','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('customer_segment','charter_travel','ltv','Lifetime value','KES 1.9M','median 12-month LTV','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),

  ('revenue_category','mobility_transaction','recognised','Recognised revenue','KES 128.4M','trailing 12 months','seed batch staff360-intelligence-v1','Rule source read from configured platform pricing.',date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','marketplace_fees','recognised','Recognised revenue','KES 46.2M','trailing 12 months','seed batch staff360-intelligence-v1','Rule source read from configurable fee definitions.',date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','corporate_mobility','recognised','Recognised revenue','KES 91.7M','trailing 12 months','seed batch staff360-intelligence-v1','Rule source read from commercial agreements.',date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','delivery_logistics','recognised','Recognised revenue','KES 37.9M','trailing 12 months','seed batch staff360-intelligence-v1','Rule source read from configured platform pricing.',date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','rental','recognised','Recognised revenue','KES 28.3M','trailing 12 months','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','leasing','recognised','Recognised revenue','KES 52.6M','trailing 12 months','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','charter','recognised','Recognised revenue','KES 19.4M','trailing 12 months','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','service_management','recognised','Recognised revenue','KES 8.7M','trailing 12 months','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','corporate_account','recognised','Recognised revenue','KES 12.1M','trailing 12 months','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),
  ('revenue_category','partner_economics','recognised','Recognised revenue','KES 6.5M','trailing 12 months','seed batch staff360-intelligence-v1',NULL,date_trunc('year', now())::date, CURRENT_DATE),

  ('attention','People','signals','Attention signals','3','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Customers','signals','Attention signals','4','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Marketplace','signals','Attention signals','5','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Revenue','signals','Attention signals','4','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Operations','signals','Attention signals','3','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Technology','signals','Attention signals','2','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Risk','signals','Attention signals','3','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE),
  ('attention','Innovation','signals','Attention signals','2','open signals','seed batch staff360-intelligence-v1',NULL,NULL,CURRENT_DATE);

INSERT INTO public.staff_intelligence_metrics (surface, entity_key, metric_key, metric_label, value_text, unit, source, period_start, period_end)
SELECT 'department', d.slug, m.key, m.label,
  CASE m.key
    WHEN 'outcomes_delivered' THEN (40 + (abs(hashtext(d.slug)) % 160))::text
    WHEN 'cycle_time' THEN round(1.5 + (abs(hashtext(d.slug || 'c')) % 90) / 10.0, 1)::text || ' days'
    WHEN 'quality' THEN round(88 + (abs(hashtext(d.slug || 'q')) % 110) / 10.0, 1)::text || '%'
    ELSE 'KES ' || round(4 + (abs(hashtext(d.slug || 'r')) % 860) / 10.0, 1)::text || 'M'
  END,
  CASE m.key
    WHEN 'outcomes_delivered' THEN 'completed outcomes'
    WHEN 'cycle_time' THEN 'median'
    WHEN 'quality' THEN 'first-time-right'
    ELSE 'trailing 12 months'
  END,
  'seed batch staff360-intelligence-v1',
  date_trunc('year', now())::date, CURRENT_DATE
FROM (VALUES
  ('executive-office'),('sales-revenue-operations'),('marketing-growth'),('customer-experience'),
  ('marketplace-partner-success'),('corporate-mobility'),('mobility-operations'),('delivery-logistics'),
  ('rentals-leasing'),('charter-travel'),('finance-revenue-assurance'),('risk-trust-safety'),
  ('legal-compliance'),('procurement-partnerships'),('technology-product'),('data-ai'),
  ('people-culture-organisation'),('corporate-administration')
) AS d(slug)
CROSS JOIN (VALUES
  ('outcomes_delivered','Outcomes delivered'),
  ('cycle_time','Cycle time'),
  ('quality','Quality'),
  ('revenue_contribution','Contribution to revenue')
) AS m(key,label);

INSERT INTO public.staff_attention_signals (domain, severity, title, why, evidence, confidence, expected_impact, recommended_action, owner, source) VALUES
  ('Revenue','critical','Corporate revenue concentration above tolerance','The five largest corporate accounts represent 41% of recognised corporate mobility revenue over the trailing twelve months, above the 30% board tolerance.',ARRAY['Recognised revenue by account (seeded)','Corporate account register (seeded)','Trailing 12-month window'],0.860,'Reduces single-account exposure worth KES 37.6M','Open two mid-market corporate pipelines per region this quarter','Sales & Revenue Operations','seed batch staff360-intelligence-v1'),
  ('Revenue','watch','Collections ageing on managed mobility programmes','KES 8.9M of issued corporate invoices sit beyond 45 days against 30-day configured payment terms.',ARRAY['Invoice ageing buckets (seeded)','Configured payment terms per account'],0.910,'Recovers KES 8.9M of working capital','Escalate the six oldest accounts to the finance collections queue','Finance & Revenue Assurance','seed batch staff360-intelligence-v1'),
  ('Marketplace','critical','Evening liquidity gap in Nairobi west corridor','Match rate falls to 78% between 17:00 and 20:00 in the western supply cells while qualified demand rises 22%.',ARRAY['Match rate by cell and time band (seeded)','Verified supply availability (seeded)'],0.880,'Recovers approximately 640 unmatched trips per week','Run a targeted supply incentive for verified operators in the affected cells','Marketplace & Partner Success','seed batch staff360-intelligence-v1'),
  ('Marketplace','watch','Partner quality drift among three operators','Three operators show rising cancellation and late-arrival rates against their service commitments.',ARRAY['Operator SLA outcomes (seeded)','Cancellation reasons (seeded)'],0.790,'Protects service quality on 4% of matched demand','Place the three operators on a 30-day performance review','Marketplace & Partner Success','seed batch staff360-intelligence-v1'),
  ('Customers','critical','Retention risk in the corporate SME cohort','Eleven SME accounts reduced monthly trip volume by more than 35% for two consecutive months without a stated reason.',ARRAY['Account trip volume trend (seeded)','Support case history (seeded)'],0.840,'Protects KES 14.2M of annualised revenue','Assign proactive save actions with the account command centre playbook','Customer Experience & Success','seed batch staff360-intelligence-v1'),
  ('Customers','watch','Service recovery backlog above SLA','Twenty-two service recovery cases exceed their first-response commitment.',ARRAY['Case ageing (seeded)','Configured SLA targets'],0.930,'Restores first-response compliance to target','Rebalance the recovery queue across the customer operations pod','Customer Experience & Success','seed batch staff360-intelligence-v1'),
  ('People','watch','Capability constraint in dispatch operations','Demand for verified dispatch capability exceeds assessed capability at level three and above by four positions.',ARRAY['Capability requirements per position (seeded)','Assessed employee capability (seeded)'],0.810,'Removes a constraint on evening dispatch coverage','Open two internal academy cohorts and one external hire requisition','People, Culture & Organisation','seed batch staff360-intelligence-v1'),
  ('People','info','Succession gap on two critical positions','Two critical positions have no assessed ready-now successor.',ARRAY['Position criticality register (seeded)','Successor readiness assessments (seeded)'],0.770,'Reduces key-person risk on two critical roles','Nominate and assess successors within the quarter','People, Culture & Organisation','seed batch staff360-intelligence-v1'),
  ('Operations','watch','Exception volume rising on airport transfers','Airport transfer exceptions rose 19% week on week, concentrated in meet-and-greet handovers.',ARRAY['Exception records by service (seeded)','Handover timestamps (seeded)'],0.870,'Improves on-time performance on the highest-value ride type','Deploy the revised handover checklist at the two busiest terminals','Mobility Operations & Orchestration','seed batch staff360-intelligence-v1'),
  ('Technology','info','Payment callback latency trending up','Median M-Pesa callback confirmation time rose from 4.1s to 7.8s over fourteen days.',ARRAY['Callback latency series (seeded)','Payment attempt outcomes (seeded)'],0.820,'Protects wallet funding completion rate','Review callback processing concurrency before the next demand peak','Technology & Product','seed batch staff360-intelligence-v1'),
  ('Risk','critical','Document expiry cluster across verified supply','Forty-one compliance documents across verified operators expire within thirty days.',ARRAY['Document expiry register (seeded)','Operator verification status (seeded)'],0.950,'Prevents removal of 41 participants from verified supply','Trigger the expiry notification campaign and reverification queue','Risk, Trust & Safety','seed batch staff360-intelligence-v1'),
  ('Innovation','info','Scheduled commuter pilot ready for scale decision','The scheduled commuter pilot met both its liquidity and unit-economics exit criteria for three consecutive weeks.',ARRAY['Pilot exit criteria (seeded)','Unit economics per trip (seeded)'],0.800,'Opens a new recurring demand category','Take the scale-or-stop decision to the investment forum','Innovation Lab','seed batch staff360-intelligence-v1');