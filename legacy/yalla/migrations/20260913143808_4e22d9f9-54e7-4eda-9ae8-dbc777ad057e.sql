-- =====================================================================
-- RENTAL ORCHESTRATION — PHASE 5: PROVIDERS + POLICY EVALUATION
-- =====================================================================

-- ------------------------------------------------------- providers
CREATE TABLE public.rental_providers (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name              text NOT NULL,
  provider_type     text NOT NULL DEFAULT 'THIRD_PARTY'
                      CHECK (provider_type IN ('YALLA','THIRD_PARTY')),
  contact_email     text,
  contact_phone     text,
  kra_pin           text,
  commission_pct    numeric(5,2),
  settlement_terms  text,
  status            text NOT NULL DEFAULT 'ONBOARDING'
                      CHECK (status IN ('ONBOARDING','ACTIVE','SUSPENDED','EXITED')),
  compliance_state  text NOT NULL DEFAULT 'EVIDENCE_REQUIRED'
                      CHECK (compliance_state IN ('EVIDENCE_REQUIRED','VERIFIED','EXPIRED')),
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_providers IS
  'Rental supply owners. Commission and settlement terms are only ever the agreed contractual values — never defaulted.';
GRANT SELECT, INSERT, UPDATE ON public.rental_providers TO authenticated;
GRANT ALL ON public.rental_providers TO service_role;
ALTER TABLE public.rental_providers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental providers" ON public.rental_providers
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE POLICY "Staff manage rental providers" ON public.rental_providers
  FOR ALL TO authenticated
  USING (public.has_staff_permission('staff.commercial.write'))
  WITH CHECK (public.has_staff_permission('staff.commercial.write'));
CREATE TRIGGER trg_rental_providers_touch BEFORE UPDATE ON public.rental_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.rental_fleet_units
  ADD COLUMN IF NOT EXISTS provider_id uuid REFERENCES public.rental_providers(id) ON DELETE RESTRICT;
COMMENT ON COLUMN public.rental_fleet_units.provider_id IS
  'Owner of the vehicle. NULL means the owner has not been recorded yet — it is never assumed to be Yalla.';

-- ---------------------------------------------------- policy engine
CREATE TABLE public.rental_policies (
  policy_code      text PRIMARY KEY,
  label            text NOT NULL,
  evaluation_point text NOT NULL CHECK (evaluation_point IN
                     ('QUOTE_REQUEST','QUOTE_ACCEPTANCE','BOOKING_CONFIRMATION',
                      'PICKUP','RETURN','CANCELLATION','REFUND','VEHICLE_ACTIVATION')),
  rule_type        text NOT NULL CHECK (rule_type IN ('HARD_GATE','APPROVAL','CHARGE','ADVISORY')),
  config           jsonb NOT NULL DEFAULT '{}'::jsonb,
  state            text NOT NULL DEFAULT 'ACTIVE'
                     CHECK (state IN ('ACTIVE','POLICY_REQUIRED','DISABLED')),
  owner_decision   text,
  note             text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.rental_policies IS
  'Configurable policy evaluation points. A rule marked POLICY_REQUIRED is a decision the business owner has not made — it is never silently invented or enforced with a guessed value.';
GRANT SELECT ON public.rental_policies TO authenticated;
GRANT ALL ON public.rental_policies TO service_role;
ALTER TABLE public.rental_policies ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read rental policies" ON public.rental_policies
  FOR SELECT TO authenticated
  USING (public.has_staff_permission('staff.commercial.read')
      OR public.has_staff_permission('staff.commercial.write')
      OR public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'super_admin'));
CREATE TRIGGER trg_rental_policies_touch BEFORE UPDATE ON public.rental_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.rental_policies (policy_code, label, evaluation_point, rule_type, config, state, note) VALUES
 ('START_DATE_NOT_PAST','Rental cannot start in the past','QUOTE_REQUEST','HARD_GATE','{}','ACTIVE',NULL),
 ('RENTAL_LENGTH_BOUNDS','Rental length between 1 and 365 days','QUOTE_REQUEST','HARD_GATE','{"min_days":1,"max_days":365}','ACTIVE',NULL),
 ('CLASS_MUST_BE_PUBLISHED','Only classes on the published rate card may be quoted','QUOTE_REQUEST','HARD_GATE','{}','ACTIVE',NULL),
 ('REAL_UNIT_MUST_BE_FREE','A real vehicle of the class must be free for the dates','QUOTE_REQUEST','HARD_GATE','{}','ACTIVE',NULL),
 ('SERVER_AUTHORITATIVE_PRICE','Price is computed server-side from the published rate card','QUOTE_ACCEPTANCE','HARD_GATE','{}','ACTIVE',NULL),
 ('FULL_AMOUNT_BEFORE_CONFIRMATION','Full quoted amount must be verified before a booking is confirmed','BOOKING_CONFIRMATION','HARD_GATE','{}','ACTIVE','Owner decision: reservation amount is the full quoted amount.'),
 ('VEHICLE_READINESS_COMPLETE','A vehicle may only be let once its readiness audit passes','VEHICLE_ACTIVATION','HARD_GATE','{}','ACTIVE',NULL),
 ('HANDOVER_EVIDENCE_REQUIRED','Pickup and return require recorded evidence','PICKUP','HARD_GATE','{}','ACTIVE',NULL),
 ('DRIVER_LICENCE_VERIFICATION','Self-drive licence and identity verification','PICKUP','HARD_GATE','{}','POLICY_REQUIRED','No licence or minimum-age rule has been given.'),
 ('SECURITY_DEPOSIT','Security deposit basis and release','BOOKING_CONFIRMATION','CHARGE','{}','POLICY_REQUIRED','No deposit amount, basis or release rule has been given.'),
 ('CANCELLATION_WINDOW','Cancellation window and fee','CANCELLATION','CHARGE','{}','POLICY_REQUIRED','No cancellation window or fee has been given.'),
 ('REFUND_BASIS','Refundable share of a cancelled rental','REFUND','CHARGE','{}','POLICY_REQUIRED','No refund rule has been given — every refund is a human decision.'),
 ('LATE_RETURN_CHARGE','Late return charge','RETURN','CHARGE','{}','POLICY_REQUIRED','No late-return charge has been given.'),
 ('EXCESS_MILEAGE_CHARGE','Charge beyond included mileage','RETURN','CHARGE','{}','POLICY_REQUIRED','Rate-card mileage is used for quoting; the post-rental excess charge rule is undefined.'),
 ('CORPORATE_APPROVAL','Corporate approver sign-off before confirmation','BOOKING_CONFIRMATION','APPROVAL','{}','POLICY_REQUIRED','Corporate rental approval thresholds have not been given.'),
 ('CORPORATE_CREDIT_LIMIT','Credit account and purchase-order limits','QUOTE_ACCEPTANCE','APPROVAL','{}','POLICY_REQUIRED','No corporate rental credit terms have been given.'),
 ('PROVIDER_COMPLIANCE_VALID','Third-party provider compliance must be verified','BOOKING_CONFIRMATION','HARD_GATE','{}','ACTIVE','Enforced only for vehicles with a recorded provider.');

-- Deterministic evaluation of the ACTIVE hard gates at a point in the flow.
CREATE OR REPLACE FUNCTION public.rental_policy_evaluate(
  _evaluation_point text, _context jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE pt text := upper(coalesce(_evaluation_point,''));
        decisions jsonb := '[]'::jsonb;
        outstanding jsonb := '[]'::jsonb;
        allow boolean := true;
        p record; verdict text; detail text;
BEGIN
  FOR p IN SELECT * FROM public.rental_policies
            WHERE evaluation_point = pt AND state <> 'DISABLED' ORDER BY policy_code
  LOOP
    IF p.state = 'POLICY_REQUIRED' THEN
      outstanding := outstanding || jsonb_build_object('policy_code', p.policy_code,
        'label', p.label, 'rule_type', p.rule_type, 'note', p.note);
      CONTINUE;
    END IF;

    verdict := 'PASS'; detail := NULL;

    IF p.policy_code = 'START_DATE_NOT_PAST' THEN
      IF (_context ->> 'start_date') IS NULL THEN verdict := 'NOT_EVALUATED';
      ELSIF (_context ->> 'start_date')::date < current_date THEN
        verdict := 'FAIL'; detail := 'START_DATE_IN_THE_PAST';
      END IF;

    ELSIF p.policy_code = 'RENTAL_LENGTH_BOUNDS' THEN
      IF (_context ->> 'rental_days') IS NULL THEN verdict := 'NOT_EVALUATED';
      ELSIF (_context ->> 'rental_days')::int < (p.config ->> 'min_days')::int
         OR (_context ->> 'rental_days')::int > (p.config ->> 'max_days')::int THEN
        verdict := 'FAIL'; detail := 'RENTAL_LENGTH_OUT_OF_BOUNDS';
      END IF;

    ELSIF p.policy_code = 'CLASS_MUST_BE_PUBLISHED' THEN
      IF (_context ->> 'band_label') IS NULL THEN verdict := 'NOT_EVALUATED';
      ELSIF NOT EXISTS (
        SELECT 1 FROM public.asset_pricing_bands b
          JOIN public.asset_pricing_versions v ON v.id = b.version_id
         WHERE v.status = 'published' AND b.label = (_context ->> 'band_label')
      ) THEN verdict := 'FAIL'; detail := 'CLASS_NOT_ON_PUBLISHED_RATE_CARD';
      END IF;

    ELSIF p.policy_code = 'REAL_UNIT_MUST_BE_FREE' THEN
      IF (_context ->> 'units_free') IS NULL THEN verdict := 'NOT_EVALUATED';
      ELSIF (_context ->> 'units_free')::int < 1 THEN
        verdict := 'FAIL'; detail := 'NO_VEHICLE_FREE_ON_THOSE_DATES';
      END IF;

    ELSIF p.policy_code = 'FULL_AMOUNT_BEFORE_CONFIRMATION' THEN
      IF (_context ->> 'amount_paid_kes') IS NULL OR (_context ->> 'total_kes') IS NULL THEN
        verdict := 'NOT_EVALUATED';
      ELSIF (_context ->> 'amount_paid_kes')::numeric < (_context ->> 'total_kes')::numeric THEN
        verdict := 'FAIL'; detail := 'AMOUNT_SHORTFALL';
      END IF;

    ELSIF p.policy_code = 'VEHICLE_READINESS_COMPLETE' THEN
      IF (_context ->> 'unit_id') IS NULL THEN verdict := 'NOT_EVALUATED';
      ELSIF NOT EXISTS (SELECT 1 FROM public.v_rental_unit_readiness r
                         WHERE r.unit_id = (_context ->> 'unit_id')::uuid AND r.may_be_activated) THEN
        verdict := 'FAIL'; detail := 'RENTAL_UNIT_READINESS_INCOMPLETE';
      END IF;

    ELSIF p.policy_code = 'HANDOVER_EVIDENCE_REQUIRED' THEN
      IF (_context ->> 'handover_recorded') IS NULL THEN verdict := 'NOT_EVALUATED';
      ELSIF (_context ->> 'handover_recorded')::boolean IS NOT true THEN
        verdict := 'FAIL'; detail := 'HANDOVER_EVIDENCE_MISSING';
      END IF;

    ELSIF p.policy_code = 'PROVIDER_COMPLIANCE_VALID' THEN
      IF (_context ->> 'provider_id') IS NULL THEN verdict := 'NOT_APPLICABLE';
      ELSIF NOT EXISTS (SELECT 1 FROM public.rental_providers pr
                         WHERE pr.id = (_context ->> 'provider_id')::uuid
                           AND pr.status = 'ACTIVE' AND pr.compliance_state = 'VERIFIED') THEN
        verdict := 'FAIL'; detail := 'PROVIDER_COMPLIANCE_NOT_VERIFIED';
      END IF;

    ELSE
      verdict := 'NOT_EVALUATED';
    END IF;

    IF verdict = 'FAIL' AND p.rule_type = 'HARD_GATE' THEN allow := false; END IF;

    decisions := decisions || jsonb_build_object('policy_code', p.policy_code, 'label', p.label,
      'rule_type', p.rule_type, 'verdict', verdict, 'detail', detail);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'evaluation_point', pt, 'allow', allow,
    'decisions', decisions, 'outstanding_policies', outstanding,
    'outstanding_count', jsonb_array_length(outstanding));
END; $$;
REVOKE ALL ON FUNCTION public.rental_policy_evaluate(text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rental_policy_evaluate(text,jsonb) TO authenticated, service_role;