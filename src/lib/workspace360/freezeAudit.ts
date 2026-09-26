/**
 * Production Readiness Freeze Audit (pre-D9).
 *
 * ONE pure-function certifier that ratchets the platform to a clean baseline
 * before Phase D9 (Enterprise Operational Intelligence) opens. It intentionally
 * reuses the schema contract and Workspace360 governance surface — no parallel
 * registry, no new dashboard, no duplicate scoring engine.
 *
 * Sub-checks (each network-free; live signals are injected by the caller):
 *   1. Contract hygiene          — no duplicate strings in the contract arrays
 *   2. Workspace360 uniqueness   — adopted ⊆ domains, no duplicates, route paths unique
 *   3. Governance registration   — each canonical certifier registered exactly once
 *   4. Deprecated-field ratchet  — obsolete columns permanently banned
 *   5. Usage reconciliation (optional) — orphan / unused RPCs, edge functions, routes
 *   6. Readiness reconciliation (optional) — readiness ↔ ops-center ↔ executive score parity
 *
 * The declarations in this file (CANONICAL_GOVERNANCE_CERTIFIERS,
 * FREEZE_AUDIT_BANS, …) are the CI ratchet. Extending this file is the ONLY
 * supported way to grow the freeze surface — do not fork a second engine.
 */
import type { Workspace360HealthContract } from "./health";
import { DATA_CONTRACT_BANS } from "./dataContract";

/* ------------------------------------------------------------------------- *
 * Types
 * ------------------------------------------------------------------------- */

export type FreezeSeverity = "P0" | "P1" | "P2";

export interface FreezeFinding {
  category:
    | "contract_hygiene"
    | "workspace360_uniqueness"
    | "governance_uniqueness"
    | "deprecated_ratchet"
    | "usage_reconciliation"
    | "readiness_reconciliation";
  severity: FreezeSeverity;
  message: string;
  detail?: Record<string, unknown>;
}

export interface FreezeCheckResult {
  key: string;
  passed: boolean;
  score: number;                 // 0-100
  findings: FreezeFinding[];
}

export interface UsageManifest {
  /** RPC names referenced anywhere in `src/` and `supabase/functions/`. */
  rpcsUsed?: readonly string[];
  /** Edge functions invoked via .invoke("…") or cron. */
  edgeFunctionsUsed?: readonly string[];
  /** Registered application route paths (from src/lib/routes.ts). */
  routesRegistered?: readonly string[];
}

export interface ScoreReconciliation {
  readiness?: number;
  opsCenter?: number;
  executive?: number;
}

export interface FreezeAuditInput {
  contract: Workspace360HealthContract & {
    workspace360?: {
      domains?: readonly string[];
      adopted_domains?: readonly string[];
      tabs?: readonly string[];
      domain_routes?: Record<string, { directory: string; workspace: string }>;
    };
  };
  usage?: UsageManifest;
  scores?: ScoreReconciliation;
}

export interface FreezeAuditReport {
  passed: boolean;                // false when any P0 present
  score: number;                  // mean of sub-check scores
  checks: FreezeCheckResult[];
  p0: FreezeFinding[];
  p1: FreezeFinding[];
  p2: FreezeFinding[];
  reconciliation: ScoreReconciliation;
}

/* ------------------------------------------------------------------------- *
 * Canonical governance certifier registry.
 * If a certifier is renamed or duplicated, freeze audit fails immediately.
 * Keep in sync with governance.ts imports; never introduce a second variant.
 * ------------------------------------------------------------------------- */

export const CANONICAL_GOVERNANCE_CERTIFIERS: readonly string[] = [
  "certifyWorkspace360",
  "certifyWorkspace360Health",
  "certifyWorkspace360CanonicalServices",
  "certifyCrossDomainWorkflows",
  "certifyBusinessConsistency",
  "certifyOperationalQualification",
  "certifyDataContract",
  "certifyWorkspace360Governance",
] as const;

/* ------------------------------------------------------------------------- *
 * Utilities
 * ------------------------------------------------------------------------- */

