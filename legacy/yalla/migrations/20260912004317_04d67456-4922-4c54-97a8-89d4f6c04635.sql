-- ============================================================
-- CONTRACT EXECUTION & REVENUE ENGINE
-- ============================================================

-- 1. Contract record: commercial terms, execution, activation
ALTER TABLE public.commercial_contract_instances
  ADD COLUMN IF NOT EXISTS contract_number text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS contract_type text NOT NULL DEFAULT 'mobility_services',
  ADD COLUMN IF NOT EXISTS lead_id uuid,
  ADD COLUMN IF NOT EXISTS value_amount numeric(14,2),
  ADD COLUMN IF NOT EXISTS currency text NOT NULL DEFAULT 'KES',
  ADD COLUMN IF NOT EXISTS value_type text NOT NULL DEFAULT 'one_time',
  ADD COLUMN IF NOT EXISTS revenue_period text,
  ADD COLUMN IF NOT EXISTS billing_frequency text,
  ADD COLUMN IF NOT EXISTS term_start date,
  ADD COLUMN IF NOT EXISTS term_end date,
  ADD COLUMN IF NOT EXISTS renewal_terms text,
  ADD COLUMN IF NOT EXISTS customer_signatory text,
  ADD COLUMN IF NOT EXISTS customer_signatory_email text,
  ADD COLUMN IF NOT EXISTS company_signatory text,
  ADD COLUMN IF NOT EXISTS company_signatory_email text,
  ADD COLUMN IF NOT EXISTS signature_method text NOT NULL DEFAULT 'recorded_upload',
  ADD COLUMN IF NOT EXISTS signature_date date,
  ADD COLUMN IF NOT EXISTS execution_date date,
  ADD COLUMN IF NOT EXISTS revenue_treatment text NOT NULL DEFAULT 'contracted',
  ADD COLUMN IF NOT EXISTS risk_level text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS variance_reason text,
  ADD COLUMN IF NOT EXISTS activation_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activated_by uuid,
  ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;

ALTER TABLE public.commercial_contract_instances
  DROP CONSTRAINT IF EXISTS commercial_contract_instances_status_check;
ALTER TABLE public.commercial_contract_instances
  ADD CONSTRAINT commercial_contract_instances_status_check CHECK (status = ANY (ARRAY[
    'draft','generated','internal_review','approved','sent_to_customer','shared','customer_review',
    'under_negotiation','customer_accepted','signature_pending','partially_signed','executed',
    'contracted','active','completed','expired','terminated','declined','superseded']));

ALTER TABLE public.commercial_contract_instances
  ADD CONSTRAINT cci_value_type_check CHECK (value_type = ANY (ARRAY[
    'one_time','monthly_recurring','quarterly_recurring','annual_recurring','multi_year','usage_based','project'])),
  ADD CONSTRAINT cci_signature_method_check CHECK (signature_method = ANY (ARRAY['recorded_upload','integrated_provider'])),
  ADD CONSTRAINT cci_revenue_treatment_check CHECK (revenue_treatment = ANY (ARRAY['contracted','qualifying'])),
  ADD CONSTRAINT cci_currency_check CHECK (currency ~ '^[A-Z]{3}$'),
  ADD CONSTRAINT cci_value_positive CHECK (value_amount IS NULL OR value_amount > 0),
  ADD CONSTRAINT cci_revenue_period_check CHECK (revenue_period IS NULL OR revenue_period ~ '^\d{4}-\d{2}$');

CREATE UNIQUE INDEX IF NOT EXISTS cci_contract_number_key
  ON public.commercial_contract_instances (contract_number) WHERE contract_number IS NOT NULL;
CREATE INDEX IF NOT EXISTS cci_owner_status_idx ON public.commercial_contract_instances (owner_staff_id, status);
CREATE INDEX IF NOT EXISTS cci_account_idx ON public.commercial_contract_instances (account_id);

-- contract number allocator
CREATE SEQUENCE IF NOT EXISTS public.contract_number_seq;

