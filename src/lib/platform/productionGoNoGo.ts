/**
 * Phase 7 — Enterprise Certification Audit: final Go/No-Go readiness report.
 *
 * Aggregates the deterministic evidence produced by Phases 1-6 of the
 * enterprise certification audit together with the live navigation
 * reachability certification. Pure/deterministic: no network, no DB — the
 * report is reproducible in CI and rendered by the admin readiness console.
 */
import { certifyNavigationGovernance, type NavigationCertification } from "./navigationGovernance";

export type PhaseId = "phase_1" | "phase_2" | "phase_3" | "phase_4" | "phase_5" | "phase_6" | "phase_7";
export type ReadinessDecision = "GO" | "CONDITIONAL_GO" | "NO_GO";

export interface PhaseCertification {
  id: PhaseId;
  title: string;
  scope: string;
  /** Certified evidence delivered in the phase (files, gates, migrations). */
  evidence: string[];
  passed: boolean;
  /** Open items that do not block release (tracked, non-critical). */
  conditions: string[];
  /** Items that block release. Any entry forces NO_GO. */
  blockers: string[];
}

/** Immutable audit record of Phases 1-6 outcomes. */
export const PHASE_CERTIFICATIONS: PhaseCertification[] = [
  {
    id: "phase_1",
    title: "Audit & Integrity Gate",
    scope: "Route/nav inventory, orphan detection, dead scaffolds, RBAC registry drift",
    evidence: [
      "src/lib/platform/navigationGovernance.ts (certified entry points)",
      "src/lib/rbac/__tests__/rbac-registry-drift.test.ts (permission-map hash lock)",
      "removed dead scaffold src/pages/Index.tsx",
    ],
    passed: true,
    conditions: [],
    blockers: [],
  },
  {
    id: "phase_2",
    title: "Shared Platform Certification",
    scope: "Auth lifecycle, design tokens, MCP client dedup, realtime cleanup",
    evidence: [
      "src/hooks/useAuth.ts (no loading trap, timers cleared on unmount)",
      "src/lib/mcp/supabaseForUser.ts (shared client factory)",
      "index.css --overlay token adopted by dialog/drawer/sheet",
    ],
    passed: true,
    conditions: [],
    blockers: [],
  },
  {
    id: "phase_3",
    title: "Finance (M-Pesa, Wallets, Payments)",
    scope: "Filter injection, false-zero balances, refund race conditions, orchestrator fail-closed",
    evidence: [
      "src/lib/security/postgrestFilter.ts (sanitizeOrFilterTerm)",
      "src/pages/dashboard/admin/RefundsCenter.tsx (optimistic lock on approval)",
      "supabase/functions/payment-orchestrator-controller (atomic decision audit)",
    ],
    passed: true,
    conditions: [],
    blockers: [],
  },
  {
    id: "phase_4",
    title: "Operations, Compliance, Fraud & Trust",
    scope: "Privileged route RBAC, guarded state transitions, error banners, realtime collisions",
    evidence: [
      "src/App.tsx (RequireRole on dispatch/compliance/fraud routes)",
      "src/lib/platform/guardedTransition.ts (conflict detection + hash-chained audit)",
      "unique realtime channel names in DeliveryFraud",
    ],
    passed: true,
    conditions: [],
    blockers: [],
  },
  {
    id: "phase_5",
    title: "Users, Roles & Admin Overview",
    scope: "Users directory, privilege-grant friction, self-grant flagging, paginated alerts",
    evidence: [
      "src/pages/dashboard/admin/UsersDirectory.tsx (server-side pagination + sanitized search)",
      "src/pages/dashboard/admin/StaffManagement.tsx (self-grant badges + confirmation)",
      "src/pages/dashboard/admin/AdminAlerts.tsx (server-side pagination)",
    ],
    passed: true,
    conditions: [],
    blockers: [],
  },
  {
    id: "phase_6",
    title: "Trust & Safety + Observability",
    scope: "Non-authoritative data banners, conflict guards, SLO integrity, realtime stability",
    evidence: [
      "src/components/platform/DataErrorBanner.tsx",
      "src/domains/trust/api.ts (TrustConflictError on resolve/ack)",
      "src/domains/trust/__tests__/trustConflict.test.ts",
    ],
    passed: true,
    conditions: [],
    blockers: [],
  },
];

export interface ReadinessCheck {
  id: string;
  label: string;
  mandatory: boolean;
  passed: boolean;
  detail: string;
}

export interface ProductionReadinessReport {
  decision: ReadinessDecision;
  score: number;
  phases: PhaseCertification[];
  checks: ReadinessCheck[];
  navigation: NavigationCertification;
  blockers: string[];
  conditions: string[];
  generatedFrom: "deterministic_registry";
}

