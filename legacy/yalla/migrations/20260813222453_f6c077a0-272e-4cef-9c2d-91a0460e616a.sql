-- ============================================================
-- 1. dispatch_rules — internal algorithm config, ops-only read
-- ============================================================
DROP POLICY IF EXISTS "rules read" ON public.dispatch_rules;

CREATE POLICY "rules read ops" ON public.dispatch_rules
FOR SELECT TO authenticated
USING (has_any_role(auth.uid(), ARRAY['admin','super_admin','operations_admin','dispatch_manager']::app_role[]));

-- ============================================================
-- 2. training question bank / answer keys — no direct read for test-takers
-- ============================================================
DROP POLICY IF EXISTS "tq_read" ON public.training_questions;
DROP POLICY IF EXISTS "ta_read" ON public.training_answers;
-- tq_admin / ta_admin (admin, super_admin, compliance_admin) remain for authoring.

-- Safe exam paper: prompt + options only. Never is_correct, never explanation.
CREATE OR REPLACE FUNCTION public.training_exam_paper(_assessment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _paper jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.training_assessments WHERE id = _assessment_id) THEN
    RAISE EXCEPTION 'Assessment not found';
  END IF;

  SELECT coalesce(jsonb_agg(q ORDER BY q->>'sort_order'), '[]'::jsonb) INTO _paper
  FROM (
    SELECT jsonb_build_object(
             'id', tq.id,
             'kind', tq.kind,
             'prompt', tq.prompt,
             'image_url', tq.image_url,
             'video_url', tq.video_url,
             'points', tq.points,
             'sort_order', tq.sort_order,
             'answers', (
               SELECT coalesce(jsonb_agg(jsonb_build_object(
                        'id', ta.id,
                        'question_id', ta.question_id,
                        'label', ta.label,
                        'sort_order', ta.sort_order
                      ) ORDER BY ta.sort_order, ta.id), '[]'::jsonb)
               FROM public.training_answers ta
               WHERE ta.question_id = tq.id
             )
           ) AS q
    FROM public.training_questions tq
    WHERE tq.assessment_id = _assessment_id
    ORDER BY tq.sort_order, tq.id
  ) s;

  RETURN _paper;
END $$;

