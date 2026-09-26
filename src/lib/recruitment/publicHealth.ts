/**
 * Vacancy publication health — internal operations view.
 *
 * Compares Recruitment 360 (`rec_vacancies`) against what the public careers
 * API actually returns, and reports public API latency / failures. All logic is
 * server-side (`rec_publication_health`) so the numbers cannot be spoofed by the
 * client, and the RPC is staff-gated.
 */
import { supabase } from "@/integrations/supabase/client";
import type { ApplicationFailureClass } from "./applicationFailure";

export type HealthSeverity = "critical" | "warning";

export interface PublicationMismatch {
  vacancy_id: string;
  vacancy_no: string;
  title: string;
  approval_status: string;
  publication_status: string;
  status: string;
  public_slug: string | null;
  published_at: string | null;
  visible_publicly: boolean;
  issue: string;
  severity: HealthSeverity;
}

export interface PublicationHealth {
  checked_at: string;
  public_count: number;
  total_vacancies: number;
  mismatches: PublicationMismatch[];
  mismatch_count: number;
  critical_count: number;
  latency: {
    window_hours: number;
    requests: number;
    /** Technical + security failures only. A refused application is not an outage. */
    errors: number;
    /** Business-validation and candidate-action refusals, counted separately. */
    validation_refusals: number;
    avg_ms: number;
    p95_ms: number;
    max_ms: number;
  };
  /** Document upload latency — a separate budget from page reads. */
  uploads?: {
    window_hours: number;
    requests: number;
    errors: number;
    avg_ms: number;
    p95_ms: number;
    max_ms: number;
  };
  /** Failure counts by class over the same window. */
  failure_classes?: Partial<Record<ApplicationFailureClass, number>>;
  recent_failures: Array<{
    operation: string;
    slug: string | null;
    error_message: string | null;
    failure_class?: ApplicationFailureClass;
    duration_ms: number;
    created_at: string;
  }>;
  applications: {
    window_hours: number;
    accepted: number;
    duplicate: number;
    rejected: number;
    top_rejections: Array<{ reason: string | null; count: number }>;
  };
  /** Candidate remediation register — preserved applications awaiting completion. */
  remediation?: {
    open: number;
    candidate_action: number;
    system_remediation: number;
    completed: number;
    total: number;
  };
}


export const ISSUE_LABEL: Record<string, string> = {
  published_without_public_slug: "Published without a public link",
  published_without_timestamp: "Published without a publication timestamp",
  published_but_not_approved: "Published while approval is not granted",
  published_but_not_open: "Published while the role is not open",
  expected_public_but_hidden: "Should be live on Careers but is hidden",
  unpublished_but_visible: "Visible on Careers while unpublished",
};

/** Latency budget for the public careers API (p95). */
export const LATENCY_P95_BUDGET_MS = 1200;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export async function fetchPublicationHealth(): Promise<PublicationHealth> {
  const { data, error } = await db.rpc("rec_publication_health");
  if (error) throw new Error(error.message);
  return data as PublicationHealth;
}

/**
 * Failure population reconciliation.
 *
 * The incident produced three different published numbers (30, 40, 68) because
 * three different populations were being counted: API request errors, refused
 * submissions, and refusal events over a longer window. This report makes the
 * accounting explicit — every event belongs to exactly one class, and event
 * counts are reported separately from unique candidates, so "68 refusals" can
 * never again be read as "68 candidates".
 */
export interface FailureReconciliation {
  window_hours: number;
  since: string;
  computed_at: string;
  api: {
    total_requests: number;
    successful: number;
    error_events: number;
    by_class: Record<string, number>;
    by_operation: Record<string, number>;
  };
  refusals: {
    refusal_events: number;
    business_validation: number;
    candidate_action_required: number;
    technical_failures: number;
    security_failures: number;
    other: number;
    by_error_code: Record<string, number>;
    by_build: Record<string, number>;
  };
  identity: {
    unique_candidates: number;
    unique_vacancies: number;
    unique_sessions: number;
    total_attempts: number;
    remediation_cases: number;
  };
}

export async function fetchFailureReconciliation(hours = 24): Promise<FailureReconciliation> {
  const { data, error } = await db.rpc("rec_failure_reconciliation", { p_hours: hours });
  if (error) throw new Error(error.message);
  return data as FailureReconciliation;
}

/** Every API error event must land in exactly one class — proves the accounting closes. */
export function reconciliationBalances(r: FailureReconciliation | undefined): boolean {
  if (!r) return false;
  const classSum = Object.values(r.api.by_class).reduce((a, b) => a + b, 0);
  const refusalSum =
    r.refusals.business_validation +
    r.refusals.candidate_action_required +
    r.refusals.technical_failures +
    r.refusals.security_failures +
    r.refusals.other;
  return classSum === r.api.error_events && refusalSum === r.refusals.refusal_events;
}


export interface HealthAlert {
  severity: HealthSeverity;
  title: string;
  detail: string;
}

/** Deterministic alerting rules rendered in the ops page. */
export function buildHealthAlerts(health: PublicationHealth | undefined): HealthAlert[] {
  if (!health) return [];
  const alerts: HealthAlert[] = [];

  for (const m of health.mismatches) {
    alerts.push({
      severity: m.severity,
      title: `${m.vacancy_no} — ${ISSUE_LABEL[m.issue] ?? m.issue}`,
      detail: `${m.title} · approval ${m.approval_status} · publication ${m.publication_status} · status ${m.status} · publicly ${m.visible_publicly ? "visible" : "hidden"}`,
    });
  }

  if (health.latency.p95_ms > LATENCY_P95_BUDGET_MS) {
    alerts.push({
      severity: "warning",
      title: "Public careers API is slow",
      detail: `p95 ${health.latency.p95_ms}ms over the last ${health.latency.window_hours}h exceeds the ${LATENCY_P95_BUDGET_MS}ms budget.`,
    });
  }

  // Technical/security failures are platform incidents.
  if (health.latency.errors > 0) {
    alerts.push({
      severity: health.latency.errors >= 5 ? "critical" : "warning",
      title: `${health.latency.errors} public careers API failure${health.latency.errors === 1 ? "" : "s"}`,
      detail: `Technical or security failures in the last ${health.latency.window_hours}h across ${health.latency.requests} requests.`,
    });
  }

  // Business-validation refusals are a funnel problem, never an outage: the
  // endpoint answered correctly and quickly. They are reported as their own
  // class so a missing certificate is never escalated as downtime.
  const refusals = health.latency.validation_refusals ?? 0;
  if (refusals >= 10) {
    alerts.push({
      severity: "warning",
      title: `${refusals} applications refused by validation`,
      detail: `Candidates reached submission without meeting the requirements in the last ${health.latency.window_hours}h. Endpoint healthy — review the requirement disclosure and remediation queue.`,
    });
  }

  const openCases = health.remediation?.system_remediation ?? 0;
  if (openCases > 0) {
    alerts.push({
      severity: "critical",
      title: `${openCases} application${openCases === 1 ? "" : "s"} blocked by a platform fault`,
      detail:
        "These candidates were stopped by our infrastructure, not by their own submission. Their applications are preserved and awaiting remediation.",
    });
  }

  if (health.applications.rejected >= 10) {
    alerts.push({
      severity: "warning",
      title: `${health.applications.rejected} application attempts rejected`,
      detail: `Top reasons: ${health.applications.top_rejections.map((r) => `${r.reason ?? "unknown"} (${r.count})`).join(", ") || "n/a"}`,
    });
  }


  return alerts;
}
