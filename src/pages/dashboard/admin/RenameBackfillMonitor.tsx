import type { LooseRow } from "@/lib/types/loose";
/**
 * Rename & Backfill Monitor
 *
 * Operator dashboard for:
 *  • Live NULL-count coverage across Phase 3 tenant/country tables.
 *  • Manual "verify now" runs (invokes `phase3-backfill-verify` and records
 *    the result in `rename_backfill_verifications` + `admin_audit_log`).
 *  • History of scheduled + manual verification runs.
 *  • Feature-flag panel for the `taxid_* → yalla_*` gradual rollout:
 *    kill switch, ramp %, country / tenant allow-lists. Changes are
 *    written to `rename_feature_flag` (super_admin only via RLS).
 */
import * as React from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RefreshCw, ShieldCheck, ShieldAlert, PlayCircle, Save, Activity, Download, FileText, Send } from "lucide-react";
import { toast } from "sonner";
import { SeoHead } from "@/components/seo/SeoHead";
import { logAdminAudit } from "@/lib/navLog";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { AppButton } from "@/components/nav/AppButton";


const TENANT_TABLES = [
  "trip_bookings",
  "corporate_accounts",
  "drivers",
  "packages",
  "mpesa_transactions",
] as const;

interface Coverage {
  table: string;
  total: number | null;
  null_tenant: number | null;
  null_country: number | null;
  error?: string;
}

interface VerificationRun {
  id: string;
  ran_at: string;
  trigger: string;
  divergent_rows: number;
  passed: boolean;
  notes: string | null;
}

interface FlagState {
  enabled: boolean;
  kill_switch: boolean;
  ramp_percent: number;
  allowed_country_codes: string[];
  allowed_tenant_ids: string[];
  notes: string | null;
}

interface Threshold {
  source: string;
  critical_threshold: number;
  warning_threshold: number;
  cooldown_minutes: number;
  notes: string | null;
}

interface HealthCheckResult {
  ok: boolean;
  checks: Record<string, { ok: boolean; detail: string }>;
  email_recipients_count: number;
  test_sent: boolean;
  test_result: unknown;
}

async function fetchCoverage(table: string): Promise<Coverage> {

  try {
    const { count: total, error: e1 } = await supabase
      .from(table as never)
      .select("*", { count: "exact", head: true });
    if (e1) throw e1;
    const { count: nt } = await supabase
      .from(table as never)
      .select("*", { count: "exact", head: true })
      .is("tenant_id" as never, null);
    const { count: nc } = await supabase
      .from(table as never)
      .select("*", { count: "exact", head: true })
      .is("country_code" as never, null);
    return { table, total: total ?? 0, null_tenant: nt ?? 0, null_country: nc ?? 0 };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { table, total: null, null_tenant: null, null_country: null, error: msg };
  }
}

