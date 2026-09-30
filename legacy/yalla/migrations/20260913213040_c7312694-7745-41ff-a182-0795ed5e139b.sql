CREATE POLICY identity_discovery_rate_staff_read ON public.identity_discovery_rate
FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

-- ============================================================
-- SECURITY CLAIMS REGISTER
-- ============================================================
CREATE TABLE public.security_claims (
  claim_code text PRIMARY KEY,
  surface text NOT NULL,
  wording text,
  implementation text NOT NULL,
  owner text NOT NULL,
  audience text NOT NULL DEFAULT 'PUBLIC',
  requested_display boolean NOT NULL DEFAULT true,
  withheld_reason text,
  review_interval_days integer NOT NULL DEFAULT 90,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.security_claims TO anon, authenticated;
GRANT ALL ON public.security_claims TO service_role;
ALTER TABLE public.security_claims ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_claims_public_read ON public.security_claims FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY security_claims_admin_write ON public.security_claims FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE TRIGGER trg_security_claims_touch BEFORE UPDATE ON public.security_claims
FOR EACH ROW EXECUTE FUNCTION public.identity_touch();

CREATE TABLE public.security_claim_controls (
  claim_code text NOT NULL REFERENCES public.security_claims(claim_code) ON DELETE CASCADE,
  control_ref text NOT NULL,
  control_kind text NOT NULL CHECK (control_kind IN ('DB_POLICY','DB_FUNCTION','DB_TABLE','CI_GATE','PLATFORM_SERVICE','EXTERNAL_AUDIT')),
  description text NOT NULL,
  PRIMARY KEY (claim_code, control_ref)
);
GRANT SELECT ON public.security_claim_controls TO authenticated;
GRANT ALL ON public.security_claim_controls TO service_role;
ALTER TABLE public.security_claim_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_claim_controls_read ON public.security_claim_controls FOR SELECT TO authenticated USING (true);
CREATE POLICY security_claim_controls_admin_write ON public.security_claim_controls FOR ALL TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]))
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));

CREATE TABLE public.security_claim_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_code text NOT NULL REFERENCES public.security_claims(claim_code) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('PASS','PARTIAL','FAIL','BLOCKED','NOT_TESTED','REQUIRES_EXTERNAL_ACTION')),
  environment text NOT NULL,
  observation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  executed_by uuid,
  executed_at timestamptz NOT NULL DEFAULT now(),
  digest text GENERATED ALWAYS AS (md5(claim_code || verdict || observation)) STORED
);
CREATE INDEX security_claim_evidence_latest ON public.security_claim_evidence (claim_code, executed_at DESC);
GRANT SELECT ON public.security_claim_evidence TO authenticated;
GRANT ALL ON public.security_claim_evidence TO service_role;
ALTER TABLE public.security_claim_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY security_claim_evidence_read ON public.security_claim_evidence FOR SELECT TO authenticated USING (true);
CREATE POLICY security_claim_evidence_admin_write ON public.security_claim_evidence FOR INSERT TO authenticated
WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[]));
CREATE TRIGGER trg_security_claim_evidence_append_only
BEFORE UPDATE OR DELETE ON public.security_claim_evidence
FOR EACH ROW EXECUTE FUNCTION public.identity_append_only();

CREATE VIEW public.v_security_claims AS
SELECT c.claim_code, c.surface, c.wording, c.implementation, c.owner, c.audience,
       c.requested_display, c.withheld_reason, c.review_interval_days,
       (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) AS controls,
       e.verdict AS latest_verdict,
       e.observation AS latest_observation,
       e.executed_at AS verified_at,
       e.environment,
       (e.executed_at + (c.review_interval_days || ' days')::interval) AS review_due,
       CASE
         WHEN c.wording IS NULL OR NOT c.requested_display THEN false
         WHEN (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) = 0 THEN false
         WHEN e.verdict IS DISTINCT FROM 'PASS' THEN false
         WHEN e.executed_at + (c.review_interval_days || ' days')::interval < now() THEN false
         ELSE true
       END AS safe_to_display,
       CASE
         WHEN c.wording IS NULL THEN 'NO_APPROVED_WORDING'
         WHEN NOT c.requested_display THEN 'WITHHELD_BY_OWNER'
         WHEN (SELECT count(*) FROM public.security_claim_controls k WHERE k.claim_code = c.claim_code) = 0 THEN 'NO_CONTROL'
         WHEN e.verdict IS NULL THEN 'NO_EVIDENCE'
         WHEN e.verdict <> 'PASS' THEN 'EVIDENCE_' || e.verdict
         WHEN e.executed_at + (c.review_interval_days || ' days')::interval < now() THEN 'EVIDENCE_EXPIRED'
         ELSE 'DISPLAYABLE'
       END AS display_state