CREATE OR REPLACE FUNCTION public._contract_number()
RETURNS text LANGUAGE sql VOLATILE SET search_path = public AS $$
  SELECT 'YB-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.contract_number_seq')::text, 4, '0');
$$;

UPDATE public.commercial_contract_instances
   SET contract_number = public._contract_number()
 WHERE contract_number IS NULL;

CREATE OR REPLACE FUNCTION public._contract_defaults()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.contract_number IS NULL THEN NEW.contract_number := public._contract_number(); END IF;
  IF NEW.title IS NULL THEN NEW.title := coalesce(NEW.customer_legal_name, 'Contract') || ' — mobility services'; END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS contract_defaults ON public.commercial_contract_instances;
CREATE TRIGGER contract_defaults BEFORE INSERT OR UPDATE ON public.commercial_contract_instances
FOR EACH ROW EXECUTE FUNCTION public._contract_defaults();

-- 2. Versioned contract documents
CREATE TABLE IF NOT EXISTS public.contract_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  document_type text NOT NULL CHECK (document_type = ANY (ARRAY[
    'draft','final','executed','acceptance_evidence','signature_evidence','amendment','addendum','supporting'])),
  version integer NOT NULL DEFAULT 1,
  storage_bucket text NOT NULL DEFAULT 'crm-documents',
  storage_path text,
  file_name text,
  external_reference text,
  status text NOT NULL DEFAULT 'current' CHECK (status = ANY (ARRAY['current','superseded','void'])),
  source text NOT NULL DEFAULT 'upload',
  notes text,
  uploaded_by uuid,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, document_type, version)
);
GRANT SELECT, INSERT ON public.contract_documents TO authenticated;
GRANT ALL ON public.contract_documents TO service_role;
ALTER TABLE public.contract_documents ENABLE ROW LEVEL SECURITY;

-- 3. Append-only contract history
CREATE TABLE IF NOT EXISTS public.contract_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  before_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  after_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason text,
  source text NOT NULL DEFAULT 'staff_ui',
  actor_id uuid,
  actor_staff_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.contract_events TO authenticated;
GRANT ALL ON public.contract_events TO service_role;
ALTER TABLE public.contract_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS contract_events_contract_idx ON public.contract_events (contract_id, created_at DESC);

CREATE OR REPLACE FUNCTION public._contract_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'CONTRACT_HISTORY_IS_APPEND_ONLY';
END $$;

DROP TRIGGER IF EXISTS contract_events_append_only ON public.contract_events;
CREATE TRIGGER contract_events_append_only BEFORE UPDATE OR DELETE ON public.contract_events
FOR EACH ROW EXECUTE FUNCTION public._contract_append_only();

-- 4. Contract revenue register (idempotent by construction)
CREATE TABLE IF NOT EXISTS public.contract_revenue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES public.commercial_contract_instances(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES public.crm_accounts(id) ON DELETE CASCADE,
  opportunity_id uuid REFERENCES public.commercial_opportunities(id) ON DELETE SET NULL,
  lead_id uuid,
  staff_member_id uuid,
  event_type text NOT NULL DEFAULT 'CONTRACT_EXECUTED'
    CHECK (event_type = ANY (ARRAY['CONTRACT_EXECUTED','CONTRACT_AMENDED','CONTRACT_TERMINATED','MANUAL_ADJUSTMENT'])),
  activation_version integer NOT NULL DEFAULT 1,
  amount numeric(14,2) NOT NULL CHECK (amount <> 0),
  currency text NOT NULL DEFAULT 'KES' CHECK (currency ~ '^[A-Z]{3}$'),
  value_type text NOT NULL DEFAULT 'one_time',
  execution_date date NOT NULL,
  revenue_period text NOT NULL CHECK (revenue_period ~ '^\d{4}-\d{2}$'),
  revenue_treatment text NOT NULL DEFAULT 'contracted',
  source text NOT NULL DEFAULT 'contract_activation',
  reason text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contract_id, event_type, activation_version)
);
GRANT SELECT ON public.contract_revenue_events TO authenticated;
GRANT ALL ON public.contract_revenue_events TO service_role;
ALTER TABLE public.contract_revenue_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS cre_account_idx ON public.contract_revenue_events (account_id, execution_date DESC);

