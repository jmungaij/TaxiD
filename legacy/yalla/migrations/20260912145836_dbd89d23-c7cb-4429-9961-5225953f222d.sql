CREATE TABLE public.ai_answer_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asked_by uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  question text NOT NULL,
  intent text NOT NULL,
  domains text[] NOT NULL DEFAULT '{}',
  verdict text NOT NULL CHECK (verdict IN ('answered','qualified','insufficient_data','not_authorised')),
  gate_failures text[] NOT NULL DEFAULT '{}',
  data_quality numeric NOT NULL DEFAULT 0 CHECK (data_quality >= 0 AND data_quality <= 100),
  confidence numeric NOT NULL DEFAULT 0 CHECK (confidence >= 0 AND confidence <= 100),
  fact_count integer NOT NULL DEFAULT 0,
  estimate_count integer NOT NULL DEFAULT 0,
  prediction_count integer NOT NULL DEFAULT 0,
  recommendation_count integer NOT NULL DEFAULT 0,
  freshest_at timestamptz,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ai_answer_ledger_asked_by_idx ON public.ai_answer_ledger (asked_by, created_at DESC);

GRANT SELECT, INSERT ON public.ai_answer_ledger TO authenticated;
GRANT ALL ON public.ai_answer_ledger TO service_role;

ALTER TABLE public.ai_answer_ledger ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Employees record their own questions"
  ON public.ai_answer_ledger FOR INSERT TO authenticated
  WITH CHECK (asked_by = auth.uid());

CREATE POLICY "Employees read their own questions"
  ON public.ai_answer_ledger FOR SELECT TO authenticated
  USING (asked_by = auth.uid());

CREATE POLICY "Governance reads every question"
  ON public.ai_answer_ledger FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin') OR public.has_staff_permission('staff.compliance.read'));

COMMENT ON TABLE public.ai_answer_ledger IS 'Append-only audit trail of Ask Yalla answers and refusals. No UPDATE or DELETE policy exists by design.';