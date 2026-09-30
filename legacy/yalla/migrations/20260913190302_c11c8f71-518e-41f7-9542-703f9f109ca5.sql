-- ===================== Rental certification catalogue: groups, controls, gates =====================
ALTER TABLE public.rental_controls ADD COLUMN IF NOT EXISTS control_group text;
ALTER TABLE public.rental_controls ADD COLUMN IF NOT EXISTS sort_order integer;

UPDATE public.rental_controls SET control_group = CASE upper(domain)
  WHEN 'INTEGRITY' THEN 'ARCHITECTURE'
  WHEN 'ORCHESTRATION' THEN 'ARCHITECTURE'
  WHEN 'DATA' THEN 'DATA_GOVERNANCE'
  WHEN 'ELIGIBILITY' THEN 'BOOKING'
  WHEN 'FULFILMENT' THEN 'BOOKING'
  WHEN 'FINANCE' THEN 'FINANCIAL'
  WHEN 'FLEET' THEN 'INVENTORY'
  WHEN 'INVENTORY' THEN 'INVENTORY'
  WHEN 'CORPORATE' THEN 'POLICY'
  WHEN 'POLICY' THEN 'POLICY'
  WHEN 'SECURITY' THEN 'SECURITY'
  WHEN 'PERFORMANCE' THEN 'OBSERVABILITY'
  WHEN 'NOTIFICATION' THEN 'OPERATIONS'
  WHEN 'OPERATIONS' THEN 'OPERATIONS'
  WHEN 'RESILIENCE' THEN 'RESILIENCE'
  ELSE 'OPERATIONS' END
WHERE control_group IS NULL;

INSERT INTO public.rental_controls
  (control_code, control_group, domain, title, requirement, evidence_kind, severity, mandatory, note)