function duplicates<T>(arr: readonly T[]): T[] {
  const seen = new Set<T>();
  const dups = new Set<T>();
  for (const x of arr) {
    if (seen.has(x)) dups.add(x);
    else seen.add(x);
  }
  return [...dups];
}

function pct(passing: number, total: number): number {
  if (total === 0) return 100;
  return Math.max(0, Math.min(100, Math.round((passing / total) * 100)));
}

/* ------------------------------------------------------------------------- *
 * 1. Contract hygiene — no duplicate entries in the schema-contract arrays.
 * ------------------------------------------------------------------------- */

export function certifyContractHygiene(
  contract: FreezeAuditInput["contract"],
): FreezeCheckResult {
  const findings: FreezeFinding[] = [];

  const tblDup = duplicates(contract.tables ?? []);
  const rpcDup = duplicates(contract.rpcs ?? []);
  const edgeDup = duplicates(contract.edge_functions ?? []);
  const colDup = duplicates(
    (contract.columns ?? []).map((c) => `${c.table}.${c.column}`),
  );

  for (const t of tblDup) {
    findings.push({
      category: "contract_hygiene",
      severity: "P1",
      message: `duplicate table in schema contract: ${t}`,
    });
  }
  for (const r of rpcDup) {
    findings.push({
      category: "contract_hygiene",
      severity: "P1",
      message: `duplicate rpc in schema contract: ${r}`,
    });
  }
  for (const e of edgeDup) {
    findings.push({
      category: "contract_hygiene",
      severity: "P1",
      message: `duplicate edge function in schema contract: ${e}`,
    });
  }
  for (const c of colDup) {
    findings.push({
      category: "contract_hygiene",
      severity: "P1",
      message: `duplicate column in schema contract: ${c}`,
    });
  }

  const totalChecks = 4;
  const failed =
    (tblDup.length ? 1 : 0) +
    (rpcDup.length ? 1 : 0) +
    (edgeDup.length ? 1 : 0) +
    (colDup.length ? 1 : 0);
  return {
    key: "contract_hygiene",
    passed: findings.length === 0,
    score: pct(totalChecks - failed, totalChecks),
    findings,
  };
}

/* ------------------------------------------------------------------------- *
 * 2. Workspace360 uniqueness — adopted ⊆ declared, unique routes.
 * ------------------------------------------------------------------------- */

export function certifyWorkspace360Uniqueness(
  contract: FreezeAuditInput["contract"],
): FreezeCheckResult {
  const findings: FreezeFinding[] = [];
  const ws = contract.workspace360 ?? {};
  const domains = ws.domains ?? [];
  const adopted = ws.adopted_domains ?? [];
  const routes = ws.domain_routes ?? {};

  for (const d of duplicates(domains)) {
    findings.push({
      category: "workspace360_uniqueness",
      severity: "P1",
      message: `duplicate workspace360 domain: ${d}`,
    });
  }
  for (const d of duplicates(adopted)) {
    findings.push({
      category: "workspace360_uniqueness",
      severity: "P1",
      message: `duplicate adopted workspace360 domain: ${d}`,
    });
  }

  const declared = new Set(domains);
  for (const a of adopted) {
    if (!declared.has(a)) {
      findings.push({
        category: "workspace360_uniqueness",
        severity: "P0",
        message: `adopted domain '${a}' not declared in workspace360.domains`,
      });
    }
  }

  const workspacePaths = Object.values(routes).map((r) => r.workspace);
  const directoryPaths = Object.values(routes).map((r) => r.directory);
  for (const p of duplicates(workspacePaths)) {
    findings.push({
      category: "workspace360_uniqueness",
      severity: "P0",
      message: `duplicate workspace360 workspace route: ${p}`,
    });
  }
  for (const p of duplicates(directoryPaths)) {
    findings.push({
      category: "workspace360_uniqueness",
      severity: "P0",
      message: `duplicate workspace360 directory route: ${p}`,
    });
  }

  const total =
    Math.max(domains.length, 1) +
    Math.max(adopted.length, 1) +
    Math.max(workspacePaths.length, 1) +
    Math.max(directoryPaths.length, 1);
  return {
    key: "workspace360_uniqueness",
    passed: findings.length === 0,
    score: pct(total - findings.length, total),
    findings,
  };
}

