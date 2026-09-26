/**
 * Admin Command Centre data spine (Phase A of the Command Experience).
 *
 * Every figure is read from a real table through the RLS-scoped client. A failed
 * query marks its KPI `unavailable` instead of rendering a confident zero, and
 * every insight / action item carries a canonical destination that already
 * exists in src/lib/routes.ts.
 */
import * as React from "react";
import { supabase } from "@/integrations/supabase/client";
import type {
  CommandAction,
  CommandActivityEvent,
  CommandInsight,
  CommandKpi,
  CommandRange,
} from "@/components/command/types";

export interface IntegrityRun {
  ran_at: string;
  passed: boolean;
  dead_routes: number;
  orphan_routes: number;
  registry_mismatch: number;
  unbound_buttons: number;
  missing_analytics: number;
  permission_violations: number | null;
}

interface Snapshot {
  accounts: number | null;
  accountsThisPeriod: number | null;
  accountsPrevPeriod: number | null;
  settledCents: number | null;
  settledPrevCents: number | null;
  failedPayments: number | null;
  openComplianceAlerts: number | null;
  criticalComplianceAlerts: number | null;
  expiringDocs: number | null;
  expiredDocs: number | null;
  dlqOpen: number | null;
  integrity: IntegrityRun | null;
}

const EMPTY: Snapshot = {
  accounts: null,
  accountsThisPeriod: null,
  accountsPrevPeriod: null,
  settledCents: null,
  settledPrevCents: null,
  failedPayments: null,
  openComplianceAlerts: null,
  criticalComplianceAlerts: null,
  expiringDocs: null,
  expiredDocs: null,
  dlqOpen: null,
  integrity: null,
};

function windowStart(range: CommandRange): Date {
  const now = new Date();
  if (range === "ytd") return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
  return new Date(now.getTime() - days * 86_400_000);
}

function previousStart(range: CommandRange, start: Date): Date {
  const span = Date.now() - start.getTime();
  return new Date(start.getTime() - span);
}

const KES = new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 });

function deltaPct(current: number | null, previous: number | null): number | undefined {
  if (current === null || previous === null || previous === 0) return undefined;
  return ((current - previous) / previous) * 100;
}

/** Integrity score derived from the latest navigation integrity run (0-100). */
function integrityScore(run: IntegrityRun | null): number | null {
  if (!run) return null;
  const penalty =
    run.dead_routes * 8 +
    run.registry_mismatch * 4 +
    (run.permission_violations ?? 0) * 8 +
    run.unbound_buttons * 2 +
    Math.max(0, run.orphan_routes - 25) * 1;
  return Math.max(0, 100 - penalty);
}

/** Shape of a PostgREST result used by this hook (rows are narrowed per query). */
interface QueryResult {
  data?: unknown;
  count?: number | null;
  error?: { message: string } | null;
}
interface AmountRow { amount_cents?: number | string | null; created_at?: string | null }
interface AuditRow {
  id: string;
  created_at: string;
  actor_email?: string | null;
  action?: string | null;
  resource_type?: string | null;
  resource_id?: string | null;
}

