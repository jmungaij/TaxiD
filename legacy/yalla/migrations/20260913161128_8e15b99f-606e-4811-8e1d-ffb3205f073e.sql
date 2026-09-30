-- Release-gate grouping over the existing rental control register.
CREATE TABLE IF NOT EXISTS public.rental_release_gates (
  gate_code text PRIMARY KEY,
  label text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  description text
);
GRANT SELECT ON public.rental_release_gates TO authenticated;
GRANT ALL ON public.rental_release_gates TO service_role;
ALTER TABLE public.rental_release_gates ENABLE ROW LEVEL SECURITY;
CREATE POLICY rental_release_gates_staff_read ON public.rental_release_gates
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

CREATE TABLE IF NOT EXISTS public.rental_gate_controls (
  gate_code text NOT NULL REFERENCES public.rental_release_gates(gate_code) ON DELETE CASCADE,
  control_code text NOT NULL REFERENCES public.rental_controls(control_code) ON DELETE CASCADE,
  PRIMARY KEY (gate_code, control_code)
);
GRANT SELECT ON public.rental_gate_controls TO authenticated;
GRANT ALL ON public.rental_gate_controls TO service_role;
ALTER TABLE public.rental_gate_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY rental_gate_controls_staff_read ON public.rental_gate_controls
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read') OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

INSERT INTO public.rental_release_gates (gate_code, label, sort_order, description) VALUES
  ('G1_INTEGRITY','State integrity',10,'The database refuses every illegal state change.'),
  ('G2_INVENTORY','Inventory truth',20,'One vehicle can never be promised twice.'),
  ('G3_ORCHESTRATION','Orchestration and retries',30,'Retried operations replay instead of duplicating.'),
  ('G4_MONEY','Money control',40,'Ledger, settlement and reconciliation are provably correct.'),
  ('G5_SECURITY','Access isolation',50,'No customer or tenant can read another one''s rental data.'),
  ('G6_FULFILMENT','Fulfilment evidence',60,'Pickup and return are evidenced and immutable.'),
  ('G7_POLICY','Policy completeness',70,'No undecided rule sits in a live path.'),
  ('G8_FLEET','Fleet readiness',80,'At least one vehicle has passed its readiness audit.'),
  ('G9_RESILIENCE','Resilience and recovery',90,'Latency, failure injection, backup and restore are proven.'),
  ('G10_NOTIFICATION','Customer communication',100,'Booking notifications are proven end to end.')
ON CONFLICT (gate_code) DO UPDATE SET label = EXCLUDED.label, sort_order = EXCLUDED.sort_order, description = EXCLUDED.description;

INSERT INTO public.rental_gate_controls (gate_code, control_code) VALUES
  ('G1_INTEGRITY','RN-01'),
  ('G2_INVENTORY','RN-02'), ('G2_INVENTORY','RN-03'),
  ('G3_ORCHESTRATION','RN-04'),
  ('G4_MONEY','RN-05'), ('G4_MONEY','RN-06'), ('G4_MONEY','RN-08'), ('G4_MONEY','RN-10'),
  ('G5_SECURITY','RN-09'),
  ('G6_FULFILMENT','RN-07'),
  ('G7_POLICY','RN-12'),
  ('G8_FLEET','RN-11'), ('G8_FLEET','RN-15'),
  ('G9_RESILIENCE','RN-13'), ('G9_RESILIENCE','RN-14'), ('G9_RESILIENCE','RN-17'),
  ('G10_NOTIFICATION','RN-16')
ON CONFLICT DO NOTHING;

