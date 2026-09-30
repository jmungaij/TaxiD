
-- Immutability for package_events and proof_of_delivery: block UPDATE/DELETE.
CREATE OR REPLACE FUNCTION public.tg_block_mutation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION '% on %.% is not allowed: records are immutable', TG_OP, TG_TABLE_SCHEMA, TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS package_events_no_update ON public.package_events;
DROP TRIGGER IF EXISTS package_events_no_delete ON public.package_events;
CREATE TRIGGER package_events_no_update BEFORE UPDATE ON public.package_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_mutation();
CREATE TRIGGER package_events_no_delete BEFORE DELETE ON public.package_events
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_mutation();

DROP TRIGGER IF EXISTS pod_no_update ON public.proof_of_delivery;
DROP TRIGGER IF EXISTS pod_no_delete ON public.proof_of_delivery;
CREATE TRIGGER pod_no_update BEFORE UPDATE ON public.proof_of_delivery
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_mutation();
CREATE TRIGGER pod_no_delete BEFORE DELETE ON public.proof_of_delivery
  FOR EACH ROW EXECUTE FUNCTION public.tg_block_mutation();

-- Helpful indexes for the operations console.
CREATE INDEX IF NOT EXISTS idx_package_events_pkg_time ON public.package_events(package_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_packages_status ON public.packages(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dispatch_jobs_status ON public.delivery_dispatch_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_candidates_job_score ON public.delivery_driver_candidates(job_id, score DESC);
CREATE INDEX IF NOT EXISTS idx_route_segments_job_index ON public.delivery_route_segments(job_id, segment_index);
CREATE INDEX IF NOT EXISTS idx_eta_predictions_pkg_time ON public.delivery_eta_predictions(package_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_package_tracking_pkg_time ON public.package_tracking(package_id, recorded_at DESC);
