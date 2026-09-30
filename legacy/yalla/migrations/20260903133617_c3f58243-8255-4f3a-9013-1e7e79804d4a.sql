-- 1. Owner-governed commission configuration (fails closed until set).
INSERT INTO public.freight_billing_config (key, label, category, state, value, owner_role, guidance)
VALUES ('settlement.carrier_commission',
        'Platform commission retained on carrier settlements',
        'settlement',
        'OWNER_CONFIGURATION_REQUIRED',
        '{}'::jsonb,
        'finance',
        'Set value = {"platform_commission_pct": <number>} and state = CONFIGURED. Carrier payable accrual refuses to run until this is set — the rate is never inferred.')
ON CONFLICT (key) DO NOTHING;

-- 2. Fleet-owner submitted proof of delivery for a dispatch-executed movement.
CREATE TABLE public.carrier_pod_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  submission_reference text NOT NULL UNIQUE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  leg_id uuid NOT NULL REFERENCES public.logistics_order_legs(id) ON DELETE RESTRICT,
  order_id uuid NOT NULL,
  dispatch_request_id uuid REFERENCES public.logistics_dispatch_requests(id),
  recipient_name text NOT NULL,
  recipient_relationship text,
  recipient_id_reference text,
  recipient_phone text,
  delivered_at timestamptz NOT NULL,
  captured_lat numeric(10,6),
  captured_lng numeric(10,6),
  notes text,
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  integrity_hash text NOT NULL,
  state text NOT NULL DEFAULT 'SUBMITTED'
    CHECK (state IN ('SUBMITTED','APPROVED','REJECTED')),
  submitted_by uuid,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_notes text,
  rejection_reason text,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX carrier_pod_submissions_leg_approved_uq
  ON public.carrier_pod_submissions (leg_id) WHERE state = 'APPROVED';

GRANT SELECT ON public.carrier_pod_submissions TO authenticated;
GRANT ALL ON public.carrier_pod_submissions TO service_role;
ALTER TABLE public.carrier_pod_submissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY carrier_pod_submissions_carrier_read ON public.carrier_pod_submissions
  FOR SELECT TO authenticated USING (public._carrier_is_member(carrier_id));
CREATE POLICY carrier_pod_submissions_staff_read ON public.carrier_pod_submissions
  FOR SELECT TO authenticated USING (
    public.has_staff_permission('staff.logistics.read')
    OR public.has_staff_permission('staff.logistics.manage')
    OR public.has_staff_permission('staff.finance.charge.manage')
  );

-- Evidence and identity of a submission are immutable; only review fields move.
CREATE OR REPLACE FUNCTION public._carrier_pod_submission_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.carrier_id <> OLD.carrier_id
     OR NEW.leg_id <> OLD.leg_id
     OR NEW.order_id <> OLD.order_id
     OR NEW.evidence::text <> OLD.evidence::text
     OR NEW.integrity_hash <> OLD.integrity_hash
     OR NEW.delivered_at <> OLD.delivered_at
     OR NEW.recipient_name <> OLD.recipient_name
     OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
     OR NEW.submitted_at <> OLD.submitted_at THEN
    RAISE EXCEPTION 'POD_SUBMISSION_IMMUTABLE';
  END IF;
  IF OLD.state <> 'SUBMITTED' AND NEW.state <> OLD.state THEN
    RAISE EXCEPTION 'POD_SUBMISSION_ALREADY_REVIEWED';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
CREATE TRIGGER carrier_pod_submissions_immutable
  BEFORE UPDATE ON public.carrier_pod_submissions
  FOR EACH ROW EXECUTE FUNCTION public._carrier_pod_submission_immutable();

CREATE TRIGGER carrier_pod_submissions_no_delete
  BEFORE DELETE ON public.carrier_pod_submissions
  FOR EACH ROW EXECUTE FUNCTION public._freight_append_only();

