/**
 * PHASE 7 — Freight Audit, Billing & Financial Reconciliation Control Centre.
 *
 * Every control on this page executes a server-authoritative database operation.
 * There are no client-side calculations, no placeholder actions and no fabricated
 * outcomes. Payments are never initiated here: the existing TaxiD M-Pesa engine
 * remains the payment authority and this surface only records and reconciles the
 * relationship between confirmed money and freight invoices.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, Banknote, Download, FileSearch, GitBranch, Receipt,
  RefreshCw, ScrollText, Scale, Settings2, Wallet,
} from "lucide-react";
import { toast } from "sonner";
import {
  allocatePayment, buildInvoice, chargeLineage, downloadCsv, financeKey, issueInvoice,
  listAllocations, listAuditRuns, listBillingConfig, listCharges, listFindings,
  listInvoiceLines, listInvoices, listReconExceptions, listReconRuns, listSettlements,
  money, requestAdjustment, resolveFinding, resolveReconException, reverseAllocation,
  runFreightAudit, runThreeWayRecon, setBillingConfig, threeWayPosition, toCsv,
  transitionCharge, transitionSettlement, voidInvoice,
  type AllocationRow, type AuditFindingRow, type AuditRunRow, type BillingConfigRow,
  type ChargeLineage, type ChargeRow, type InvoiceLineRow, type InvoiceRow,
  type ReconExceptionRow, type ReconRunRow, type SettlementRow,
} from "@/lib/logistics/finance/freightFinanceEngine";

const PAGE = 25;

const SEVERITY_TONE: Record<string, string> = {
  CRITICAL: "bg-destructive/10 text-destructive border-destructive/30",
  MAJOR: "bg-warning/10 text-warning-foreground border-warning/30",
  MINOR: "bg-muted text-muted-foreground",
  INFO: "bg-muted text-muted-foreground",
};

const STATUS_TONE: Record<string, string> = {
  VOID: "bg-muted text-muted-foreground",
  PAID: "bg-success/10 text-success-foreground border-success/30",
  SETTLED: "bg-success/10 text-success-foreground border-success/30",
  APPROVED: "bg-primary/10 text-primary border-primary/30",
};

function useWindowRange() {
  const [from, setFrom] = useState(() =>
    new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  return {
    from, to, setFrom, setTo,
    fromIso: new Date(`${from}T00:00:00Z`).toISOString(),
    toIso: new Date(`${to}T23:59:59Z`).toISOString(),
  };
}

function Empty({ label }: { label: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{label}</p>;
}

export default function FreightAudit() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [charges, setCharges] = useState<ChargeRow[]>([]);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [allocations, setAllocations] = useState<AllocationRow[]>([]);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [auditRuns, setAuditRuns] = useState<AuditRunRow[]>([]);
  const [findings, setFindings] = useState<AuditFindingRow[]>([]);
  const [reconRuns, setReconRuns] = useState<ReconRunRow[]>([]);
  const [reconExceptions, setReconExceptions] = useState<ReconExceptionRow[]>([]);
  const [config, setConfig] = useState<BillingConfigRow[]>([]);

  const [chargeSearch, setChargeSearch] = useState("");
  const [chargeStatus, setChargeStatus] = useState<string>("ALL");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedCharges, setSelectedCharges] = useState<string[]>([]);
  const [openInvoice, setOpenInvoice] = useState<string | null>(null);
  const [invoiceLines, setInvoiceLines] = useState<InvoiceLineRow[]>([]);
  const [lineage, setLineage] = useState<ChargeLineage | null>(null);
  const [lineageId, setLineageId] = useState("");
  const [chargePage, setChargePage] = useState(0);

  const window7 = useWindowRange();

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const [c, i, a, s, ar, f, rr, re, cfg] = await Promise.all([
        listCharges(), listInvoices(), listAllocations(), listSettlements(),
        listAuditRuns(), listFindings(), listReconRuns(), listReconExceptions(),
        listBillingConfig(),
      ]);
      setCharges(c); setInvoices(i); setAllocations(a); setSettlements(s);
      setAuditRuns(ar); setFindings(f); setReconRuns(rr); setReconExceptions(re);
      setConfig(cfg);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load freight financial data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const run = useCallback(async (id: string, fn: () => Promise<unknown>, success: string) => {
    setBusy(id);
    try {
      const result = (await fn()) as { duplicate?: boolean } | undefined;
      toast.success(result?.duplicate ? "Already applied — no second financial effect" : success);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Operation refused");
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const filteredCharges = useMemo(() => charges.filter((c) =>
    (chargeStatus === "ALL" || c.status === chargeStatus) &&
    (chargeSearch === "" ||
      c.charge_number.toLowerCase().includes(chargeSearch.toLowerCase()) ||
      c.charge_code.toLowerCase().includes(chargeSearch.toLowerCase()))),
    [charges, chargeStatus, chargeSearch]);

  const pagedCharges = filteredCharges.slice(chargePage * PAGE, chargePage * PAGE + PAGE);

  const openFindings = findings.filter((f) => f.state === "OPEN");
  const openExceptions = reconExceptions.filter((e) => e.state === "OPEN");
  const unmatched = allocations.filter((a) => a.state === "UNMATCHED" && !a.reversed_at);
  const pendingConfig = config.filter((c) => c.state !== "CONFIGURED");

  const kpis = [
    { label: "Open audit findings", value: openFindings.length,
      tone: openFindings.some((f) => f.severity === "CRITICAL") ? "text-destructive" : "" },
    { label: "Reconciliation exceptions", value: openExceptions.length,
      tone: openExceptions.some((e) => e.severity === "CRITICAL") ? "text-destructive" : "" },
    { label: "Unmatched payments", value: unmatched.length, tone: unmatched.length ? "text-warning-foreground" : "" },
    { label: "Invoices outstanding",
      value: invoices.filter((i) => ["ISSUED", "PARTIALLY_PAID"].includes(i.status)).length, tone: "" },
    { label: "Settlements awaiting approval",
      value: settlements.filter((s) => ["CALCULATED", "PENDING_REVIEW"].includes(s.status)).length, tone: "" },
    { label: "Configuration required", value: pendingConfig.length,
      tone: pendingConfig.length ? "text-warning-foreground" : "" },
  ];

  const loadInvoice = async (id: string) => {
    setOpenInvoice(id);
    try { setInvoiceLines(await listInvoiceLines(id)); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Unable to load invoice lines"); }
  };

  const loadLineage = async (id: string) => {
    if (!id) return;
    setBusy("lineage");
    try { setLineage(await chargeLineage(id)); setLineageId(id); }
    catch (e) { toast.error(e instanceof Error ? e.message : "Unable to load lineage"); }
    finally { setBusy(null); }
  };

  if (loading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-10 w-72" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Freight Audit &amp; Financial Reconciliation</h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Operational, commercial and financial truth for freight. Payments remain owned by the
            existing TaxiD M-Pesa engine — this centre records, allocates and reconciles them.
          </p>
        </div>
        <Button variant="outline" onClick={() => void refresh()} disabled={busy !== null}>
          <RefreshCw className="mr-2 h-4 w-4" /> Refresh
        </Button>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
            <p className={`mt-1 text-2xl font-semibold ${k.tone}`}>{k.value}</p>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="audit" className="w-full">
        <TabsList className="flex w-full flex-wrap justify-start gap-1">
          <TabsTrigger value="audit"><FileSearch className="mr-1.5 h-4 w-4" />Audit queue</TabsTrigger>
          <TabsTrigger value="recon"><Scale className="mr-1.5 h-4 w-4" />Three-way</TabsTrigger>
          <TabsTrigger value="charges"><ScrollText className="mr-1.5 h-4 w-4" />Charges</TabsTrigger>
          <TabsTrigger value="invoices"><Receipt className="mr-1.5 h-4 w-4" />Invoices</TabsTrigger>
          <TabsTrigger value="payments"><Wallet className="mr-1.5 h-4 w-4" />Payments</TabsTrigger>
          <TabsTrigger value="settlements"><Banknote className="mr-1.5 h-4 w-4" />Settlements</TabsTrigger>
          <TabsTrigger value="lineage"><GitBranch className="mr-1.5 h-4 w-4" />Lineage</TabsTrigger>
          <TabsTrigger value="config"><Settings2 className="mr-1.5 h-4 w-4" />Configuration</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ AUDIT */}
        <TabsContent value="audit" className="space-y-4 pt-4">
          <Card className="p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="audit-from">From</Label>
                <Input id="audit-from" type="date" value={window7.from}
                       onChange={(e) => window7.setFrom(e.target.value)} className="w-40" />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="audit-to">To</Label>
                <Input id="audit-to" type="date" value={window7.to}
                       onChange={(e) => window7.setTo(e.target.value)} className="w-40" />
              </div>
              <Button
                disabled={busy !== null}
                onClick={() => run("audit", async () => {
                  const r = await runFreightAudit(window7.fromIso, window7.toIso);
                  return r;
                }, "Freight audit completed")}
              >
                <FileSearch className="mr-2 h-4 w-4" /> Run freight audit
              </Button>
              <Button data-analytics="freight_audit_export_findings" variant="outline" disabled={findings.length === 0}
                onClick={() => downloadCsv("freight-audit-findings.csv", toCsv(
                  ["Raised", "Reason", "Severity", "State", "Expected", "Actual", "Variance", "Currency", "Detail"],
                  findings.map((f) => [f.created_at, f.reason_code, f.severity, f.state,
                    f.expected_amount, f.actual_amount, f.variance_amount, f.currency, f.detail])))}>
                <Download className="mr-2 h-4 w-4" /> Export findings
              </Button>
            </div>
            {auditRuns[0] && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last run {new Date(auditRuns[0].created_at).toLocaleString()} · scanned{" "}
                {auditRuns[0].bookings_scanned} bookings, {auditRuns[0].charges_scanned} charges,{" "}
                {auditRuns[0].invoices_scanned} invoices · {auditRuns[0].findings} findings
                ({auditRuns[0].critical} critical)
              </p>
            )}
          </Card>

          <Card className="divide-y">
            {findings.length === 0 && <Empty label="No audit findings recorded yet. Run the freight audit for a window." />}
            {findings.map((f) => (
              <div key={f.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={SEVERITY_TONE[f.severity]}>{f.severity}</Badge>
                  <span className="font-mono text-sm">{f.reason_code}</span>
                  <Badge variant="secondary">{f.state}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Date(f.created_at).toLocaleString()}
                  </span>
                </div>
                <p className="text-sm">{f.detail}</p>
                <p className="text-xs text-muted-foreground">
                  Expected {money(f.expected_amount, f.currency)} · actual {money(f.actual_amount, f.currency)} ·
                  variance {money(f.variance_amount, f.currency)}
                </p>
                {f.state === "OPEN" && (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="outline" disabled={busy !== null}
                      onClick={() => run(f.id, () => resolveFinding(f.id, "ACKNOWLEDGED", "acknowledged for investigation"),
                        "Finding acknowledged")}>Acknowledge</Button>
                    <ResolveInline
                      disabled={busy !== null}
                      label="Resolve"
                      onSubmit={(notes) => run(f.id, () => resolveFinding(f.id, "RESOLVED", notes), "Finding resolved")}
                    />
                    <ResolveInline
                      disabled={busy !== null}
                      label="Waive"
                      onSubmit={(notes) => run(f.id, () => resolveFinding(f.id, "WAIVED", notes), "Finding waived")}
                    />
                  </div>
                )}
                {f.resolution_notes && (
                  <p className="text-xs text-muted-foreground">Resolution: {f.resolution_notes}</p>
                )}
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------- RECON */}
        <TabsContent value="recon" className="space-y-4 pt-4">
          <Card className="p-4">
            <p className="mb-3 text-sm text-muted-foreground">
              Compares what happened operationally, what should have been charged, and what was
              actually invoiced, paid and settled. Every unexplained difference becomes an exception.
            </p>
            <div className="flex flex-wrap items-end gap-3">
              <Button disabled={busy !== null}
                onClick={() => run("recon", () => runThreeWayRecon(window7.fromIso, window7.toIso),
                  "Three-way reconciliation completed")}>
                <Scale className="mr-2 h-4 w-4" /> Run reconciliation ({window7.from} → {window7.to})
              </Button>
              <Button data-analytics="freight_audit_export_charges" variant="outline" disabled={reconExceptions.length === 0}
                onClick={() => downloadCsv("freight-reconciliation.csv", toCsv(
                  ["Detected", "Reason", "Severity", "Expected", "Charged", "Invoiced", "Paid", "Settled", "Paid to carrier", "Variance"],
                  reconExceptions.map((e) => [e.created_at, e.reason_code, e.severity, e.expected_amount,
                    e.charged_amount, e.invoiced_amount, e.paid_amount, e.settled_amount,
                    e.carrier_paid_amount, e.variance_amount])))}>
                <Download className="mr-2 h-4 w-4" /> Export
              </Button>
            </div>
            {reconRuns[0] && (
              <p className="mt-3 text-xs text-muted-foreground">
                Last run {new Date(reconRuns[0].created_at).toLocaleString()} ·{" "}
                {reconRuns[0].transactions_scanned} transactions · {reconRuns[0].exceptions} exceptions
                ({reconRuns[0].critical} critical) · {reconRuns[0].balanced ? "balanced" : "unbalanced"}
              </p>
            )}
          </Card>

          <Card className="divide-y">
            {reconExceptions.length === 0 && <Empty label="No reconciliation exceptions." />}
            {reconExceptions.map((e) => (
              <div key={e.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className={SEVERITY_TONE[e.severity]}>{e.severity}</Badge>
                  <span className="font-mono text-sm">{e.reason_code}</span>
                  <Badge variant="secondary">{e.state}</Badge>
                  <span className="ml-auto text-xs text-muted-foreground">
                    variance {money(e.variance_amount, e.currency)}
                  </span>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                  {threeWayPosition(e).map((p) => (
                    <div key={p.label} className="rounded-md border p-2">
                      <p className="text-muted-foreground">{p.label}</p>
                      <p className="font-medium">{money(p.value, e.currency)}</p>
                    </div>
                  ))}
                </div>
                <p className="text-sm">{e.detail}</p>
                {e.state === "OPEN" && (
                  <ResolveInline
                    disabled={busy !== null}
                    label="Resolve exception"
                    onSubmit={(notes) => run(e.id, () => resolveReconException(e.id, "RESOLVED", notes),
                      "Exception resolved")}
                  />
                )}
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- CHARGES */}
        <TabsContent value="charges" className="space-y-4 pt-4">
          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="charge-search">Search</Label>
              <Input id="charge-search" placeholder="Charge number or code" value={chargeSearch}
                     onChange={(e) => { setChargeSearch(e.target.value); setChargePage(0); }}
                     className="w-56" />
            </div>
            <div className="grid gap-1.5">
              <Label>Status</Label>
              <Select value={chargeStatus} onValueChange={(v) => { setChargeStatus(v); setChargePage(0); }}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["ALL", "CALCULATED", "PENDING_REVIEW", "APPROVED", "INVOICED", "PAID", "SETTLED", "VOID"]
                    .map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={selectedCharges.length === 0 || busy !== null}
              onClick={() => run("build-invoice", () => buildInvoice({
                chargeIds: selectedCharges,
                idempotencyKey: financeKey("invoice", [...selectedCharges].sort().join("|")),
              }), "Invoice built from approved charges")}
            >
              <Receipt className="mr-2 h-4 w-4" /> Invoice {selectedCharges.length} selected
            </Button>
            <Button data-analytics="freight_audit_export_invoices" variant="outline" disabled={charges.length === 0}
              onClick={() => downloadCsv("freight-charges.csv", toCsv(
                ["Charge", "Party", "Status", "Code", "Basis", "Qty", "Rate", "Amount", "Tax", "Currency", "Created"],
                charges.map((c) => [c.charge_number, c.party, c.status, c.charge_code, c.basis,
                  c.quantity, c.unit_rate, c.amount, c.tax_amount, c.currency, c.created_at])))}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </Card>

          <Card className="divide-y">
            {pagedCharges.length === 0 && <Empty label="No charges match this filter." />}
            {pagedCharges.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-3 p-4">
                <input
                  type="checkbox"
                  aria-label={`Select charge ${c.charge_number}`}
                  className="h-4 w-4"
                  disabled={c.status !== "APPROVED"}
                  checked={selectedCharges.includes(c.id)}
                  onChange={(e) => setSelectedCharges((prev) =>
                    e.target.checked ? [...prev, c.id] : prev.filter((id) => id !== c.id))}
                />
                <div className="min-w-48 flex-1">
                  <p className="font-mono text-sm">{c.charge_number}</p>
                  <p className="text-xs text-muted-foreground">
                    {c.party} · {c.charge_code} · {c.basis} · {c.quantity} × {c.unit_rate}
                  </p>
                </div>
                <Badge variant="outline" className={STATUS_TONE[c.status] ?? ""}>{c.status}</Badge>
                <span className="font-medium">{money(c.amount, c.currency)}</span>
                <div className="flex flex-wrap gap-2">
                  {c.status === "CALCULATED" && (
                    <Button size="sm" variant="outline" disabled={busy !== null}
                      onClick={() => run(c.id, () => transitionCharge(c.id, "PENDING_REVIEW", "review"),
                        "Sent for review")}>Send for review</Button>
                  )}
                  {(c.status === "CALCULATED" || c.status === "PENDING_REVIEW") && (
                    <Button size="sm" disabled={busy !== null}
                      onClick={() => run(c.id, () => transitionCharge(c.id, "APPROVED", "approved"),
                        "Charge approved")}>Approve</Button>
                  )}
                  {c.status !== "VOID" && c.status !== "PAID" && c.status !== "SETTLED" && (
                    <ResolveInline label="Void" disabled={busy !== null}
                      onSubmit={(reason) => run(c.id, () => transitionCharge(c.id, "VOID", "VOIDED", reason),
                        "Charge voided")} />
                  )}
                  <AdjustInline disabled={busy !== null}
                    onSubmit={(kind, amount, reasonCode, note) => run(c.id, () => requestAdjustment({
                      chargeId: c.id, kind, amount, reasonCode, reasonNote: note,
                    }), "Adjustment requested — needs a second approver")} />
                  <Button size="sm" variant="ghost" onClick={() => void loadLineage(c.id)}>Lineage</Button>
                </div>
              </div>
            ))}
          </Card>

          {filteredCharges.length > PAGE && (
            <div className="flex items-center justify-between">
              <Button variant="outline" size="sm" disabled={chargePage === 0}
                onClick={() => setChargePage((p) => p - 1)}>Previous</Button>
              <span className="text-sm text-muted-foreground">
                {chargePage * PAGE + 1}–{Math.min((chargePage + 1) * PAGE, filteredCharges.length)} of {filteredCharges.length}
              </span>
              <Button variant="outline" size="sm"
                disabled={(chargePage + 1) * PAGE >= filteredCharges.length}
                onClick={() => setChargePage((p) => p + 1)}>Next</Button>
            </div>
          )}
        </TabsContent>

        {/* ---------------------------------------------------------- INVOICES */}
        <TabsContent value="invoices" className="space-y-4 pt-4">
          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div className="grid gap-1.5">
              <Label htmlFor="inv-search">Search</Label>
              <Input id="inv-search" placeholder="Invoice number" value={invoiceSearch}
                     onChange={(e) => setInvoiceSearch(e.target.value)} className="w-56" />
            </div>
            <Button data-analytics="freight_audit_export_recon" variant="outline" disabled={invoices.length === 0}
              onClick={() => downloadCsv("freight-invoices.csv", toCsv(
                ["Invoice", "Status", "Subtotal", "Tax", "Total", "Paid", "Currency", "Issued", "Due"],
                invoices.map((i) => [i.invoice_number, i.status, i.subtotal, i.tax_total, i.total,
                  i.paid_total, i.currency, i.issued_at, i.due_at])))}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </Card>

          <Card className="divide-y">
            {invoices.length === 0 && <Empty label="No freight invoices yet." />}
            {invoices
              .filter((i) => invoiceSearch === "" ||
                i.invoice_number.toLowerCase().includes(invoiceSearch.toLowerCase()))
              .map((i) => (
                <div key={i.id} className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="font-mono text-sm">{i.invoice_number}</span>
                    <Badge variant="outline" className={STATUS_TONE[i.status] ?? ""}>{i.status}</Badge>
                    <span className="text-sm">
                      {money(i.total, i.currency)} · paid {money(i.paid_total, i.currency)}
                    </span>
                    <div className="ml-auto flex flex-wrap gap-2">
                      {i.status === "DRAFT" && (
                        <Button size="sm" disabled={busy !== null}
                          onClick={() => run(i.id, () => issueInvoice(i.id), "Invoice issued")}>Issue</Button>
                      )}
                      {i.status !== "VOID" && i.paid_total === 0 && (
                        <ResolveInline label="Void" disabled={busy !== null}
                          onSubmit={(reason) => run(i.id, () => voidInvoice(i.id, reason), "Invoice voided")} />
                      )}
                      {["ISSUED", "PARTIALLY_PAID"].includes(i.status) && (
                        <AllocateInline disabled={busy !== null}
                          outstanding={i.total - i.paid_total}
                          onSubmit={(amount, ref) => run(i.id, () => allocatePayment({
                            invoiceId: i.id, amount, providerReference: ref,
                            idempotencyKey: financeKey("alloc", i.id, ref, amount),
                          }), "Confirmed payment allocated")} />
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void loadInvoice(i.id)}>Lines</Button>
                    </div>
                  </div>
                  {openInvoice === i.id && (
                    <div className="rounded-md border">
                      {invoiceLines.length === 0 && <Empty label="No lines." />}
                      {invoiceLines.map((l) => (
                        <div key={l.id} className="flex flex-wrap items-center gap-3 border-b p-3 last:border-0">
                          <span className="text-xs text-muted-foreground">#{l.line_no}</span>
                          <span className="flex-1 text-sm">{l.description}</span>
                          <span className="text-xs text-muted-foreground">
                            {l.quantity} × {l.unit_rate}
                          </span>
                          <span className="text-sm font-medium">{money(l.amount, i.currency)}</span>
                          <Button size="sm" variant="ghost" onClick={() => void loadLineage(l.charge_id)}>
                            Why this amount?
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
          </Card>
        </TabsContent>

        {/* ---------------------------------------------------------- PAYMENTS */}
        <TabsContent value="payments" className="space-y-4 pt-4">
          <Alert>
            <Wallet className="h-4 w-4" />
            <AlertDescription>
              The existing TaxiD M-Pesa engine remains the payment authority. Nothing here initiates
              or edits a payment — allocations only attach already-confirmed money to freight invoices
              and can be reversed without touching the original transaction.
            </AlertDescription>
          </Alert>

          <Card className="flex flex-wrap items-center gap-3 p-4">
            <p className="text-sm text-muted-foreground">
              {unmatched.length} unmatched · {allocations.filter((a) => a.state === "OVERPAYMENT").length} overpayment ·{" "}
              {allocations.filter((a) => a.state === "DUPLICATE").length} duplicate ·{" "}
              {allocations.filter((a) => a.state === "REVERSED").length} reversed
            </p>
            <Button data-analytics="freight_audit_export_disputes" variant="outline" className="ml-auto" disabled={allocations.length === 0}
              onClick={() => downloadCsv("freight-payment-allocations.csv", toCsv(
                ["Created", "Provider", "Reference", "Provider status", "Amount", "Currency", "State", "Invoice", "Reversed"],
                allocations.map((a) => [a.created_at, a.provider, a.provider_reference, a.provider_status,
                  a.amount, a.currency, a.state, a.invoice_id, a.reversed_at])))}>
              <Download className="mr-2 h-4 w-4" /> Export
            </Button>
          </Card>

          <Card className="divide-y">
            {allocations.length === 0 && <Empty label="No payment allocations recorded." />}
            {allocations.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-56 flex-1">
                  <p className="font-mono text-sm">{a.provider_reference ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {a.provider} · provider state {a.provider_status ?? "unknown"} ·{" "}
                    {new Date(a.created_at).toLocaleString()}
                  </p>
                  {a.unmatched_reason && (
                    <p className="text-xs text-warning-foreground">{a.unmatched_reason}</p>
                  )}
                </div>
                <Badge variant="outline"
                  className={a.state === "UNMATCHED" || a.state === "DUPLICATE"
                    ? SEVERITY_TONE.MAJOR : STATUS_TONE.APPROVED}>
                  {a.state}
                </Badge>
                <span className="font-medium">{money(a.amount, a.currency)}</span>
                {!a.reversed_at && a.state !== "REVERSED" && (
                  <ResolveInline label="Reverse" disabled={busy !== null}
                    onSubmit={(reason) => run(a.id, () => reverseAllocation(a.id, reason),
                      "Allocation reversed — the payment record is unchanged")} />
                )}
                {a.reversal_reason && (
                  <span className="text-xs text-muted-foreground">Reversed: {a.reversal_reason}</span>
                )}
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------- SETTLEMENTS */}
        <TabsContent value="settlements" className="space-y-4 pt-4">
          <Alert>
            <Banknote className="h-4 w-4" />
            <AlertDescription>
              Settlement amounts are derived from the contract, the award and actual executed
              bookings. A carrier-submitted figure is recorded as a claim and compared — it never
              becomes the payable amount on its own.
            </AlertDescription>
          </Alert>

          <Card className="divide-y">
            {settlements.length === 0 && <Empty label="No carrier settlements calculated yet." />}
            {settlements.map((s) => (
              <div key={s.id} className="space-y-2 p-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-mono text-sm">{s.settlement_number}</span>
                  <Badge variant="outline" className={STATUS_TONE[s.status] ?? ""}>{s.status}</Badge>
                  <span className="text-sm">
                    {s.period_start} → {s.period_end} · net {money(s.net_payable, s.currency)}
                  </span>
                  {s.carrier_claimed_amount !== null && (
                    <span className={`text-xs ${Math.abs(s.variance_amount) > 0.5 ? "text-destructive" : "text-muted-foreground"}`}>
                      carrier claimed {money(s.carrier_claimed_amount, s.currency)} · variance{" "}
                      {money(s.variance_amount, s.currency)}
                    </span>
                  )}
                  <div className="ml-auto flex flex-wrap gap-2">
                    {s.status === "CALCULATED" && (
                      <Button size="sm" variant="outline" disabled={busy !== null}
                        onClick={() => run(s.id, () => transitionSettlement(s.id, "PENDING_REVIEW"),
                          "Sent for review")}>Send for review</Button>
                    )}
                    {["CALCULATED", "PENDING_REVIEW"].includes(s.status) && (
                      <Button size="sm" disabled={busy !== null}
                        onClick={() => run(s.id, () => transitionSettlement(s.id, "APPROVED"),
                          "Settlement approved")}>Approve</Button>
                    )}
                    {s.status === "APPROVED" && (
                      <PayoutInline disabled={busy !== null}
                        onSubmit={(ref) => run(s.id, () => transitionSettlement(s.id, "PAID", undefined, ref),
                          "Payout recorded against its reference")} />
                    )}
                    {s.status !== "REVERSED" && (
                      <ResolveInline label="Reverse" disabled={busy !== null}
                        onSubmit={(reason) => run(s.id, () => transitionSettlement(s.id, "REVERSED", reason),
                          "Settlement reversed")} />
                    )}
                  </div>
                </div>
              </div>
            ))}
          </Card>
        </TabsContent>

        {/* ----------------------------------------------------------- LINEAGE */}
        <TabsContent value="lineage" className="space-y-4 pt-4">
          <Card className="flex flex-wrap items-end gap-3 p-4">
            <div className="grid flex-1 gap-1.5">
              <Label htmlFor="lineage-id">Charge identifier</Label>
              <Input id="lineage-id" placeholder="Charge UUID" value={lineageId}
                     onChange={(e) => setLineageId(e.target.value)} />
            </div>
            <Button disabled={!lineageId || busy !== null} onClick={() => void loadLineage(lineageId)}>
              <GitBranch className="mr-2 h-4 w-4" /> Reconstruct
            </Button>
          </Card>

          {!lineage && <Empty label="Open a charge's lineage to see why an amount was charged." />}
          {lineage && (
            <Card className="space-y-4 p-4">
              <div>
                <h2 className="text-lg font-semibold">{lineage.charge.charge_number}</h2>
                <p className="text-sm text-muted-foreground">
                  {money(lineage.charge.amount, lineage.charge.currency)} · {lineage.charge.basis} ·{" "}
                  {lineage.charge.status}
                </p>
              </div>
              <Separator />
              <div className="grid gap-3 md:grid-cols-2">
                {([
                  ["Quote", lineage.quote], ["Rate card", lineage.rate_card],
                  ["Rate line", lineage.rate_line], ["Award", lineage.award],
                  ["Booking", lineage.booking], ["Manifest", lineage.manifest],
                  ["Package", lineage.package], ["Invoice", lineage.invoice],
                  ["Settlement", lineage.settlement],
                ] as const).map(([label, value]) => (
                  <div key={label} className="rounded-md border p-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
                    <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all text-xs">
                      {value ? JSON.stringify(value, null, 2) : "— not linked"}
                    </pre>
                  </div>
                ))}
              </div>
              <Separator />
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Lifecycle history</p>
                <ul className="mt-2 space-y-1 text-sm">
                  {lineage.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap gap-2">
                      <span className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleString()}
                      </span>
                      <span className="font-mono text-xs">
                        {e.from_status ?? "—"} → {e.to_status}
                      </span>
                      <span className="text-xs text-muted-foreground">{e.reason_code ?? ""} {e.note ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <Button data-analytics="freight_audit_export_ledger" variant="outline" onClick={() => downloadCsv(
                `lineage-${lineage.charge.charge_number}.csv`,
                toCsv(["When", "From", "To", "Reason", "Note"],
                  lineage.events.map((e) => [e.created_at, e.from_status, e.to_status, e.reason_code, e.note])))}>
                <Download className="mr-2 h-4 w-4" /> Export history
              </Button>
            </Card>
          )}
        </TabsContent>

        {/* ------------------------------------------------------------ CONFIG */}
        <TabsContent value="config" className="space-y-4 pt-4">
          <Alert>
            <Settings2 className="h-4 w-4" />
            <AlertDescription>
              Missing owner or provider information is recorded here as a configuration item, so the
              rest of the financial layer keeps working around it.
            </AlertDescription>
          </Alert>
          <Card className="divide-y">
            {config.map((c) => (
              <div key={c.key} className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-56 flex-1">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="font-mono text-xs text-muted-foreground">{c.key}</p>
                  {c.guidance && <p className="text-xs text-muted-foreground">{c.guidance}</p>}
                </div>
                <Badge variant="outline"
                  className={c.state === "CONFIGURED" ? STATUS_TONE.APPROVED : SEVERITY_TONE.MAJOR}>
                  {c.state.replace(/_/g, " ")}
                </Badge>
                <ConfigInline
                  disabled={busy !== null}
                  current={JSON.stringify(c.value)}
                  onSubmit={(value) => run(c.key, async () => {
                    let parsed: Record<string, unknown>;
                    try { parsed = JSON.parse(value || "{}"); }
                    catch { throw new Error("Configuration must be valid JSON"); }
                    return setBillingConfig(c.key, parsed, "CONFIGURED");
                  }, "Configuration saved")}
                />
              </div>
            ))}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

/* --------------------------------------------------------- inline controls */

function ResolveInline({ label, disabled, onSubmit }: {
  label: string; disabled?: boolean; onSubmit: (notes: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>{label}</Button>;
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor={`notes-${label}`} className="text-xs">Reason (required)</Label>
        <Textarea id={`notes-${label}`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      <Button size="sm" disabled={disabled || notes.trim() === ""}
        onClick={() => { onSubmit(notes.trim()); setOpen(false); setNotes(""); }}>Confirm</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function AdjustInline({ disabled, onSubmit }: {
  disabled?: boolean;
  onSubmit: (kind: "CREDIT" | "DEBIT" | "REVERSAL", amount: number, reasonCode: string, note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"CREDIT" | "DEBIT" | "REVERSAL">("CREDIT");
  const [amount, setAmount] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Adjust</Button>;
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label className="text-xs">Kind</Label>
        <Select value={kind} onValueChange={(v) => setKind(v as typeof kind)}>
          <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="CREDIT">Credit</SelectItem>
            <SelectItem value="DEBIT">Debit</SelectItem>
            <SelectItem value="REVERSAL">Reversal</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="adj-amount" className="text-xs">Amount</Label>
        <Input id="adj-amount" type="number" className="w-32" value={amount}
               onChange={(e) => setAmount(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="adj-code" className="text-xs">Reason code</Label>
        <Input id="adj-code" className="w-40" value={reasonCode}
               onChange={(e) => setReasonCode(e.target.value)} />
      </div>
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="adj-note" className="text-xs">Note</Label>
        <Input id="adj-note" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <Button size="sm" disabled={disabled || !amount || !reasonCode.trim()}
        onClick={() => { onSubmit(kind, Number(amount), reasonCode.trim(), note); setOpen(false); setAmount(""); }}>
        Request
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function AllocateInline({ disabled, outstanding, onSubmit }: {
  disabled?: boolean; outstanding: number; onSubmit: (amount: number, reference: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(String(outstanding));
  const [reference, setReference] = useState("");
  if (!open) {
    return <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Allocate payment</Button>;
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <div className="grid gap-1.5">
        <Label htmlFor="alloc-ref" className="text-xs">Confirmed provider reference</Label>
        <Input id="alloc-ref" className="w-56" placeholder="M-Pesa receipt" value={reference}
               onChange={(e) => setReference(e.target.value)} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="alloc-amount" className="text-xs">Amount</Label>
        <Input id="alloc-amount" type="number" className="w-32" value={amount}
               onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Button size="sm" disabled={disabled || !reference.trim() || !amount}
        onClick={() => { onSubmit(Number(amount), reference.trim()); setOpen(false); }}>Allocate</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function PayoutInline({ disabled, onSubmit }: { disabled?: boolean; onSubmit: (ref: string) => void }) {
  const [open, setOpen] = useState(false);
  const [ref, setRef] = useState("");
  if (!open) {
    return <Button size="sm" disabled={disabled} onClick={() => setOpen(true)}>Record payout</Button>;
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="payout-ref" className="text-xs">Payout reference (required)</Label>
        <Input id="payout-ref" value={ref} onChange={(e) => setRef(e.target.value)} />
      </div>
      <Button size="sm" disabled={disabled || !ref.trim()}
        onClick={() => { onSubmit(ref.trim()); setOpen(false); }}>Confirm</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}

function ConfigInline({ disabled, current, onSubmit }: {
  disabled?: boolean; current: string; onSubmit: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  if (!open) {
    return <Button size="sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)}>Configure</Button>;
  }
  return (
    <div className="flex w-full flex-wrap items-end gap-2">
      <div className="grid flex-1 gap-1.5">
        <Label htmlFor="cfg-value" className="text-xs">Value (JSON)</Label>
        <Textarea id="cfg-value" rows={2} value={value} onChange={(e) => setValue(e.target.value)} />
      </div>
      <Button size="sm" disabled={disabled} onClick={() => { onSubmit(value); setOpen(false); }}>Save</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  );
}
