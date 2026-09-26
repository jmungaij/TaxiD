import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Navigate } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Download, RotateCcw, Trash2, AlertTriangle, Shield, Activity, FileText } from "lucide-react";
import { AppButton } from "@/components/nav/AppButton";
import { AnalyticsEvents } from "@/lib/analyticsEvents";
import { auditedExport } from "@/lib/exportAudit";

const STATUSES = ["PENDING", "PROCESSING", "SUCCESS", "FAILED", "REVERSED", "CANCELLED"] as const;
const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const fmtKES = (cents: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency }).format((cents || 0) / 100);

// Shared PostgREST filter hardening (re-exported for existing importers/tests).
export { sanitizeOrFilterTerm } from "@/lib/security/postgrestFilter";
import { sanitizeOrFilterTerm } from "@/lib/security/postgrestFilter";


const statusVariant = (s: string) => {
  switch (s) {
    case "SUCCESS": return "default";
    case "FAILED":
    case "CANCELLED": return "destructive";
    case "REVERSED": return "outline";
    default: return "secondary";
  }
};

export default function AdminPayments() {
  const { loading, isAnyAdmin } = useAuth();
  if (loading) return <div className="p-6"><Skeleton className="h-8 w-64" /></div>;
  if (!isAnyAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Payments Operations</h1>
          <p className="text-sm text-muted-foreground">Audit, reverse, and reconcile financial transactions.</p>
        </div>
      </header>

      <MetricsHeader />

      <Tabs defaultValue="transactions">
        <TabsList>
          <TabsTrigger value="transactions"><Activity className="h-4 w-4 mr-2" />Transactions</TabsTrigger>
          <TabsTrigger value="risk"><AlertTriangle className="h-4 w-4 mr-2" />Risk Events</TabsTrigger>
          <TabsTrigger value="reconciliation"><Shield className="h-4 w-4 mr-2" />Reconciliation</TabsTrigger>
        </TabsList>
        <TabsContent value="transactions" className="mt-4"><TransactionsPanel /></TabsContent>
        <TabsContent value="risk" className="mt-4"><RiskPanel /></TabsContent>
        <TabsContent value="reconciliation" className="mt-4"><ReconciliationPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function MetricsHeader() {
  const [metrics, setMetrics] = useState({ today: 0, success: 0, pending: 0, risk: 0 });
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
    Promise.all([
      supabase.from("mpesa_transactions").select("amount_cents,status").gte("created_at", todayStart.toISOString()),
      supabase.from("mpesa_transactions").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
      supabase.from("payment_risk_events").select("id", { count: "exact", head: true }).is("reviewed_at", null),
    ]).then(([txns, pending, risk]) => {
      const failure = txns.error || pending.error || risk.error;
      if (failure) {
        // Never render a fabricated "0 / 100%" scorecard on a finance surface.
        setMetricsError(failure.message);
        return;
      }
      setMetricsError(null);
      const rows = (txns.data as LooseRow[]) || [];
      const today = rows.filter(r => r.status === "SUCCESS").reduce((s, r) => s + (r.amount_cents || 0), 0);
      const total = rows.length || 1;
      const success = Math.round((rows.filter(r => r.status === "SUCCESS").length / total) * 100);
      setMetrics({ today, success, pending: pending.count || 0, risk: risk.count || 0 });
    });
  }, []);

  const cards = [
    { label: "Today Settled", value: fmtKES(metrics.today), tone: "text-primary" },
    { label: "Success Rate (24h)", value: `${metrics.success}%`, tone: "text-status-success" },
    { label: "Pending", value: metrics.pending, tone: "text-status-warning" },
    { label: "Open Risk Events", value: metrics.risk, tone: "text-status-danger" },
  ];
  if (metricsError) {
    return (
      <Card className="p-5 border-destructive/40" role="alert">
        <p className="text-sm font-semibold text-destructive flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" /> Payment metrics unavailable
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          KPIs are suppressed to avoid showing incorrect financial figures. {metricsError}
        </p>
      </Card>
    );
  }
  return (
    <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => (
        <Card key={c.label} className="p-5">
          <p className="text-sm text-muted-foreground">{c.label}</p>
          <p className={`text-2xl font-bold mt-1 ${c.tone}`}>{c.value}</p>
        </Card>
      ))}
    </div>
  );
}