DROP TRIGGER IF EXISTS contract_revenue_append_only ON public.contract_revenue_events;
CREATE TRIGGER contract_revenue_append_only BEFORE UPDATE OR DELETE ON public.contract_revenue_events
FOR EACH ROW EXECUTE FUNCTION public._contract_append_only();

-- 5. Authorisation helpers
CREATE OR REPLACE FUNCTION public._contract_may_read(_contract public.commercial_contract_instances)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.manage')
      OR (_contract.owner_staff_id IS NOT NULL AND _contract.owner_staff_id = public._my_staff_member_id());
$$;

CREATE OR REPLACE FUNCTION public._contract_may_activate(_contract public.commercial_contract_instances)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'super_admin')
      OR public.has_staff_permission('staff.commercial.manage')
      OR (_contract.owner_staff_id IS NOT NULL AND _contract.owner_staff_id = public._my_staff_member_id());
$$;

-- RLS: read through the same rule, mutations only through RPCs
DROP POLICY IF EXISTS contract_documents_read ON public.contract_documents;
CREATE POLICY contract_documents_read ON public.contract_documents FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
               WHERE c.id = contract_id AND public._contract_may_read(c)));

DROP POLICY IF EXISTS contract_documents_insert ON public.contract_documents;
CREATE POLICY contract_documents_insert ON public.contract_documents FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
                    WHERE c.id = contract_id AND public._contract_may_activate(c)));

DROP POLICY IF EXISTS contract_events_read ON public.contract_events;
CREATE POLICY contract_events_read ON public.contract_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
               WHERE c.id = contract_id AND public._contract_may_read(c)));

DROP POLICY IF EXISTS contract_revenue_read ON public.contract_revenue_events;
CREATE POLICY contract_revenue_read ON public.contract_revenue_events FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.commercial_contract_instances c
               WHERE c.id = contract_id AND public._contract_may_read(c))
       OR public.has_staff_permission('staff.finance.read'));