-- 3. Carrier payable lines.
CREATE TABLE public.carrier_payable_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_reference text NOT NULL UNIQUE,
  carrier_id uuid NOT NULL REFERENCES public.carrier_profiles(id) ON DELETE RESTRICT,
  partner_id uuid NOT NULL,
  order_id uuid NOT NULL,
  leg_id uuid NOT NULL REFERENCES public.logistics_order_legs(id),
  pod_submission_id uuid NOT NULL UNIQUE
    REFERENCES public.carrier_pod_submissions(id) ON DELETE RESTRICT,
  currency text NOT NULL DEFAULT 'KES',
  gross_amount numeric(14,2) NOT NULL CHECK (gross_amount >= 0),
  commission_pct numeric(6,3) NOT NULL CHECK (commission_pct >= 0 AND commission_pct <= 100),
  platform_fee numeric(14,2) NOT NULL CHECK (platform_fee >= 0),
  net_payable numeric(14,2) NOT NULL CHECK (net_payable >= 0),
  basis jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'ACCRUED' CHECK (state IN ('ACCRUED','RELEASED')),
  ledger_entry_id uuid,
  accrued_by uuid,
  accrued_at timestamptz NOT NULL DEFAULT now(),
  released_by uuid,
  released_at timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.carrier_payable_lines TO authenticated;
GRANT ALL ON public.carrier_payable_lines TO service_role;
ALTER TABLE public.carrier_payable_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY carrier_payable_lines_carrier_read ON public.carrier_payable_lines
  FOR SELECT TO authenticated USING (public._carrier_is_member(carrier_id));
CREATE POLICY carrier_payable_lines_staff_read ON public.carrier_payable_lines
  FOR SELECT TO authenticated USING (
    public.has_staff_permission('staff.logistics.read')
    OR public.has_staff_permission('staff.logistics.manage')
    OR public.has_staff_permission('staff.finance.charge.manage')
  );

CREATE TRIGGER carrier_payable_lines_no_delete
  BEFORE DELETE ON public.carrier_payable_lines
  FOR EACH ROW EXECUTE FUNCTION public._freight_append_only();

-- 4. Fleet owner submits delivery evidence.
CREATE OR REPLACE FUNCTION public.carrier_pod_submit(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_carrier uuid := (p->>'carrier_id')::uuid;
  v_leg uuid := (p->>'leg_id')::uuid;
  v_key text := coalesce(p->>'idempotency_key','');
  v_leg_row public.logistics_order_legs;
  v_existing public.carrier_pod_submissions;
  v_evidence jsonb := coalesce(p->'evidence','[]'::jsonb);
  v_ref text; v_id uuid; v_hash text; v_dispatch uuid;
BEGIN
  IF NOT public._carrier_is_member(v_carrier) THEN
    RETURN jsonb_build_object('error', true, 'code','NOT_AUTHORISED');
  END IF;
  IF v_key = '' THEN
    RETURN jsonb_build_object('error', true, 'code','IDEMPOTENCY_KEY_REQUIRED');
  END IF;

  SELECT * INTO v_existing FROM public.carrier_pod_submissions WHERE idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'submission_id', v_existing.id,
      'reference', v_existing.submission_reference, 'state', v_existing.state);
  END IF;

  SELECT * INTO v_leg_row FROM public.logistics_order_legs WHERE id = v_leg;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','LEG_NOT_FOUND'); END IF;
  IF v_leg_row.status <> 'COMPLETED' THEN
    RETURN jsonb_build_object('error', true, 'code','LEG_NOT_COMPLETED', 'status', v_leg_row.status);
  END IF;
  IF coalesce(btrim(p->>'recipient_name'),'') = '' THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','recipient_name');
  END IF;
  IF (p->>'delivered_at') IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','delivered_at');
  END IF;
  IF jsonb_array_length(v_evidence) < 1 THEN
    RETURN jsonb_build_object('error', true, 'code','EVIDENCE_REQUIRED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.carrier_pod_submissions
              WHERE leg_id = v_leg AND state IN ('SUBMITTED','APPROVED')) THEN
    RETURN jsonb_build_object('error', true, 'code','POD_ALREADY_PENDING_OR_APPROVED');
  END IF;

  SELECT id INTO v_dispatch FROM public.logistics_dispatch_requests
   WHERE leg_id = v_leg ORDER BY created_at DESC LIMIT 1;

  v_hash := encode(sha256(convert_to(
    coalesce(v_carrier::text,'') || '|' || v_leg::text || '|' ||
    (p->>'delivered_at') || '|' || btrim(p->>'recipient_name') || '|' || v_evidence::text, 'utf8')), 'hex');

  v_ref := 'CPOD-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_key || v_leg::text), 1, 6));

  INSERT INTO public.carrier_pod_submissions (
    submission_reference, carrier_id, leg_id, order_id, dispatch_request_id,
    recipient_name, recipient_relationship, recipient_id_reference, recipient_phone,
    delivered_at, captured_lat, captured_lng, notes, evidence, integrity_hash,
    submitted_by, idempotency_key)
  VALUES (v_ref, v_carrier, v_leg, v_leg_row.order_id, v_dispatch,
    btrim(p->>'recipient_name'), p->>'recipient_relationship', p->>'recipient_id_reference',
    p->>'recipient_phone', (p->>'delivered_at')::timestamptz,
    (p->>'captured_lat')::numeric, (p->>'captured_lng')::numeric, p->>'notes',
    v_evidence, v_hash, auth.uid(), v_key)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'submission_id', v_id, 'reference', v_ref,
    'state','SUBMITTED', 'integrity_hash', v_hash);