export function useAdminCommandIntelligence(range: CommandRange) {
  const [snap, setSnap] = React.useState<Snapshot>(EMPTY);
  const [activity, setActivity] = React.useState<CommandActivityEvent[]>([]);
  const [series, setSeries] = React.useState<{ day: string; value: number }[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [nonce, setNonce] = React.useState(0);

  const refresh = React.useCallback(() => setNonce((n) => n + 1), []);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const start = windowStart(range);
    const prev = previousStart(range, start);
    const in30 = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);

    type Countable = { select: (cols: string, opts: { count: "exact"; head: boolean }) => unknown };
    const count = <T extends Countable>(q: T) =>
      q.select("id", { count: "exact", head: true }) as ReturnType<T["select"]>;

    Promise.all([
      count(supabase.from("profiles")),
      count(supabase.from("profiles")).gte("created_at", start.toISOString()),
      count(supabase.from("profiles")).gte("created_at", prev.toISOString()).lt("created_at", start.toISOString()),
      supabase
        .from("mpesa_transactions")
        .select("amount_cents,created_at")
        .eq("status", "SUCCESS")
        .gte("created_at", start.toISOString())
        .limit(5000),
      supabase
        .from("mpesa_transactions")
        .select("amount_cents")
        .eq("status", "SUCCESS")
        .gte("created_at", prev.toISOString())
        .lt("created_at", start.toISOString())
        .limit(5000),
      count(supabase.from("mpesa_transactions")).eq("status", "FAILED").gte("created_at", start.toISOString()),
      count(supabase.from("compliance_alerts")).eq("status", "OPEN"),
      count(supabase.from("compliance_alerts")).eq("status", "OPEN").eq("severity", "CRITICAL"),
      count(supabase.from("corporate_documents")).lte("expiry_date", in30).gt("expiry_date", today),
      count(supabase.from("corporate_documents")).lte("expiry_date", today),
      count(supabase.from("event_outbox_dlq")).is("resolved_at", null),
      supabase
        .from("navigation_integrity_runs")
        .select(
          "ran_at,passed,dead_routes,orphan_routes,registry_mismatch,unbound_buttons,missing_analytics,permission_violations",
        )
        .order("ran_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("admin_audit_log")
        .select("id,created_at,actor_email,action,resource_type,resource_id")
        .order("created_at", { ascending: false })
        .limit(12),
    ]).then((results) => {
      if (cancelled) return;
      const [
        accounts,
        accountsPeriod,
        accountsPrev,
        settled,
        settledPrev,
        failed,
        alertsOpen,
        alertsCritical,
        expiring,
        expired,
        dlq,
        integrity,
        audit,
      ] = results as QueryResult[];

      const firstError = (results as QueryResult[]).find((r) => r?.error)?.error;
      setError(firstError ? firstError.message : null);

      const sum = (rows: QueryResult | undefined) =>
        Array.isArray(rows?.data)
          ? (rows.data as AmountRow[]).reduce((t, r) => t + (Number(r.amount_cents) || 0), 0)
          : null;

      setSnap({
        accounts: accounts?.error ? null : accounts?.count ?? 0,
        accountsThisPeriod: accountsPeriod?.error ? null : accountsPeriod?.count ?? 0,
        accountsPrevPeriod: accountsPrev?.error ? null : accountsPrev?.count ?? 0,
        settledCents: settled?.error ? null : sum(settled),
        settledPrevCents: settledPrev?.error ? null : sum(settledPrev),
        failedPayments: failed?.error ? null : failed?.count ?? 0,
        openComplianceAlerts: alertsOpen?.error ? null : alertsOpen?.count ?? 0,
        criticalComplianceAlerts: alertsCritical?.error ? null : alertsCritical?.count ?? 0,
        expiringDocs: expiring?.error ? null : expiring?.count ?? 0,
        expiredDocs: expired?.error ? null : expired?.count ?? 0,
        dlqOpen: dlq?.error ? null : dlq?.count ?? 0,
        integrity: integrity?.error ? null : ((integrity?.data as IntegrityRun) ?? null),
      });

      // Daily settled-value series for the command canvas (real rows only).
      const byDay = new Map<string, number>();
      for (const row of (settled?.data ?? []) as AmountRow[]) {
        const day = String(row.created_at ?? "").slice(0, 10);
        if (!day) continue;
        byDay.set(day, (byDay.get(day) ?? 0) + (Number(row.amount_cents) || 0) / 100);
      }
      setSeries(
        [...byDay.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([day, value]) => ({ day, value })),
      );

      setActivity(
        ((audit?.data ?? []) as AuditRow[]).map((row) => ({
          id: row.id,
          at: row.created_at,
          actor: row.actor_email ?? undefined,
          summary: `${String(row.action ?? "action").replace(/_/g, " ")}${
            row.resource_type ? ` · ${row.resource_type}` : ""
          }`,
          to: "/dashboard/admin/audit-log",
        })),
      );
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [range, nonce]);

  const score = integrityScore(snap.integrity);

  const kpis: CommandKpi[] = [
    {
      id: "integrity",
      label: "Platform integrity",
      value: score === null ? undefined : `${score}%`,
      unavailable: score === null,
      caption: snap.integrity
        ? `Last run ${new Date(snap.integrity.ran_at).toLocaleString()}`
        : "No integrity run recorded",
      tone: score === null ? "neutral" : score >= 95 ? "positive" : score >= 80 ? "warning" : "critical",
      to: "/dashboard/admin/integrity-report",
    },
    {
      id: "settled",
      label: "Settled payments",
      value: snap.settledCents === null ? undefined : `KES ${KES.format(snap.settledCents / 100)}`,
      unavailable: snap.settledCents === null,
      caption: `Successful M-Pesa value · vs previous ${range.toUpperCase()}`,
      deltaPct: deltaPct(snap.settledCents, snap.settledPrevCents),
      tone: "info",
      to: "/dashboard/admin/mpesa",
    },
    {
      id: "accounts",
      label: "Platform accounts",
      value: snap.accounts === null ? undefined : KES.format(snap.accounts),
      unavailable: snap.accounts === null,
      caption:
        snap.accountsThisPeriod === null
          ? "New accounts unavailable"
          : `${KES.format(snap.accountsThisPeriod)} new this period`,
      deltaPct: deltaPct(snap.accountsThisPeriod, snap.accountsPrevPeriod),
      to: "/dashboard/admin/users",
    },
    {
      id: "attention",
      label: "Open risk items",
      value:
        snap.openComplianceAlerts === null && snap.dlqOpen === null
          ? undefined
          : KES.format((snap.openComplianceAlerts ?? 0) + (snap.dlqOpen ?? 0)),
      unavailable: snap.openComplianceAlerts === null && snap.dlqOpen === null,
      caption: `${snap.criticalComplianceAlerts ?? 0} critical · ${snap.dlqOpen ?? 0} failed events`,
      tone:
        (snap.criticalComplianceAlerts ?? 0) > 0 || (snap.dlqOpen ?? 0) > 0 ? "critical" : "positive",
      to: "/dashboard/admin/compliance-alerts",
    },
  ];

  const insights: CommandInsight[] = [];
  if ((snap.expiringDocs ?? 0) > 0) {
    insights.push({
      id: "docs-expiring",
      headline: `${snap.expiringDocs} corporate documents expire within 30 days`,
      detail: "Renewal requests should be raised before the compliance window closes.",
      tone: "warning",
      to: "/dashboard/admin/corporate-kyb",
      actionLabel: "Review",
    });
  }
  if ((snap.expiredDocs ?? 0) > 0) {
    insights.push({
      id: "docs-expired",
      headline: `${snap.expiredDocs} corporate documents have already expired`,
      detail: "Affected accounts are trading outside their verified KYB position.",
      tone: "critical",
      to: "/dashboard/admin/corporate-kyb",
      actionLabel: "Investigate",
    });
  }
  const accountDelta = deltaPct(snap.accountsThisPeriod, snap.accountsPrevPeriod);
  if (accountDelta !== undefined && Math.abs(accountDelta) >= 5) {
    insights.push({
      id: "account-growth",
      headline: `New account creation ${accountDelta > 0 ? "increased" : "declined"} ${Math.abs(
        accountDelta,
      ).toFixed(1)}% vs the previous period`,
      detail: `${snap.accountsThisPeriod} accounts created in the selected window.`,
      tone: accountDelta > 0 ? "positive" : "warning",
      to: "/dashboard/admin/users",
      actionLabel: "Segment",
    });
  }
  if (snap.integrity && !snap.integrity.passed) {
    insights.push({
      id: "integrity-fail",
      headline: "Navigation integrity gate is failing",
      detail: `${snap.integrity.dead_routes} dead · ${snap.integrity.registry_mismatch} registry mismatch · ${snap.integrity.unbound_buttons} unbound controls`,
      tone: "critical",
      to: "/dashboard/admin/integrity-report",
      actionLabel: "Remediate",
    });
  }

  const actions: CommandAction[] = [];
  if ((snap.failedPayments ?? 0) > 0) {
    actions.push({
      id: "failed-payments",
      severity: "critical",
      title: "Payment failures require reconciliation",
      detail: `${snap.failedPayments} failed M-Pesa transactions in the selected window.`,
      to: "/dashboard/admin/mpesa",
      actionLabel: "Investigate",
    });
  }
  if ((snap.dlqOpen ?? 0) > 0) {
    actions.push({
      id: "dlq",
      severity: "critical",
      title: "Unresolved events in the dead-letter queue",
      detail: `${snap.dlqOpen} events failed delivery and are awaiting replay.`,
      to: "/dashboard/admin/outbox-dlq",
      actionLabel: "Replay",
    });
  }
  if ((snap.criticalComplianceAlerts ?? 0) > 0) {
    actions.push({
      id: "compliance-critical",
      severity: "high",
      title: "Critical compliance alerts open",
      detail: `${snap.criticalComplianceAlerts} of ${snap.openComplianceAlerts ?? 0} open alerts are critical.`,
      to: "/dashboard/admin/compliance-alerts",
      actionLabel: "Review",
    });
  }
  if ((snap.expiringDocs ?? 0) > 0) {
    actions.push({
      id: "kyb-expiring",
      severity: "medium",
      title: "Corporate KYB documents expiring",
      detail: `${snap.expiringDocs} documents expire within 30 days.`,
      to: "/dashboard/admin/corporate-kyb",
      actionLabel: "Review",
    });
  }
  if (!snap.integrity) {
    actions.push({
      id: "no-integrity-run",
      severity: "info",
      title: "No navigation integrity run recorded",
      detail: "Run the gate so route, permission and control binding are evidenced.",
      to: "/dashboard/admin/command-center?tab=surfaces",
      actionLabel: "Run gate",
    });
  }

  return { kpis, insights, actions, activity, series, snapshot: snap, integrityScore: score, loading, error, refresh };
}