-- 6. Activation validation gate
CREATE OR REPLACE FUNCTION public.contract_activation_check(_contract uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.commercial_contract_instances;
  o public.commercial_opportunities;
  checks jsonb := '[]'::jsonb;
  failures int := 0;
  v_variance numeric := NULL;
  v_variance_pct numeric := NULL;
  v_already boolean;
  add_check text;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_read(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  SELECT * INTO o FROM public.commercial_opportunities WHERE id = c.opportunity_id;
  SELECT EXISTS (SELECT 1 FROM public.contract_revenue_events
                  WHERE contract_id = c.id AND event_type = 'CONTRACT_EXECUTED'
                    AND activation_version = c.activation_version) INTO v_already;

  IF o.expected_value_cents IS NOT NULL AND c.value_amount IS NOT NULL THEN
    v_variance := c.value_amount - (o.expected_value_cents::numeric / 100);
    IF o.expected_value_cents > 0 THEN
      v_variance_pct := round(100 * v_variance / (o.expected_value_cents::numeric / 100), 2);
    END IF;
  END IF;

  -- helper-free inline checks
  checks := checks
    || jsonb_build_object('key','account','label','Account linked','ok', c.account_id IS NOT NULL,
         'detail', CASE WHEN c.account_id IS NULL THEN 'Link the contract to a customer account.' END)
    || jsonb_build_object('key','opportunity','label','Opportunity linked','ok', c.opportunity_id IS NOT NULL,
         'detail', CASE WHEN c.opportunity_id IS NULL THEN 'Link the originating opportunity so the pipeline can be updated.' END)
    || jsonb_build_object('key','value','label','Contract value present','ok', c.value_amount IS NOT NULL,
         'detail', CASE WHEN c.value_amount IS NULL THEN 'Record the agreed contract value.' END)
    || jsonb_build_object('key','currency','label','Currency present','ok', c.currency IS NOT NULL, 'detail', NULL)
    || jsonb_build_object('key','revenue_period','label','Revenue period selected','ok', c.revenue_period IS NOT NULL,
         'detail', CASE WHEN c.revenue_period IS NULL THEN 'Choose the month the contracted value belongs to.' END)
    || jsonb_build_object('key','execution_date','label','Execution date recorded','ok', c.execution_date IS NOT NULL,
         'detail', CASE WHEN c.execution_date IS NULL THEN 'Record the date both parties signed.' END)
    || jsonb_build_object('key','signatories','label','Both signatories recorded','ok',
         (coalesce(btrim(c.customer_signatory),'') <> '' AND coalesce(btrim(c.company_signatory),'') <> ''),
         'detail', 'Record who signed for the customer and for Yalla Mobility.')
    || jsonb_build_object('key','executed_document','label','Executed contract attached','ok',
         EXISTS (SELECT 1 FROM public.contract_documents d
                  WHERE d.contract_id = c.id AND d.document_type = 'executed' AND d.status = 'current'),
         'detail', 'Upload the fully signed contract.')
    || jsonb_build_object('key','acceptance','label','Customer acceptance evidence on file','ok',
         EXISTS (SELECT 1 FROM public.contract_documents d
                  WHERE d.contract_id = c.id AND d.document_type IN ('acceptance_evidence','executed')
                    AND d.status = 'current'),
         'detail', 'File the written acceptance or the signed copy.')
    || jsonb_build_object('key','authorised','label','You are authorised to activate','ok', public._contract_may_activate(c),
         'detail', 'Only the contract owner or a commercial manager may activate.')
    || jsonb_build_object('key','no_duplicate','label','Not already activated','ok', NOT v_already,
         'detail', CASE WHEN v_already THEN 'This activation already posted its revenue entry.' END)
    || jsonb_build_object('key','variance','label','Value variance explained','ok',
         (v_variance_pct IS NULL OR abs(v_variance_pct) <= 10 OR coalesce(btrim(c.variance_reason),'') <> ''),
         'detail', CASE WHEN v_variance_pct IS NOT NULL AND abs(v_variance_pct) > 10
                        THEN 'Contract value differs from the opportunity by ' || v_variance_pct || '%. A written explanation is required.' END);

  SELECT count(*) INTO failures FROM jsonb_array_elements(checks) e WHERE (e->>'ok')::boolean IS NOT TRUE;

  RETURN jsonb_build_object(
    'ok', true,
    'contract_id', c.id,
    'contract_number', c.contract_number,
    'status', c.status,
    'can_activate', failures = 0,
    'failures', failures,
    'already_activated', v_already,
    'checks', checks,
    'variance_amount', v_variance,
    'variance_pct', v_variance_pct,
    'value_amount', c.value_amount,
    'currency', c.currency,
    'value_type', c.value_type,
    'revenue_period', c.revenue_period,
    'execution_date', c.execution_date,
    'account_id', c.account_id,
    'opportunity_id', c.opportunity_id
  );
END $$;
REVOKE ALL ON FUNCTION public.contract_activation_check(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_activation_check(uuid) TO authenticated;

-- 7. Record execution details (owner-editable, audited)
CREATE OR REPLACE FUNCTION public.contract_execution_record(
  _contract uuid,
  _patch jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.commercial_contract_instances;
  before_state jsonb;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;
  IF c.status IN ('contracted','active','completed','terminated') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_IS_ACTIVATED');
  END IF;

  before_state := to_jsonb(c);

  UPDATE public.commercial_contract_instances SET
    title                    = coalesce(_patch->>'title', title),
    contract_type            = coalesce(_patch->>'contract_type', contract_type),
    value_amount             = coalesce((_patch->>'value_amount')::numeric, value_amount),
    currency                 = coalesce(upper(_patch->>'currency'), currency),
    value_type               = coalesce(_patch->>'value_type', value_type),
    revenue_period           = coalesce(_patch->>'revenue_period', revenue_period),
    billing_frequency        = coalesce(_patch->>'billing_frequency', billing_frequency),
    payment_terms            = coalesce(_patch->>'payment_terms', payment_terms),
    term_start               = coalesce((_patch->>'term_start')::date, term_start),
    term_end                 = coalesce((_patch->>'term_end')::date, term_end),
    renewal_terms            = coalesce(_patch->>'renewal_terms', renewal_terms),
    customer_signatory       = coalesce(_patch->>'customer_signatory', customer_signatory),
    customer_signatory_email = coalesce(_patch->>'customer_signatory_email', customer_signatory_email),
    company_signatory        = coalesce(_patch->>'company_signatory', company_signatory),
    company_signatory_email  = coalesce(_patch->>'company_signatory_email', company_signatory_email),
    signature_date           = coalesce((_patch->>'signature_date')::date, signature_date),
    execution_date           = coalesce((_patch->>'execution_date')::date, execution_date),
    revenue_treatment        = coalesce(_patch->>'revenue_treatment', revenue_treatment),
    variance_reason          = coalesce(_patch->>'variance_reason', variance_reason),
    lead_id                  = coalesce((_patch->>'lead_id')::uuid, lead_id),
    opportunity_id           = coalesce((_patch->>'opportunity_id')::uuid, opportunity_id),
    status                   = CASE WHEN _patch->>'status' IS NOT NULL THEN _patch->>'status' ELSE status END
  WHERE id = _contract;

  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'CONTRACT_EDITED', before_state->>'status', c.status, before_state, to_jsonb(c),
          _patch->>'reason', auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'contract_id', _contract, 'status', c.status);
END $$;
REVOKE ALL ON FUNCTION public.contract_execution_record(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_execution_record(uuid, jsonb) TO authenticated;

-- 8. Attach a document version
CREATE OR REPLACE FUNCTION public.contract_document_attach(
  _contract uuid, _document_type text, _storage_path text DEFAULT NULL,
  _file_name text DEFAULT NULL, _external_reference text DEFAULT NULL, _notes text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.commercial_contract_instances;
  v_version int;
  v_id uuid;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  SELECT coalesce(max(version), 0) + 1 INTO v_version
    FROM public.contract_documents WHERE contract_id = _contract AND document_type = _document_type;

  UPDATE public.contract_documents SET status = 'superseded'
   WHERE contract_id = _contract AND document_type = _document_type AND status = 'current';

  INSERT INTO public.contract_documents
    (contract_id, document_type, version, storage_path, file_name, external_reference, notes, uploaded_by)
  VALUES (_contract, _document_type, v_version, _storage_path, _file_name, _external_reference, _notes, auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, after_state, reason, actor_id, actor_staff_id)
  VALUES (_contract, 'DOCUMENT_ATTACHED', c.status, c.status,
          jsonb_build_object('document_type', _document_type, 'version', v_version,
                             'storage_path', _storage_path, 'reference', _external_reference),
          _notes, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'document_id', v_id, 'version', v_version);
END $$;
REVOKE ALL ON FUNCTION public.contract_document_attach(uuid, text, text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_document_attach(uuid, text, text, text, text, text) TO authenticated;

-- 9. THE ACTIVATION: one atomic, idempotent commercial truth event
CREATE OR REPLACE FUNCTION public.contract_activate(_contract uuid, _reason text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  c public.commercial_contract_instances;
  gate jsonb;
  v_staff uuid;
  v_event uuid;
  v_existing uuid;
  v_work uuid;
  v_lifecycle jsonb := NULL;
  v_period text;
BEGIN
  SELECT * INTO c FROM public.commercial_contract_instances WHERE id = _contract FOR UPDATE;
  IF c.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'CONTRACT_NOT_FOUND'); END IF;
  IF NOT public._contract_may_activate(c) THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  -- idempotency: an existing revenue entry for this activation returns the same result
  SELECT id INTO v_existing FROM public.contract_revenue_events
   WHERE contract_id = c.id AND event_type = 'CONTRACT_EXECUTED' AND activation_version = c.activation_version;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_activated', true, 'revenue_event_id', v_existing,
                              'contract_id', c.id, 'status', c.status);
  END IF;

  gate := public.contract_activation_check(_contract);
  IF (gate->>'can_activate')::boolean IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'ACTIVATION_BLOCKED', 'gate', gate);
  END IF;

  v_staff := coalesce(c.owner_staff_id, public._my_staff_member_id());
  v_period := coalesce(c.revenue_period, to_char(c.execution_date, 'YYYY-MM'));

  INSERT INTO public.contract_revenue_events
    (contract_id, account_id, opportunity_id, lead_id, staff_member_id, event_type, activation_version,
     amount, currency, value_type, execution_date, revenue_period, revenue_treatment, reason, created_by)
  VALUES (c.id, c.account_id, c.opportunity_id, c.lead_id, v_staff, 'CONTRACT_EXECUTED', c.activation_version,
          c.value_amount, c.currency, c.value_type, c.execution_date, v_period, c.revenue_treatment,
          _reason, auth.uid())
  ON CONFLICT (contract_id, event_type, activation_version) DO NOTHING
  RETURNING id INTO v_event;

  IF v_event IS NULL THEN
    SELECT id INTO v_event FROM public.contract_revenue_events
     WHERE contract_id = c.id AND event_type = 'CONTRACT_EXECUTED' AND activation_version = c.activation_version;
    RETURN jsonb_build_object('ok', true, 'already_activated', true, 'revenue_event_id', v_event,
                              'contract_id', c.id, 'status', c.status);
  END IF;

  UPDATE public.commercial_contract_instances
     SET status = 'contracted', activated_at = now(), activated_by = auth.uid(),
         effective_date = coalesce(effective_date, execution_date)
   WHERE id = c.id;

  -- opportunity: only ever forward, and only on real execution evidence
  IF c.opportunity_id IS NOT NULL THEN
    UPDATE public.commercial_opportunities
       SET stage = 'won', updated_at = now()
     WHERE id = c.opportunity_id AND stage NOT IN ('won','lost');
  END IF;

  -- account lifecycle stage follows the contract
  UPDATE public.crm_accounts SET lifecycle_stage = 'won', updated_at = now()
   WHERE id = c.account_id AND lifecycle_stage NOT IN ('active','expansion','renewal','won');

  -- commercial lifecycle (quote-to-cash) advance, non-fatal
  IF c.lead_id IS NOT NULL THEN
    BEGIN
      v_lifecycle := public.commercial_lifecycle_advance(c.lead_id, 'CONTRACTED', c.value_amount,
                       'Contract ' || c.contract_number || ' executed', false);
    EXCEPTION WHEN OTHERS THEN
      v_lifecycle := jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
  END IF;

  -- next best action into the existing work queue
  IF v_staff IS NOT NULL THEN
    v_work := public._sales_work_ensure(
      v_staff, 'contract_onboarding',
      'Start onboarding — ' || coalesce(c.customer_legal_name, 'customer'),
      'Contract ' || c.contract_number || ' is contracted. Arrange kickoff, billing setup and the first booking.',
      'commercial_contract_instances', c.id, c.contract_number, 'high', 1440);
  END IF;

  INSERT INTO public.contract_events
    (contract_id, event_type, from_status, to_status, before_state, after_state, reason, actor_id, actor_staff_id)
  VALUES (c.id, 'CONTRACT_ACTIVATED', c.status, 'contracted', to_jsonb(c),
          jsonb_build_object('revenue_event_id', v_event, 'amount', c.value_amount, 'currency', c.currency,
                             'revenue_period', v_period, 'work_item_id', v_work, 'lifecycle', v_lifecycle),
          _reason, auth.uid(), public._my_staff_member_id());

  RETURN jsonb_build_object('ok', true, 'already_activated', false, 'contract_id', c.id,
    'contract_number', c.contract_number, 'status', 'contracted', 'revenue_event_id', v_event,
    'amount', c.value_amount, 'currency', c.currency, 'revenue_period', v_period,
    'opportunity_id', c.opportunity_id, 'account_id', c.account_id,
    'work_item_id', v_work, 'lifecycle', v_lifecycle);
END $$;
REVOKE ALL ON FUNCTION public.contract_activate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_activate(uuid, text) TO authenticated;

-- 10. Account revenue provenance
CREATE OR REPLACE FUNCTION public.contract_account_revenue(_account uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_authorised boolean;
  v_rows jsonb;
  v_total numeric;
  v_recurring numeric;
BEGIN
  v_authorised := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.manage')
    OR public.has_staff_permission('staff.finance.read')
    OR EXISTS (SELECT 1 FROM public.crm_accounts a
                WHERE a.id = _account AND a.owner_staff_id = public._my_staff_member_id());
  IF NOT v_authorised THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'revenue_event_id', r.id, 'contract_id', r.contract_id, 'contract_number', c.contract_number,
           'title', c.title, 'event_type', r.event_type, 'amount', r.amount, 'currency', r.currency,
           'value_type', r.value_type, 'execution_date', r.execution_date, 'revenue_period', r.revenue_period,
           'opportunity_id', r.opportunity_id, 'staff_member_id', r.staff_member_id
         ) ORDER BY r.execution_date DESC), '[]'::jsonb),
         coalesce(sum(r.amount), 0),
         coalesce(sum(CASE WHEN r.value_type <> 'one_time' THEN r.amount ELSE 0 END), 0)
    INTO v_rows, v_total, v_recurring
    FROM public.contract_revenue_events r
    JOIN public.commercial_contract_instances c ON c.id = r.contract_id
   WHERE r.account_id = _account;

  RETURN jsonb_build_object('ok', true, 'account_id', _account,
    'contracted_revenue', v_total, 'recurring_revenue', v_recurring,
    'active_contracts', (SELECT count(*) FROM public.commercial_contract_instances
                          WHERE account_id = _account AND status IN ('contracted','active')),
    'open_opportunities', (SELECT count(*) FROM public.commercial_opportunities o
                            JOIN public.commercial_contract_instances ci ON ci.opportunity_id = o.id
                           WHERE ci.account_id = _account AND o.stage NOT IN ('won','lost')),
    'sources', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.contract_account_revenue(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_account_revenue(uuid) TO authenticated;

-- 11. Manager control centre + data health
CREATE OR REPLACE FUNCTION public.contract_control_centre()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_ok boolean;
BEGIN
  v_ok := public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_staff_permission('staff.commercial.read') OR public.has_staff_permission('staff.commercial.manage')
    OR public.has_staff_permission('staff.finance.read');
  IF NOT v_ok THEN RETURN jsonb_build_object('ok', false, 'error', 'NOT_AUTHORISED'); END IF;

  RETURN jsonb_build_object('ok', true,
    'pipeline', (SELECT coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                   FROM (SELECT status, count(*) n FROM public.commercial_contract_instances
                          WHERE NOT is_test GROUP BY status) s),
    'awaiting_signature', (SELECT count(*) FROM public.commercial_contract_instances
                            WHERE status IN ('sent_to_customer','shared','customer_review','signature_pending','partially_signed')
                              AND NOT is_test),
    'executed_pending_activation', (SELECT count(*) FROM public.commercial_contract_instances
                                     WHERE status IN ('executed','customer_accepted') AND NOT is_test),
    'revenue_pending_activation', (SELECT coalesce(sum(value_amount), 0) FROM public.commercial_contract_instances
                                    WHERE status IN ('executed','customer_accepted') AND NOT is_test),
    'contracted_revenue_today', (SELECT coalesce(sum(amount), 0) FROM public.contract_revenue_events
                                  WHERE created_at >= date_trunc('day', now())),
    'contracted_revenue_month', (SELECT coalesce(sum(amount), 0) FROM public.contract_revenue_events
                                  WHERE revenue_period = to_char(now(), 'YYYY-MM')),
    'activated_today', (SELECT count(*) FROM public.contract_revenue_events
                         WHERE created_at >= date_trunc('day', now())),
    'average_contract_value', (SELECT coalesce(round(avg(amount), 2), 0) FROM public.contract_revenue_events),
    'ready', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'contract_id', c.id, 'contract_number', c.contract_number, 'customer', c.customer_legal_name,
                'status', c.status, 'value_amount', c.value_amount, 'currency', c.currency,
                'owner_staff_id', c.owner_staff_id, 'execution_date', c.execution_date)
                ORDER BY c.value_amount DESC NULLS LAST), '[]'::jsonb)
                FROM public.commercial_contract_instances c
               WHERE c.status IN ('executed','customer_accepted','signature_pending','partially_signed') AND NOT c.is_test),
    'health', jsonb_build_object(
      'missing_account', 0,
      'missing_opportunity', (SELECT count(*) FROM public.commercial_contract_instances WHERE opportunity_id IS NULL AND NOT is_test),
      'missing_value', (SELECT count(*) FROM public.commercial_contract_instances WHERE value_amount IS NULL AND NOT is_test),
      'missing_owner', (SELECT count(*) FROM public.commercial_contract_instances WHERE owner_staff_id IS NULL AND NOT is_test),
      'missing_executed_document', (SELECT count(*) FROM public.commercial_contract_instances c
                                     WHERE c.status IN ('executed','contracted','active') AND NOT c.is_test
                                       AND NOT EXISTS (SELECT 1 FROM public.contract_documents d
                                                        WHERE d.contract_id = c.id AND d.document_type = 'executed' AND d.status='current')),
      'contracted_without_revenue_event', (SELECT count(*) FROM public.commercial_contract_instances c
                                            WHERE c.status IN ('contracted','active') AND NOT c.is_test
                                              AND NOT EXISTS (SELECT 1 FROM public.contract_revenue_events r WHERE r.contract_id = c.id))
    ));