END $$;
REVOKE ALL ON FUNCTION public.carrier_pod_submit(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_pod_submit(jsonb) TO authenticated, service_role;

-- 5. Staff review; approval accrues the payable line.
CREATE OR REPLACE FUNCTION public.carrier_pod_review(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := (p->>'submission_id')::uuid;
  v_decision text := upper(coalesce(p->>'decision',''));
  v_sub public.carrier_pod_submissions;
  v_cfg public.freight_billing_config;
  v_pct numeric; v_gross numeric; v_fee numeric; v_net numeric;
  v_partner uuid; v_line uuid; v_ref text; v_order public.delivery_orders;
BEGIN
  IF NOT (public.has_staff_permission('staff.logistics.manage')
          OR public.has_staff_permission('staff.finance.charge.manage')) THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  IF v_decision NOT IN ('APPROVED','REJECTED') THEN
    RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','decision');
  END IF;

  SELECT * INTO v_sub FROM public.carrier_pod_submissions WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','NOT_FOUND'); END IF;
  IF v_sub.state <> 'SUBMITTED' THEN
    RETURN jsonb_build_object('error', true, 'code','ALREADY_REVIEWED','state', v_sub.state);
  END IF;
  IF v_sub.submitted_by IS NOT NULL AND v_sub.submitted_by = auth.uid() THEN
    RETURN jsonb_build_object('error', true, 'code','SEPARATION_OF_DUTIES');
  END IF;

  IF v_decision = 'REJECTED' THEN
    IF coalesce(length(btrim(p->>'rejection_reason')),0) < 10 THEN
      RETURN jsonb_build_object('error', true, 'code','VALIDATION_ERROR','field','rejection_reason');
    END IF;
    UPDATE public.carrier_pod_submissions
       SET state='REJECTED', reviewed_by=auth.uid(), reviewed_at=now(),
           rejection_reason=btrim(p->>'rejection_reason'), review_notes=p->>'review_notes'
     WHERE id = v_id;
    RETURN jsonb_build_object('ok', true, 'state','REJECTED', 'submission_id', v_id);
  END IF;

  SELECT * INTO v_cfg FROM public.freight_billing_config WHERE key='settlement.carrier_commission';
  IF v_cfg.state IS DISTINCT FROM 'CONFIGURED'
     OR (v_cfg.value->>'platform_commission_pct') IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','COMMISSION_NOT_CONFIGURED',
      'detail','Set freight_billing_config settlement.carrier_commission before approving payables.');
  END IF;
  v_pct := (v_cfg.value->>'platform_commission_pct')::numeric;
  IF v_pct < 0 OR v_pct > 100 THEN
    RETURN jsonb_build_object('error', true, 'code','COMMISSION_INVALID');
  END IF;

  SELECT * INTO v_order FROM public.delivery_orders WHERE id = v_sub.order_id;
  IF NOT FOUND OR v_order.total_amount IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','ORDER_AMOUNT_UNAVAILABLE');
  END IF;
  SELECT partner_id INTO v_partner FROM public.carrier_profiles WHERE id = v_sub.carrier_id;
  IF v_partner IS NULL THEN
    RETURN jsonb_build_object('error', true, 'code','CARRIER_PARTNER_MISSING');
  END IF;

  v_gross := round(v_order.total_amount, 2);
  v_fee := round(v_gross * v_pct / 100.0, 2);
  v_net := v_gross - v_fee;

  UPDATE public.carrier_pod_submissions
     SET state='APPROVED', reviewed_by=auth.uid(), reviewed_at=now(),
         review_notes=p->>'review_notes'
   WHERE id = v_id;

  v_ref := 'CPL-' || to_char(now(),'YYYYMM') || '-' || upper(substr(md5(v_id::text), 1, 6));

  INSERT INTO public.carrier_payable_lines (
    line_reference, carrier_id, partner_id, order_id, leg_id, pod_submission_id,
    gross_amount, commission_pct, platform_fee, net_payable, basis, accrued_by, idempotency_key)
  VALUES (v_ref, v_sub.carrier_id, v_partner, v_sub.order_id, v_sub.leg_id, v_sub.id,
    v_gross, v_pct, v_fee, v_net,
    jsonb_build_object('source','dispatch_leg_completion','order_total', v_gross,
                       'commission_pct', v_pct, 'pod_reference', v_sub.submission_reference,
                       'pod_integrity_hash', v_sub.integrity_hash),
    auth.uid(), 'cpl:' || v_sub.id::text)
  RETURNING id INTO v_line;

  RETURN jsonb_build_object('ok', true, 'state','APPROVED', 'submission_id', v_id,
    'payable_line_id', v_line, 'line_reference', v_ref,
    'gross_amount', v_gross, 'platform_fee', v_fee, 'net_payable', v_net);
END $$;
REVOKE ALL ON FUNCTION public.carrier_pod_review(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_pod_review(jsonb) TO authenticated, service_role;

-- 6. Release an accrued payable into the carrier wallet ledger.
CREATE OR REPLACE FUNCTION public.carrier_payable_release(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  v_id uuid := (p->>'payable_line_id')::uuid;
  v_line public.carrier_payable_lines;
  v_entry uuid;
BEGIN
  IF NOT public.has_staff_permission('staff.finance.charge.manage') THEN
    RETURN jsonb_build_object('error', true, 'code','AUTHORIZATION_ERROR');
  END IF;
  SELECT * INTO v_line FROM public.carrier_payable_lines WHERE id = v_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('error', true, 'code','NOT_FOUND'); END IF;
  IF v_line.state = 'RELEASED' THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'state','RELEASED',
      'ledger_entry_id', v_line.ledger_entry_id, 'net_payable', v_line.net_payable);
  END IF;

  v_entry := public.partner_ledger_post(
    v_line.partner_id, 'supplier_cost'::partner_ledger_kind, 'CREDIT'::ledger_direction,
    v_line.net_payable,
    'Carrier settlement ' || v_line.line_reference,
    v_line.order_id, NULL, v_line.line_reference,
    'carrier_payable:' || v_line.id::text, true);

  UPDATE public.carrier_payable_lines
     SET state='RELEASED', released_by=auth.uid(), released_at=now(),
         ledger_entry_id=v_entry, updated_at=now()
   WHERE id = v_id;

  RETURN jsonb_build_object('ok', true, 'state','RELEASED', 'payable_line_id', v_id,
    'ledger_entry_id', v_entry, 'net_payable', v_line.net_payable);
END $$;
REVOKE ALL ON FUNCTION public.carrier_payable_release(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.carrier_payable_release(jsonb) TO authenticated, service_role;