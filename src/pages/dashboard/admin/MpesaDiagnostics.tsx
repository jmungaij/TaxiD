import type { LooseRow } from "@/lib/types/loose";
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import {
  AlertTriangle, CheckCircle2, RefreshCw, Zap, ServerCrash,
  FileDown, FileText, Search, X, Clock, Download, PlayCircle,
} from "lucide-react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  DEFAULT_MPESA_TEST_MSISDN,
  isValidKenyanMsisdn,
  normalizeKenyanMsisdn,
} from "@/lib/kenyaPhone";

type DiagResponse = {
  request_id: string;
  correlation_id: string;
  config: {
    environment: string;
    base_url: string;
    shortcode: string;
    consumer_key_present: boolean;
    consumer_key_preview: string | null;
    consumer_secret_present: boolean;
    consumer_secret_preview: string | null;
    passkey_present: boolean;
    passkey_preview: string | null;
    callback_url: string;
  };
  warnings: string[];
  oauth?: { ok: boolean; latency_ms: number; error?: string; token_preview?: string };
  stk_dryrun?: { ok: boolean; http_status?: number; latency_ms: number; error?: string; response?: LooseRow };
  remedy?: string;
};

type AttemptRow = {
  id: string;
  created_at: string;
  environment: string;
  shortcode: string | null;
  phone_masked: string | null;
  amount_cents: number | null;
  attempt_number: number;
  outcome: string;
  http_status: number | null;
  error_code: string | null;
  error_message: string | null;
  latency_ms: number | null;
  will_retry: boolean;
  request_id: string | null;
  correlation_id: string | null;
  idempotency_key: string | null;
  merchant_request_id: string | null;
  checkout_request_id: string | null;
  daraja_response: LooseRow;
  final_result_code: number | null;
  final_result_desc: string | null;
  final_receipt: string | null;
  reconciled_at: string | null;
  reconciliation_mismatch: boolean;
  reconciliation_notes: string | null;
};

const CSV_COLS: { key: keyof AttemptRow; label: string }[] = [
  { key: "created_at", label: "Timestamp" },
  { key: "environment", label: "Environment" },
  { key: "shortcode", label: "Shortcode" },
  { key: "phone_masked", label: "Phone (masked)" },
  { key: "amount_cents", label: "Amount (cents)" },
  { key: "attempt_number", label: "Attempt #" },
  { key: "outcome", label: "Outcome" },
  { key: "http_status", label: "HTTP" },
  { key: "error_code", label: "Error code" },
  { key: "error_message", label: "Error message" },
  { key: "latency_ms", label: "Latency ms" },
  { key: "will_retry", label: "Will retry" },
  { key: "idempotency_key", label: "Idempotency key" },
  { key: "merchant_request_id", label: "Merchant request ID" },
  { key: "checkout_request_id", label: "Checkout request ID" },
  { key: "correlation_id", label: "Correlation ID" },
  { key: "final_result_code", label: "Final result code" },
  { key: "final_result_desc", label: "Final result desc" },
  { key: "final_receipt", label: "M-Pesa receipt" },
  { key: "reconciled_at", label: "Reconciled at" },
  { key: "reconciliation_mismatch", label: "Reconciliation mismatch" },
  { key: "reconciliation_notes", label: "Reconciliation notes" },
];

function csvEscape(v: LooseRow): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}