END $$;
REVOKE ALL ON FUNCTION public.contract_control_centre() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_control_centre() TO authenticated;

-- 12. Employee contract list with gate summary
CREATE OR REPLACE FUNCTION public.contract_my_book()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_staff uuid; v_rows jsonb;
BEGIN
  v_staff := public._my_staff_member_id();
  IF v_staff IS NULL AND NOT (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_STAFF_IDENTITY');
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'contract_id', c.id, 'contract_number', c.contract_number, 'title', c.title,
      'customer', c.customer_legal_name, 'status', c.status,
      'value_amount', c.value_amount, 'currency', c.currency, 'value_type', c.value_type,
      'revenue_period', c.revenue_period, 'execution_date', c.execution_date,
      'term_start', c.term_start, 'term_end', c.term_end,
      'account_id', c.account_id, 'opportunity_id', c.opportunity_id, 'lead_id', c.lead_id,
      'customer_signatory', c.customer_signatory, 'company_signatory', c.company_signatory,
      'signature_date', c.signature_date, 'variance_reason', c.variance_reason,
      'activated_at', c.activated_at, 'is_test', c.is_test,
      'documents', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'document_type', d.document_type, 'version', d.version, 'file_name', d.file_name,
                       'reference', d.external_reference, 'uploaded_at', d.uploaded_at) ORDER BY d.uploaded_at DESC), '[]'::jsonb)
                     FROM public.contract_documents d WHERE d.contract_id = c.id AND d.status = 'current'),
      'revenue', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                       'amount', r.amount, 'currency', r.currency, 'revenue_period', r.revenue_period,
                       'event_type', r.event_type, 'created_at', r.created_at)), '[]'::jsonb)
                     FROM public.contract_revenue_events r WHERE r.contract_id = c.id)
    ) ORDER BY c.updated_at DESC), '[]'::jsonb)
    INTO v_rows
    FROM public.commercial_contract_instances c
   WHERE public._contract_may_read(c)
     AND (v_staff IS NULL OR c.owner_staff_id = v_staff
          OR public.has_staff_permission('staff.commercial.manage')
          OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));

  RETURN jsonb_build_object('ok', true, 'items', v_rows);
END $$;
REVOKE ALL ON FUNCTION public.contract_my_book() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.contract_my_book() TO authenticated;