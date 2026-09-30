CREATE TABLE public.staff_live_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  event_key text NOT NULL,
  domain text NOT NULL DEFAULT 'unknown',
  source text NOT NULL,
  entity_type text,
  entity_id text,
  severity text NOT NULL DEFAULT 'info',
  magnitude numeric,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  signature_verified boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX staff_live_events_key_time_idx ON public.staff_live_events (event_key, occurred_at DESC);
CREATE INDEX staff_live_events_time_idx ON public.staff_live_events (occurred_at DESC);

GRANT SELECT ON public.staff_live_events TO authenticated;
GRANT ALL ON public.staff_live_events TO service_role;
ALTER TABLE public.staff_live_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_live_events_staff_read" ON public.staff_live_events
  FOR SELECT TO authenticated USING (public.is_staff_user());

CREATE OR REPLACE FUNCTION public.deny_staff_live_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'staff_live_events is append-only';
END;
$$;

CREATE TRIGGER staff_live_events_append_only
  BEFORE UPDATE OR DELETE ON public.staff_live_events
  FOR EACH ROW EXECUTE FUNCTION public.deny_staff_live_event_mutation();

CREATE TABLE public.staff_experiments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  domain text NOT NULL,
  hypothesis text NOT NULL,
  baseline text,
  control text,
  treatment text,
  measurement text,
  status text NOT NULL DEFAULT 'draft',
  decision text,
  measured_result text,
  expected_value text,
  owner_role text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE ON public.staff_experiments TO authenticated;
GRANT ALL ON public.staff_experiments TO service_role;
ALTER TABLE public.staff_experiments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_experiments_staff_read" ON public.staff_experiments
  FOR SELECT TO authenticated USING (public.is_staff_user());

CREATE POLICY "staff_experiments_staff_insert" ON public.staff_experiments
  FOR INSERT TO authenticated WITH CHECK (public.is_staff_user() AND created_by = auth.uid());

CREATE POLICY "staff_experiments_owner_update" ON public.staff_experiments
  FOR UPDATE TO authenticated USING (public.is_staff_user() AND created_by = auth.uid())
  WITH CHECK (public.is_staff_user() AND created_by = auth.uid());

CREATE TRIGGER staff_experiments_touch
  BEFORE UPDATE ON public.staff_experiments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();