function TransactionsPanel() {
  const [rows, setRows] = useState<LooseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<string>("ALL");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LooseRow | null>(null);

  const load = async () => {
    setLoading(true);
    let q = supabase.from("mpesa_transactions").select("*").is("deleted_at", null).order("created_at", { ascending: false }).limit(200);
    if (status !== "ALL") q = q.eq("status", status as LooseRow);
    const term = sanitizeOrFilterTerm(search);
    if (term) q = q.or(`mpesa_receipt.ilike.%${term}%,phone_number.ilike.%${term}%,transaction_reference.ilike.%${term}%`);
    const { data, error } = await q;
    if (error) {
      toast({ title: "Could not load transactions", description: error.message, variant: "destructive" });
      setLoading(false);
      return;
    }
    setRows(data || []);
    setLoading(false);
  };

  useEffect(() => { load();   }, [status]);

  const exportCsv = () =>
    auditedExport(
      { dataset: "payments.mpesa", exportType: "csv", rowCount: rows.length, filters: { status, search } },
      () => {
        const headers = ["id", "created_at", "status", "amount_cents", "currency", "phone_number", "mpesa_receipt", "user_id"];
        const csv = [headers.join(","), ...rows.map(r => headers.map(h => { const s = String(r[h] ?? ""); return JSON.stringify(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s); }).join(","))].join("\n");
        const blob = new Blob([csv], { type: "text/csv" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a"); a.href = url; a.download = `payments-${Date.now()}.csv`; a.click();
        URL.revokeObjectURL(url);
        return csv;
      },
    );

  return (
    <Card className="p-4 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input placeholder="Search receipt, phone, reference…" value={search} onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === "Enter" && load()} className="max-w-sm" />
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All statuses</SelectItem>
            {STATUSES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Refresh</Button>
        <AppButton variant="outline" analytics={AnalyticsEvents.ADMIN_EXPORT_DOWNLOAD} action="submit"
          aria-label="Export payments to CSV" onClick={exportCsv}
          trackingMeta={{ dataset: "payments.mpesa", export_type: "csv" }}>
          <Download className="h-4 w-4 mr-2" />Export CSV
        </AppButton>
      </div>

      <ScrollArea className="h-[560px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Created</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Receipt</TableHead>
              <TableHead>Reference</TableHead>
              <TableHead>Last touched by</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={7}><Skeleton className="h-8 w-full" /></TableCell></TableRow>
            ) : rows.length === 0 ? (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No transactions found.</TableCell></TableRow>
            ) : rows.map(r => (
              <TableRow key={r.id} className="cursor-pointer" onClick={() => setSelected(r)}>
                <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
                <TableCell><Badge variant={statusVariant(r.status) as LooseRow}>{r.status}</Badge></TableCell>
                <TableCell className="text-right font-mono">{fmtKES(r.amount_cents, r.currency)}</TableCell>
                <TableCell className="font-mono text-xs">{r.phone_number}</TableCell>
                <TableCell className="font-mono text-xs">{r.mpesa_receipt || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{r.transaction_reference || "—"}</TableCell>
                <TableCell className="text-xs">
                  {r.last_touched_label ? (<><div>{r.last_touched_label}</div><div className="text-muted-foreground">{new Date(r.last_touched_at).toLocaleString()}</div></>) : <span className="text-muted-foreground">Not recorded (before tracking)</span>}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>

      <TransactionDrawer txn={selected} onClose={() => setSelected(null)} onChanged={load} />
    </Card>
  );
}

function TransactionDrawer({ txn, onClose, onChanged }: { txn: LooseRow | null; onClose: () => void; onChanged: () => void }) {
  const [audit, setAudit] = useState<LooseRow[]>([]);
  const [events, setEvents] = useState<LooseRow[]>([]);
  const [ledger, setLedger] = useState<LooseRow[]>([]);
  const [risk, setRisk] = useState<LooseRow[]>([]);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!txn) return;
    Promise.all([
      supabase.from("payment_audit_logs").select("*").eq("transaction_id", txn.id).order("created_at", { ascending: false }),
      supabase.from("payment_events").select("*").eq("transaction_id", txn.id).order("created_at", { ascending: false }),
      supabase.from("ledger_entries").select("*").eq("transaction_id", txn.id).order("created_at"),
      supabase.from("payment_risk_events").select("*").eq("transaction_id", txn.id),
    ]).then(([a, e, l, r]) => {
      const failure = a.error || e.error || l.error || r.error;
      // An empty ledger and a failed ledger read must never look identical to an
      // operator who is about to authorise a reversal.
      setDetailError(failure ? failure.message : null);
      setAudit(a.data || []); setEvents(e.data || []); setLedger(l.data || []); setRisk(r.data || []);
    });
  }, [txn]);

  if (!txn) return null;
  const canReverse = txn.status === "SUCCESS";

  return (
    <Sheet open={!!txn} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            Transaction
            <Badge variant={statusVariant(txn.status) as LooseRow}>{txn.status}</Badge>
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-6">
          {detailError && (
            <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              <span className="font-semibold flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" /> Ledger / audit history could not be loaded
              </span>
              <p className="mt-1 text-muted-foreground">
                Sections below may be incomplete — do not treat them as evidence. {detailError}
              </p>
            </div>
          )}

          <section className="grid grid-cols-2 gap-3 text-sm">
            <Field k="ID" v={txn.id} mono />
            <Field k="Amount" v={fmtKES(txn.amount_cents, txn.currency)} />
            <Field k="Phone" v={txn.phone_number} mono />
            <Field k="Receipt" v={txn.mpesa_receipt || "—"} mono />
            <Field k="Reference" v={txn.transaction_reference || "—"} mono />
            <Field k="Provider TX" v={txn.provider_transaction_id || "—"} mono />
            <Field k="Trip Type" v={txn.trip_type || "—"} />
            <Field k="Created" v={new Date(txn.created_at).toLocaleString()} />
          </section>

          <section>
            <h3 className="font-semibold mb-2 flex items-center gap-2"><FileText className="h-4 w-4" />Ledger Journal</h3>
            {ledger.length === 0 ? <p className="text-sm text-muted-foreground">No ledger entries posted.</p> : (
              <Table>
                <TableHeader><TableRow>
                  <TableHead>Direction</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Amount</TableHead>
                </TableRow></TableHeader>
                <TableBody>
                  {ledger.map(e => (
                    <TableRow key={e.id}>
                      <TableCell><Badge variant={e.direction === "DEBIT" ? "outline" : "secondary"}>{e.direction}</Badge></TableCell>
                      <TableCell className="font-mono text-xs">{e.account_id.slice(0, 8)}…</TableCell>
                      <TableCell className="text-right font-mono">{fmtKES(e.amount_cents, e.currency)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          {risk.length > 0 && (
            <section>
              <h3 className="font-semibold mb-2 text-status-danger flex items-center gap-2"><AlertTriangle className="h-4 w-4" />Risk Flags</h3>
              <ul className="space-y-1 text-sm">
                {risk.map(r => (
                  <li key={r.id} className="flex items-center justify-between border rounded p-2">
                    <span>{r.rule}</span>
                    <Badge variant="destructive">{r.severity}</Badge>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h3 className="font-semibold mb-2">Events</h3>
            <ul className="space-y-1 text-xs">
              {events.map(e => (
                <li key={e.event_id} className="flex justify-between border-b pb-1">
                  <span className="font-mono">{e.event_type}</span>
                  <span className="text-muted-foreground">{new Date(e.created_at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="font-semibold mb-2">Audit Log</h3>
            <ul className="space-y-1 text-xs">
              {audit.map(a => (
                <li key={a.audit_id} className="flex justify-between border-b pb-1">
                  <span className="font-mono">{a.event_type}</span>
                  <span className="text-muted-foreground">{new Date(a.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>

          <div className="flex gap-2 pt-2 border-t">
            <Button variant="destructive" disabled={!canReverse} onClick={() => setReverseOpen(true)}>
              <RotateCcw className="h-4 w-4 mr-2" />Reverse
            </Button>
            <Button variant="outline" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4 mr-2" />Soft Delete
            </Button>
          </div>
        </div>

        <ReverseDialog open={reverseOpen} onClose={() => setReverseOpen(false)} txn={txn} onDone={() => { setReverseOpen(false); onChanged(); onClose(); }} />
        <SoftDeleteDialog open={deleteOpen} onClose={() => setDeleteOpen(false)} txn={txn} onDone={() => { setDeleteOpen(false); onChanged(); onClose(); }} />
      </SheetContent>
    </Sheet>
  );
}

function Field({ k, v, mono }: { k: string; v: LooseRow; mono?: boolean }) {
  return (
    <div>
      <p className="text-muted-foreground text-xs">{k}</p>
      <p className={mono ? "font-mono text-xs break-all" : ""}>{v}</p>
    </div>
  );
}

function ReverseDialog({ open, onClose, txn, onDone }: LooseRow) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 10) { toast({ title: "Reason required", description: "Please provide a clear reason (≥10 chars)." }); return; }
    setBusy(true);
    const idempotencyKey = (crypto as LooseRow)?.randomUUID?.() ?? `rev-${txn.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { data, error } = await supabase.functions.invoke("mpesa-reverse", {
      body: { transaction_id: txn.id, reason: reason.trim() },
      headers: { "Idempotency-Key": idempotencyKey },
    });
    setBusy(false);
    if (error || (data as LooseRow)?.error) { toast({ title: "Reversal failed", description: error?.message || (data as LooseRow)?.error, variant: "destructive" }); return; }
    toast({ title: "Reversed", description: "Reversal journal posted." });
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Reverse Transaction</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">This posts a balanced reversal journal and marks the transaction REVERSED. The original entries are not deleted.</p>
        <Textarea placeholder="Reason (audit log, min 10 characters)" value={reason} onChange={e => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={busy} onClick={submit}>{busy ? "Reversing…" : "Confirm Reversal"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SoftDeleteDialog({ open, onClose, txn, onDone }: LooseRow) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (reason.trim().length < 6) { toast({ title: "Reason required" }); return; }
    setBusy(true);
    const { error } = await supabase.rpc("soft_delete_mpesa_transaction", { _txn_id: txn.id, _reason: reason });
    setBusy(false);
    if (error) { toast({ title: "Failed", description: error.message, variant: "destructive" }); return; }
    toast({ title: "Deleted", description: "Transaction hidden from operational views." });
    onDone();
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Soft Delete</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">Hides the record from operational views. Audit log is preserved.</p>
        <Textarea placeholder="Reason" value={reason} onChange={e => setReason(e.target.value)} />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy} onClick={submit}>{busy ? "Deleting…" : "Confirm"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RiskPanel() {
  const [rows, setRows] = useState<LooseRow[]>([]);
  const [sev, setSev] = useState("ALL");
  const load = async () => {
    let q = supabase.from("payment_risk_events").select("*").order("created_at", { ascending: false }).limit(200);
    if (sev !== "ALL") q = q.eq("severity", sev as LooseRow);
    const { data } = await q;
    setRows(data || []);
  };
  useEffect(() => { load();   }, [sev]);

  const ack = async (id: string) => {
    const { error } = await supabase.from("payment_risk_events").update({ reviewed_at: new Date().toISOString() }).eq("id", id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <Card className="p-4 space-y-3">
      <div className="flex gap-2">
        <Select value={sev} onValueChange={setSev}>
          <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">All severities</SelectItem>
            {SEVERITIES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="outline" onClick={load}>Refresh</Button>
      </div>
      <Table>
        <TableHeader><TableRow>
          <TableHead>Time</TableHead><TableHead>Rule</TableHead><TableHead>Severity</TableHead>
          <TableHead>Transaction</TableHead><TableHead>Status</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No risk events.</TableCell></TableRow>
          ) : rows.map(r => (
            <TableRow key={r.id}>
              <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
              <TableCell>{r.rule}</TableCell>
              <TableCell><Badge variant={r.severity === "CRITICAL" || r.severity === "HIGH" ? "destructive" : "secondary"}>{r.severity}</Badge></TableCell>
              <TableCell className="font-mono text-xs">{r.transaction_id?.slice(0, 8)}…</TableCell>
              <TableCell>{r.reviewed_at ? <Badge variant="outline">ACK</Badge> : <Badge>OPEN</Badge>}</TableCell>
              <TableCell>{!r.reviewed_at && <Button size="sm" variant="outline" onClick={() => ack(r.id)}>Acknowledge</Button>}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function ReconciliationPanel() {
  const [rows, setRows] = useState<LooseRow[]>([]);
  useEffect(() => {
    supabase.from("wallet_reconciliation").select("*").order("created_at", { ascending: false }).limit(100)
      .then(({ data }) => setRows(data || []));
  }, []);
  return (
    <Card className="p-4">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Run</TableHead><TableHead>Wallet</TableHead><TableHead>Opening</TableHead>
          <TableHead>Closing</TableHead><TableHead>Expected</TableHead><TableHead>Variance</TableHead><TableHead>Status</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No reconciliation runs yet.</TableCell></TableRow>
          ) : rows.map(r => (
            <TableRow key={r.id} className={Number(r.variance) !== 0 ? "bg-status-danger/10 dark:bg-status-danger/20" : ""}>
              <TableCell className="text-xs">{new Date(r.created_at).toLocaleString()}</TableCell>
              <TableCell className="font-mono text-xs">{r.wallet_id?.slice(0, 8)}…</TableCell>
              <TableCell className="font-mono">{fmtKES(r.opening_balance)}</TableCell>
              <TableCell className="font-mono">{fmtKES(r.closing_balance)}</TableCell>
              <TableCell className="font-mono">{fmtKES(r.expected_balance)}</TableCell>
              <TableCell className="font-mono">{fmtKES(r.variance)}</TableCell>
              <TableCell><Badge variant={r.status === "OK" ? "default" : "destructive"}>{r.status}</Badge></TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
