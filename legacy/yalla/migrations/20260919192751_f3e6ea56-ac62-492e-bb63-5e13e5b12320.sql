-- ===========================================================================
-- COMMERCIAL INTELLIGENCE SPINE
-- Upgrade-only foundation for the Staff 360 intelligence layer:
--   1. opportunity change log  (what changed, trigger-written, append-only)
--   2. signal register         (one universal signal model, lifecycle-tracked)
--   3. deal stakeholders       (buying committee roles per opportunity)
--   4. record labels           (personal, filterable)
--   5. whitespace decisions    (expansion suggestion accepted / dismissed)
-- No existing table is altered in behaviour; nothing is removed.
-- ===========================================================================

-- ---------------------------------------------------------------- 1. changes
CREATE TABLE public.commercial_opportunity_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.commercial_opportunities(id) ON DELETE CASCADE,
  field text NOT NULL,
  old_value text,
  new_value text,
  delta_cents bigint,
  changed_by uuid,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_coc_opportunity_changed ON public.commercial_opportunity_changes (opportunity_id, changed_at DESC);
CREATE INDEX idx_coc_changed_at ON public.commercial_opportunity_changes (changed_at DESC);

GRANT SELECT ON public.commercial_opportunity_changes TO authenticated;
GRANT ALL ON public.commercial_opportunity_changes TO service_role;
ALTER TABLE public.commercial_opportunity_changes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read opportunity changes"
  ON public.commercial_opportunity_changes FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "service role writes opportunity changes"
  ON public.commercial_opportunity_changes FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.commercial_opportunity_changes IS
  'Append-only field-level change log for commercial opportunities. Written only by the _commercial_opportunity_change_log trigger; no client may insert, update or delete.';

CREATE OR REPLACE FUNCTION public._commercial_opportunity_changes_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'commercial_opportunity_changes is append-only';
END;
$$;

CREATE TRIGGER commercial_opportunity_changes_no_mutation
  BEFORE UPDATE OR DELETE ON public.commercial_opportunity_changes
  FOR EACH ROW EXECUTE FUNCTION public._commercial_opportunity_changes_append_only();

CREATE OR REPLACE FUNCTION public._commercial_opportunity_change_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
BEGIN
  IF NEW.stage IS DISTINCT FROM OLD.stage THEN
    INSERT INTO public.commercial_opportunity_changes (opportunity_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'stage', OLD.stage, NEW.stage, v_actor);
  END IF;

  IF NEW.expected_value_cents IS DISTINCT FROM OLD.expected_value_cents THEN
    INSERT INTO public.commercial_opportunity_changes
      (opportunity_id, field, old_value, new_value, delta_cents, changed_by)
    VALUES (
      NEW.id, 'expected_value_cents',
      OLD.expected_value_cents::text, NEW.expected_value_cents::text,
      COALESCE(NEW.expected_value_cents, 0) - COALESCE(OLD.expected_value_cents, 0),
      v_actor
    );
  END IF;

  IF NEW.probability_pct IS DISTINCT FROM OLD.probability_pct THEN
    INSERT INTO public.commercial_opportunity_changes (opportunity_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'probability_pct', OLD.probability_pct::text, NEW.probability_pct::text, v_actor);
  END IF;

  IF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    INSERT INTO public.commercial_opportunity_changes (opportunity_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'owner_user_id', OLD.owner_user_id::text, NEW.owner_user_id::text, v_actor);
  END IF;

  IF NEW.lost_reason IS DISTINCT FROM OLD.lost_reason THEN
    INSERT INTO public.commercial_opportunity_changes (opportunity_id, field, old_value, new_value, changed_by)
    VALUES (NEW.id, 'lost_reason', OLD.lost_reason, NEW.lost_reason, v_actor);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER commercial_opportunity_change_log
  AFTER UPDATE ON public.commercial_opportunities
  FOR EACH ROW EXECUTE FUNCTION public._commercial_opportunity_change_log();