REVOKE ALL ON FUNCTION public.training_exam_paper(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.training_exam_paper(uuid) TO authenticated;

-- ============================================================
-- 3. Fleet ownership scoping helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.owns_fleet(_fleet_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _fleet_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.fleets f
             WHERE f.id = _fleet_id AND f.owner_user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.fleet_companies c
                WHERE c.id = _fleet_id AND c.owner_user_id = auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_fleet_vehicle(_vehicle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _vehicle_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.vehicles v
             WHERE v.id = _vehicle_id AND v.owner_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.fleet_vehicles fv
                WHERE fv.vehicle_id = _vehicle_id AND public.owns_fleet(fv.fleet_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.owns_fleet_driver(_driver_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT _driver_id IS NOT NULL AND auth.uid() IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.fleet_drivers fd
             WHERE fd.driver_id = _driver_id AND public.owns_fleet(fd.fleet_id))
    OR EXISTS (SELECT 1 FROM public.driver_profiles_extended dpe
                WHERE dpe.driver_id = _driver_id AND public.owns_fleet(dpe.fleet_company_id))
    OR EXISTS (SELECT 1 FROM public.driver_vehicle_assignments dva
                JOIN public.vehicles v ON v.id = dva.vehicle_id
               WHERE dva.driver_id = _driver_id AND v.owner_id = auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.owns_fleet(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_fleet_vehicle(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owns_fleet_driver(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_fleet(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_fleet_vehicle(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owns_fleet_driver(uuid) TO authenticated;

-- ---------- driver-scoped surfaces ----------
DROP POLICY IF EXISTS "drivers_read" ON public.drivers;
CREATE POLICY "drivers_read" ON public.drivers
FOR SELECT TO authenticated
USING (
  user_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(id)
);

DROP POLICY IF EXISTS "dc_self" ON public.driver_compliance;
CREATE POLICY "dc_self" ON public.driver_compliance
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_compliance.driver_id AND d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
);

DROP POLICY IF EXISTS "ddm_read" ON public.driver_daily_metrics;
CREATE POLICY "ddm_read" ON public.driver_daily_metrics
FOR SELECT TO authenticated
USING (
  driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
);

DROP POLICY IF EXISTS "dpe_read" ON public.driver_profiles_extended;
CREATE POLICY "dpe_read" ON public.driver_profiles_extended
FOR SELECT TO authenticated
USING (
  driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
);

DROP POLICY IF EXISTS "dscore_read" ON public.driver_scores;
CREATE POLICY "dscore_read" ON public.driver_scores
FOR SELECT TO authenticated
USING (
  driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
);

DROP POLICY IF EXISTS "cact_read" ON public.compliance_actions;
CREATE POLICY "cact_read" ON public.compliance_actions
FOR SELECT TO authenticated
USING (
  driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "ca_read" ON public.compliance_alerts;
CREATE POLICY "ca_read" ON public.compliance_alerts
FOR SELECT TO authenticated
USING (
  driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
  OR public.owns_fleet_vehicle(vehicle_id)
);

-- ---------- vehicle-scoped surfaces ----------
DROP POLICY IF EXISTS "vehicles_read" ON public.vehicles;
CREATE POLICY "vehicles_read" ON public.vehicles
FOR SELECT TO authenticated
USING (
  owner_id = auth.uid()
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(id)
);

DROP POLICY IF EXISTS "vd_read" ON public.vehicle_documents;
CREATE POLICY "vd_read" ON public.vehicle_documents
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vi_read" ON public.vehicle_inspections;
CREATE POLICY "vi_read" ON public.vehicle_inspections
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vc_read" ON public.vehicle_compliance;
CREATE POLICY "vc_read" ON public.vehicle_compliance
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vce_read" ON public.vehicle_compliance_events;
CREATE POLICY "vce_read" ON public.vehicle_compliance_events
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vcost_read" ON public.vehicle_costs;
CREATE POLICY "vcost_read" ON public.vehicle_costs
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vm_read" ON public.vehicle_maintenance;
CREATE POLICY "vm_read" ON public.vehicle_maintenance
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vr_read" ON public.vehicle_repairs;
CREATE POLICY "vr_read" ON public.vehicle_repairs
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "vsr_read" ON public.vehicle_service_records;
CREATE POLICY "vsr_read" ON public.vehicle_service_records
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "va_read" ON public.vehicle_accidents;
CREATE POLICY "va_read" ON public.vehicle_accidents
FOR SELECT TO authenticated
USING (
  driver_id IN (SELECT d.id FROM public.drivers d WHERE d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_driver(driver_id)
  OR public.owns_fleet_vehicle(vehicle_id)
);

DROP POLICY IF EXISTS "dva_read" ON public.driver_vehicle_assignments;
CREATE POLICY "dva_read" ON public.driver_vehicle_assignments
FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.drivers d WHERE d.id = driver_vehicle_assignments.driver_id AND d.user_id = auth.uid())
  OR has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet_vehicle(vehicle_id)
  OR public.owns_fleet_driver(driver_id)
);

-- ---------- fleet-level aggregates ----------
DROP POLICY IF EXISTS "fleet comp read" ON public.fleet_compliance;
CREATE POLICY "fleet comp read" ON public.fleet_compliance
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','compliance_admin']::app_role[])
  OR public.owns_fleet(fleet_company_id)
);

DROP POLICY IF EXISTS "fleet perf read" ON public.fleet_performance;
CREATE POLICY "fleet perf read" ON public.fleet_performance
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
  OR public.owns_fleet(fleet_company_id)
);

DROP POLICY IF EXISTS "fleet rev read" ON public.fleet_revenue;
CREATE POLICY "fleet rev read" ON public.fleet_revenue
FOR SELECT TO authenticated
USING (
  has_any_role(auth.uid(), ARRAY['admin','super_admin','finance_admin']::app_role[])
  OR public.owns_fleet(fleet_company_id)
);