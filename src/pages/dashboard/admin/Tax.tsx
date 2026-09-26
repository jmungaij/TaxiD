import type { LooseRow } from "@/lib/types/loose";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/hooks/use-toast";
import {
  Activity, AlertTriangle, FileText, Building2, RefreshCw, Download, Receipt,
  MoreHorizontal, Ban, Undo2, FileMinus,
} from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { auditedExport } from "@/lib/exportAudit";
import { classifyTaxError, type TaxLoadFailure } from "@/lib/tax/reportErrors";
import { TaxLoadError } from "@/components/tax/TaxLoadError";
import { TaxDiagnosticsPanel } from "@/components/tax/TaxDiagnosticsPanel";
import { useTaxReport } from "@/hooks/useTaxReport";
import { useTaxSchemaCheck } from "@/hooks/useTaxSchemaCheck";
import { TaxSchemaGuard } from "@/components/tax/TaxSchemaGuard";
import { captureSchemaAlert } from "@/lib/tax/schemaAlerts";
import type { TaxSchemaReport } from "@/lib/tax/schemaContract";
import { invoicesReport, vatDailyReport, vatSummaryReport, downloadReportCsv, downloadReportPdf, reportToCsv } from "@/lib/tax/taxExports";

type ActionKind = "void" | "credit_note" | "refund";
type InvoiceRow = {
  id: string; invoice_number: string; status: string; currency?: string;
  total_cents: number; subtotal_cents: number; tax_total_cents: number;
  customer_name?: string | null; customer_kra_pin?: string | null;
  transaction_id?: string | null; kra_reference?: string | null;
  issued_at?: string; attempt_count?: number;
};

const fmtKES = (cents: number | null | undefined, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency }).format(((cents ?? 0) as number) / 100);

const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleString("en-KE") : "—");

const STATUSES = ["PENDING", "SYNCING", "RETRYING", "SYNCED", "FAILED", "VOIDED"] as const;

const statusVariant = (s: string): "default" | "secondary" | "destructive" | "outline" => {
  switch (s) {
    case "SYNCED": return "default";
    case "FAILED": case "VOIDED": return "destructive";
    case "RETRYING": case "SYNCING": return "secondary";
    default: return "outline";
  }
};