-- ---------------------------------------------------------------- 2. signals
CREATE TABLE public.commercial_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signal_key text NOT NULL,
  signal_type text NOT NULL,
  source text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  account_id uuid,
  customer_label text,
  severity text NOT NULL DEFAULT 'info'
    CHECK (severity IN ('info','low','medium','high','critical')),
  urgency text NOT NULL DEFAULT 'normal'
    CHECK (urgency IN ('whenever','normal','today','now')),
  commercial_impact_cents bigint,
  customer_impact text,
  headline text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  recommended_action text,
  owner_user_id uuid,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','acknowledged','actioned','dismissed','expired')),
  status_note text,
  status_by uuid,
  status_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  UNIQUE (signal_key)
);
CREATE INDEX idx_csig_open ON public.commercial_signals (status, urgency, severity, created_at DESC);
CREATE INDEX idx_csig_entity ON public.commercial_signals (entity_type, entity_id);
CREATE INDEX idx_csig_account ON public.commercial_signals (account_id);
CREATE INDEX idx_csig_owner ON public.commercial_signals (owner_user_id, status);

GRANT SELECT ON public.commercial_signals TO authenticated;
GRANT ALL ON public.commercial_signals TO service_role;
ALTER TABLE public.commercial_signals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read signals"
  ON public.commercial_signals FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "service role writes signals"
  ON public.commercial_signals FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.commercial_signals IS
  'Universal signal register for the commercial intelligence layer. Written only through commercial_signal_emit / commercial_signal_set_status; every row carries the evidence that produced it.';

CREATE OR REPLACE FUNCTION public._commercial_signals_touch()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;
CREATE TRIGGER commercial_signals_touch
  BEFORE UPDATE ON public.commercial_signals
  FOR EACH ROW EXECUTE FUNCTION public._commercial_signals_touch();