VALUES
-- ARCHITECTURE
('ARC-01','ARCHITECTURE','ARCHITECTURE','Domain authority register','Every rental entity has exactly one authoritative owner recorded in rental_domain_authority.','EXECUTED_DB_PROBE','P1',true,NULL),
('ARC-02','ARCHITECTURE','ARCHITECTURE','State machines live in the database','Legal transitions are defined as data and enforced by triggers, not by application code.','EXECUTED_DB_PROBE','P0',true,NULL),
('ARC-03','ARCHITECTURE','ARCHITECTURE','Append-only domain events','rental_domain_events is append-only and every row carries a correlation id.','EXECUTED_DB_PROBE','P0',true,NULL),
('ARC-04','ARCHITECTURE','ARCHITECTURE','Orchestration hand-off','Escalating rental events are published to the shared ops outbox for the orchestrator.','EXECUTED_DB_PROBE','P1',true,NULL),
('ARC-05','ARCHITECTURE','ARCHITECTURE','Saga with compensation','Multi-step operations run as a saga whose steps record their compensating action.','EXECUTED_DB_PROBE','P0',true,NULL),
('ARC-06','ARCHITECTURE','ARCHITECTURE','Idempotency register','Every money or inventory operation claims an idempotency key before acting.','EXECUTED_DB_PROBE','P0',true,NULL),
('ARC-07','ARCHITECTURE','ARCHITECTURE','Server-authoritative pricing','A client-supplied price can never reach a quotation or booking total.','EXECUTED_DB_PROBE','P0',true,NULL),
('ARC-08','ARCHITECTURE','ARCHITECTURE','Provider abstraction','Nothing assumes the vehicle is Yalla-owned; ownership is a provider attribute.','EXECUTED_DB_PROBE','P1',true,NULL),
-- SECURITY
('SEC-01','SECURITY','SECURITY','Row level security everywhere','Every rental table has row level security enabled.','EXECUTED_DB_PROBE','P0',true,NULL),
('SEC-02','SECURITY','SECURITY','No anonymous read of inventory or bookings','Anonymous callers hold no read grant on rental inventory, booking or ledger tables.','EXECUTED_DB_PROBE','P0',true,NULL),
('SEC-03','SECURITY','SECURITY','Privileged routines closed to anonymous','Rental SECURITY DEFINER routines are revoked from anon unless they are declared public entrypoints.','EXECUTED_DB_PROBE','P0',true,NULL),
('SEC-04','SECURITY','SECURITY','Quotation access is scoped','A quotation is readable only with its token or by the person who requested it.','ROLE_SESSION_PROBE','P0',true,NULL),
('SEC-05','SECURITY','SECURITY','Corporate data is company-scoped','Company budgets, approvals and balances are readable only by that company''s active employees and authorised staff.','ROLE_SESSION_PROBE','P0',true,NULL),
('SEC-06','SECURITY','SECURITY','Staff mutations are role-gated','Handover, refund, activation and approval routines refuse callers without the required role.','ROLE_SESSION_PROBE','P0',true,NULL),
('SEC-07','SECURITY','SECURITY','Adversarial authorisation testing','Anonymous, customer, provider and staff sessions are each probed against every rental entrypoint.','ROLE_SESSION_PROBE','P0',true,NULL),
('SEC-08','SECURITY','SECURITY','Event payload minimisation','Domain event payloads carry references, not unnecessary personal data.','EXECUTED_DB_PROBE','P1',true,NULL),
-- INVENTORY
('INV-01','INVENTORY','INVENTORY','Readiness precedes activation','A unit cannot become bookable until every readiness check has recorded evidence.','EXECUTED_DB_PROBE','P0',true,NULL),
('INV-02','INVENTORY','INVENTORY','No overlapping commitments','The database itself refuses two commitments on one unit for overlapping dates.','EXECUTED_DB_PROBE','P0',true,NULL),
('INV-03','INVENTORY','INVENTORY','Concurrency certification','Two simultaneous reservations for the last unit: exactly one succeeds, under real concurrency.','ISOLATED_CONCURRENCY_PROBE','P0',true,NULL),
('INV-04','INVENTORY','INVENTORY','Availability combines all blockers','Availability subtracts maintenance, compliance expiry, existing reservations and blackout windows.','EXECUTED_DB_PROBE','P0',true,NULL),
('INV-05','INVENTORY','INVENTORY','Atomic reservation with confirmation','Reservation and booking confirmation succeed or fail together.','STAGING_END_TO_END','P0',true,NULL),
('INV-06','INVENTORY','INVENTORY','Reallocation on unit failure','When a committed unit fails, reallocation is attempted before any customer impact.','EXECUTED_DB_PROBE','P1',true,NULL),
('INV-07','INVENTORY','INVENTORY','Per-unit readiness checklist','Each fleet unit carries a complete, evidenced readiness checklist.','EXECUTED_DB_PROBE','P0',true,NULL),
('INV-08','INVENTORY','INVENTORY','Retired units stay retired','A retired unit cannot be returned to service by any transition.','EXECUTED_DB_PROBE','P1',true,NULL),
-- BOOKING
('BKG-01','BOOKING','BOOKING','Quotation immutability','An issued quotation''s priced terms cannot change; the pricing snapshot is hashed.','EXECUTED_DB_PROBE','P0',true,NULL),
('BKG-02','BOOKING','BOOKING','Quotation expiry enforced','An expired quotation cannot be paid, submitted or converted.','EXECUTED_DB_PROBE','P0',true,NULL),
('BKG-03','BOOKING','BOOKING','Confirmation requires verified payment','A booking is confirmed only against a verified provider payment record.','EXECUTED_DB_PROBE','P0',true,NULL),
('BKG-04','BOOKING','BOOKING','Booking state machine','Booking statuses follow the declared transition table only.','EXECUTED_DB_PROBE','P0',true,NULL),
('BKG-05','BOOKING','BOOKING','Amendments preserve original terms','An amendment records the original terms alongside the new ones.','EXECUTED_DB_PROBE','P1',true,NULL),
('BKG-06','BOOKING','BOOKING','Cancellation follows an approved policy version','Cancellation outcomes come from a versioned, approved cancellation rule.','EXECUTED_DB_PROBE','P0',true,NULL),
('BKG-07','BOOKING','BOOKING','Handover evidence before status change','Pickup and return statuses require an immutable handover record.','EXECUTED_DB_PROBE','P0',true,NULL),
('BKG-08','BOOKING','BOOKING','Booking truth view','One authorised view shows customer, company, quotation, inventory, payment, policy, events and money for a booking.','EXECUTED_DB_PROBE','P1',true,NULL),
-- PAYMENTS
('PAY-01','PAYMENTS','PAYMENTS','Callback verified against provider record','A payment is accepted only after matching the verified provider transaction.','EXECUTED_DB_PROBE','P0',true,NULL),
('PAY-02','PAYMENTS','PAYMENTS','Payment replay is idempotent','Replaying a callback neither double-charges nor double-books.','EXECUTED_DB_PROBE','P0',true,NULL),
('PAY-03','PAYMENTS','PAYMENTS','Partial payment cannot confirm','A part payment leaves the booking unconfirmed.','EXECUTED_DB_PROBE','P0',true,NULL),
('PAY-04','PAYMENTS','PAYMENTS','Failed reservation after payment compensates','If reservation fails after payment, reallocation or refund is opened automatically.','STAGING_END_TO_END','P0',true,NULL),
('PAY-05','PAYMENTS','PAYMENTS','Refunds only through the refund lifecycle','No refund exists without an eligibility check, approval and provider confirmation.','EXECUTED_DB_PROBE','P0',true,NULL),
('PAY-06','PAYMENTS','PAYMENTS','Provider confirmation before REFUNDED','A refund reaches REFUNDED only with a recorded provider confirmation.','EXECUTED_DB_PROBE','P0',true,NULL),
('PAY-07','PAYMENTS','PAYMENTS','No default payer number','Every collection takes the payer''s number at runtime.','EXECUTED_DB_PROBE','P0',true,NULL),
('PAY-08','PAYMENTS','PAYMENTS','Payment path performance','Payment settlement latency and error rate are measured and recorded.','MEASUREMENT','P1',true,NULL),
-- FINANCIAL
('FIN-01','FINANCIAL','FINANCIAL','Ledger balances','Every ledger entry''s debits equal its credits.','EXECUTED_DB_PROBE','P0',true,NULL),
('FIN-02','FINANCIAL','FINANCIAL','Deposits are not revenue','Security deposits are held on a separate account with hold, release and deduction states.','EXECUTED_DB_PROBE','P0',true,NULL),
('FIN-03','FINANCIAL','FINANCIAL','Tax separated','VAT is posted as its own line, never merged into the rental charge.','EXECUTED_DB_PROBE','P0',true,NULL),
('FIN-04','FINANCIAL','FINANCIAL','Discount authority','A discount records who authorised it and under which rule.','EXECUTED_DB_PROBE','P1',true,NULL),
('FIN-05','FINANCIAL','FINANCIAL','Provider payable and commission','Provider payable and Yalla commission are posted per settled booking.','EXECUTED_DB_PROBE','P0',true,NULL),
('FIN-06','FINANCIAL','FINANCIAL','Reversals, never deletions','Corrections are posted as reversing entries; nothing is deleted or edited.','EXECUTED_DB_PROBE','P0',true,NULL),
('FIN-07','FINANCIAL','FINANCIAL','Three-way reconciliation','Booking value, provider payment and ledger agree, and breaks are raised as exceptions.','EXECUTED_DB_PROBE','P0',true,NULL),
('FIN-08','FINANCIAL','FINANCIAL','Revenue on settlement only','Revenue is recognised only for settled bookings, never on quotation or approval.','EXECUTED_DB_PROBE','P0',true,NULL),
-- POLICY
('POL-01','POLICY','POLICY','Every rule is versioned','Each rule has a version, scope and effective dates.','EXECUTED_DB_PROBE','P0',true,NULL),
('POL-02','POLICY','POLICY','No rule hard-coded','No cancellation, deposit, mileage or late-return value is written into application code.','EXECUTED_DB_PROBE','P0',true,NULL),
('POL-03','POLICY','POLICY','Decision log','Every evaluation records rule, version, input, decision, reason, actor and time.','EXECUTED_DB_PROBE','P0',true,NULL),
('POL-04','POLICY','POLICY','Pending rules block release','Any rule awaiting business approval keeps its release gate closed.','EXECUTED_DB_PROBE','P0',true,NULL),
('POL-05','POLICY','POLICY','Cancellation tiers approved','The tiered cancellation schedule is approved by the business owner.','OWNER_DECISION','P0',true,NULL),
('POL-06','POLICY','POLICY','Charges approved','Deposit, late return and excess mileage charges are approved by the business owner.','OWNER_DECISION','P0',true,NULL),
('POL-07','POLICY','POLICY','Licence verification is a hard gate','Driving licence verification blocks handover; it is not a tick box.','EXECUTED_DB_PROBE','P0',true,NULL),
('POL-08','POLICY','POLICY','Corporate approval and credit enforced','Company bookings cannot bypass approval, budget or credit limits.','EXECUTED_DB_PROBE','P0',true,NULL),
-- OPERATIONS
('OPS-01','OPERATIONS','OPERATIONS','Exception lifecycle','Exceptions move from detected through classified, actioned, resolved, verified and closed.','EXECUTED_DB_PROBE','P0',true,NULL),
('OPS-02','OPERATIONS','OPERATIONS','Exception classification','Each exception is machine-resolved, human-required, approval-required or a system fault.','EXECUTED_DB_PROBE','P1',true,NULL),
('OPS-03','OPERATIONS','OPERATIONS','SLA and escalation','Each exception carries an owner, deadline and escalation path.','EXECUTED_DB_PROBE','P1',true,NULL),
('OPS-04','OPERATIONS','OPERATIONS','Control tower','One console shows live operations, inventory, money, exceptions, policy and certification.','EXECUTED_DB_PROBE','P1',true,NULL),
('OPS-05','OPERATIONS','OPERATIONS','Automation rate measured','The share of exceptions resolved without a human is measured.','EXECUTED_DB_PROBE','P2',true,NULL),
('OPS-06','OPERATIONS','OPERATIONS','Corporate portal','A company can set a budget, submit a booking for approval and see its balance.','EXECUTED_DB_PROBE','P1',true,NULL),
-- OBSERVABILITY
('OBS-01','OBSERVABILITY','OBSERVABILITY','Correlation identifiers','Quotation, booking, payment, event, saga and exception records share a correlation id.','EXECUTED_DB_PROBE','P1',true,NULL),
('OBS-02','OBSERVABILITY','OBSERVABILITY','Latency distribution','Availability, reconciliation and control tower paths report p50, p95 and p99.','MEASUREMENT','P1',true,NULL),
('OBS-03','OBSERVABILITY','OBSERVABILITY','Error rate and contention','Failed operations and lock waits are counted, not estimated.','MEASUREMENT','P1',true,NULL),
('OBS-04','OBSERVABILITY','OBSERVABILITY','Alerting on severe exceptions','P0 and P1 exceptions raise an alert to a named owner.','EXECUTED_DB_PROBE','P1',true,NULL),
('OBS-05','OBSERVABILITY','OBSERVABILITY','Scheduled certification run','The certification run executes on schedule and stores its evidence.','EXECUTED_DB_PROBE','P1',true,NULL),
-- RESILIENCE
('RES-01','RESILIENCE','RESILIENCE','Dead-letter replay','Undeliverable events land in a dead-letter queue and can be replayed once.','EXECUTED_DB_PROBE','P1',true,NULL),
('RES-02','RESILIENCE','RESILIENCE','Failure injection','Provider timeout, callback loss and reservation failure are injected and survived.','STAGING_END_TO_END','P0',true,NULL),
('RES-03','RESILIENCE','RESILIENCE','Safety jobs separated from destructive tests','Production jobs only observe and reconcile; destructive and concurrency tests run only on staging.','EXECUTED_DB_PROBE','P0',true,NULL),
('RES-04','RESILIENCE','RESILIENCE','Backup and restore evidence','A real restore into an isolated database is executed and checksummed.','EXTERNAL_DOCUMENT','P0',true,NULL),
('RES-05','RESILIENCE','RESILIENCE','Recovery objectives tested','Recovery point and recovery time objectives are stated and demonstrated.','EXTERNAL_DOCUMENT','P0',true,NULL),
-- COMPLIANCE
('CMP-01','COMPLIANCE','COMPLIANCE','Vehicle compliance before activation','Insurance and inspection validity are checked before a unit becomes bookable.','EXECUTED_DB_PROBE','P0',true,NULL),
('CMP-02','COMPLIANCE','COMPLIANCE','Driver licence records','Licence evidence captured at handover is retained against the booking.','EXECUTED_DB_PROBE','P0',true,NULL),
('CMP-03','COMPLIANCE','COMPLIANCE','Tax invoicing','Rental invoices meet Kenyan tax invoicing requirements.','EXTERNAL_DOCUMENT','P0',true,NULL),
('CMP-04','COMPLIANCE','COMPLIANCE','Terms versioned and accepted','The rental terms version accepted by the customer is recorded.','EXECUTED_DB_PROBE','P0',true,NULL),
-- DATA GOVERNANCE
('DAT-01','DATA_GOVERNANCE','DATA_GOVERNANCE','Immutable audit trail','Handovers, events, ledger lines and evidence cannot be edited or deleted.','EXECUTED_DB_PROBE','P0',true,NULL),
('DAT-02','DATA_GOVERNANCE','DATA_GOVERNANCE','Retention rules','Retention and deletion rules exist for customer and handover data.','OWNER_DECISION','P1',true,NULL),
('DAT-03','DATA_GOVERNANCE','DATA_GOVERNANCE','No fabricated production data','Production rental tables contain no seeded, sample or test records.','EXECUTED_DB_PROBE','P0',true,NULL),
-- PARTNER MANAGEMENT
('PTR-01','PARTNER','PARTNER','Provider onboarding state','Each provider carries an onboarding and compliance state that gates its units.','EXECUTED_DB_PROBE','P1',true,NULL),
('PTR-02','PARTNER','PARTNER','Provider settlement statements','Provider payables are summarised per period from the ledger.','EXECUTED_DB_PROBE','P1',true,NULL),
('PTR-03','PARTNER','PARTNER','Provider performance','Provider reliability and damage history are measured from records.','EXECUTED_DB_PROBE','P2',true,NULL)
ON CONFLICT (control_code) DO NOTHING;