export default function MpesaDiagnostics() {
  const { toast } = useToast();
  const [diag, setDiag] = useState<DiagResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [testPhone, setTestPhone] = useState(DEFAULT_MPESA_TEST_MSISDN);
  const phoneValid = isValidKenyanMsisdn(testPhone);
  const [attempts, setAttempts] = useState<AttemptRow[]>([]);
  const [selected, setSelected] = useState<AttemptRow | null>(null);
  const [loading, setLoading] = useState(false);

  // Filters
  const [outcomeFilter, setOutcomeFilter] = useState<string>("all");
  const [envFilter, setEnvFilter] = useState<string>("all");
  const [shortcodeFilter, setShortcodeFilter] = useState<string>("");
  const [phoneFilter, setPhoneFilter] = useState<string>("");
  const [fromDate, setFromDate] = useState<string>("");
  const [toDate, setToDate] = useState<string>("");
  const [search, setSearch] = useState<string>("");

  // Background export jobs
  type ExportJob = {
    id: string; format: string; status: string; row_count: number | null;
    download_url: string | null; error_message: string | null;
    created_at: string; completed_at: string | null; expires_at: string | null;
    filters: Record<string, string | null>;
  };
  const [jobs, setJobs] = useState<ExportJob[]>([]);
  const [queueing, setQueueing] = useState(false);

  // Reconciliation runs (scheduled sweeps)
  type ReconRun = {
    id: string; started_at: string; completed_at: string | null;
    window_minutes: number; checked_count: number; reconciled_count: number;
    mismatch_count: number; still_pending_count: number; error_count: number;
  };
  const [runs, setRuns] = useState<ReconRun[]>([]);
  const [runningRecon, setRunningRecon] = useState(false);

  const runDiag = async (mode: "config" | "oauth" | "stk_dryrun") => {
    if (mode === "stk_dryrun" && !phoneValid) {
      toast({
        title: "Invalid MSISDN",
        description: "Enter a valid Kenyan number, e.g. 0712345678.",
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const normalized = normalizeKenyanMsisdn(testPhone) ?? testPhone;
      const { data, error } = await supabase.functions.invoke("mpesa-diagnostics", {
        body: { mode, test_phone: normalized, test_amount: 1 },
      });
      if (error) throw error;
      setDiag(data as DiagResponse);
      toast({ title: `Diagnostic (${mode}) complete` });
    } catch (e: LooseRow) {
      toast({ title: "Diagnostic failed", description: e.message, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const loadAttempts = useCallback(async () => {
    setLoading(true);
    try {
      let q = supabase
        .from("mpesa_stk_attempts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      if (outcomeFilter !== "all") q = q.eq("outcome", outcomeFilter);
      if (envFilter !== "all") q = q.eq("environment", envFilter);
      if (shortcodeFilter.trim()) q = q.eq("shortcode", shortcodeFilter.trim());
      if (phoneFilter.trim()) q = q.ilike("phone_masked", `%${phoneFilter.trim()}%`);
      if (fromDate) q = q.gte("created_at", new Date(fromDate).toISOString());
      if (toDate) {
        const end = new Date(toDate); end.setHours(23, 59, 59, 999);
        q = q.lte("created_at", end.toISOString());
      }
      const { data, error } = await q;
      if (error) throw error;
      setAttempts((data as LooseRow) || []);
    } catch (e: LooseRow) {
      toast({ title: "Failed to load attempts", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [outcomeFilter, envFilter, shortcodeFilter, phoneFilter, fromDate, toDate, toast]);

  const loadJobs = useCallback(async () => {
    const { data } = await supabase
      .from("mpesa_export_jobs")
      .select("id, format, status, row_count, download_url, error_message, created_at, completed_at, expires_at, filters")
      .order("created_at", { ascending: false })
      .limit(20);
    setJobs((data as LooseRow) || []);
  }, []);

  const loadRuns = useCallback(async () => {
    const { data } = await supabase
      .from("mpesa_reconciliation_runs")
      .select("id, started_at, completed_at, window_minutes, checked_count, reconciled_count, mismatch_count, still_pending_count, error_count")
      .order("started_at", { ascending: false })
      .limit(10);
    setRuns((data as LooseRow) || []);
  }, []);

  useEffect(() => { runDiag("config"); loadJobs(); loadRuns();   }, []);
  useEffect(() => { loadAttempts(); }, [loadAttempts]);

  // Poll background jobs while any are queued/processing.
  useEffect(() => {
    const active = jobs.some((j) => j.status === "queued" || j.status === "processing");
    if (!active) return;
    const t = setInterval(loadJobs, 5000);
    return () => clearInterval(t);
  }, [jobs, loadJobs]);

  const filtered = useMemo(() => {
    if (!search.trim()) return attempts;
    const s = search.toLowerCase();
    return attempts.filter((a) =>
      [a.idempotency_key, a.correlation_id, a.request_id, a.checkout_request_id,
       a.merchant_request_id, a.error_message, a.error_code, a.final_receipt]
        .some((v) => v && String(v).toLowerCase().includes(s))
    );
  }, [attempts, search]);

  const clearFilters = () => {
    setOutcomeFilter("all"); setEnvFilter("all"); setShortcodeFilter("");
    setPhoneFilter(""); setFromDate(""); setToDate(""); setSearch("");
  };

  const exportCSV = () => {
    const header = CSV_COLS.map((c) => csvEscape(c.label)).join(",");
    const rows = filtered.map((r) =>
      CSV_COLS.map((c) => csvEscape(r[c.key] as LooseRow)).join(",")
    );
    const blob = new Blob(["\uFEFF" + [header, ...rows].join("\n")], {
      type: "text/csv;charset=utf-8;",
    });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    download(blob, `mpesa-stk-attempts-${ts}.csv`);
    toast({ title: `Exported ${filtered.length} rows to CSV` });
  };

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
    const now = new Date();
    doc.setFontSize(14);
    doc.text("M-Pesa STK Push Attempts — Compliance Export", 40, 40);
    doc.setFontSize(9);
    doc.text(`Generated: ${now.toISOString()}  ·  Environment filter: ${envFilter}  ·  Outcome filter: ${outcomeFilter}  ·  Rows: ${filtered.length}`, 40, 58);
    if (diag?.config) {
      doc.text(`Shortcode: ${diag.config.shortcode}  ·  Base URL: ${diag.config.base_url}`, 40, 72);
    }
    autoTable(doc, {
      startY: 90,
      styles: { fontSize: 7, cellPadding: 3, overflow: "linebreak" },
      headStyles: { fillColor: [15, 52, 96] },
      head: [[
        "Time", "Env", "Shortcode", "Phone", "KES", "Try",
        "Outcome", "HTTP", "Error", "Final code", "Receipt", "Reconciled",
      ]],
      body: filtered.map((a) => [
        new Date(a.created_at).toLocaleString(),
        a.environment,
        a.shortcode ?? "-",
        a.phone_masked ?? "-",
        a.amount_cents != null ? (a.amount_cents / 100).toFixed(0) : "-",
        `#${a.attempt_number}${a.will_retry ? " ↻" : ""}`,
        a.outcome,
        a.http_status ?? "-",
        [a.error_code, a.error_message].filter(Boolean).join(" ") || "-",
        a.final_result_code ?? "-",
        a.final_receipt ?? "-",
        a.reconciled_at ? new Date(a.reconciled_at).toLocaleString() : "-",
      ]),
      didDrawPage: (data) => {
        const page = doc.getNumberOfPages();
        doc.setFontSize(7);
        doc.text(`Page ${page}`, data.settings.margin.left, doc.internal.pageSize.height - 12);
      },
    });
    const ts = now.toISOString().replace(/[:.]/g, "-");
    doc.save(`mpesa-stk-attempts-${ts}.pdf`);
    toast({ title: `Exported ${filtered.length} rows to PDF` });
  };

  const currentFilters = useMemo(() => {
    const end = toDate ? new Date(toDate) : null; end?.setHours(23, 59, 59, 999);
    return {
      outcome: outcomeFilter === "all" ? null : outcomeFilter,
      environment: envFilter === "all" ? null : envFilter,
      shortcode: shortcodeFilter.trim() || null,
      phone: phoneFilter.trim() || null,
      from: fromDate ? new Date(fromDate).toISOString() : null,
      to: end ? end.toISOString() : null,
    };
  }, [outcomeFilter, envFilter, shortcodeFilter, phoneFilter, fromDate, toDate]);

  const queueBackgroundExport = async (format: "csv" | "pdf") => {
    setQueueing(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error("not signed in");
      const { error } = await supabase.from("mpesa_export_jobs").insert({
        requested_by: auth.user.id,
        format,
        filters: currentFilters,
      });
      if (error) throw error;
      toast({ title: "Export queued", description: "You'll see a download link when it's ready." });
      // Kick the worker immediately so admins don't wait for cron.
      supabase.functions.invoke("mpesa-export-worker", { body: {} }).catch(() => {});
      loadJobs();
    } catch (e: LooseRow) {
      toast({ title: "Queue failed", description: e.message, variant: "destructive" });
    } finally {
      setQueueing(false);
    }
  };

  const runReconcileNow = async () => {
    setRunningRecon(true);
    try {
      const { error } = await supabase.functions.invoke("mpesa-reconcile-recent", {
        body: { window_minutes: 60 },
      });
      if (error) throw error;
      toast({ title: "Reconciliation started" });
      setTimeout(() => { loadRuns(); loadAttempts(); }, 1500);
    } catch (e: LooseRow) {
      toast({ title: "Reconcile failed", description: e.message, variant: "destructive" });
    } finally {
      setRunningRecon(false);
    }
  };


  const oauthOk = diag?.oauth?.ok;
  const stkOk = diag?.stk_dryrun?.ok;

  const envBadge = useMemo(() => {
    const env = diag?.config?.environment;
    if (!env) return null;
    const isProd = env === "production";
    return <Badge variant={isProd ? "default" : "secondary"}>{env.toUpperCase()}</Badge>;
  }, [diag]);

  const environments = useMemo(() => {
    const s = new Set(attempts.map((a) => a.environment).filter(Boolean));
    return Array.from(s);
  }, [attempts]);

  return (
    <div className="p-6 space-y-6 max-w-7xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">M-Pesa Diagnostics</h1>
          <p className="text-sm text-muted-foreground">
            Validate MPESA_ENV and Daraja reachability. Your key, secret and passkey are never modified or exposed.
          </p>
        </div>
        <Button variant="outline" onClick={() => { runDiag("config"); loadAttempts(); }} disabled={busy}>
          <RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} /> Refresh
        </Button>
      </div>

      {/* Config Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <CardTitle>Configuration</CardTitle>
            {envBadge}
          </div>
          <CardDescription>Read-only view — secrets are masked to their last 4 characters.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {diag?.warnings && diag.warnings.length > 0 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Configuration warnings</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-4 space-y-1 mt-2">
                  {diag.warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </AlertDescription>
            </Alert>
          )}
          {diag?.config && (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <Field label="Environment" value={diag.config.environment} />
              <Field label="Base URL" value={diag.config.base_url} />
              <Field label="Shortcode" value={diag.config.shortcode} />
              <Field label="Consumer Key" value={diag.config.consumer_key_preview || "— missing"} ok={diag.config.consumer_key_present} />
              <Field label="Consumer Secret" value={diag.config.consumer_secret_preview || "— missing"} ok={diag.config.consumer_secret_present} />
              <Field label="Passkey" value={diag.config.passkey_preview || "— missing"} ok={diag.config.passkey_present} />
              <Field label="Callback URL" value={diag.config.callback_url} className="col-span-full break-all" />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Reachability */}
      <Card>
        <CardHeader>
          <CardTitle>Reachability tests</CardTitle>
          <CardDescription>Confirms STK Push can reach Safaricom Daraja without changing your secrets.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => runDiag("oauth")} disabled={busy}>
              <Zap className="h-4 w-4 mr-2" /> Test OAuth Token
            </Button>
            <div className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <Label htmlFor="tphone" className="text-xs">Test MSISDN</Label>
                <Input
                  id="tphone"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className={`w-44 ${!phoneValid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                  aria-invalid={!phoneValid}
                  placeholder="0712345678"
                  inputMode="tel"
                />
                <Button
                  variant="secondary"
                  onClick={() => runDiag("stk_dryrun")}
                  disabled={busy || !phoneValid}
                >
                  <ServerCrash className="h-4 w-4 mr-2" /> STK Dry-Run (KES 1)
                </Button>
              </div>
              {!phoneValid && (
                <p className="text-[11px] text-destructive">Enter a valid Kenyan mobile number (e.g. 0712345678).</p>
              )}
            </div>
          </div>

          {diag?.oauth && (
            <Alert variant={oauthOk ? "default" : "destructive"}>
              {oauthOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertTitle>OAuth: {oauthOk ? `OK (${diag.oauth.latency_ms}ms)` : "Failed"}</AlertTitle>
              <AlertDescription>
                {oauthOk
                  ? <>Token preview: <code className="text-xs">{diag.oauth.token_preview}</code></>
                  : <span className="text-xs">{diag.oauth.error}</span>}
                {diag.remedy && <div className="mt-2 text-xs">{diag.remedy}</div>}
              </AlertDescription>
            </Alert>
          )}

          {diag?.stk_dryrun && (
            <Alert variant={stkOk ? "default" : "destructive"}>
              {stkOk ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
              <AlertTitle>STK Dry-Run: {stkOk ? `OK (${diag.stk_dryrun.latency_ms}ms)` : `Failed (${diag.stk_dryrun.http_status ?? "n/a"})`}</AlertTitle>
              <AlertDescription>
                <pre className="text-xs whitespace-pre-wrap bg-muted p-2 rounded mt-2 max-h-64 overflow-auto">
                  {JSON.stringify(diag.stk_dryrun.response ?? diag.stk_dryrun.error, null, 2)}
                </pre>
              </AlertDescription>
            </Alert>
          )}

          {diag && (
            <div className="text-xs text-muted-foreground">
              request_id: <code>{diag.request_id}</code> · correlation_id: <code>{diag.correlation_id}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Persistent STK attempt audit log */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>STK Push Attempts</CardTitle>
              <CardDescription>Every STK request, retry and Daraja callback reconciliation.</CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={exportCSV} disabled={!filtered.length}>
                <FileDown className="h-4 w-4 mr-1" /> CSV
              </Button>
              <Button size="sm" variant="outline" onClick={exportPDF} disabled={!filtered.length}>
                <FileText className="h-4 w-4 mr-1" /> PDF
              </Button>
              <Button size="sm" variant="secondary" onClick={() => queueBackgroundExport("csv")} disabled={queueing}>
                <Clock className="h-4 w-4 mr-1" /> Queue full CSV
              </Button>
              <Button size="sm" variant="outline" onClick={loadAttempts} disabled={loading}>
                <RefreshCw className={`h-3 w-3 mr-1 ${loading ? "animate-spin" : ""}`} /> Reload
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Filters */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 items-end">
            <div>
              <Label className="text-xs">Environment</Label>
              <select
                className="border rounded px-2 py-1 text-xs bg-background w-full h-9"
                value={envFilter}
                onChange={(e) => setEnvFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="production">production</option>
                <option value="sandbox">sandbox</option>
                {environments.filter((e) => !["production", "sandbox"].includes(e))
                  .map((e) => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>
            <div>
              <Label className="text-xs">Outcome</Label>
              <select
                className="border rounded px-2 py-1 text-xs bg-background w-full h-9"
                value={outcomeFilter}
                onChange={(e) => setOutcomeFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="success">Success</option>
                <option value="transient_failure">Transient (retried)</option>
                <option value="failure">Failure</option>
              </select>
            </div>
            <div>
              <Label className="text-xs">Shortcode</Label>
              <Input value={shortcodeFilter} onChange={(e) => setShortcodeFilter(e.target.value)} placeholder="e.g. 4148095" className="h-9" />
            </div>
            <div>
              <Label className="text-xs">Phone</Label>
              <Input value={phoneFilter} onChange={(e) => setPhoneFilter(e.target.value)} placeholder="254***" className="h-9" />
            </div>
            <div>
              <Label className="text-xs">From</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-9" />
            </div>
            <div>
              <Label className="text-xs">To</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-9" />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs">Search</Label>
                <div className="relative">
                  <Search className="h-3 w-3 absolute left-2 top-3 text-muted-foreground" />
                  <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ID / receipt / error" className="h-9 pl-7" />
                </div>
              </div>
              <Button size="sm" variant="ghost" onClick={clearFilters} title="Clear filters" className="self-end h-9">
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>

          <div className="text-xs text-muted-foreground">
            Showing {filtered.length} of {attempts.length} loaded attempts (max 500 per query).
          </div>

          <div className="overflow-auto border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted">
                <tr>
                  <th className="text-left p-2">Time</th>
                  <th className="text-left p-2">Env</th>
                  <th className="text-left p-2">Shortcode</th>
                  <th className="text-left p-2">Phone</th>
                  <th className="text-left p-2">Amount</th>
                  <th className="text-left p-2">Try</th>
                  <th className="text-left p-2">Outcome</th>
                  <th className="text-left p-2">HTTP</th>
                  <th className="text-left p-2">Callback</th>
                  <th className="text-left p-2">Receipt</th>
                  <th className="text-left p-2">Latency</th>
                  <th className="text-left p-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={12} className="p-4 text-center text-muted-foreground">No attempts match filters.</td></tr>
                )}
                {filtered.map((a) => (
                  <tr key={a.id} className="border-t hover:bg-muted/40">
                    <td className="p-2 whitespace-nowrap">{new Date(a.created_at).toLocaleString()}</td>
                    <td className="p-2">{a.environment}</td>
                    <td className="p-2">{a.shortcode ?? "-"}</td>
                    <td className="p-2">{a.phone_masked}</td>
                    <td className="p-2">KES {a.amount_cents != null ? (a.amount_cents / 100).toFixed(0) : "-"}</td>
                    <td className="p-2">#{a.attempt_number}{a.will_retry ? " ↻" : ""}</td>
                    <td className="p-2">
                      <Badge variant={a.outcome === "success" ? "default" : a.outcome === "transient_failure" ? "secondary" : "destructive"}>
                        {a.outcome}
                      </Badge>
                    </td>
                    <td className="p-2">{a.http_status ?? "-"}</td>
                    <td className="p-2">
                      {a.reconciled_at ? (
                        <Badge variant={a.reconciliation_mismatch ? "destructive" : a.final_result_code === 0 ? "default" : "secondary"}>
                          {a.final_result_code === 0 ? "OK" : `code ${a.final_result_code ?? "?"}`}
                        </Badge>
                      ) : <span className="text-muted-foreground">pending</span>}
                    </td>
                    <td className="p-2 font-mono">{a.final_receipt ?? "-"}</td>
                    <td className="p-2">{a.latency_ms ?? "-"}ms</td>
                    <td className="p-2">
                      <Button size="sm" variant="ghost" onClick={() => setSelected(a)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">Attempt detail</CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Close</Button>
          </CardHeader>
          <CardContent>
            <pre className="text-xs whitespace-pre-wrap bg-muted p-3 rounded max-h-96 overflow-auto">
{JSON.stringify(selected, null, 2)}
            </pre>
          </CardContent>
        </Card>
      )}

      {/* Background export jobs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Background exports</CardTitle>
              <CardDescription>Large filtered exports run server-side; downloads stay available for 24h.</CardDescription>
            </div>
            <Button size="sm" variant="outline" onClick={loadJobs}>
              <RefreshCw className="h-3 w-3 mr-1" /> Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {jobs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No export jobs yet. Use "Queue full CSV" above.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr><th className="py-2">Queued</th><th>Status</th><th>Rows</th><th>Format</th><th>Error</th><th></th></tr>
                </thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="border-b last:border-0">
                      <td className="py-2">{new Date(j.created_at).toLocaleString()}</td>
                      <td>
                        <Badge variant={j.status === "done" ? "default" : j.status === "failed" ? "destructive" : "secondary"}>
                          {j.status}
                        </Badge>
                      </td>
                      <td>{j.row_count ?? "—"}</td>
                      <td className="uppercase">{j.format}</td>
                      <td className="text-destructive text-xs max-w-xs truncate">{j.error_message ?? ""}</td>
                      <td className="text-right">
                        {j.download_url && j.status === "done" && (
                          <a data-analytics="mpesadiagnostics.download" href={j.download_url} target="_blank" rel="noreferrer">
                            <Button size="sm" variant="outline" data-analytics="mpesa_diag_download_export">
                              <Download className="h-3 w-3 mr-1" /> Download
                            </Button>
                          </a>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Scheduled reconciliation */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle>Scheduled reconciliation</CardTitle>
              <CardDescription>Runs every 5 minutes. Re-queries Daraja for STK attempts we never received a callback for, and raises alerts on mismatches.</CardDescription>
            </div>
            <Button size="sm" variant="secondary" onClick={runReconcileNow} disabled={runningRecon}>
              <PlayCircle className={`h-4 w-4 mr-1 ${runningRecon ? "animate-pulse" : ""}`} /> Run now
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {runs.length === 0 ? (
            <div className="text-sm text-muted-foreground">No runs recorded yet.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground border-b">
                  <tr>
                    <th className="py-2">Started</th><th>Window</th><th>Checked</th>
                    <th>Reconciled</th><th>Mismatch</th><th>Pending</th><th>Errors</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-b last:border-0">
                      <td className="py-2">{new Date(r.started_at).toLocaleString()}</td>
                      <td>{r.window_minutes}m</td>
                      <td>{r.checked_count}</td>
                      <td>{r.reconciled_count}</td>
                      <td className={r.mismatch_count > 0 ? "text-destructive font-semibold" : ""}>{r.mismatch_count}</td>
                      <td>{r.still_pending_count}</td>
                      <td className={r.error_count > 0 ? "text-destructive" : ""}>{r.error_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, ok, className }: { label: string; value: string; ok?: boolean; className?: string }) {
  return (
    <div className={className}>
      <div className="text-muted-foreground text-xs uppercase tracking-wide">{label}</div>
      <div className="font-mono text-sm flex items-center gap-2">
        {ok === false && <AlertTriangle className="h-3 w-3 text-destructive" />}
        {ok === true && <CheckCircle2 className="h-3 w-3 text-primary" />}
        {value}
      </div>
    </div>
  );
}