FROM public.security_claims c
LEFT JOIN LATERAL (
  SELECT * FROM public.security_claim_evidence x
  WHERE x.claim_code = c.claim_code ORDER BY x.executed_at DESC LIMIT 1
) e ON true;
ALTER VIEW public.v_security_claims SET (security_invoker = true);
GRANT SELECT ON public.v_security_claims TO anon, authenticated;

-- ============================================================
-- IDENTITY CERTIFICATION CONTROLS
-- ============================================================
CREATE TABLE public.identity_controls (
  control_code text PRIMARY KEY,
  domain text NOT NULL,
  title text NOT NULL,
  requirement text NOT NULL,
  evidence_kind text NOT NULL,
  severity text NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
  mandatory boolean NOT NULL DEFAULT true,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.identity_controls TO authenticated;
GRANT ALL ON public.identity_controls TO service_role;
ALTER TABLE public.identity_controls ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_controls_staff_read ON public.identity_controls FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
       OR public.has_staff_permission('staff.security.read'));

CREATE TABLE public.identity_control_evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  control_code text NOT NULL REFERENCES public.identity_controls(control_code) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('PASS','PARTIAL','FAIL','BLOCKED','NOT_TESTED','REQUIRES_EXTERNAL_ACTION')),
  environment text NOT NULL,
  observation text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}',
  blocked_reason text,
  executed_by uuid,
  executed_at timestamptz NOT NULL DEFAULT now(),
  digest text GENERATED ALWAYS AS (md5(control_code || verdict || observation)) STORED
);
CREATE INDEX identity_control_evidence_latest ON public.identity_control_evidence (control_code, executed_at DESC);
GRANT SELECT ON public.identity_control_evidence TO authenticated;
GRANT ALL ON public.identity_control_evidence TO service_role;
ALTER TABLE public.identity_control_evidence ENABLE ROW LEVEL SECURITY;
CREATE POLICY identity_control_evidence_staff_read ON public.identity_control_evidence FOR SELECT TO authenticated
USING (public.has_any_role(auth.uid(), ARRAY['admin','super_admin']::app_role[])
       OR public.has_staff_permission('staff.security.read'));
CREATE TRIGGER trg_identity_control_evidence_append_only
BEFORE UPDATE OR DELETE ON public.identity_control_evidence
FOR EACH ROW EXECUTE FUNCTION public.identity_append_only();

CREATE VIEW public.v_identity_certification AS
SELECT c.control_code, c.domain, c.title, c.requirement, c.evidence_kind, c.severity, c.mandatory, c.note,
       coalesce(e.verdict, 'NOT_TESTED') AS verdict,
       e.observation, e.blocked_reason, e.environment, e.executed_at, e.evidence
FROM public.identity_controls c
LEFT JOIN LATERAL (
  SELECT * FROM public.identity_control_evidence x
  WHERE x.control_code = c.control_code ORDER BY x.executed_at DESC LIMIT 1
) e ON true;
ALTER VIEW public.v_identity_certification SET (security_invoker = true);
GRANT SELECT ON public.v_identity_certification TO authenticated;

CREATE VIEW public.v_identity_certification_summary AS
SELECT count(*) AS controls,
       count(*) FILTER (WHERE verdict = 'PASS') AS passed,
       count(*) FILTER (WHERE verdict = 'PARTIAL') AS partial,
       count(*) FILTER (WHERE verdict = 'FAIL') AS failed,
       count(*) FILTER (WHERE verdict = 'BLOCKED') AS blocked,
       count(*) FILTER (WHERE verdict = 'NOT_TESTED') AS not_tested,
       count(*) FILTER (WHERE verdict = 'REQUIRES_EXTERNAL_ACTION') AS requires_external_action,
       CASE WHEN count(*) FILTER (WHERE mandatory AND verdict <> 'PASS') = 0
            THEN 'CERTIFIED' ELSE 'NOT PRODUCTION READY' END AS certification