-- Emit (upsert by deterministic key) — staff or backend, never anon.
CREATE OR REPLACE FUNCTION public.commercial_signal_emit(p jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_commercial_staff() THEN
    RAISE EXCEPTION 'not authorised to emit commercial signals';
  END IF;
  IF COALESCE(p->>'signal_key','') = '' OR COALESCE(p->>'headline','') = '' THEN
    RAISE EXCEPTION 'signal_key and headline are required';
  END IF;

  INSERT INTO public.commercial_signals (
    signal_key, signal_type, source, entity_type, entity_id, account_id, customer_label,
    severity, urgency, commercial_impact_cents, customer_impact, headline, evidence,
    recommended_action, owner_user_id, expires_at
  ) VALUES (
    p->>'signal_key',
    COALESCE(p->>'signal_type','unclassified'),
    COALESCE(p->>'source','derived'),
    COALESCE(p->>'entity_type','opportunity'),
    NULLIF(p->>'entity_id','')::uuid,
    NULLIF(p->>'account_id','')::uuid,
    p->>'customer_label',
    COALESCE(p->>'severity','info'),
    COALESCE(p->>'urgency','normal'),
    NULLIF(p->>'commercial_impact_cents','')::bigint,
    p->>'customer_impact',
    p->>'headline',
    COALESCE(p->'evidence','[]'::jsonb),
    p->>'recommended_action',
    NULLIF(p->>'owner_user_id','')::uuid,
    NULLIF(p->>'expires_at','')::timestamptz
  )
  ON CONFLICT (signal_key) DO UPDATE SET
    severity = EXCLUDED.severity,
    urgency = EXCLUDED.urgency,
    commercial_impact_cents = EXCLUDED.commercial_impact_cents,
    customer_impact = EXCLUDED.customer_impact,
    headline = EXCLUDED.headline,
    evidence = EXCLUDED.evidence,
    recommended_action = EXCLUDED.recommended_action,
    owner_user_id = EXCLUDED.owner_user_id,
    expires_at = EXCLUDED.expires_at,
    -- a dismissed signal stays dismissed unless the evidence changes state
    status = CASE WHEN public.commercial_signals.status = 'dismissed'
                  THEN 'dismissed' ELSE 'open' END
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commercial_signal_set_status(
  p_signal_id uuid, p_status text, p_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.role() <> 'service_role' AND NOT public.is_commercial_staff() THEN
    RAISE EXCEPTION 'not authorised to change signal status';
  END IF;
  IF p_status NOT IN ('open','acknowledged','actioned','dismissed','expired') THEN
    RAISE EXCEPTION 'unknown signal status %', p_status;
  END IF;
  UPDATE public.commercial_signals
     SET status = p_status, status_note = p_note, status_by = auth.uid(), status_at = now()
   WHERE id = p_signal_id;
END;
$$;

REVOKE ALL ON FUNCTION public.commercial_signal_emit(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.commercial_signal_set_status(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.commercial_signal_emit(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.commercial_signal_set_status(uuid, text, text) TO authenticated, service_role;

-- ----------------------------------------------------------- 3. stakeholders
CREATE TABLE public.commercial_deal_stakeholders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id uuid NOT NULL REFERENCES public.commercial_opportunities(id) ON DELETE CASCADE,
  account_id uuid,
  contact_id uuid,
  person_name text NOT NULL,
  job_title text,
  committee_role text NOT NULL CHECK (committee_role IN (
    'economic_buyer','decision_maker','procurement','finance','technical_evaluator',
    'user','influencer','champion','detractor','executive_sponsor')),
  engagement text NOT NULL DEFAULT 'not_engaged'
    CHECK (engagement IN ('not_engaged','contacted','engaged','advocating','resistant')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, person_name, committee_role)
);
CREATE INDEX idx_cds_opportunity ON public.commercial_deal_stakeholders (opportunity_id);
CREATE INDEX idx_cds_account ON public.commercial_deal_stakeholders (account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_deal_stakeholders TO authenticated;
GRANT ALL ON public.commercial_deal_stakeholders TO service_role;
ALTER TABLE public.commercial_deal_stakeholders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read stakeholders"
  ON public.commercial_deal_stakeholders FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write stakeholders"
  ON public.commercial_deal_stakeholders FOR ALL TO authenticated
  USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE POLICY "service role writes stakeholders"
  ON public.commercial_deal_stakeholders FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE TRIGGER commercial_deal_stakeholders_touch
  BEFORE UPDATE ON public.commercial_deal_stakeholders
  FOR EACH ROW EXECUTE FUNCTION public._commercial_signals_touch();

COMMENT ON TABLE public.commercial_deal_stakeholders IS
  'Buying committee per opportunity. Roles are explicit so the intelligence layer can name a missing decision maker instead of guessing.';

-- ----------------------------------------------------------------- 4. labels
CREATE TABLE public.commercial_record_labels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL DEFAULT auth.uid(),
  entity_type text NOT NULL CHECK (entity_type IN ('account','opportunity','quotation','contract','lead','contact')),
  entity_id uuid NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_user_id, entity_type, entity_id, label)
);
CREATE INDEX idx_crl_owner ON public.commercial_record_labels (owner_user_id, entity_type);
CREATE INDEX idx_crl_entity ON public.commercial_record_labels (entity_type, entity_id);

GRANT SELECT, INSERT, DELETE ON public.commercial_record_labels TO authenticated;
GRANT ALL ON public.commercial_record_labels TO service_role;
ALTER TABLE public.commercial_record_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "own labels read" ON public.commercial_record_labels FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY "own labels insert" ON public.commercial_record_labels FOR INSERT TO authenticated
  WITH CHECK (owner_user_id = auth.uid() AND public.is_commercial_staff());
CREATE POLICY "own labels delete" ON public.commercial_record_labels FOR DELETE TO authenticated
  USING (owner_user_id = auth.uid());
CREATE POLICY "service role labels" ON public.commercial_record_labels FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.commercial_record_labels IS
  'Personal, private labels used for filtering. Visible only to the staff member who created them.';

-- ------------------------------------------------------------ 5. whitespace
CREATE TABLE public.commercial_whitespace_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  service_code text NOT NULL,
  decision text NOT NULL CHECK (decision IN ('dismissed','pursued')),
  reason text,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  decided_by uuid NOT NULL DEFAULT auth.uid(),
  decided_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, service_code)
);
CREATE INDEX idx_cwd_account ON public.commercial_whitespace_decisions (account_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.commercial_whitespace_decisions TO authenticated;
GRANT ALL ON public.commercial_whitespace_decisions TO service_role;
ALTER TABLE public.commercial_whitespace_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "commercial staff read whitespace decisions"
  ON public.commercial_whitespace_decisions FOR SELECT TO authenticated
  USING (public.is_commercial_staff());
CREATE POLICY "commercial staff write whitespace decisions"
  ON public.commercial_whitespace_decisions FOR ALL TO authenticated
  USING (public.is_commercial_staff()) WITH CHECK (public.is_commercial_staff());
CREATE POLICY "service role whitespace decisions"
  ON public.commercial_whitespace_decisions FOR ALL TO service_role
  USING (true) WITH CHECK (true);

COMMENT ON TABLE public.commercial_whitespace_decisions IS
  'Records that a suggested expansion service was dismissed or pursued, so suggestions are never re-shown blindly and never auto-create opportunities.';