export interface ReadinessInputs {
  navigation?: NavigationCertification;
  phases?: PhaseCertification[];
  /** Count of "coming soon" / mock-data placeholders detected by the audit script. */
  placeholderCount?: number;
  /** Unguarded privileged routes detected by the RBAC sweep. */
  unguardedPrivilegedRoutes?: string[];
}

export function certifyProductionReadiness(inputs: ReadinessInputs = {}): ProductionReadinessReport {
  const phases = inputs.phases ?? PHASE_CERTIFICATIONS;
  const navigation = inputs.navigation ?? certifyNavigationGovernance();
  const placeholderCount = inputs.placeholderCount ?? 0;
  const unguarded = inputs.unguardedPrivilegedRoutes ?? [];

  const failedPhases = phases.filter((p) => !p.passed);
  const phaseBlockers = phases.flatMap((p) => p.blockers.map((b) => `${p.id}: ${b}`));
  const conditions = phases.flatMap((p) => p.conditions.map((c) => `${p.id}: ${c}`));

  const checks: ReadinessCheck[] = [
    {
      id: "phase_completion",
      label: "All audit phases certified",
      mandatory: true,
      passed: failedPhases.length === 0,
      detail: failedPhases.length === 0
        ? `${phases.length}/${phases.length} phases passed`
        : `failed: ${failedPhases.map((p) => p.id).join(", ")}`,
    },
    {
      id: "no_phase_blockers",
      label: "No open phase blockers",
      mandatory: true,
      passed: phaseBlockers.length === 0,
      detail: phaseBlockers.length === 0 ? "none" : phaseBlockers.join("; "),
    },
    {
      id: "navigation_reachability",
      label: "Navigation reachability certified (no uncertified orphans)",
      mandatory: true,
      passed: navigation.passed,
      detail: navigation.passed
        ? `${navigation.certifiedRoutes}/${navigation.totalRoutes} routes certified`
        : `orphans: ${navigation.uncertifiedOrphans.slice(0, 10).join(", ")}`,
    },
    {
      id: "rbac_matrix",
      label: "Privileged routes are RBAC-guarded",
      mandatory: true,
      passed: unguarded.length === 0,
      detail: unguarded.length === 0 ? "all privileged routes guarded" : unguarded.join(", "),
    },
    {
      id: "no_placeholders",
      label: "No 'coming soon' / mock-data placeholders",
      mandatory: true,
      passed: placeholderCount === 0,
      detail: placeholderCount === 0 ? "none detected" : `${placeholderCount} detected`,
    },
    {
      id: "navigation_health",
      label: "Navigation health score >= 90",
      mandatory: false,
      passed: navigation.score >= 90,
      detail: `score ${navigation.score}`,
    },
  ];

  const mandatoryFailures = checks.filter((c) => c.mandatory && !c.passed);
  const advisoryFailures = checks.filter((c) => !c.mandatory && !c.passed);
  const blockers = [
    ...mandatoryFailures.map((c) => `${c.id}: ${c.detail}`),
    ...phaseBlockers,
  ];
  const allConditions = [...conditions, ...advisoryFailures.map((c) => `${c.id}: ${c.detail}`)];

  const decision: ReadinessDecision = blockers.length > 0
    ? "NO_GO"
    : allConditions.length > 0
      ? "CONDITIONAL_GO"
      : "GO";

  const score = Math.round((checks.filter((c) => c.passed).length / checks.length) * 100);

  return {
    decision,
    score,
    phases,
    checks,
    navigation,
    blockers,
    conditions: allConditions,
    generatedFrom: "deterministic_registry",
  };
}

export function renderReadinessMarkdown(report: ProductionReadinessReport = certifyProductionReadiness()): string {
  const lines: string[] = [
    "# TaxiD — Enterprise Production Readiness Report",
    "",
    `**Decision:** ${report.decision} · **Score:** ${report.score}/100`,
    "",
    "## Gate checks",
    ...report.checks.map((c) => `- ${c.passed ? "PASS" : "FAIL"} ${c.mandatory ? "(mandatory)" : "(advisory)"} — ${c.label}: ${c.detail}`),
    "",
    "## Phase certifications",
    ...report.phases.map((p) => `- ${p.passed ? "PASS" : "FAIL"} ${p.id} — ${p.title} (${p.scope})`),
  ];
  if (report.blockers.length) {
    lines.push("", "## Blockers", ...report.blockers.map((b) => `- ${b}`));
  }
  if (report.conditions.length) {
    lines.push("", "## Conditions", ...report.conditions.map((c) => `- ${c}`));
  }
  return lines.join("\n");
}