-- Baseline verdict for newly catalogued controls: registered, never executed.
INSERT INTO public.rental_control_evidence (control_code, verdict, environment, executed_by, evidence, blocked_reason)
SELECT c.control_code, 'NOT_TESTED', 'catalogue', 'catalogue-registration',
       jsonb_build_object('reason','Control catalogued; awaiting execution'),
       'CATALOGUE_REGISTERED_NOT_YET_EXECUTED'
  FROM public.rental_controls c
 WHERE NOT EXISTS (SELECT 1 FROM public.rental_control_evidence e WHERE e.control_code = c.control_code);

-- One release gate per catalogue group.
INSERT INTO public.rental_release_gates (gate_code, label, sort_order, description) VALUES
  ('GC_ARCHITECTURE','Architecture & orchestration',101,'Domain ownership, state machines, events, sagas, idempotency.'),
  ('GC_SECURITY','Security & access',102,'Row level security, scoped access, adversarial authorisation testing.'),
  ('GC_INVENTORY','Inventory integrity',103,'Readiness, non-overlapping commitments, concurrency, availability.'),
  ('GC_BOOKING','Booking lifecycle',104,'Quotation, confirmation, amendment, cancellation, handover.'),
  ('GC_PAYMENTS','Payments',105,'Verification, idempotency, compensation, refunds.'),
  ('GC_FINANCIAL','Financial control',106,'Ledger, deposits, tax, commission, reconciliation, revenue.'),
  ('GC_POLICY','Policy governance',107,'Versioned rules, decision log, business approvals.'),
  ('GC_OPERATIONS','Operations',108,'Exceptions, SLA, control tower, corporate portal.'),
  ('GC_OBSERVABILITY','Observability',109,'Correlation, latency distribution, error rate, alerting.'),
  ('GC_RESILIENCE','Resilience & recovery',110,'Dead letters, failure injection, backup and restore.'),
  ('GC_COMPLIANCE','Compliance',111,'Vehicle compliance, licence records, tax invoicing, terms.'),
  ('GC_DATA','Data governance',112,'Immutable audit trail, retention, no fabricated data.'),
  ('GC_PARTNER','Partner management',113,'Provider onboarding, settlement, performance.')