export default function RenameBackfillMonitor() {
  const [coverage, setCoverage] = React.useState<Coverage[] | null>(null);
  const [runs, setRuns] = React.useState<VerificationRun[] | null>(null);
  const [flag, setFlag] = React.useState<FlagState | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [verifying, setVerifying] = React.useState(false);
  const [savingFlag, setSavingFlag] = React.useState(false);
  const [sessionStats, setSessionStats] = React.useState<{ total: number; withSession: number } | null>(null);
  const [thresholds, setThresholds] = React.useState<Threshold[] | null>(null);
  const [savingThresholds, setSavingThresholds] = React.useState(false);
  const [health, setHealth] = React.useState<HealthCheckResult | null>(null);
  const [checkingHealth, setCheckingHealth] = React.useState(false);
  // Filter state is persisted to the URL so the timeline panel, CSV export
  // and PDF export always operate on the same range/source/status the operator
  // is looking at, and links can be shared / reloaded deterministically.
  const [searchParams, setSearchParams] = useSearchParams();
  const defaultFrom = React.useMemo(
    () => new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10),
    [],
  );
  const defaultTo = React.useMemo(() => new Date().toISOString().slice(0, 10), []);
  const [filterFrom, setFilterFrom] = React.useState<string>(
    () => searchParams.get("from") ?? defaultFrom,
  );
  const [filterTo, setFilterTo] = React.useState<string>(
    () => searchParams.get("to") ?? defaultTo,
  );
  const [filterSource, setFilterSource] = React.useState<string>(
    () => searchParams.get("source") ?? "all",
  );
  const [filterStatus, setFilterStatus] = React.useState<string>(
    () => searchParams.get("status") ?? "all",
  );
  React.useEffect(() => {
    const next = new URLSearchParams(searchParams);
    const setOrDelete = (key: string, value: string, fallback: string) => {
      if (value && value !== fallback) next.set(key, value);
      else next.delete(key);
    };
    setOrDelete("from", filterFrom, defaultFrom);
    setOrDelete("to", filterTo, defaultTo);
    setOrDelete("source", filterSource, "all");
    setOrDelete("status", filterStatus, "all");
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterFrom, filterTo, filterSource, filterStatus]);
  const [timeline, setTimeline] = React.useState<Array<{ id: string; created_at: string; source: string; severity: string; suppressed: boolean; title: string }> | null>(null);

  // Server-authoritative super_admin gate for the export endpoints.
  // Even though RLS on rename_alert_dispatch_log / admin_audit_log already
  // filters rows, we refuse to build the report at all unless the current
  // session belongs to a super_admin — a second, explicit line of defence
  // that closes the "direct request from a non-super_admin" path.
  const assertSuperAdminForExport = React.useCallback(async (): Promise<boolean> => {
    const { data: userRes } = await supabase.auth.getUser();
    const uid = userRes.user?.id;
    if (!uid) {
      toast.error("Sign in required to export breach/suppression details.");
      return false;
    }
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: uid,
      _role: "super_admin",
    });
    if (error || data !== true) {
      toast.error("Only super_admins can export breach/suppression details.");
      void logAdminAudit({
        action: "rename_monitor_export_denied",
        resourceType: "rename_alert_dispatch_log",
        metadata: { reason: "not_super_admin", filterFrom, filterTo, filterSource, filterStatus },
      });
      return false;
    }
    return true;
  }, [filterFrom, filterTo, filterSource, filterStatus]);



  const load = React.useCallback(async () => {
    setLoading(true);
    const rows = await Promise.all(TENANT_TABLES.map(fetchCoverage));
    setCoverage(rows);

    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count: total } = await supabase
      .from("navigation_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since);
    const { count: withSession } = await supabase
      .from("navigation_logs")
      .select("*", { count: "exact", head: true })
      .gte("created_at", since)
      .not("session_id", "is", null);
    setSessionStats({ total: total ?? 0, withSession: withSession ?? 0 });

    const { data: rlist } = await (supabase.from as LooseRow)("rename_backfill_verifications")
      .select("id, ran_at, trigger, divergent_rows, passed, notes")
      .order("ran_at", { ascending: false })
      .limit(15);
    setRuns((rlist ?? []) as VerificationRun[]);

    const { data: fdata } = await (supabase.from as LooseRow)("rename_feature_flag")
      .select("enabled, kill_switch, ramp_percent, allowed_country_codes, allowed_tenant_ids, notes")
      .limit(1)
      .maybeSingle();
    if (fdata) setFlag(fdata as FlagState);

    const { data: tdata } = await (supabase.from as LooseRow)("rename_alert_thresholds")
      .select("source, critical_threshold, warning_threshold, cooldown_minutes, notes")
      .order("source", { ascending: true });
    setThresholds((tdata ?? []) as Threshold[]);

    setLoading(false);
  }, []);


  React.useEffect(() => {
    void load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  // Load per-source breach timeline whenever filters change. Rows come from
  // rename_alert_dispatch_log and show every dispatched vs suppressed event
  // — so operators can visually spot an alert storm being flattened by the
  // cooldown window (short cluster of suppressed rows after one dispatch).
  React.useEffect(() => {
    const fromIso = new Date(filterFrom + "T00:00:00Z").toISOString();
    const toIso = new Date(filterTo + "T23:59:59Z").toISOString();
    let q = (supabase.from as LooseRow)("rename_alert_dispatch_log")
      .select("id, created_at, source, severity, suppressed, title")
      .gte("created_at", fromIso).lte("created_at", toIso);
    if (filterSource !== "all" && filterSource !== "scheduled" && filterSource !== "manual") {
      q = q.eq("source", filterSource);
    }
    if (filterStatus === "dispatched") q = q.eq("suppressed", false);
    if (filterStatus === "suppressed") q = q.eq("suppressed", true);
    q.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(500)
      .then(({ data }: { data: unknown }) => setTimeline((data as never) ?? []));
  }, [filterFrom, filterTo, filterSource, filterStatus]);

  const runVerification = async () => {
    setVerifying(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const { error } = await supabase.functions.invoke("phase3-backfill-verify", {
        body: { trigger: "manual", triggered_by: sess.session?.user.id },
      });
      if (error) throw error;
      toast.success("Verification run recorded");
      await load();
    } catch (e) {
      toast.error(`Verification failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setVerifying(false);
    }
  };

  const saveFlag = async () => {
    if (!flag) return;
    setSavingFlag(true);
    try {
      const { error } = await (supabase.from as LooseRow)("rename_feature_flag")
        .update({
          enabled: flag.enabled,
          kill_switch: flag.kill_switch,
          ramp_percent: flag.ramp_percent,
          allowed_country_codes: flag.allowed_country_codes,
          allowed_tenant_ids: flag.allowed_tenant_ids,
          notes: flag.notes,
        })
        .eq("singleton", true);
      if (error) throw error;
      await logAdminAudit({
        action: "rename_feature_flag.update",
        resourceType: "rename_feature_flag",
        newValue: flag,
        reason: "Operator adjusted rename rollout parameters",
      });
      toast.success("Feature flag saved");
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSavingFlag(false);
    }
  };

  const killSwitch = async () => {
    if (!flag) return;
    setFlag({ ...flag, kill_switch: true, enabled: false });
    // Persist immediately without waiting for Save click — the whole point.
    try {
      await (supabase.from as LooseRow)("rename_feature_flag")
        .update({ kill_switch: true, enabled: false })
        .eq("singleton", true);
      await logAdminAudit({
        action: "rename_feature_flag.kill_switch",
        resourceType: "rename_feature_flag",
        reason: "Emergency: operator pulled kill switch on identifier rename",
      });
      toast.success("Kill switch engaged — all sessions revert to legacy key");
    } catch (e) {
      toast.error(`Kill switch failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const saveThresholds = async () => {
    if (!thresholds) return;
    setSavingThresholds(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const uid = sess.session?.user.id ?? null;
      for (const t of thresholds) {
        const { error } = await (supabase.from as LooseRow)("rename_alert_thresholds")
          .update({
            critical_threshold: t.critical_threshold,
            warning_threshold: t.warning_threshold,
            cooldown_minutes: t.cooldown_minutes,
            notes: t.notes,
            updated_at: new Date().toISOString(),
            updated_by: uid,
          })
          .eq("source", t.source);
        if (error) throw error;
      }
      await logAdminAudit({
        action: "rename_alert_thresholds.update",
        resourceType: "rename_alert_thresholds",
        newValue: thresholds as never,
        reason: "Operator adjusted alert thresholds / cooldown windows",
      });
      toast.success("Thresholds saved & logged to admin_audit_log");
    } catch (e) {
      toast.error(`Save failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSavingThresholds(false);
    }
  };

  const runHealthCheck = async (sendTest: boolean) => {
    setCheckingHealth(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const { data, error } = await supabase.functions.invoke("rename-alert-healthcheck", {
        body: { send_test: sendTest, triggered_by: sess.session?.user.id },
      });
      if (error) throw error;
      setHealth(data as HealthCheckResult);
      toast.success(sendTest ? "Test alert dispatched — check Slack/email" : "Health-check complete");
    } catch (e) {
      toast.error(`Health-check failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setCheckingHealth(false);
    }
  };

  // ------ Filtered history fetch ------------------------------------------
  // Applies date range, source (trigger for verifications / source for
  // dispatches), and status (pass/fail / dispatched/suppressed) filters.
  // Fetches deterministic ordered slices for both verification history,
  // matching admin_audit_log rows, and the recent alert dispatch log so the
  // report can attribute each breach to its dedup key + cooldown outcome.
  const fetchFilteredHistory = React.useCallback(async () => {
    const fromIso = new Date(filterFrom + "T00:00:00Z").toISOString();
    const toIso = new Date(filterTo + "T23:59:59Z").toISOString();

    let vq = (supabase.from as LooseRow)("rename_backfill_verifications")
      .select("id, ran_at, trigger, divergent_rows, passed, notes, triggered_by")
      .gte("ran_at", fromIso).lte("ran_at", toIso);
    if (filterSource !== "all") vq = vq.eq("trigger", filterSource);
    if (filterStatus === "pass") vq = vq.eq("passed", true);
    if (filterStatus === "fail") vq = vq.eq("passed", false);
    // Deterministic: order by ran_at then id so ties break stably.
    const { data: allRuns } = await vq.order("ran_at", { ascending: true }).order("id", { ascending: true }).limit(5000);

    const { data: allAudit } = await supabase
      .from("admin_audit_log")
      .select("id, created_at, action, resource_type, resource_id, reason, actor_email")
      .eq("action", "phase3_backfill_verify")
      .gte("created_at", fromIso).lte("created_at", toIso)
      .order("created_at", { ascending: true }).order("id", { ascending: true })
      .limit(5000);

    let dq = (supabase.from as LooseRow)("rename_alert_dispatch_log")
      .select("id, created_at, dedup_key, source, severity, title, suppressed, slack_sent, email_sent, cooldown_expires_at")
      .gte("created_at", fromIso).lte("created_at", toIso);
    if (filterSource !== "all" && filterSource !== "scheduled" && filterSource !== "manual") {
      dq = dq.eq("source", filterSource);
    }
    if (filterStatus === "dispatched") dq = dq.eq("suppressed", false);
    if (filterStatus === "suppressed") dq = dq.eq("suppressed", true);
    const { data: allDispatch } = await dq.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(5000);

    return { allRuns: allRuns ?? [], allAudit: allAudit ?? [], allDispatch: allDispatch ?? [] };
  }, [filterFrom, filterTo, filterSource, filterStatus]);

  const ROLLBACK_LINE =
    "Rollback: docs/runbooks/phase3-tenant-backfill.md · docs/runbooks/rename-taxid-identifiers.md";

  const exportCsv = async () => {
    if (!(await assertSuperAdminForExport())) return;
    const { allRuns, allAudit, allDispatch } = await fetchFilteredHistory();
    const thresholdIndex = new Map<string, Threshold>();
    (thresholds ?? []).forEach(t => thresholdIndex.set(t.source, t));

    // Header banner rows (comment-prefixed) so the report is
    // self-describing but still parses as CSV in Excel/Sheets.
    const banner = [
      `# Yalla Mobility — Phase 3 verification & alert history`,
      `# Range: ${filterFrom} → ${filterTo}`,
      `# Source filter: ${filterSource} · Status filter: ${filterStatus}`,
      `# ${ROLLBACK_LINE}`,
      `#`,
      `# Alert thresholds in effect at export time:`,
      ...(thresholds ?? []).map(t =>
        `# ${t.source}: warning≥${t.warning_threshold}, critical≥${t.critical_threshold}, cooldown=${t.cooldown_minutes}m`
      ),
    ];

    const header = [
      "kind","id","when","source_or_trigger","severity_or_passed",
      "divergent","dedup_key","suppressed","slack_sent","email_sent",
      "warning_threshold","critical_threshold","cooldown_minutes",
      "breach_reason","actor_or_notes",
    ];
    const quote = (v: unknown) => `"${String(v ?? "").replace(/[\r\n]+/g, " ").replace(/"/g, '""')}"`;

    const rows: string[] = [...banner, header.join(",")];

    for (const r of allRuns as Array<{ id: string; ran_at: string; trigger: string; divergent_rows: number; passed: boolean; notes: string | null; triggered_by: string | null }>) {
      const t = thresholdIndex.get("scheduled-verify");
      const breach = !r.passed
        ? `divergent=${r.divergent_rows} ≥ critical=${t?.critical_threshold ?? 0}`
        : "";
      rows.push([
        "verification", r.id, r.ran_at, r.trigger, r.passed ? "pass" : "fail",
        r.divergent_rows, "", "", "", "",
        t?.warning_threshold ?? "", t?.critical_threshold ?? "", t?.cooldown_minutes ?? "",
        breach, r.notes ?? r.triggered_by ?? "",
      ].map(quote).join(","));
    }
    for (const a of allAudit as Array<{ id: string; created_at: string; action: string; reason: string | null; actor_email: string | null }>) {
      rows.push([
        "audit", a.id, a.created_at, a.action, "",
        "", "", "", "", "",
        "", "", "",
        "", a.reason ?? a.actor_email ?? "",
      ].map(quote).join(","));
    }
    for (const d of allDispatch as Array<{ id: string; created_at: string; source: string; severity: string; title: string; dedup_key: string; suppressed: boolean; slack_sent: boolean; email_sent: boolean }>) {
      const t = thresholdIndex.get(d.source);
      const reason = d.suppressed
        ? `suppressed (within ${t?.cooldown_minutes ?? "?"}m cooldown)`
        : `dispatched (${d.severity})`;
      rows.push([
        "alert", d.id, d.created_at, d.source, d.severity,
        "", d.dedup_key, d.suppressed, d.slack_sent, d.email_sent,
        t?.warning_threshold ?? "", t?.critical_threshold ?? "", t?.cooldown_minutes ?? "",
        reason, d.title,
      ].map(quote).join(","));
    }

    const blob = new Blob([rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `yalla-phase3-verify-${filterFrom}_to_${filterTo}_${filterSource}_${filterStatus}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${allRuns.length + allAudit.length + allDispatch.length} rows`);
  };

  const exportPdf = async () => {
    if (!(await assertSuperAdminForExport())) return;
    const { allRuns, allAudit, allDispatch } = await fetchFilteredHistory();
    const thresholdIndex = new Map<string, Threshold>();
    (thresholds ?? []).forEach(t => thresholdIndex.set(t.source, t));

    const doc = new jsPDF();
    doc.setFontSize(16); doc.text("Yalla Mobility — Phase 3 Verification & Alert Report", 14, 18);
    doc.setFontSize(9);
    doc.text(`Range: ${filterFrom} → ${filterTo}   Source: ${filterSource}   Status: ${filterStatus}`, 14, 25);
    doc.text(ROLLBACK_LINE, 14, 31);

    doc.setFontSize(11); doc.text("Alert thresholds in effect", 14, 41);
    autoTable(doc, {
      startY: 44,
      head: [["Source", "Warning ≥", "Critical ≥", "Cooldown (min)", "Notes"]],
      body: (thresholds ?? []).map(t => [
        t.source, t.warning_threshold, t.critical_threshold, t.cooldown_minutes, t.notes ?? "",
      ]),
      styles: { fontSize: 8 },
    });
    let y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 60;

    doc.setFontSize(11); doc.text(`Verification runs (${allRuns.length})`, 14, y + 10);
    autoTable(doc, {
      startY: y + 13,
      head: [["When", "Trigger", "Divergent", "Result", "Breach reason"]],
      body: (allRuns as Array<{ ran_at: string; trigger: string; divergent_rows: number; passed: boolean; notes: string | null }>).map(r => {
        const t = thresholdIndex.get("scheduled-verify");
        const breach = !r.passed
          ? `divergent=${r.divergent_rows} ≥ critical=${t?.critical_threshold ?? 0}`
          : "";
        return [new Date(r.ran_at).toISOString(), r.trigger, String(r.divergent_rows), r.passed ? "PASS" : "FAIL", breach];
      }),
      styles: { fontSize: 7 },
    });
    y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;

    doc.setFontSize(11); doc.text(`Alert dispatch log (${allDispatch.length})`, 14, y + 10);
    autoTable(doc, {
      startY: y + 13,
      head: [["When", "Source", "Severity", "Suppressed", "Slack", "Email", "Reason"]],
      body: (allDispatch as Array<{ created_at: string; source: string; severity: string; suppressed: boolean; slack_sent: boolean; email_sent: boolean; title: string }>).map(d => {
        const t = thresholdIndex.get(d.source);
        const reason = d.suppressed
          ? `suppressed within ${t?.cooldown_minutes ?? "?"}m cooldown`
          : `dispatched: ${d.title}`;
        return [new Date(d.created_at).toISOString(), d.source, d.severity, d.suppressed ? "yes" : "no", d.slack_sent ? "yes" : "no", d.email_sent ? "yes" : "no", reason];
      }),
      styles: { fontSize: 7 },
    });
    y = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y + 40;

    doc.setFontSize(11); doc.text(`Audit-log mirror (${allAudit.length})`, 14, y + 10);
    autoTable(doc, {
      startY: y + 13,
      head: [["When", "Action", "Actor", "Reason"]],
      body: (allAudit as Array<{ created_at: string; action: string; actor_email: string | null; reason: string | null }>).map(a => [
        new Date(a.created_at).toISOString(), a.action, a.actor_email ?? "—", (a.reason ?? "").slice(0, 80),
      ]),
      styles: { fontSize: 7 },
    });

    doc.save(`yalla-phase3-verify-${filterFrom}_to_${filterTo}_${filterSource}_${filterStatus}.pdf`);
    toast.success("PDF generated");
  };


  const allClean =
    coverage?.every((c) => (c.null_tenant ?? 0) === 0 && (c.null_country ?? 0) === 0) ?? false;



  return (
    <div className="p-6 space-y-6">
      <SeoHead path="/dashboard/admin/rename-backfill-monitor" title="Rename & Backfill Monitor" description="Operator dashboard for the identifier rename and Phase 3 tenant/country backfill." />
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Rename & Backfill Monitor</h1>
          <p className="text-sm text-muted-foreground">
            Identifier rename (yalla_ / legacy) rollout, Phase 3 tenant/country
            backfill coverage, and audit history.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
          <Button size="sm" onClick={runVerification} disabled={verifying}>
            <PlayCircle className={`mr-2 h-4 w-4 ${verifying ? "animate-spin" : ""}`} />
            Run verification
          </Button>
          <AppButton analytics="admin_rename_backfill_report_csv_download" action="submit" size="sm" variant="outline" aria-label="Download backfill verification report as CSV" onClick={exportCsv}>
            <Download className="mr-2 h-4 w-4" /> CSV
          </AppButton>
          <AppButton analytics="admin_rename_backfill_report_pdf_download" action="submit" size="sm" variant="outline" aria-label="Download backfill verification report as PDF" onClick={exportPdf}>
            <FileText className="mr-2 h-4 w-4" /> PDF
          </AppButton>
        </div>

      </div>

      {/* -------------------- Backfill coverage -------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Backfill coverage</CardTitle>
          {coverage &&
            (allClean ? (
              <Badge className="bg-status-success"><ShieldCheck className="mr-1 h-3 w-3" />All clean</Badge>
            ) : (
              <Badge variant="destructive"><ShieldAlert className="mr-1 h-3 w-3" />NULLs remaining</Badge>
            ))}
        </CardHeader>
        <CardContent>
          {!coverage ? (
            <Skeleton className="h-32 w-full" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Table</th>
                  <th className="py-2 text-right">Rows</th>
                  <th className="py-2 text-right">NULL tenant_id</th>
                  <th className="py-2 text-right">NULL country_code</th>
                  <th className="py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((c) => {
                  const clean = (c.null_tenant ?? 0) === 0 && (c.null_country ?? 0) === 0;
                  return (
                    <tr key={c.table} className="border-b last:border-0">
                      <td className="py-2 font-mono">{c.table}</td>
                      <td className="py-2 text-right">{c.total?.toLocaleString() ?? "—"}</td>
                      <td className="py-2 text-right">{c.null_tenant ?? "N/A"}</td>
                      <td className="py-2 text-right">{c.null_country ?? "N/A"}</td>
                      <td className="py-2">
                        {c.error ? (
                          <Badge variant="secondary">column not present</Badge>
                        ) : clean ? (
                          <Badge className="bg-status-success">clean</Badge>
                        ) : (
                          <Badge variant="destructive">needs backfill</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* -------------------- Verification history -------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Verification runs (last 15)</CardTitle>
        </CardHeader>
        <CardContent>
          {!runs ? (
            <Skeleton className="h-24 w-full" />
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No verification runs yet — click "Run verification".</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">When</th>
                  <th className="py-2">Trigger</th>
                  <th className="py-2 text-right">Divergent</th>
                  <th className="py-2">Result</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="py-2">{new Date(r.ran_at).toLocaleString()}</td>
                    <td className="py-2"><Badge variant="outline">{r.trigger}</Badge></td>
                    <td className="py-2 text-right">{r.divergent_rows}</td>
                    <td className="py-2">
                      {r.passed ? (
                        <Badge className="bg-status-success">pass</Badge>
                      ) : (
                        <Badge variant="destructive">fail</Badge>
                      )}
                    </td>
                    <td className="py-2 text-xs text-muted-foreground">{r.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* -------------------- Export filters -------------------- */}
      <Card data-testid="export-filters">
        <CardHeader>
          <CardTitle className="text-base">Export filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <select value={filterSource} onChange={(e) => setFilterSource(e.target.value)}
                      aria-label="Source filter"
                      className="block w-full px-3 py-2 text-sm rounded-md border bg-background">
                <option value="all">All</option>
                <option value="scheduled">Verification: scheduled</option>
                <option value="manual">Verification: manual</option>
                <option value="rename-audit">Alerts: rename-audit</option>
                <option value="phase3-backfill">Alerts: phase3-backfill</option>
                <option value="scheduled-verify">Alerts: scheduled-verify</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}
                      aria-label="Status filter"
                      className="block w-full px-3 py-2 text-sm rounded-md border bg-background">
                <option value="all">All</option>
                <option value="pass">Verification: pass</option>
                <option value="fail">Verification: fail</option>
                <option value="dispatched">Alerts: dispatched</option>
                <option value="suppressed">Alerts: suppressed (cooldown)</option>
              </select>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Filters apply to the CSV / PDF buttons above. Reports are deterministic
            (ordered by <code>when</code> then <code>id</code>) and include current
            threshold context plus rollback pointers.
          </p>
        </CardContent>
      </Card>

      {/* -------------------- Breach timeline (per source) -------------------- */}
      <Card data-testid="breach-timeline">
        <CardHeader>
          <CardTitle className="text-base">Breach timeline (dispatched vs suppressed)</CardTitle>
        </CardHeader>
        <CardContent>
          {!timeline ? (
            <Skeleton className="h-24 w-full" />
          ) : timeline.length === 0 ? (
            <p className="text-sm text-muted-foreground">No alert dispatches in the selected filter range.</p>
          ) : (
            <>
              {(() => {
                const bySource = new Map<string, typeof timeline>();
                for (const row of timeline) {
                  const arr = bySource.get(row.source) ?? [];
                  arr.push(row);
                  bySource.set(row.source, arr);
                }
                return Array.from(bySource.entries()).map(([source, rows]) => {
                  const dispatched = rows.filter(r => !r.suppressed).length;
                  const suppressed = rows.filter(r => r.suppressed).length;
                  return (
                    <div key={source} className="mb-4 last:mb-0" data-testid={`timeline-source-${source}`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-mono text-sm">{source}</span>
                        <span className="text-xs text-muted-foreground">
                          <Badge className="bg-status-success mr-1">{dispatched} dispatched</Badge>
                          <Badge variant="secondary">{suppressed} suppressed</Badge>
                        </span>
                      </div>
                      <div className="flex gap-[2px] h-6 rounded overflow-hidden border">
                        {rows.map(r => (
                          <span
                            key={r.id}
                            title={`${new Date(r.created_at).toISOString()} · ${r.severity} · ${r.suppressed ? "suppressed" : "dispatched"} — ${r.title}`}
                            className={`flex-1 min-w-[3px] ${r.suppressed ? "bg-muted-foreground/40" : r.severity === "critical" ? "bg-status-danger" : r.severity === "warning" ? "bg-status-warning" : "bg-status-success"}`}
                            data-suppressed={r.suppressed}
                          />
                        ))}
                      </div>
                    </div>
                  );
                });
              })()}
              <p className="mt-2 text-xs text-muted-foreground">
                Solid bars = dispatched (colored by severity). Grey bars = suppressed by cooldown. Hover a bar for detail.
              </p>
            </>
          )}
        </CardContent>
      </Card>



      {/* -------------------- Alerting health-check -------------------- */}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4" /> Alert pipeline health-check
          </CardTitle>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => runHealthCheck(false)} disabled={checkingHealth}>
              <Activity className="mr-2 h-4 w-4" /> Check config
            </Button>
            <Button size="sm" onClick={() => runHealthCheck(true)} disabled={checkingHealth}>
              <Send className="mr-2 h-4 w-4" /> Send test alert
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {!health ? (
            <p className="text-sm text-muted-foreground">
              Verify SLACK_WEBHOOK_URL and SEND_ALERT_EMAILS_TO are configured. "Send test alert" delivers a synthetic notification through the full pipeline (with rollback instructions).
            </p>
          ) : (
            <div className="space-y-2">
              {Object.entries(health.checks).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between text-sm">
                  <span className="font-mono">{k}</span>
                  <Badge className={v.ok ? "bg-status-success" : "bg-status-danger"}>
                    {v.ok ? "OK" : "MISSING"}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-1 ml-3 text-right">{v.detail}</span>
                </div>
              ))}
              {health.test_sent && (
                <pre className="mt-3 rounded bg-muted p-2 text-xs overflow-x-auto">
                  {JSON.stringify(health.test_result, null, 2)}
                </pre>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* -------------------- Alert thresholds -------------------- */}
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Alert thresholds & cooldown</CardTitle>
          <Button size="sm" onClick={saveThresholds} disabled={savingThresholds || !thresholds}>
            <Save className="mr-2 h-4 w-4" /> Save thresholds
          </Button>
        </CardHeader>
        <CardContent>
          {!thresholds ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2">Source</th>
                  <th className="py-2 text-right">Critical ≥</th>
                  <th className="py-2 text-right">Warning ≥</th>
                  <th className="py-2 text-right">Cooldown (min)</th>
                  <th className="py-2">Notes</th>
                </tr>
              </thead>
              <tbody>
                {thresholds.map((t, i) => (
                  <tr key={t.source} className="border-b last:border-0">
                    <td className="py-2 font-mono">{t.source}</td>
                    <td className="py-2 text-right">
                      <Input type="number" className="w-20 ml-auto"
                        value={t.critical_threshold}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setThresholds(thresholds.map((x, j) => j === i ? { ...x, critical_threshold: v } : x));
                        }} />
                    </td>
                    <td className="py-2 text-right">
                      <Input type="number" className="w-20 ml-auto"
                        value={t.warning_threshold}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setThresholds(thresholds.map((x, j) => j === i ? { ...x, warning_threshold: v } : x));
                        }} />
                    </td>
                    <td className="py-2 text-right">
                      <Input type="number" className="w-20 ml-auto"
                        value={t.cooldown_minutes}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setThresholds(thresholds.map((x, j) => j === i ? { ...x, cooldown_minutes: v } : x));
                        }} />
                    </td>
                    <td className="py-2">
                      <Input value={t.notes ?? ""}
                        onChange={(e) => setThresholds(thresholds.map((x, j) => j === i ? { ...x, notes: e.target.value } : x))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Cooldown collapses repeated breaches into one Slack/email — suppressed alerts still write to <code>rename_alert_dispatch_log</code>. Saved changes are logged to <code>admin_audit_log</code>.
          </p>
        </CardContent>
      </Card>

      {/* -------------------- Feature flag -------------------- */}

      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Identifier rename — feature flag</CardTitle>
          <Button size="sm" variant="destructive" onClick={killSwitch} disabled={!flag}>
            Engage kill switch
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {!flag ? (
            <Skeleton className="h-40 w-full" />
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Enabled</Label>
                  <p className="text-xs text-muted-foreground">Master switch — when off, every session stays on the legacy key.</p>
                </div>
                <Switch checked={flag.enabled} onCheckedChange={(v) => setFlag({ ...flag, enabled: v })} disabled={flag.kill_switch} />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm">Kill switch</Label>
                  <p className="text-xs text-muted-foreground">Emergency override — forces everyone back to the legacy key regardless of other settings.</p>
                </div>
                <Switch checked={flag.kill_switch} onCheckedChange={(v) => setFlag({ ...flag, kill_switch: v })} />
              </div>

              <div>
                <Label className="text-sm">Ramp: {flag.ramp_percent}% of sessions</Label>
                <Slider
                  value={[flag.ramp_percent]}
                  min={0} max={100} step={1}
                  onValueChange={([v]) => setFlag({ ...flag, ramp_percent: v })}
                  disabled={flag.kill_switch || !flag.enabled}
                  className="mt-2"
                />
                <p className="mt-1 text-xs text-muted-foreground">Deterministic bucket per device — same browser always lands in the same slot, no flip-flop.</p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-sm">Allowed country codes</Label>
                  <Input
                    value={flag.allowed_country_codes.join(",")}
                    onChange={(e) => setFlag({ ...flag, allowed_country_codes: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="KE, UG, TZ (leave empty for all)"
                  />
                </div>
                <div>
                  <Label className="text-sm">Allowed tenant IDs</Label>
                  <Input
                    value={flag.allowed_tenant_ids.join(",")}
                    onChange={(e) => setFlag({ ...flag, allowed_tenant_ids: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })}
                    placeholder="uuid,uuid (leave empty for all)"
                  />
                </div>
              </div>

              <div>
                <Label className="text-sm">Notes</Label>
                <Input
                  value={flag.notes ?? ""}
                  onChange={(e) => setFlag({ ...flag, notes: e.target.value })}
                  placeholder="Change reason for the audit log"
                />
              </div>

              <div className="flex justify-end">
                <Button size="sm" onClick={saveFlag} disabled={savingFlag}>
                  <Save className="mr-2 h-4 w-4" />
                  Save flag
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* -------------------- Session-key adoption -------------------- */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Session-key adoption (last 1h)</CardTitle>
        </CardHeader>
        <CardContent>
          {!sessionStats ? (
            <Skeleton className="h-16 w-full" />
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-3xl font-semibold">{sessionStats.total.toLocaleString()}</div>
                <div className="text-xs text-muted-foreground">navigation events</div>
              </div>
              <div>
                <div className="text-3xl font-semibold">
                  {sessionStats.total === 0
                    ? "—"
                    : `${Math.round((sessionStats.withSession / sessionStats.total) * 100)}%`}
                </div>
                <div className="text-xs text-muted-foreground">
                  with active session_id (legacy + new)
                </div>
              </div>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">
            Rollback: engage kill switch above OR revert
            <code> src/lib/renameFeatureFlag.ts</code> defaults. Full runbook:
            <code> docs/runbooks/rename-taxid-identifiers.md</code>.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