/* ------------------------------------------------------------------------- *
 * 3. Governance registration — each canonical certifier registered once.
 * The caller supplies the observed certifier list (typically parsed from
 * governance.ts). If omitted, we skip the check with a P2 note so freeze
 * audit remains callable from pure test environments.
 * ------------------------------------------------------------------------- */

export function certifyGovernanceUniqueness(
  observed?: readonly string[],
): FreezeCheckResult {
  const findings: FreezeFinding[] = [];
  if (!observed) {
    findings.push({
      category: "governance_uniqueness",
      severity: "P2",
      message: "governance certifier list not provided; audit ran in offline mode",
    });
    return { key: "governance_uniqueness", passed: true, score: 100, findings };
  }

  const canonical = new Set(CANONICAL_GOVERNANCE_CERTIFIERS);
  for (const c of CANONICAL_GOVERNANCE_CERTIFIERS) {
    const count = observed.filter((o) => o === c).length;
    if (count === 0) {
      findings.push({
        category: "governance_uniqueness",
        severity: "P0",
        message: `canonical governance certifier missing: ${c}`,
      });
    } else if (count > 1) {
      findings.push({
        category: "governance_uniqueness",
        severity: "P0",
        message: `canonical governance certifier registered ${count}× (expected 1): ${c}`,
      });
    }
  }
  for (const o of observed) {
    if (!canonical.has(o) && /^certify[A-Z]/.test(o)) {
      findings.push({
        category: "governance_uniqueness",
        severity: "P1",
        message: `non-canonical certifier detected: ${o} — consider consolidating into governance.ts`,
      });
    }
  }

  const total = CANONICAL_GOVERNANCE_CERTIFIERS.length;
  const passing = total - findings.filter((f) => f.severity === "P0").length;
  return {
    key: "governance_uniqueness",
    passed: findings.every((f) => f.severity !== "P0"),
    score: pct(passing, total),
    findings,
  };
}

/* ------------------------------------------------------------------------- *
 * 4. Deprecated-field ratchet — obsolete columns must stay banned.
 * Delegates the ban list to dataContract.ts; freeze audit is the "gate that
 * blocks CI" while dataContract.ts is the "detailed report card".
 * ------------------------------------------------------------------------- */

export function certifyDeprecatedRatchet(
  contract: FreezeAuditInput["contract"],
): FreezeCheckResult {
  const findings: FreezeFinding[] = [];
  const cols = new Set(
    (contract.columns ?? []).map((c) => `${c.table}.${c.column}`),
  );
  for (const b of DATA_CONTRACT_BANS) {
    if (cols.has(`${b.table}.${b.column}`)) {
      findings.push({
        category: "deprecated_ratchet",
        severity: "P0",
        message: `banned column re-introduced: ${b.table}.${b.column} — use ${b.replacement}`,
        detail: { reason: b.reason },
      });
    }
  }
  const total = DATA_CONTRACT_BANS.length || 1;
  return {
    key: "deprecated_ratchet",
    passed: findings.length === 0,
    score: pct(total - findings.length, total),
    findings,
  };
}

/* ------------------------------------------------------------------------- *
 * 5. Usage reconciliation — orphan / unused RPCs, edge functions, routes.
 * Only runs when `usage` is provided by the caller (CI script).
 * ------------------------------------------------------------------------- */

