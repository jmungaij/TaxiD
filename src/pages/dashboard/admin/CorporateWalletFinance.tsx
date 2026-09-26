/**
 * Corporate Wallet Finance Console.
 *
 * Finance-only surface for the pre-funded corporate wallet:
 *   • daily reconciliation runs, findings and CSV/PDF discrepancy exports,
 *   • rerun controls for any date range, queued retries and per-attempt audit,
 *   • instant mismatch alerting (email + webhook) with delivery status,
 *   • evidence-backed reversal / refund workflow that always posts a
 *     compensating debit instead of editing history,
 *   • scoped funding limits and an append-only finance audit trail.
 *
 * Nothing on this page can credit a wallet: credits stay exclusive to the
 * verified M-Pesa callback RPC.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertTriangle, BellRing, CheckCircle2, Download, FileText, FlaskConical, Loader2, Paperclip,
  RefreshCw, ShieldCheck, Undo2,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { SeoHead } from "@/components/seo/SeoHead";
import { FUNDING_STATUS_LABEL, type FundingRequestRow } from "@/lib/charter/walletFunding";
import { downloadReportCsv, downloadReportPdf } from "@/lib/corporate/executiveExports";
import {
  reconciliationAlertsReport, reconciliationAttemptsReport, reconciliationFindingsReport,
  type ReconAlertLike, type ReconAttemptLike, type ReconFindingLike, type ReconRunLike,
} from "@/lib/charter/reconciliationExports";
import { FindingDrilldown } from "@/components/finance/FindingDrilldown";
import { reconDeniedReason, useReconPermissions } from "@/lib/charter/reconPermissions";
import { listReconAudit, reconAuditReport, recordReconAction, type ReconAuditRow } from "@/lib/charter/reconAudit";
import {
  absoluteDrift, bulkActionable, describeFilters, dryRunReport, filterFindings, findingKinds,
  findingWallets, resolutionStatus, FINDING_STATUSES,
  type DryRunPreview, type FindingFilters,
} from "@/lib/charter/reconFilters";
import { Link } from "react-router-dom";
import { AppButton } from "@/components/nav/AppButton";

const money = (n: unknown) => `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(Number(n ?? 0)))}`;
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-KE") : "—");
const dayInput = (d: Date) => d.toISOString().slice(0, 10);

type Run = ReconRunLike;
type Finding = ReconFindingLike;
type Attempt = ReconAttemptLike;

interface Limit {
  id: string; wallet_id: string | null; actor_id: string | null; department: string | null;
  label: string | null; per_txn_max_kes: number; daily_max_kes: number;
  monthly_max_kes: number; approval_threshold_kes: number;
}
interface FinanceAction {
  id: string; funding_request_id: string | null; wallet_id: string | null; action: string;
  amount_kes: number | null; reason: string; ledger_entry_id: string | null; created_at: string;
}
type AlertRow = ReconAlertLike;

interface DeliveryAttempt {
  id: string; alert_id: string; attempt: number; channel: string; target: string | null;
  ok: boolean; status_code: number | null; error: string | null;
  duration_ms: number | null; next_attempt_at: string | null; created_at: string;
}
interface AlertSettings {
  id: string; enabled: boolean; email_recipients: string[] | null;
  webhook_url: string | null; min_severity: string;
}

export default function CorporateWalletFinance() {
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runs, setRuns] = useState<Run[]>([]);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [limits, setLimits] = useState<Limit[]>([]);
  const [actions, setActions] = useState<FinanceAction[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [settings, setSettings] = useState<AlertSettings | null>(null);
  const [paid, setPaid] = useState<FundingRequestRow[]>([]);
  const [deliveries, setDeliveries] = useState<DeliveryAttempt[]>([]);
  const [drilldown, setDrilldown] = useState<Finding | null>(null);
  const [ackNotes, setAckNotes] = useState<Record<string, string>>({});
  const [auditTrail, setAuditTrail] = useState<ReconAuditRow[]>([]);
  const { can, loading: permsLoading } = useReconPermissions();

  // advanced filters + bulk selection
  const [filters, setFilters] = useState<FindingFilters>({ status: "all", kind: "all", severity: "all" });
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [bulkNotes, setBulkNotes] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [scope, setScope] = useState<"latest" | "all">("latest");

  // rerun controls
  const today = new Date();
  const [from, setFrom] = useState(dayInput(new Date(today.getTime() - 7 * 86_400_000)));
  const [to, setTo] = useState(dayInput(new Date(today.getTime() + 86_400_000)));
  const [note, setNote] = useState("");
  const [preview, setPreview] = useState<DryRunPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // reversal workflow
  const [target, setTarget] = useState("");
  const [reason, setReason] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [evidenceRef, setEvidenceRef] = useState("");
  const [uploaded, setUploaded] = useState<{ path: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  // alert settings draft
  const [recipients, setRecipients] = useState("");
  const [webhook, setWebhook] = useState("");
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    const [r, f, l, a, p, at, al, st, dl] = await Promise.all([
      supabase.from("charter_wallet_reconciliation_runs").select("*").order("created_at", { ascending: false }).limit(20),
      supabase.from("charter_wallet_reconciliation_findings").select("*").order("created_at", { ascending: false }).limit(200),
      supabase.from("charter_wallet_funding_limits").select("*").order("created_at", { ascending: true }),
      supabase.from("charter_wallet_finance_actions").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("charter_wallet_funding_requests").select("*").eq("status", "paid").order("created_at", { ascending: false }).limit(50),
      supabase.from("charter_wallet_reconciliation_attempts").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("charter_wallet_finance_alerts").select("*").order("created_at", { ascending: false }).limit(50),
      supabase.from("charter_wallet_finance_alert_settings").select("*").order("created_at").limit(1).maybeSingle(),
      supabase.from("charter_wallet_alert_delivery_attempts").select("*").order("created_at", { ascending: false }).limit(150),
    ]);
    setRuns((r.data ?? []) as Run[]);
    setFindings((f.data ?? []) as Finding[]);
    setLimits((l.data ?? []) as Limit[]);
    setActions((a.data ?? []) as FinanceAction[]);
    setPaid((p.data ?? []) as unknown as FundingRequestRow[]);
    setAttempts((at.data ?? []) as Attempt[]);
    setAlerts((al.data ?? []) as unknown as AlertRow[]);
    setDeliveries((dl.data ?? []) as unknown as DeliveryAttempt[]);
    setAuditTrail(await listReconAudit(200));
    const s = (st.data ?? null) as AlertSettings | null;
    setSettings(s);
    setRecipients((s?.email_recipients ?? []).join(", "));
    setWebhook(s?.webhook_url ?? "");
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const latest = runs[0] ?? null;
  const latestFindings = useMemo(
    () => (latest ? findings.filter((x) => x.run_id === latest.id) : findings),
    [findings, latest],
  );
  const pendingAlerts = alerts.filter((a) => a.status === "pending").length;

  /* ------------------------------------- advanced filters + bulk actions */

  const scoped = scope === "latest" ? latestFindings : findings;
  const visibleFindings = useMemo(
    () => filterFindings(scoped as ReconFindingLike[], filters) as Finding[],
    [scoped, filters],
  );
  const kinds = useMemo(() => findingKinds(findings as ReconFindingLike[]), [findings]);
  const wallets = useMemo(() => findingWallets(findings as ReconFindingLike[]), [findings]);
  const drift = useMemo(() => absoluteDrift(visibleFindings as ReconFindingLike[]), [visibleFindings]);
  const pickedIds = useMemo(
    () => visibleFindings.filter((f) => picked[f.id]).map((f) => f.id),
    [visibleFindings, picked],
  );
  const activeFilters = describeFilters({ ...filters, runId: scope === "latest" ? latest?.id : undefined });

  const toggleAll = (on: boolean) => {
    const next: Record<string, boolean> = {};
    if (on) bulkActionable(visibleFindings as ReconFindingLike[]).forEach((f) => { next[f.id] = true; });
    setPicked(next);
  };

  const bulkResolve = async (status: "acknowledged" | "resolved" | "false_positive") => {
    if (!can("recon.resolve")) return denied("recon.resolve");
    if (pickedIds.length === 0) return;
    setBulkBusy(true);
    let ok = 0;
    for (const id of pickedIds) {
      const { error } = await supabase.rpc("charter_wallet_resolve_finding", {
        _finding_id: id, _status: status, _notes: bulkNotes || null,
      } as never);
      if (!error) ok += 1;
    }
    await recordReconAction({
      action: status === "acknowledged" ? "acknowledge" : "resolve",
      permission: "recon.resolve",
      targetType: "finding_bulk",
      rowCount: ok,
      filters: activeFilters,
      resolutionNotes: bulkNotes || null,
      detail: { requested: pickedIds.length, applied: ok, status, finding_ids: pickedIds },
      outcome: ok === pickedIds.length ? "success" : "failed",
    });
    setBulkBusy(false);
    setPicked({});
    setBulkNotes("");
    toast({
      title: `${ok}/${pickedIds.length} finding(s) updated`,
      description: `Marked ${status.replace("_", " ")}. The action is recorded in the audit trail.`,
      variant: ok === pickedIds.length ? undefined : "destructive",
    });
    await load();
  };

  /* ------------------------------------------------------------ exports */

  const denied = (perm: Parameters<typeof reconDeniedReason>[0]) => {
    toast({ title: "Not permitted", description: reconDeniedReason(perm), variant: "destructive" });
  };

  const exportFindings = async (fmt: "csv" | "pdf") => {
    if (!can("recon.export")) {
      await recordReconAction({ action: "export", permission: "recon.export", dataset: "reconciliation.findings", exportFormat: fmt, filters: activeFilters, outcome: "denied" });
      return denied("recon.export");
    }
    const table = reconciliationFindingsReport(visibleFindings as ReconFindingLike[], runs);
    if (table.rows.length === 0) {
      toast({ title: "Nothing to export", description: "No findings match the current filters." });
      return;
    }
    if (fmt === "csv") downloadReportCsv(table);
    else await downloadReportPdf(table);
    await recordReconAction({
      action: "export", permission: "recon.export", dataset: "reconciliation.findings",
      exportFormat: fmt, rowCount: table.rows.length, filters: activeFilters,
    });
    toast({ title: `Findings exported (${fmt.toUpperCase()})`, description: `${table.rows.length} filtered discrepancy row(s).` });
  };

  const exportAudit = async (fmt: "csv" | "pdf") => {
    if (!can("recon.export")) return denied("recon.export");
    const table = reconAuditReport(auditTrail);
    if (table.rows.length === 0) {
      toast({ title: "Nothing to export", description: "No finance actions recorded yet." });
      return;
    }
    if (fmt === "csv") downloadReportCsv(table);
    else await downloadReportPdf(table);
    await recordReconAction({
      action: "export", permission: "recon.export", dataset: "reconciliation.action_audit",
      exportFormat: fmt, rowCount: table.rows.length,
    });
  };

  const exportPreview = async (fmt: "csv" | "pdf") => {
    if (!preview) return;
    if (!can("recon.export")) return denied("recon.export");
    const table = dryRunReport(preview);
    if (fmt === "csv") downloadReportCsv(table);
    else await downloadReportPdf(table);
    await recordReconAction({
      action: "export", permission: "recon.export", dataset: "reconciliation.dry_run",
      exportFormat: fmt, rowCount: table.rows.length, filters: { from, to },
    });
  };

  const runDryRun = async () => {
    if (!can("recon.rerun")) {
      await recordReconAction({ action: "rerun_dry_run", permission: "recon.rerun", filters: { from, to }, outcome: "denied" });
      return denied("recon.rerun");
    }
    setPreviewing(true);
    const { data, error } = await supabase.rpc("charter_wallet_reconcile_dry_run", {
      _from: from, _to: to,
    } as never);
    setPreviewing(false);
    if (error) {
      await recordReconAction({ action: "rerun_dry_run", permission: "recon.rerun", filters: { from, to }, outcome: "failed", detail: { error: error.message } });
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
      return;
    }
    const result = data as unknown as DryRunPreview;
    setPreview(result);
    await recordReconAction({
      action: "rerun_dry_run", permission: "recon.rerun", filters: { from, to },
      rowCount: result?.findings ?? 0,
      detail: { wallets_scanned: result?.wallets_scanned, requests_scanned: result?.requests_scanned, critical: result?.critical },
    });
    toast({
      title: "Dry run complete — nothing written",
      description: `${result?.findings ?? 0} discrepancy(ies) would be recorded (${result?.critical ?? 0} critical).`,
    });
  };


  const exportAttempts = async (fmt: "csv" | "pdf") => {
    if (!can("recon.export")) return denied("recon.export");
    const table = reconciliationAttemptsReport(attempts);
    if (fmt === "csv") downloadReportCsv(table);
    else await downloadReportPdf(table);
  };

  /* ---------------------------------------------------- reconciliation */

  const notifyFinance = async () => {
    const { error } = await supabase.functions.invoke("wallet-recon-alerts", { body: {} });
    if (error) console.error("wallet-recon-alerts", error);
  };

  const runReconciliation = async () => {
    if (!can("recon.rerun")) return denied("recon.rerun");
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc("charter_wallet_daily_reconciliation", {
        _window: "24 hours", _triggered_by: "console",
      } as never);
      if (error) throw new Error(error.message);
      const res = data as { critical?: number; findings?: number } | null;
      if ((res?.findings ?? 0) > 0) await notifyFinance();
      toast({
        title: res?.critical ? "Reconciliation found critical drift" : "Reconciliation balanced",
        description: `${res?.findings ?? 0} finding(s), ${res?.critical ?? 0} critical.`,
        variant: res?.critical ? "destructive" : "default",
      });
      await load();
    } catch (e) {
      toast({ title: "Reconciliation failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const rerunRange = async (retryOf: string | null = null) => {
    if (!can("recon.rerun")) {
      await recordReconAction({ action: "rerun", permission: "recon.rerun", filters: { from, to }, outcome: "denied" });
      return denied("recon.rerun");
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.rpc("charter_wallet_reconcile_range", {
        _from: new Date(from).toISOString(),
        _to: new Date(to).toISOString(),
        _triggered_by: retryOf ? "console_retry" : "console_range",
        _retry_of: retryOf,
        _note: note.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
      const res = data as { findings?: number; critical?: number } | null;
      if ((res?.findings ?? 0) > 0) await notifyFinance();
      await recordReconAction({
        action: "rerun", permission: "recon.rerun", targetType: "attempt", targetId: retryOf,
        filters: { from, to }, rowCount: res?.findings ?? 0, resolutionNotes: note.trim() || null,
        detail: { critical: res?.critical ?? 0, retry_of: retryOf },
      });
      toast({
        title: res?.critical ? "Rerun found critical drift" : "Rerun completed",
        description: `${res?.findings ?? 0} finding(s), ${res?.critical ?? 0} critical.`,
        variant: res?.critical ? "destructive" : "default",
      });
      setNote("");
      setPreview(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      await recordReconAction({ action: "rerun", permission: "recon.rerun", filters: { from, to }, outcome: "failed", detail: { error: msg } });
      toast({ title: "Rerun failed", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };


  const queueRetry = async (retryOf: string | null, rangeFrom?: string, rangeTo?: string) => {
    try {
      const { error } = await supabase.rpc("charter_wallet_queue_reconciliation", {
        _from: new Date(rangeFrom ?? from).toISOString(),
        _to: new Date(rangeTo ?? to).toISOString(),
        _retry_of: retryOf,
        _note: note.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
      toast({ title: "Retry queued", description: "The attempt is queued and auditable below." });
      await load();
    } catch (e) {
      toast({ title: "Could not queue retry", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    }
  };

  const runQueued = async (a: Attempt) => {
    setFrom(a.requested_from.slice(0, 10));
    setTo(a.requested_to.slice(0, 10));
    setRunning(true);
    try {
      const { error } = await supabase.rpc("charter_wallet_reconcile_range", {
        _from: a.requested_from, _to: a.requested_to,
        _triggered_by: "console_retry", _retry_of: a.id, _note: a.note,
      } as never);
      if (error) throw new Error(error.message);
      await notifyFinance();
      toast({ title: "Queued attempt executed" });
      await load();
    } catch (e) {
      toast({ title: "Attempt failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  /* ------------------------------------------------------ alert settings */

  const saveSettings = async (patch: Partial<AlertSettings>) => {
    if (!settings) return;
    setSavingSettings(true);
    try {
      const { error } = await supabase
        .from("charter_wallet_finance_alert_settings")
        .update({
          enabled: patch.enabled ?? settings.enabled,
          min_severity: patch.min_severity ?? settings.min_severity,
          email_recipients: recipients.split(",").map((s) => s.trim()).filter(Boolean),
          webhook_url: webhook.trim() || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", settings.id);
      if (error) throw new Error(error.message);
      toast({ title: "Alert settings saved" });
      await load();
    } catch (e) {
      toast({ title: "Could not save settings", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setSavingSettings(false);
    }
  };

  /* ---------------------------------------------------------- reversals */

  const selected = useMemo(
    () => paid.find((p) => p.reference === target.trim() || p.id === target.trim()) ?? null,
    [paid, target],
  );

  const uploadEvidence = async () => {
    if (!evidenceFile || !selected) {
      toast({ title: "Select a paid funding and a file first", variant: "destructive" });
      return;
    }
    setUploading(true);
    try {
      const path = `${selected.id}/${Date.now()}-${evidenceFile.name.replace(/[^\w.-]/g, "_")}`;
      const { error } = await supabase.storage
        .from("wallet-reversal-evidence")
        .upload(path, evidenceFile, { upsert: false });
      if (error) throw new Error(error.message);
      setUploaded({ path, name: evidenceFile.name });
      toast({ title: "Evidence uploaded", description: "Confirm the compensating entry to complete the reversal." });
    } catch (e) {
      toast({ title: "Upload failed", description: e instanceof Error ? e.message : "Error", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const reverse = async (kind: "reversed" | "refunded") => {
    if (!can("recon.reverse")) return denied("recon.reverse");
    if (!selected || reason.trim().length < 8) {
      toast({ title: "A paid funding reference and a reason (min 8 characters) are required", variant: "destructive" });
      return;
    }
    if (!uploaded) {
      toast({ title: "Verified evidence is required", description: "Upload the M-Pesa reversal proof before confirming.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc("charter_wallet_reverse_funding", {
        _request_id: selected.id, _kind: kind, _reason: reason.trim(),
        _evidence: {
          source: "finance_console",
          reference: selected.reference,
          evidence_path: uploaded.path,
          evidence_name: uploaded.name,
          external_reference: evidenceRef.trim() || null,
          verified_at: new Date().toISOString(),
        },
      } as never);
      if (error) throw new Error(error.message);
      const res = data as { balance_kes?: number } | null;
      await recordReconAction({
        action: "reversal_confirm", permission: "recon.reverse", targetType: "funding_request",
        targetId: selected.id, resolutionNotes: reason.trim(),
        detail: {
          kind, reference: selected.reference, evidence_path: uploaded.path,
          external_reference: evidenceRef.trim() || null, balance_kes: res?.balance_kes,
        },
      });
      toast({
        title: kind === "reversed" ? "Funding reversed" : "Funding refunded",
        description: `Compensating debit posted · balance ${money(res?.balance_kes)}`,
      });
      setTarget(""); setReason(""); setUploaded(null); setEvidenceFile(null); setEvidenceRef("");
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      await recordReconAction({
        action: "reversal_confirm", permission: "recon.reverse", targetType: "funding_request",
        targetId: selected?.id ?? null, outcome: "failed", detail: { kind, error: msg },
      });
      toast({ title: "Action rejected", description: msg, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const exportAlerts = async (fmt: "csv" | "pdf") => {
    if (!can("recon.export")) return denied("recon.export");
    const table = reconciliationAlertsReport(alerts);
    if (table.rows.length === 0) {
      toast({ title: "Nothing to export", description: "No mismatch alerts recorded yet." });
      return;
    }
    if (fmt === "csv") downloadReportCsv(table);
    else await downloadReportPdf(table);
    await recordReconAction({
      action: "export", permission: "recon.export", dataset: "reconciliation.alerts",
      exportFormat: fmt, rowCount: table.rows.length,
    });
  };

  const acknowledgeAlert = async (alert: AlertRow) => {
    if (!can("recon.alerts.manage")) return denied("recon.alerts.manage");
    const notes = (ackNotes[alert.id] ?? "").trim() || null;
    const { error } = await supabase.rpc("charter_wallet_acknowledge_alert", {
      _alert_id: alert.id, _notes: notes,
    } as never);
    if (error) {
      toast({ title: "Could not acknowledge alert", description: error.message, variant: "destructive" });
      return;
    }
    await recordReconAction({
      action: "alert_acknowledge", permission: "recon.alerts.manage", targetType: "alert",
      targetId: alert.id, resolutionNotes: notes, detail: { severity: alert.severity, kind: alert.kind },
    });
    toast({ title: "Alert acknowledged", description: "Notes are included in alert exports." });
    await load();
  };

  const retryAlert = async (alert: AlertRow) => {
    if (!can("recon.alerts.manage")) return denied("recon.alerts.manage");
    const { error } = await supabase.rpc("charter_wallet_retry_alert", { _alert_id: alert.id } as never);
    if (error) {
      toast({ title: "Could not queue retry", description: error.message, variant: "destructive" });
      return;
    }
    await notifyFinance();
    await recordReconAction({
      action: "alert_retry", permission: "recon.alerts.manage", targetType: "alert",
      targetId: alert.id, detail: { attempts: alert.attempts, severity: alert.severity },
    });
    toast({ title: "Retry queued", description: "Delivery retried now; failures back off exponentially." });
    await load();
  };


  return (
    <div className="space-y-6">
      <SeoHead
        path="/dashboard/admin/corporate-wallet-finance"
        title="Corporate Wallet Finance Console | Yalla Mobility"
        description="Reconciliation exports, mismatch alerting, reversals and the immutable finance audit trail for corporate wallet funding."
      />

      <header className="rounded-2xl border border-border bg-gradient-to-br from-primary/10 via-card to-primary-glow/10 p-6">
        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary">Finance controls</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Corporate Wallet Finance Console</h1>
        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
          Wallet balances may only rise through a verified M-Pesa callback. This console reconciles the ledger,
          alerts finance the moment a mismatch appears, and records every reversal in an append-only trail.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {latest && (
            <Badge variant={latest.balanced ? "outline" : "destructive"} className="gap-1">
              {latest.balanced ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : <AlertTriangle className="h-3 w-3" aria-hidden />}
              {latest.balanced ? "Ledger balanced" : `${latest.critical} critical finding(s)`}
            </Badge>
          )}
          {pendingAlerts > 0 && (
            <Badge variant="destructive" className="gap-1">
              <BellRing className="h-3 w-3" aria-hidden /> {pendingAlerts} alert(s) awaiting dispatch
            </Badge>
          )}
          <Button size="sm" onClick={() => void runReconciliation()} disabled={running || permsLoading || !can("recon.rerun")}>
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
            Run reconciliation
          </Button>
          <AppButton analytics="admin_wallet_recon_findings_csv_download" action="submit" size="sm" variant="outline" disabled={permsLoading || !can("recon.export")} onClick={() => void exportFindings("csv")}>
            <Download className="mr-2 h-4 w-4" aria-hidden /> Findings CSV
          </AppButton>
          <AppButton analytics="admin_wallet_recon_findings_pdf_download" action="submit" size="sm" variant="outline" disabled={permsLoading || !can("recon.export")} onClick={() => void exportFindings("pdf")}>
            <FileText className="mr-2 h-4 w-4" aria-hidden /> Findings PDF
          </AppButton>
          {can("ops.cron.monitor") && (
            <Button asChild size="sm" variant="outline">
              <Link to="/dashboard/admin/scheduled-job-health">Scheduled job health</Link>
            </Button>
          )}
        </div>
      </header>

      {!permsLoading && !can("recon.export") && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base">Limited finance access</CardTitle>
            <CardDescription>
              Your role is not in the reconciliation permission matrix, so exports, reruns, resolutions and
              reversals are disabled. Ask a super admin to grant the permissions you need.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      <Tabs defaultValue="reconciliation">
        <TabsList className="flex-wrap">
          <TabsTrigger value="reconciliation">Reconciliation</TabsTrigger>
          <TabsTrigger value="reruns">Reruns &amp; retries</TabsTrigger>
          <TabsTrigger value="alerts">Alerts</TabsTrigger>
          <TabsTrigger value="limits">Funding limits</TabsTrigger>
          <TabsTrigger value="reversals">Reversals &amp; refunds</TabsTrigger>
          <TabsTrigger value="audit">Audit trail</TabsTrigger>
        </TabsList>

        <TabsContent value="reconciliation" className="mt-6 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base">Discrepancy findings</CardTitle>
                <CardDescription>
                  Balance ↔ ledger drift, paid fundings without a ledger entry or receipt, and stale pending fundings.
                  Exports and bulk actions always apply to the filtered set below.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!can("recon.export")} onClick={() => void exportFindings("csv")}>CSV</Button>
                <Button size="sm" variant="outline" disabled={!can("recon.export")} onClick={() => void exportFindings("pdf")}>PDF</Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-2 lg:grid-cols-4">
                <div className="space-y-1">
                  <Label htmlFor="f-scope" className="text-xs">Scope</Label>
                  <Select value={scope} onValueChange={(v) => setScope(v as "latest" | "all")}>
                    <SelectTrigger id="f-scope"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="latest">Latest run</SelectItem>
                      <SelectItem value="all">All runs</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-from" className="text-xs">Detected from</Label>
                  <Input id="f-from" type="date" value={filters.from ?? ""}
                    onChange={(e) => setFilters((p) => ({ ...p, from: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-to" className="text-xs">Detected to</Label>
                  <Input id="f-to" type="date" value={filters.to ?? ""}
                    onChange={(e) => setFilters((p) => ({ ...p, to: e.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-status" className="text-xs">Resolution status</Label>
                  <Select value={filters.status ?? "all"} onValueChange={(v) => setFilters((p) => ({ ...p, status: v }))}>
                    <SelectTrigger id="f-status"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {FINDING_STATUSES.map((s) => (
                        <SelectItem key={s} value={s}>{s.replace("_", " ")}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-kind" className="text-xs">Mismatch type</Label>
                  <Select value={filters.kind ?? "all"} onValueChange={(v) => setFilters((p) => ({ ...p, kind: v }))}>
                    <SelectTrigger id="f-kind"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All types</SelectItem>
                      {kinds.map((k) => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-sev" className="text-xs">Severity</Label>
                  <Select value={filters.severity ?? "all"} onValueChange={(v) => setFilters((p) => ({ ...p, severity: v }))}>
                    <SelectTrigger id="f-sev"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All severities</SelectItem>
                      <SelectItem value="critical">critical</SelectItem>
                      <SelectItem value="warning">warning</SelectItem>
                      <SelectItem value="info">info</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-wallet" className="text-xs">Wallet</Label>
                  <Select value={filters.wallet ?? "all"} onValueChange={(v) => setFilters((p) => ({ ...p, wallet: v === "all" ? undefined : v }))}>
                    <SelectTrigger id="f-wallet"><SelectValue placeholder="All wallets" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All wallets</SelectItem>
                      {wallets.map((w) => <SelectItem key={w} value={w}>{w.slice(0, 8)}…</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="f-search" className="text-xs">Search detail</Label>
                  <Input id="f-search" placeholder="reference, note…" value={filters.search ?? ""}
                    onChange={(e) => setFilters((p) => ({ ...p, search: e.target.value }))} />
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                <span>{visibleFindings.length} of {findings.length} finding(s) shown</span>
                <span>· absolute drift {money(drift)}</span>
                <Button size="sm" variant="ghost"
                  onClick={() => { setFilters({ status: "all", kind: "all", severity: "all" }); setPicked({}); }}>
                  Clear filters
                </Button>
              </div>

              {pickedIds.length > 0 && (
                <div className="space-y-3 rounded-lg border border-primary/40 bg-primary/5 p-3">
                  <p className="text-sm font-medium">{pickedIds.length} finding(s) selected for bulk action</p>
                  <Textarea rows={2} placeholder="Resolution notes recorded against every selected finding (required for audit clarity)"
                    value={bulkNotes} onChange={(e) => setBulkNotes(e.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={bulkBusy || !can("recon.resolve")}
                      onClick={() => void bulkResolve("acknowledged")}>
                      {bulkBusy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                      Acknowledge selected
                    </Button>
                    <Button size="sm" disabled={bulkBusy || !can("recon.resolve")}
                      onClick={() => void bulkResolve("resolved")}>Resolve selected</Button>
                    <Button size="sm" variant="ghost" disabled={bulkBusy || !can("recon.resolve")}
                      onClick={() => void bulkResolve("false_positive")}>Mark false positive</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPicked({})}>Clear selection</Button>
                  </div>
                </div>
              )}

              {loading ? <Skeleton className="h-24 w-full" /> : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox aria-label="Select all actionable findings"
                          checked={pickedIds.length > 0 && pickedIds.length === bulkActionable(visibleFindings as ReconFindingLike[]).length}
                          onCheckedChange={(v) => toggleAll(v === true)} />
                      </TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Detail</TableHead>
                      <TableHead className="text-right">Expected</TableHead>
                      <TableHead className="text-right">Actual</TableHead>
                      <TableHead>Resolution</TableHead>
                      <TableHead className="text-right">Evidence</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {visibleFindings.length === 0 && (
                      <TableRow><TableCell colSpan={8} className="text-muted-foreground">No findings match these filters.</TableCell></TableRow>
                    )}
                    {visibleFindings.map((f) => (
                      <TableRow key={f.id}>
                        <TableCell>
                          <Checkbox aria-label={`Select finding ${f.kind}`}
                            disabled={!["open", "acknowledged"].includes(resolutionStatus(f as ReconFindingLike))}
                            checked={!!picked[f.id]}
                            onCheckedChange={(v) => setPicked((p) => ({ ...p, [f.id]: v === true }))} />
                        </TableCell>
                        <TableCell>
                          <Badge variant={f.severity === "critical" ? "destructive" : "secondary"}>{f.severity}</Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs">{f.kind}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{f.detail}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.expected_kes == null ? "—" : money(f.expected_kes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{f.actual_kes == null ? "—" : money(f.actual_kes)}</TableCell>
                        <TableCell>
                          <Badge variant={(f.resolution_status ?? "open") === "open" ? "destructive" : "outline"}>
                            {f.resolution_status ?? "open"}
                          </Badge>
                          {f.resolution_notes ? (
                            <span className="block text-xs text-muted-foreground">{f.resolution_notes}</span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button size="sm" variant="outline" onClick={() => setDrilldown(f)}>Drill down</Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>


          <Card>
            <CardHeader><CardTitle className="text-base">Run history</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Run</TableHead>
                    <TableHead>Trigger</TableHead>
                    <TableHead className="text-right">Wallets</TableHead>
                    <TableHead className="text-right">Fundings</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-muted-foreground">No reconciliation has run yet.</TableCell></TableRow>
                  )}
                  {runs.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="text-xs">{when(r.created_at)}</TableCell>
                      <TableCell className="text-xs">{r.triggered_by}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.wallets_scanned}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.requests_scanned}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.findings}</TableCell>
                      <TableCell>
                        <Badge variant={r.balanced ? "outline" : "destructive"}>{r.balanced ? "Balanced" : `${r.critical} critical`}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reruns" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Rerun reconciliation for a date range</CardTitle>
              <CardDescription>
                Runs the full invariant set over the selected window, or queues it as a retry for later execution.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-from">From</Label>
                  <Input id="cwf-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-to">To</Label>
                  <Input id="cwf-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-note">Note (audited)</Label>
                  <Input id="cwf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Month-end close" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" disabled={previewing || !can("recon.rerun")} onClick={() => void runDryRun()}>
                  {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <FlaskConical className="mr-2 h-4 w-4" aria-hidden />}
                  Dry run preview
                </Button>
                <Button disabled={running} onClick={() => void rerunRange(null)}>
                  {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="mr-2 h-4 w-4" aria-hidden />}
                  Rerun now
                </Button>
                <Button variant="outline" onClick={() => void queueRetry(null)}>Queue for later</Button>
                <AppButton analytics="admin_wallet_recon_attempts_csv_download" action="submit" variant="outline" onClick={() => void exportAttempts("csv")}>
                  <Download className="mr-2 h-4 w-4" aria-hidden /> Attempt audit CSV
                </AppButton>
                <AppButton analytics="admin_wallet_recon_attempts_pdf_download" action="submit" variant="outline" aria-label="Download attempt audit as PDF" onClick={() => void exportAttempts("pdf")}>PDF</AppButton>
              </div>
              <p className="text-xs text-muted-foreground">
                A dry run scans the same invariants but writes nothing — use it to preview the discrepancies and
                ledger vs settlement diffs a real rerun would record.
              </p>
            </CardContent>
          </Card>

          {preview && (
            <Card className="border-primary/40">
              <CardHeader className="flex flex-row items-start justify-between gap-4">
                <div>
                  <CardTitle className="text-base flex items-center gap-2">
                    <FlaskConical className="h-4 w-4" aria-hidden /> Dry run preview — nothing was written
                  </CardTitle>
                  <CardDescription>
                    {preview.window_start?.slice(0, 10)} → {preview.window_end?.slice(0, 10)} ·
                    {" "}{preview.wallets_scanned} wallet(s), {preview.requests_scanned} funding(s) scanned ·
                    {" "}{preview.findings} would-be finding(s), {preview.critical} critical
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={!can("recon.export")} onClick={() => void exportPreview("csv")}>CSV</Button>
                  <Button size="sm" variant="outline" disabled={!can("recon.export")} onClick={() => void exportPreview("pdf")}>PDF</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>Dismiss</Button>
                </div>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Severity</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Detail</TableHead>
                      <TableHead className="text-right">Ledger (expected)</TableHead>
                      <TableHead className="text-right">Wallet (actual)</TableHead>
                      <TableHead className="text-right">Variance</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(preview.items ?? []).length === 0 && (
                      <TableRow><TableCell colSpan={6} className="text-muted-foreground">A real rerun would record no discrepancies.</TableCell></TableRow>
                    )}
                    {(preview.items ?? []).map((i, idx) => (
                      <TableRow key={`${i.kind}-${idx}`}>
                        <TableCell><Badge variant={i.severity === "critical" ? "destructive" : "secondary"}>{i.severity}</Badge></TableCell>
                        <TableCell className="font-mono text-xs">{i.kind}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">{i.detail}</TableCell>
                        <TableCell className="text-right tabular-nums">{i.expected_kes == null ? "—" : money(i.expected_kes)}</TableCell>
                        <TableCell className="text-right tabular-nums">{i.actual_kes == null ? "—" : money(i.actual_kes)}</TableCell>
                        <TableCell className="text-right tabular-nums">
                          {i.expected_kes == null || i.actual_kes == null ? "—" : money(Number(i.actual_kes) - Number(i.expected_kes))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}


          <Card>
            <CardHeader>
              <CardTitle className="text-base">Attempt status &amp; audit</CardTitle>
              <CardDescription>Every rerun and retry, with the range requested and the run it produced.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requested</TableHead>
                    <TableHead>Range</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Attempt</TableHead>
                    <TableHead className="text-right">Findings</TableHead>
                    <TableHead>Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attempts.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-muted-foreground">No reruns requested yet.</TableCell></TableRow>
                  )}
                  {attempts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{when(a.created_at)}</TableCell>
                      <TableCell className="text-xs">
                        {a.requested_from.slice(0, 10)} → {a.requested_to.slice(0, 10)}
                        {a.note ? <span className="block text-muted-foreground">{a.note}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.status === "failed" ? "destructive" : a.status === "succeeded" ? "outline" : "secondary"}>
                          {a.status}
                        </Badge>
                        {a.error ? <span className="block text-xs text-destructive">{a.error}</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">#{a.attempt}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {a.findings}{a.critical ? ` (${a.critical} critical)` : ""}
                      </TableCell>
                      <TableCell className="space-x-2">
                        {a.status === "queued" && (
                          <Button size="sm" variant="outline" disabled={running} onClick={() => void runQueued(a)}>Run</Button>
                        )}
                        <Button size="sm" variant="ghost"
                          onClick={() => void queueRetry(a.id, a.requested_from, a.requested_to)}>
                          Queue retry
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="alerts" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <BellRing className="h-4 w-4 text-primary" aria-hidden /> Instant mismatch alerts
              </CardTitle>
              <CardDescription>
                Every balance, ledger or settlement mismatch is queued the instant it is detected and delivered
                to finance by email and webhook.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <Switch
                  id="cwf-alerts-enabled"
                  checked={settings?.enabled ?? false}
                  onCheckedChange={(v) => void saveSettings({ enabled: v })}
                  disabled={!settings || savingSettings || !can("recon.alerts.manage")}
                />
                <Label htmlFor="cwf-alerts-enabled">Alerting enabled</Label>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-recipients">Finance email recipients (comma separated)</Label>
                  <Input id="cwf-recipients" value={recipients} onChange={(e) => setRecipients(e.target.value)}
                    placeholder="finance@yalla.africa, controller@yalla.africa" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-webhook">Webhook URL (signed with HMAC-SHA256)</Label>
                  <Input id="cwf-webhook" value={webhook} onChange={(e) => setWebhook(e.target.value)}
                    placeholder="https://ops.example.com/hooks/wallet-alerts" />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={savingSettings || !can("recon.alerts.manage")} onClick={() => void saveSettings({})}>
                  {savingSettings ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
                  Save alert settings
                </Button>
                <Button variant="outline" disabled={!can("recon.alerts.manage")}
                  onClick={async () => { await notifyFinance(); await load(); toast({ title: "Dispatch triggered" }); }}>
                  Dispatch pending alerts now
                </Button>
                <AppButton analytics="admin_wallet_recon_alerts_csv_download" action="submit" variant="outline" disabled={!can("recon.export")} onClick={() => void exportAlerts("csv")}>
                  <Download className="mr-2 h-4 w-4" aria-hidden /> Alerts CSV
                </AppButton>
                <AppButton analytics="admin_wallet_recon_alerts_pdf_download" action="submit" variant="outline" disabled={!can("recon.export")} onClick={() => void exportAlerts("pdf")}>
                  <FileText className="mr-2 h-4 w-4" aria-hidden /> Alerts PDF
                </AppButton>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Alert delivery log</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Detected</TableHead>
                    <TableHead>Severity</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Delivery</TableHead>
                    <TableHead>Attempts &amp; backoff</TableHead>
                    <TableHead>Acknowledgement</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {alerts.length === 0 && (
                    <TableRow><TableCell colSpan={6} className="text-muted-foreground">No mismatch alerts raised.</TableCell></TableRow>
                  )}
                  {alerts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{when(a.created_at)}</TableCell>
                      <TableCell><Badge variant={a.severity === "critical" ? "destructive" : "secondary"}>{a.severity}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{a.kind}</TableCell>
                      <TableCell className="text-xs">
                        <Badge variant={a.status === "notified" ? "outline" : a.status === "failed" ? "destructive" : "secondary"}>{a.status}</Badge>
                        <span className="block text-muted-foreground">
                          {(a.email_sent_to ?? []).length} email(s)
                          {a.webhook_status != null ? ` · webhook ${a.webhook_status}` : ""}
                        </span>
                        {a.last_error ? <span className="block text-destructive">{a.last_error}</span> : null}
                      </TableCell>
                      <TableCell className="text-xs">
                        <span className="tabular-nums">{a.attempts}/{a.max_attempts ?? 5} attempt(s)</span>
                        {a.next_attempt_at ? (
                          <span className="block text-muted-foreground">next retry {when(a.next_attempt_at)}</span>
                        ) : null}
                        <ul className="mt-1 space-y-0.5 text-muted-foreground">
                          {deliveries.filter((d) => d.alert_id === a.id).slice(0, 4).map((d) => (
                            <li key={d.id} className={d.ok ? undefined : "text-destructive"}>
                              #{d.attempt} {d.channel} {d.ok ? "ok" : `failed${d.status_code ? ` (${d.status_code})` : ""}`}
                              {d.error ? ` · ${d.error.slice(0, 80)}` : ""}
                            </li>
                          ))}
                        </ul>
                      </TableCell>
                      <TableCell className="text-xs">
                        {a.acknowledged_at ? (
                          <>
                            <Badge variant="outline">acknowledged</Badge>
                            <span className="block text-muted-foreground">{when(a.acknowledged_at)}</span>
                            {a.acknowledgement_notes ? <span className="block">{a.acknowledgement_notes}</span> : null}
                          </>
                        ) : (
                          <div className="space-y-2">
                            <Textarea
                              aria-label={`Acknowledgement notes for alert ${a.id}`}
                              rows={2}
                              value={ackNotes[a.id] ?? ""}
                              onChange={(e) => setAckNotes((prev) => ({ ...prev, [a.id]: e.target.value }))}
                              placeholder="Resolution notes"
                            />
                            <div className="flex gap-2">
                              <Button size="sm" variant="outline" disabled={!can("recon.alerts.manage")}
                                onClick={() => void acknowledgeAlert(a)}>Acknowledge</Button>
                              {(a.status === "failed" || a.status === "exhausted") && (
                                <Button size="sm" variant="outline" disabled={!can("recon.alerts.manage")}
                                  onClick={() => void retryAlert(a)}>Retry now</Button>
                              )}
                            </div>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Scoped funding limits</CardTitle>
              <CardDescription>The most specific scope wins: user → department → wallet → global.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scope</TableHead>
                    <TableHead className="text-right">Per transaction</TableHead>
                    <TableHead className="text-right">Daily</TableHead>
                    <TableHead className="text-right">Monthly</TableHead>
                    <TableHead className="text-right">Approval above</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {limits.map((l) => (
                    <TableRow key={l.id}>
                      <TableCell className="text-xs">
                        {l.label ?? (l.actor_id ? "User scope" : l.department ? `Department · ${l.department}` : l.wallet_id ? "Wallet scope" : "Global default")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.per_txn_max_kes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.daily_max_kes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.monthly_max_kes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(l.approval_threshold_kes)}</TableCell>
                    </TableRow>
                  ))}
                  {limits.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">No limits configured.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reversals" className="mt-6 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Evidence-backed reversal workflow
              </CardTitle>
              <CardDescription>
                Step 1 select the paid funding · Step 2 upload verified reversal evidence · Step 3 confirm the
                atomic compensating ledger entry. History is never rewritten.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-target">1 · Funding reference</Label>
                  <Input id="cwf-target" value={target} onChange={(e) => { setTarget(e.target.value); setUploaded(null); }} placeholder="CWF-…" />
                  {selected ? (
                    <p className="text-xs text-muted-foreground">
                      Matched {selected.reference} · {money(selected.amount_kes)} · receipt {selected.mpesa_receipt ?? "—"}
                    </p>
                  ) : target ? (
                    <p className="text-xs text-destructive">No paid funding request matches that reference.</p>
                  ) : null}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-reason">Reason (audited)</Label>
                  <Textarea id="cwf-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2}
                    placeholder="Customer disputed the top-up; M-Pesa reversal confirmed by receipt." />
                </div>
              </div>

              <div className="grid gap-4 rounded-xl border border-dashed border-border p-4 sm:grid-cols-3">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="cwf-evidence">2 · Verified reversal evidence</Label>
                  <Input id="cwf-evidence" type="file" accept="application/pdf,image/*"
                    onChange={(e) => { setEvidenceFile(e.target.files?.[0] ?? null); setUploaded(null); }} />
                  <p className="text-xs text-muted-foreground">
                    Stored privately; only finance roles can retrieve it. The storage path is recorded on the
                    compensating ledger entry.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cwf-evref">External reference</Label>
                  <Input id="cwf-evref" value={evidenceRef} onChange={(e) => setEvidenceRef(e.target.value)} placeholder="M-Pesa reversal ID" />
                </div>
                <div className="sm:col-span-3 flex flex-wrap items-center gap-3">
                  <Button variant="outline" disabled={uploading || !evidenceFile || !selected} onClick={() => void uploadEvidence()}>
                    {uploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Paperclip className="mr-2 h-4 w-4" aria-hidden />}
                    Upload evidence
                  </Button>
                  {uploaded && (
                    <Badge variant="outline" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" aria-hidden /> {uploaded.name} verified
                    </Badge>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>3 · Confirm the compensating entry</Label>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" disabled={busy || !uploaded} onClick={() => void reverse("reversed")}>
                    {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Undo2 className="mr-2 h-4 w-4" aria-hidden />}
                    Confirm reversal
                  </Button>
                  <Button disabled={busy || !uploaded} onClick={() => void reverse("refunded")}>Confirm refund</Button>
                </div>
                {!uploaded && (
                  <p className="text-xs text-muted-foreground">Upload verified evidence to unlock confirmation.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Paid fundings eligible for reversal</CardTitle></CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Reference</TableHead>
                    <TableHead>Cost centre</TableHead>
                    <TableHead>Receipt</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paid.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">No paid fundings.</TableCell></TableRow>
                  )}
                  {paid.map((p) => (
                    <TableRow key={p.id} className="cursor-pointer" onClick={() => { setTarget(p.reference); setUploaded(null); }}>
                      <TableCell className="font-mono text-xs">{p.reference}</TableCell>
                      <TableCell className="text-xs">{p.cost_center}</TableCell>
                      <TableCell className="font-mono text-xs">{p.mpesa_receipt ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(p.amount_kes)}</TableCell>
                      <TableCell><Badge variant="outline">{FUNDING_STATUS_LABEL[p.status]}</Badge></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="audit" className="mt-6 space-y-6">
          <Card>
            <CardHeader className="flex flex-row items-start justify-between gap-4">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" aria-hidden /> Reconciliation action audit
                </CardTitle>
                <CardDescription>
                  Immutable record of every export, rerun (including dry runs), reversal confirmation and
                  acknowledge/resolve action — who, what, when, the filters used and the resolution notes.
                </CardDescription>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={!can("recon.export")} onClick={() => void exportAudit("csv")}>CSV</Button>
                <Button size="sm" variant="outline" disabled={!can("recon.export")} onClick={() => void exportAudit("pdf")}>PDF</Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Actor</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead>Outcome</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead className="text-right">Rows</TableHead>
                    <TableHead>Filters / notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {auditTrail.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-muted-foreground">No reconciliation actions recorded yet.</TableCell></TableRow>
                  )}
                  {auditTrail.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{when(a.created_at)}</TableCell>
                      <TableCell className="text-xs">{a.actor_email ?? a.actor_id?.slice(0, 8) ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={a.action === "reversal_confirm" ? "destructive" : "secondary"}>{a.action}</Badge>
                        {a.export_format ? <span className="ml-1 text-xs uppercase text-muted-foreground">{a.export_format}</span> : null}
                      </TableCell>
                      <TableCell>
                        <Badge variant={a.outcome === "success" ? "outline" : "destructive"}>{a.outcome}</Badge>
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {a.dataset ?? a.target_type ?? "—"}
                        {a.target_id ? <span className="block text-muted-foreground">{a.target_id.slice(0, 8)}…</span> : null}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{a.row_count ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {a.resolution_notes ? <span className="block">{a.resolution_notes}</span> : null}
                        {a.filters && Object.keys(a.filters).length > 0 ? (
                          <span className="block font-mono">{JSON.stringify(a.filters)}</span>
                        ) : null}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Wallet finance actions</CardTitle>
              <CardDescription>Append-only ledger-affecting actions: entries cannot be edited or deleted.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>When</TableHead>
                    <TableHead>Action</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Reason</TableHead>
                    <TableHead>Ledger entry</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {actions.length === 0 && (
                    <TableRow><TableCell colSpan={5} className="text-muted-foreground">No finance actions recorded.</TableCell></TableRow>
                  )}
                  {actions.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-xs">{when(a.created_at)}</TableCell>
                      <TableCell><Badge variant="secondary">{a.action}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{money(a.amount_kes)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">{a.reason}</TableCell>
                      <TableCell className="font-mono text-xs">{a.ledger_entry_id?.slice(0, 8) ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

      </Tabs>

      <FindingDrilldown
        finding={drilldown}
        run={drilldown ? (runs.find((r) => r.id === drilldown.run_id) ?? null) : null}
        canResolve={can("recon.resolve")}
        onClose={() => setDrilldown(null)}
        onResolved={load}
      />
    </div>
  );
}