-- Gate roll-up. A gate is only PASS when every control under it is PASS.
CREATE OR REPLACE VIEW public.v_rental_release_gates AS
SELECT g.gate_code,
       g.label,
       g.sort_order,
       g.description,
       count(c.control_code) AS controls,
       count(*) FILTER (WHERE c.verdict = 'PASS') AS passed,
       count(*) FILTER (WHERE c.verdict = 'FAIL') AS failed,
       count(*) FILTER (WHERE c.verdict = 'PARTIAL') AS partial,
       count(*) FILTER (WHERE c.verdict = 'BLOCKED') AS blocked,
       count(*) FILTER (WHERE c.verdict = 'NOT_TESTED') AS not_tested,
       count(*) FILTER (WHERE c.verdict = 'REQUIRES_EXTERNAL_ACTION') AS requires_external_action,
       CASE
         WHEN count(*) FILTER (WHERE c.verdict = 'FAIL') > 0 THEN 'FAILED'
         WHEN count(*) FILTER (WHERE c.verdict = 'PASS') = count(c.control_code) THEN 'PASS'
         WHEN count(*) FILTER (WHERE c.verdict = 'BLOCKED') > 0 THEN 'BLOCKED'
         WHEN count(*) FILTER (WHERE c.verdict = 'REQUIRES_EXTERNAL_ACTION') > 0 THEN 'REQUIRES_EXTERNAL_ACTION'
         ELSE 'INCOMPLETE'
       END AS gate_status,
       array_remove(array_agg(DISTINCT c.control_code) FILTER (WHERE c.verdict <> 'PASS'), NULL) AS outstanding_controls,
       array_remove(array_agg(DISTINCT c.blocked_reason) FILTER (WHERE c.blocked_reason IS NOT NULL), NULL) AS reasons
FROM public.rental_release_gates g
JOIN public.rental_gate_controls gc ON gc.gate_code = g.gate_code
JOIN public.v_rental_certification c ON c.control_code = gc.control_code
GROUP BY g.gate_code, g.label, g.sort_order, g.description;
GRANT SELECT ON public.v_rental_release_gates TO authenticated, service_role;

-- Business decisions the owner still has to make, and the gate each one holds.
CREATE OR REPLACE VIEW public.v_rental_business_decisions AS
SELECT p.policy_code,
       p.label,
       p.evaluation_point,
       p.state,
       p.owner_decision,
       p.note,
       'G7_POLICY'::text AS blocks_gate,
       'RN-12'::text AS blocks_control
FROM public.rental_policies p
WHERE p.state <> 'ACTIVE';
GRANT SELECT ON public.v_rental_business_decisions TO authenticated, service_role;

-- Evidence that cannot be produced inside the application.
CREATE OR REPLACE VIEW public.v_rental_external_evidence AS
SELECT c.control_code,
       c.title,
       c.severity,
       c.evidence_kind,
       c.verdict,
       c.blocked_reason,
       CASE
         WHEN c.evidence_kind = 'ISOLATED_CONCURRENCY_PROBE' THEN 'Isolated database with two concurrent sessions'
         WHEN c.evidence_kind = 'RESTORE_EVIDENCE' THEN 'Real backup restore on isolated infrastructure'
         WHEN c.evidence_kind = 'ROLE_SESSION_PROBE' THEN 'Real anonymous, rider, provider and staff sessions'
         WHEN c.evidence_kind = 'STAGING_E2E' THEN 'End-to-end run on real staging infrastructure'
         ELSE 'External or staged evidence'
       END AS evidence_source
FROM public.v_rental_certification c
WHERE c.verdict IN ('BLOCKED','REQUIRES_EXTERNAL_ACTION','NOT_TESTED')
  AND c.evidence_kind <> 'EXECUTED_DB_PROBE';
GRANT SELECT ON public.v_rental_external_evidence TO authenticated, service_role;

-- Self-consistency guard: the verdict buckets must always add up to the control count,
-- and every control must belong to exactly one release gate.
CREATE OR REPLACE FUNCTION public.rental_certification_consistency()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH s AS (SELECT * FROM public.v_rental_certification_summary),
  gated AS (SELECT count(DISTINCT control_code) AS n FROM public.rental_gate_controls),
  total AS (SELECT count(*) AS n FROM public.rental_controls)
  SELECT jsonb_build_object(
    'controls', s.controls,
    'verdict_sum', s.passed + s.failed + s.partial + s.blocked + s.not_tested + s.requires_external_action,
    'verdicts_add_up', s.controls = (s.passed + s.failed + s.partial + s.blocked + s.not_tested + s.requires_external_action),
    'controls_total', total.n,
    'controls_in_a_gate', gated.n,
    'every_control_gated', gated.n = total.n,
    'certification', s.certification,
    'consistent', s.controls = (s.passed + s.failed + s.partial + s.blocked + s.not_tested + s.requires_external_action)
                  AND gated.n = total.n
  )
  FROM s, gated, total;
$$;
REVOKE ALL ON FUNCTION public.rental_certification_consistency() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_certification_consistency() TO authenticated, service_role;