FROM public.v_identity_certification;
ALTER VIEW public.v_identity_certification_summary SET (security_invoker = true);
GRANT SELECT ON public.v_identity_certification_summary TO authenticated;

-- ============================================================
-- CONTROL CATALOGUE
-- ============================================================
INSERT INTO public.identity_controls (control_code, domain, title, requirement, evidence_kind, severity, note) VALUES
('ID-01','IDENTITY_MODEL','Person, account, organisation and membership are separate','A person may hold a personal account and one or more organisation memberships with distinct roles.','EXECUTED_DB_PROBE','P0',NULL),
('ID-02','DISCOVERY','Account discovery does not enumerate accounts','Discovery returns the applicable sign-in policy for an address without revealing whether an account exists.','EXECUTED_DB_PROBE','P0',NULL),
('ID-03','DISCOVERY','Discovery is rate limited and recorded','Repeated lookups for the same address are refused and every lookup is appended to an immutable log.','EXECUTED_DB_PROBE','P1',NULL),
('ID-04','AUTH_POLICY','Every active policy is approved and versioned','A policy cannot be ACTIVE without an approver and approval timestamp, and only one policy per organisation may be active.','EXECUTED_DB_PROBE','P0',NULL),
('ID-05','AUTH_POLICY','Displayed sign-in methods derive from server configuration','The sign-in page renders only the methods the active policy allows.','EXECUTED_DB_PROBE','P1',NULL),
('ID-06','TENANT_ISOLATION','An organisation member cannot read another organisation''s account record','Cross-tenant read of corporate_accounts returns zero rows for a member of a different organisation.','EXECUTED_DB_PROBE','P0',NULL),
('ID-07','TENANT_ISOLATION','An organisation member cannot read another organisation''s employees','Cross-tenant read of corporate_employees returns zero rows.','EXECUTED_DB_PROBE','P0',NULL),
('ID-08','TENANT_ISOLATION','An organisation member cannot read another organisation''s invoices or ledger','Cross-tenant read of corporate_invoices and corporate_cash_ledger returns zero rows.','EXECUTED_DB_PROBE','P0',NULL),
('ID-09','TENANT_ISOLATION','Client-supplied tenant identifiers are ignored','Substituting another corporate_id in a request does not widen access.','LIVE_API_PROBE','P0',NULL),
('ID-10','SESSION','A person can list only their own sessions','Session listing is scoped to the caller and exposes no session secrets.','EXECUTED_DB_PROBE','P0',NULL),
('ID-11','SESSION','Sessions can be revoked on all devices','Global sign-out revokes every session for the caller.','LIVE_API_PROBE','P1',NULL),
('ID-12','DEVICE','Device records exclude fraud scoring from the owner view','Owner device listing excludes risk score, tamper flags and raw IP address.','EXECUTED_DB_PROBE','P1',NULL),
('ID-13','AUDIT','Sign-in activity is recorded server-side','Every sign-in, failure and passwordless request is appended to the authentication event log.','EXECUTED_DB_PROBE','P0',NULL),
('ID-14','AUDIT','Identity audit records resist alteration','Update and delete on identity audit tables are refused.','EXECUTED_DB_PROBE','P0',NULL),
('ID-15','CLAIM_GOVERNANCE','No security claim is displayed without a control and evidence','Every displayed claim resolves to at least one control and passing evidence inside its review window.','EXECUTED_DB_PROBE','P0',NULL),
('ID-16','MFA','Multi-factor verification for customers','Customers can enrol a second factor and step-up is enforced for sensitive actions.','EXECUTED_DB_PROBE','P1','Not configured for customers today.'),
('ID-17','SSO','Organisation single sign-on','An organisation can authenticate through its own identity provider.','EXTERNAL_EVIDENCE','P2','No SAML/OIDC connection exists on the auth server.'),
('ID-18','RISK','Risk-based step-up authentication','Elevated-risk sign-ins require additional verification.','EXECUTED_DB_PROBE','P2','No customer-facing risk engine.'),
('ID-19','RECOVERY','Account recovery is not a privilege escalation path','Recovery cannot change roles, tenant membership or email without verification.','EXECUTED_DB_PROBE','P0',NULL),
('ID-20','SERVICE_IDENTITY','Service-to-service calls are authenticated and scoped','Privileged routines are executable only by the service role or guarded staff sessions.','EXECUTED_DB_PROBE','P0',NULL);