ON CONFLICT (gate_code) DO NOTHING;

INSERT INTO public.rental_gate_controls (gate_code, control_code)
SELECT CASE c.control_group
         WHEN 'ARCHITECTURE' THEN 'GC_ARCHITECTURE'
         WHEN 'SECURITY' THEN 'GC_SECURITY'
         WHEN 'INVENTORY' THEN 'GC_INVENTORY'
         WHEN 'BOOKING' THEN 'GC_BOOKING'
         WHEN 'PAYMENTS' THEN 'GC_PAYMENTS'
         WHEN 'FINANCIAL' THEN 'GC_FINANCIAL'
         WHEN 'POLICY' THEN 'GC_POLICY'
         WHEN 'OPERATIONS' THEN 'GC_OPERATIONS'
         WHEN 'OBSERVABILITY' THEN 'GC_OBSERVABILITY'
         WHEN 'RESILIENCE' THEN 'GC_RESILIENCE'
         WHEN 'COMPLIANCE' THEN 'GC_COMPLIANCE'
         WHEN 'DATA_GOVERNANCE' THEN 'GC_DATA'
         WHEN 'PARTNER' THEN 'GC_PARTNER'
       END, c.control_code
  FROM public.rental_controls c
 WHERE c.control_group IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.rental_gate_controls g WHERE g.control_code = c.control_code)