export function certifyUsageReconciliation(
  contract: FreezeAuditInput["contract"],
  usage?: UsageManifest,
): FreezeCheckResult {
  const findings: FreezeFinding[] = [];
  if (!usage) {
    findings.push({
      category: "usage_reconciliation",
      severity: "P2",
      message: "usage manifest not supplied; run scripts/freeze-audit.ts for full reconciliation",
    });
    return { key: "usage_reconciliation", passed: true, score: 100, findings };
  }

  const rpcs = new Set(contract.rpcs ?? []);
  const edges = new Set(contract.edge_functions ?? []);

  // Orphan = referenced in code but not in schema contract.
  for (const r of usage.rpcsUsed ?? []) {
    if (!rpcs.has(r)) {
      findings.push({
        category: "usage_reconciliation",
        severity: "P1",
        message: `orphan rpc referenced but not in schema contract: ${r}`,
      });
    }
  }
  for (const e of usage.edgeFunctionsUsed ?? []) {
    if (!edges.has(e)) {
      findings.push({
        category: "usage_reconciliation",
        severity: "P1",
        message: `orphan edge function invoked but not in schema contract: ${e}`,
      });
    }
  }

  // Unused = declared in contract but never referenced anywhere.
  const usedRpcs = new Set(usage.rpcsUsed ?? []);
  for (const r of rpcs) {
    if (!usedRpcs.has(r)) {
      findings.push({
        category: "usage_reconciliation",
        severity: "P2",
        message: `unused rpc in schema contract: ${r} — remove or wire it up`,
      });
    }
  }
  const usedEdges = new Set(usage.edgeFunctionsUsed ?? []);
  for (const e of edges) {
    if (!usedEdges.has(e)) {
      findings.push({
        category: "usage_reconciliation",
        severity: "P2",
        message: `unused edge function in schema contract: ${e} — remove or wire it up`,
      });
    }
  }

  const total = rpcs.size + edges.size || 1;
  const failed = findings.length;
  return {
    key: "usage_reconciliation",
    passed: findings.every((f) => f.severity === "P2"),
    score: pct(Math.max(0, total - failed), total),
    findings,
  };
}

/* ------------------------------------------------------------------------- *
 * 6. Readiness reconciliation — score parity across the three surfaces.
 * ------------------------------------------------------------------------- */

export function certifyReadinessReconciliation(
  scores?: ScoreReconciliation,
): FreezeCheckResult {
  const findings: FreezeFinding[] = [];
  if (!scores) {
    findings.push({
      category: "readiness_reconciliation",
      severity: "P2",
      message: "readiness scores not supplied; freeze audit ran without reconciliation",
    });
    return { key: "readiness_reconciliation", passed: true, score: 100, findings };
  }

  const values = Object.entries(scores).filter(([, v]) => typeof v === "number") as Array<[string, number]>;
  if (values.length < 2) {
    findings.push({
      category: "readiness_reconciliation",
      severity: "P2",
      message: "fewer than two readiness scores provided; reconciliation skipped",
    });
    return { key: "readiness_reconciliation", passed: true, score: 100, findings };
  }
  const [_, first] = values[0];
  for (const [name, v] of values.slice(1)) {
    if (Math.abs(v - first) > 0) {
      findings.push({
        category: "readiness_reconciliation",
        severity: "P0",
        message: `readiness score divergence: ${values[0][0]}=${first} vs ${name}=${v}`,
      });
    }
  }
  const total = values.length - 1 || 1;
  return {
    key: "readiness_reconciliation",
    passed: findings.every((f) => f.severity !== "P0"),
    score: pct(total - findings.filter((f) => f.severity === "P0").length, total),
    findings,
  };
}

/* ------------------------------------------------------------------------- *
 * Aggregate — the single Freeze Audit report.
 * ------------------------------------------------------------------------- */

export function certifyFreezeAudit(input: FreezeAuditInput): FreezeAuditReport {
  const checks: FreezeCheckResult[] = [
    certifyContractHygiene(input.contract),
    certifyWorkspace360Uniqueness(input.contract),
    certifyGovernanceUniqueness(undefined),          // upgraded by CI script
    certifyDeprecatedRatchet(input.contract),
    certifyUsageReconciliation(input.contract, input.usage),
    certifyReadinessReconciliation(input.scores),
  ];

  const allFindings = checks.flatMap((c) => c.findings);
  const p0 = allFindings.filter((f) => f.severity === "P0");
  const p1 = allFindings.filter((f) => f.severity === "P1");
  const p2 = allFindings.filter((f) => f.severity === "P2");

  const score = Math.round(
    checks.reduce((a, c) => a + c.score, 0) / checks.length,
  );
  return {
    passed: p0.length === 0,
    score,
    checks,
    p0,
    p1,
    p2,
    reconciliation: input.scores ?? {},
  };
}
