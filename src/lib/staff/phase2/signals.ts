/**
 * Phase 2 — Notification Engine rules: Event → Rule → Notification → Action → Audit.
 *
 * Rules are declarative and reference real platform events/tables; a rule with
 * `source: null` cannot fire and is reported as a readiness gap rather than
 * shown as an active alert.
 */

export interface NotificationRule {
  key: string;
  domain: string;
  event: string;
  /** Table or edge function that emits the event, null when not yet wired. */
  source: string | null;
  condition: string;
  notify: string;
  action: string;
  /** Table receiving the audit record for the resulting action. */
  audit: string;
}

export const NOTIFICATION_RULES: readonly NotificationRule[] = [
  {
    key: "opportunity_inactive",
    domain: "Sales",
    event: "Opportunity inactive",
    source: null,
    condition: "No activity for configured idle window",
    notify: "Owning sales executive + sales manager",
    action: "Create follow-up task",
    audit: "staff_follow_up_tasks",
  },
  {
    key: "invoice_overdue",
    domain: "Finance",
    event: "Invoice overdue",
    source: "corporate_invoices",
    condition: "Due date passed and status not paid",
    notify: "Finance manager + account owner",
    action: "Collections task + dunning approval",
    audit: "audit_logs",
  },
  {
    key: "supply_shortage",
    domain: "Marketplace",
    event: "Supply shortage",
    source: "dispatch_supply_cells",
    condition: "Demand signal exceeds available supply in cell",
    notify: "Marketplace supply manager",
    action: "Partner activation / incentive task",
    audit: "audit_logs",
  },
  {
    key: "sla_breach_risk",
    domain: "Operations",
    event: "SLA approaching breach",
    source: "alerts_events",
    condition: "Elapsed time within configured warning threshold",
    notify: "Operations manager on duty",
    action: "Intervention on booking / delivery",
    audit: "audit_logs",
  },
  {
    key: "review_due",
    domain: "People",
    event: "Performance review due",
    source: null,
    condition: "Review date reached",
    notify: "Line manager + employee",
    action: "Open performance cycle",
    audit: "audit_logs",
  },
  {
    key: "document_expiry",
    domain: "Compliance",
    event: "Document approaching expiry",
    source: "corporate_documents",
    condition: "Expiry within 30 days or already expired",
    notify: "Document owner + compliance",
    action: "Re-upload & re-verification workflow",
    audit: "corporate_document_audit_log",
  },
  {
    key: "wallet_finance_alert",
    domain: "Finance",
    event: "Wallet / reconciliation anomaly",
    source: "charter_wallet_finance_alerts",
    condition: "Ledger and provider balance mismatch",
    notify: "Revenue assurance",
    action: "Reconciliation exception with owner",
    audit: "charter_wallet_finance_actions",
  },
  {
    key: "critical_risk",
    domain: "Executive",
    event: "Critical organisational risk",
    source: "alerts_events",
    condition: "High-impact risk overdue for mitigation",
    notify: "Executive committee",
    action: "Escalation and decision record",
    audit: "approval_decisions",
  },
];

export function unwiredRules(): NotificationRule[] {
  return NOTIFICATION_RULES.filter((r) => !r.source);
}