ON CONFLICT DO NOTHING;

-- Grouped catalogue view for the operations console.
CREATE OR REPLACE VIEW public.v_rental_catalogue_groups AS
SELECT c.control_group,
       count(*)::bigint AS controls,
       count(*) FILTER (WHERE v.verdict = 'PASS')::bigint AS passed,
       count(*) FILTER (WHERE v.verdict = 'FAIL')::bigint AS failed,
       count(*) FILTER (WHERE v.verdict = 'PARTIAL')::bigint AS partial,
       count(*) FILTER (WHERE v.verdict = 'BLOCKED')::bigint AS blocked,
       count(*) FILTER (WHERE v.verdict = 'NOT_TESTED' OR v.verdict IS NULL)::bigint AS not_tested,
       count(*) FILTER (WHERE v.verdict = 'REQUIRES_EXTERNAL_ACTION')::bigint AS requires_external_action,
       count(*) FILTER (WHERE c.severity = 'P0' AND coalesce(v.verdict,'NOT_TESTED') <> 'PASS')::bigint AS open_p0
  FROM public.rental_controls c
  LEFT JOIN public.v_rental_certification v ON v.control_code = c.control_code
 GROUP BY c.control_group;

ALTER VIEW public.v_rental_catalogue_groups SET (security_invoker = true);
GRANT SELECT ON public.v_rental_catalogue_groups TO authenticated;