function todayISO(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

export default function AdminTax() {
  const { loading, isAnyAdmin } = useAuth();
  if (loading) return <div className="p-6"><Skeleton className="h-8 w-64" /></div>;
  if (!isAnyAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Tax Command Center</h1>
          <p className="text-sm text-muted-foreground">
            eTIMS invoice operations, sync health, VAT reports, and corporate billing.
          </p>
        </div>
      </header>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview"><Activity className="h-4 w-4 mr-2" />Overview</TabsTrigger>
          <TabsTrigger value="invoices"><FileText className="h-4 w-4 mr-2" />Invoices</TabsTrigger>
          <TabsTrigger value="sync"><AlertTriangle className="h-4 w-4 mr-2" />Sync Health</TabsTrigger>
          <TabsTrigger value="vat"><Receipt className="h-4 w-4 mr-2" />VAT Report</TabsTrigger>
          <TabsTrigger value="corporate"><Building2 className="h-4 w-4 mr-2" />Corporate Billing</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4"><OverviewPanel /></TabsContent>
        <TabsContent value="invoices" className="mt-4"><InvoicesPanel /></TabsContent>
        <TabsContent value="sync" className="mt-4"><SyncHealthPanel /></TabsContent>
        <TabsContent value="vat" className="mt-4"><VatReportPanel /></TabsContent>
        <TabsContent value="corporate" className="mt-4"><CorporateBillingPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

/* ---------------- Overview ---------------- */
function OverviewPanel() {
  const { report, checking, blocked, requestId, recheck } = useTaxSchemaCheck("tax_report_overview");
  return (
    <TaxSchemaGuard
      report={report} checking={checking} blocked={blocked}
      requestId={requestId} onRecheck={recheck} context="the tax overview"
    >
      <OverviewReport schema={report} />
    </TaxSchemaGuard>
  );
}

function OverviewReport({ schema }: { schema: TaxSchemaReport | null }) {
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const fetcher = useCallback(
    () => supabase.rpc("tax_report_overview", { _from: from, _to: to }),
    [from, to],
  );
  const ridRef = useRef("");
  const onFailure = useCallback((f: TaxLoadFailure) => {
    void captureSchemaAlert({ requestId: ridRef.current, report: "tax_report_overview", failure: f, missing: schema });
  }, [schema]);
  const { data, busy, failure, retryInSeconds, retryPlan, requestId, reload } =
    useTaxReport<any>({ report: "tax_report_overview", from, to, fetcher, onFailure });
  ridRef.current = requestId;
  const load = reload;

  const inv = data?.invoices ?? {};
  const queue = data?.retry_queue ?? {};
  const hooks = data?.webhooks_24h ?? {};
  const corp = data?.corporate ?? {};

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div>
          <Button onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Refresh</Button>
        </CardContent>
      </Card>

      {failure && (
        <TaxLoadError
          failure={failure} onRetry={load} busy={busy} context="the tax overview"
          retryInSeconds={retryInSeconds} retryReason={retryPlan?.reason} requestId={requestId}
        />
      )}





      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Invoices Issued" value={inv.total ?? 0} sub={`${fmtKES(inv.gross_cents)} gross`} />
        <Kpi title="VAT Collected" value={fmtKES(inv.tax_cents)} sub={`Net ${fmtKES(inv.net_cents)}`} />
        <Kpi title="Synced to KRA" value={inv.synced ?? 0} sub={`${inv.failed ?? 0} failed`} tone={inv.failed ? "warn" : "ok"} />
        <Kpi title="Retry Queue" value={queue.pending ?? 0} sub={`${queue.due_now ?? 0} due now · ${queue.exhausted ?? 0} exhausted`} tone={queue.exhausted ? "warn" : undefined} />
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi title="Pending" value={inv.pending ?? 0} />
        <Kpi title="Syncing" value={inv.syncing ?? 0} />
        <Kpi title="Retrying" value={inv.retrying ?? 0} />
        <Kpi title="Voided" value={inv.voided ?? 0} />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Webhooks (last 24h)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Received</span><span className="font-medium">{hooks.total ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Verified</span><span className="font-medium">{hooks.verified ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Rejected</span><span className="font-medium text-destructive">{hooks.rejected ?? 0}</span></div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Corporate Billing (period)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Invoices</span><span className="font-medium">{corp.invoices ?? 0}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Billed</span><span className="font-medium">{fmtKES(corp.gross_cents)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Outstanding</span><span className="font-medium">{fmtKES(corp.outstanding_cents)}</span></div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Kpi({ title, value, sub, tone }: { title: string; value: LooseRow; sub?: string; tone?: "ok" | "warn" }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="text-xs text-muted-foreground">{title}</div>
        <div className={`text-2xl font-bold mt-1 ${tone === "warn" ? "text-destructive" : ""}`}>{value}</div>
        {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      </CardContent>
    </Card>
  );
}

/* ---------------- Invoices ---------------- */
function InvoicesPanel() {
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const [status, setStatus] = useState<string>("ALL");
  const [action, setAction] = useState<{ kind: ActionKind; row: InvoiceRow } | null>(null);

  const fetcher = useCallback(
    () => supabase.rpc("tax_report_invoices", {
      _from: from, _to: to,
      _status: status === "ALL" ? null : status,
      _limit: 200, _offset: 0,
    }),
    [from, to, status],
  );
  const { data, busy, failure, retryInSeconds, retryPlan, requestId, reload } = useTaxReport<InvoiceRow[]>({
    report: "tax_report_invoices",
    from, to, fetcher,
    onFailure: (f) => toast({ title: f.title, description: f.hint, variant: "destructive" }),
  });
  const rows = data ?? [];
  const load = reload;

  const table = useMemo(() => invoicesReport(rows, { from, to, status }), [rows, from, to, status]);

  const exportCsv = () =>
    auditedExport(
      { dataset: "tax.etims_invoices", exportType: "csv", rowCount: rows.length, filters: { from, to, status } },
      () => { downloadReportCsv(table); return reportToCsv(table); },
    );

  const exportPdf = () =>
    auditedExport(
      { dataset: "tax.etims_invoices", exportType: "pdf", rowCount: rows.length, filters: { from, to, status } },
      async () => { await downloadReportPdf(table); return reportToCsv(table); },
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <div>
            <label className="text-xs text-muted-foreground">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Refresh</Button>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export eTIMS invoices to CSV" onClick={exportCsv} disabled={!rows.length}
            trackingMeta={{ dataset: "tax.etims_invoices", export_type: "csv" }}>
            <Download className="h-4 w-4 mr-2" />Export CSV
          </AppButton>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export eTIMS invoices to PDF" onClick={exportPdf} disabled={!rows.length}
            trackingMeta={{ dataset: "tax.etims_invoices", export_type: "pdf" }}>
            <Download className="h-4 w-4 mr-2" />Export PDF
          </AppButton>
        </CardContent>
      </Card>

      {failure && (
        <>
          <TaxLoadError
            failure={failure} onRetry={load} busy={busy} context="eTIMS invoices"
            retryInSeconds={retryInSeconds} retryReason={retryPlan?.reason} requestId={requestId}
          />
          <TaxDiagnosticsPanel from={from} to={to} />
        </>
      )}




      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice #</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>KRA PIN</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Issued</TableHead>
                <TableHead>KRA Ref</TableHead>
                <TableHead className="text-right">Attempts</TableHead>
                <TableHead className="w-12"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {busy && <TableRow><TableCell colSpan={11}><Skeleton className="h-6 w-full" /></TableCell></TableRow>}
              {!busy && rows.length === 0 && <TableRow><TableCell colSpan={11} className="text-center text-muted-foreground py-8">No invoices in this window.</TableCell></TableRow>}
              {rows.map(r => {
                const canVoid = ["PENDING", "SYNCED", "FAILED"].includes(r.status);
                const canCredit = r.status === "SYNCED";
                const canRefund = r.status === "SYNCED" && !!r.transaction_id;
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                    <TableCell><Badge variant={statusVariant(r.status)}>{r.status}</Badge></TableCell>
                    <TableCell>{r.customer_name ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{r.customer_kra_pin ?? "—"}</TableCell>
                    <TableCell className="text-right">{fmtKES(r.subtotal_cents, r.currency)}</TableCell>
                    <TableCell className="text-right">{fmtKES(r.tax_total_cents, r.currency)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmtKES(r.total_cents, r.currency)}</TableCell>
                    <TableCell className="text-xs">{fmtDate(r.issued_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{r.kra_reference ?? "—"}</TableCell>
                    <TableCell className="text-right">{r.attempt_count ?? 0}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem disabled={!canVoid} onClick={() => setAction({ kind: "void", row: r })}>
                            <Ban className="h-4 w-4 mr-2" />Void invoice
                          </DropdownMenuItem>
                          <DropdownMenuItem disabled={!canCredit} onClick={() => setAction({ kind: "credit_note", row: r })}>
                            <FileMinus className="h-4 w-4 mr-2" />Issue credit note
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={!canRefund} onClick={() => setAction({ kind: "refund", row: r })}>
                            <Undo2 className="h-4 w-4 mr-2" />Refund M-Pesa payment
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <InvoiceActionDialog
        action={action}
        onClose={() => setAction(null)}
        onDone={() => { setAction(null); load(); }}
      />
    </div>
  );
}

/* ---------------- Action Dialog (Void / Credit Note / Refund) ---------------- */
function InvoiceActionDialog({
  action, onClose, onDone,
}: {
  action: { kind: ActionKind; row: InvoiceRow } | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [reason, setReason] = useState("");
  const [amountKes, setAmountKes] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setReason("");
    setAmountKes(action ? (action.row.total_cents / 100).toFixed(2) : "");
  }, [action]);

  if (!action) return null;
  const { kind, row } = action;
  const title = kind === "void" ? "Void invoice"
    : kind === "credit_note" ? "Issue credit note"
    : "Refund M-Pesa payment";
  const supportsPartial = kind !== "void";

  const submit = async () => {
    if (reason.trim().length < 6) {
      toast({ title: "Reason required", description: "Please provide at least 6 characters.", variant: "destructive" });
      return;
    }
    let amountCents: number | null = null;
    if (supportsPartial) {
      const n = Number(amountKes);
      if (!Number.isFinite(n) || n <= 0) {
        toast({ title: "Invalid amount", variant: "destructive" }); return;
      }
      amountCents = Math.round(n * 100);
      if (amountCents > row.total_cents) {
        toast({ title: "Amount exceeds invoice total", variant: "destructive" }); return;
      }
    }

    setBusy(true);
    try {
      if (kind === "void") {
        const { error } = await supabase.rpc("etims_invoice_void" as LooseRow, {
          _invoice_id: row.id, _reason: reason,
        });
        if (error) throw error;
        toast({ title: "Invoice voided", description: row.invoice_number });
      } else if (kind === "credit_note") {
        const { data, error } = await supabase.rpc("etims_issue_credit_note" as LooseRow, {
          _original_invoice_id: row.id, _reason: reason,
          _amount_cents: amountCents === row.total_cents ? null : amountCents,
        });
        if (error) throw error;
        toast({ title: "Credit note issued", description: `New invoice id: ${String(data).slice(0, 8)}…` });
      } else {
        const { error } = await supabase.rpc("refund_mpesa_payment" as LooseRow, {
          _txn_id: row.transaction_id!, _reason: reason,
          _amount_cents: amountCents === row.total_cents ? null : amountCents,
        });
        if (error) throw error;
        toast({ title: "Refund initiated", description: row.invoice_number });
      }
      onDone();
    } catch (e: LooseRow) {
      toast({ title: "Action failed", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!action} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>
            Invoice <span className="font-mono">{row.invoice_number}</span> · Total{" "}
            <span className="font-semibold">{fmtKES(row.total_cents, row.currency)}</span>
            {kind === "void" && " · This is irreversible and posts a reversing journal."}
            {kind === "credit_note" && " · A new CREDIT_NOTE invoice will be issued and synced to KRA."}
            {kind === "refund" && " · Posts a reversing journal, issues a credit note, and marks the M-Pesa payment for reversal."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {supportsPartial && (
            <div>
              <Label className="text-xs">Amount ({row.currency ?? "KES"})</Label>
              <Input
                type="number" min="0" step="0.01"
                value={amountKes} onChange={(e) => setAmountKes(e.target.value)}
              />
              <p className="text-xs text-muted-foreground mt-1">
                Max {fmtKES(row.total_cents, row.currency)}. Use full amount for a full {kind === "refund" ? "refund" : "credit"}.
              </p>
            </div>
          )}
          <div>
            <Label className="text-xs">Reason (required, ≥ 6 chars)</Label>
            <Textarea
              value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer cancelled trip after payment; refund authorized by ops lead."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant={kind === "void" ? "destructive" : "default"}
            onClick={submit} disabled={busy}
          >
            {busy ? "Working…" : title}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Sync Health ---------------- */
function SyncHealthPanel() {
  const [from, setFrom] = useState(todayISO(-7));
  const [to, setTo] = useState(todayISO());
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [failure, setFailure] = useState<TaxLoadFailure | null>(null);

  const load = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("tax_report_sync_health", { _from: from, _to: to });
    setBusy(false);
    if (error) { setFailure(classifyTaxError(error)); return; }
    setFailure(null);
    setData(data);
  };
  useEffect(() => { load();   }, []);

  const triggerRetry = async () => {
    setRetrying(true);
    const { error } = await supabase.functions.invoke("etims-retry", { body: {} });
    setRetrying(false);
    if (error) { toast({ title: "Retry trigger failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Retry job triggered" });
    load();
  };

  const events = data?.events_by_type ?? {};
  const queue = data?.retry_by_status ?? {};
  const failures = data?.recent_failures ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Refresh</Button>
          <Button variant="outline" onClick={triggerRetry} disabled={retrying}><RefreshCw className={`h-4 w-4 mr-2 ${retrying ? "animate-spin" : ""}`} />Run retry job</Button>
        </CardContent>
      </Card>

      {failure && <TaxLoadError failure={failure} onRetry={load} busy={busy} context="eTIMS sync health" />}

      <TaxDiagnosticsPanel from={from} to={to} />



      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader><CardTitle className="text-base">Sync events by type</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.keys(events).length === 0 && <p className="text-muted-foreground">No events.</p>}
            {Object.entries(events).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-medium">{String(v)}</span></div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-base">Retry queue</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.keys(queue).length === 0 && <p className="text-muted-foreground">Queue empty.</p>}
            {Object.entries(queue).map(([k, v]) => (
              <div key={k} className="flex justify-between"><span className="text-muted-foreground">{k}</span><span className="font-medium">{String(v)}</span></div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Recent failures</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>When</TableHead>
                <TableHead>Event</TableHead>
                <TableHead>HTTP</TableHead>
                <TableHead>Error</TableHead>
                <TableHead className="font-mono">Invoice</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {failures.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No failures recorded.</TableCell></TableRow>}
              {failures.map((f: LooseRow) => (
                <TableRow key={f.id}>
                  <TableCell className="text-xs">{fmtDate(f.created_at)}</TableCell>
                  <TableCell><Badge variant="destructive">{f.event_type}</Badge></TableCell>
                  <TableCell>{f.response_status ?? "—"}</TableCell>
                  <TableCell className="text-xs max-w-md truncate">{f.error_message ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{f.invoice_id?.slice(0, 8) ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- VAT Report ---------------- */
function VatReportPanel() {
  const [from, setFrom] = useState(todayISO(-30));
  const [to, setTo] = useState(todayISO());
  const fetcher = useCallback(
    () => supabase.rpc("tax_report_vat_summary", { _from: from, _to: to }),
    [from, to],
  );
  const { data, busy, failure, retryInSeconds, retryPlan, requestId, reload } =
    useTaxReport<any>({ report: "tax_report_vat_summary", from, to, fetcher });
  const load = reload;

  const byScheme = data?.by_scheme ?? [];
  const daily = data?.daily ?? [];

  const totals = useMemo(() => {
    return byScheme.reduce((acc: LooseRow, r: LooseRow) => ({
      taxable: acc.taxable + Number(r.taxable_cents || 0),
      tax: acc.tax + Number(r.tax_cents || 0),
      total: acc.total + Number(r.total_cents || 0),
    }), { taxable: 0, tax: 0, total: 0 });
  }, [byScheme]);

  const schemeTable = useMemo(() => vatSummaryReport(data, { from, to }), [data, from, to]);
  const dailyTable = useMemo(() => vatDailyReport(data, { from, to }), [data, from, to]);

  const exportSummary = (kind: "csv" | "pdf") => () =>
    auditedExport(
      { dataset: "tax.vat_summary", exportType: kind, rowCount: byScheme.length, filters: { from, to } },
      async () => {
        if (kind === "csv") downloadReportCsv(schemeTable);
        else await downloadReportPdf(schemeTable);
        return reportToCsv(schemeTable);
      },
    );

  const exportDaily = (kind: "csv" | "pdf") => () =>
    auditedExport(
      { dataset: "tax.vat_daily", exportType: kind, rowCount: daily.length, filters: { from, to } },
      async () => {
        if (kind === "csv") downloadReportCsv(dailyTable);
        else await downloadReportPdf(dailyTable);
        return reportToCsv(dailyTable);
      },
    );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Refresh</Button>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export VAT summary to CSV" onClick={exportSummary("csv")} disabled={!byScheme.length}
            trackingMeta={{ dataset: "tax.vat_summary", export_type: "csv" }}>
            <Download className="h-4 w-4 mr-2" />Summary CSV
          </AppButton>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export VAT summary to PDF" onClick={exportSummary("pdf")} disabled={!byScheme.length}
            trackingMeta={{ dataset: "tax.vat_summary", export_type: "pdf" }}>
            <Download className="h-4 w-4 mr-2" />Summary PDF
          </AppButton>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export daily VAT report to CSV" onClick={exportDaily("csv")} disabled={!daily.length}
            trackingMeta={{ dataset: "tax.vat_daily", export_type: "csv" }}>
            <Download className="h-4 w-4 mr-2" />Daily CSV
          </AppButton>
          <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
            aria-label="Export daily VAT report to PDF" onClick={exportDaily("pdf")} disabled={!daily.length}
            trackingMeta={{ dataset: "tax.vat_daily", export_type: "pdf" }}>
            <Download className="h-4 w-4 mr-2" />Daily PDF
          </AppButton>
        </CardContent>
      </Card>

      {failure && (
        <TaxLoadError
          failure={failure} onRetry={load} busy={busy} context="the VAT report"
          retryInSeconds={retryInSeconds} retryReason={retryPlan?.reason} requestId={requestId}
        />
      )}




      <div className="grid sm:grid-cols-3 gap-4">
        <Kpi title="Taxable Base" value={fmtKES(totals.taxable)} />
        <Kpi title="VAT Collected" value={fmtKES(totals.tax)} />
        <Kpi title="Gross Sales" value={fmtKES(totals.total)} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">By scheme</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Scheme</TableHead>
              <TableHead className="text-right">Lines</TableHead>
              <TableHead className="text-right">Taxable</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Total</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {byScheme.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No data.</TableCell></TableRow>}
              {byScheme.map((s: LooseRow) => (
                <TableRow key={s.tax_scheme_code}>
                  <TableCell className="font-mono">{s.tax_scheme_code}</TableCell>
                  <TableCell className="text-right">{s.line_count}</TableCell>
                  <TableCell className="text-right">{fmtKES(s.taxable_cents)}</TableCell>
                  <TableCell className="text-right">{fmtKES(s.tax_cents)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtKES(s.total_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Daily trend</CardTitle></CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Invoices</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Gross</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {daily.length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No data.</TableCell></TableRow>}
              {daily.map((d: LooseRow) => (
                <TableRow key={d.day}>
                  <TableCell>{d.day}</TableCell>
                  <TableCell className="text-right">{d.invoice_count}</TableCell>
                  <TableCell className="text-right">{fmtKES(d.net_cents)}</TableCell>
                  <TableCell className="text-right">{fmtKES(d.tax_cents)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtKES(d.gross_cents)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------------- Corporate Billing ---------------- */
function CorporateBillingPanel() {
  const [from, setFrom] = useState(todayISO(-90));
  const [to, setTo] = useState(todayISO());
  const fetcher = useCallback(
    () => supabase.rpc("tax_report_corporate_billing", { _from: from, _to: to }),
    [from, to],
  );
  const { data, busy, failure, retryInSeconds, retryPlan, requestId, reload } =
    useTaxReport<LooseRow[]>({ report: "tax_report_corporate_billing", from, to, fetcher });
  const rows = data ?? [];
  const load = reload;

  const totals = useMemo(() => rows.reduce((acc, r) => ({
    billed: acc.billed + Number(r.total_cents || 0),
    outstanding: acc.outstanding + Number(r.balance_cents || 0),
    vat: acc.vat + Number(r.tax_total_cents || 0),
  }), { billed: 0, outstanding: 0, vat: 0 }), [rows]);

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 flex flex-wrap items-end gap-3">
          <div><label className="text-xs text-muted-foreground">From</label><Input type="date" value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><label className="text-xs text-muted-foreground">To</label><Input type="date" value={to} onChange={e => setTo(e.target.value)} /></div>
          <Button onClick={load} disabled={busy}><RefreshCw className={`h-4 w-4 mr-2 ${busy ? "animate-spin" : ""}`} />Refresh</Button>
        </CardContent>
      </Card>

      {failure && (
        <TaxLoadError
          failure={failure} onRetry={load} busy={busy} context="corporate billing"
          retryInSeconds={retryInSeconds} retryReason={retryPlan?.reason} requestId={requestId}
        />
      )}




      <div className="grid sm:grid-cols-3 gap-4">
        <Kpi title="Invoices" value={rows.length} />
        <Kpi title="Billed" value={fmtKES(totals.billed)} sub={`${fmtKES(totals.vat)} VAT`} />
        <Kpi title="Outstanding" value={fmtKES(totals.outstanding)} tone={totals.outstanding > 0 ? "warn" : undefined} />
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Invoice #</TableHead>
              <TableHead>Corporate</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">VAT</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead>Issued</TableHead>
              <TableHead>Due</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {busy && <TableRow><TableCell colSpan={9}><Skeleton className="h-6 w-full" /></TableCell></TableRow>}
              {!busy && rows.length === 0 && <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground py-6">No corporate invoices.</TableCell></TableRow>}
              {rows.map(r => (
                <TableRow key={r.invoice_id}>
                  <TableCell className="font-mono text-xs">{r.invoice_number}</TableCell>
                  <TableCell>{r.legal_name}</TableCell>
                  <TableCell><Badge variant={r.status === "PAID" ? "default" : r.status === "ISSUED" ? "secondary" : "outline"}>{r.status}</Badge></TableCell>
                  <TableCell className="text-right">{fmtKES(r.subtotal_cents, r.currency)}</TableCell>
                  <TableCell className="text-right">{fmtKES(r.tax_total_cents, r.currency)}</TableCell>
                  <TableCell className="text-right font-semibold">{fmtKES(r.total_cents, r.currency)}</TableCell>
                  <TableCell className="text-right">{fmtKES(r.balance_cents, r.currency)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.issued_at)}</TableCell>
                  <TableCell className="text-xs">{fmtDate(r.due_at)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
