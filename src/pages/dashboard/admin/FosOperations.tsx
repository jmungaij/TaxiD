import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/hooks/use-toast";
import { Banknote, Scale, Receipt, AlertOctagon, ShieldCheck, FileBarChart2, Globe2 } from "lucide-react";

const fmt = (cents: number, currency = "KES") =>
  new Intl.NumberFormat("en-KE", { style: "currency", currency }).format((cents || 0) / 100);

export default function FosOperations() {
  const { loading, isAnyAdmin } = useAuth();
  if (loading) return <div className="p-6"><Skeleton className="h-8 w-64" /></div>;
  if (!isAnyAdmin) return <Navigate to="/dashboard" replace />;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Financial Operating System</h1>
        <p className="text-sm text-muted-foreground">
          Treasury, settlements, revenue, disputes, ledger integrity, and regulatory ops.
        </p>
      </header>

      <Tabs defaultValue="treasury">
        <TabsList className="flex-wrap">
          <TabsTrigger value="treasury"><Banknote className="h-4 w-4 mr-2" />Treasury</TabsTrigger>
          <TabsTrigger value="settlements"><Scale className="h-4 w-4 mr-2" />Settlements</TabsTrigger>
          <TabsTrigger value="revenue"><Receipt className="h-4 w-4 mr-2" />Revenue</TabsTrigger>
          <TabsTrigger value="disputes"><AlertOctagon className="h-4 w-4 mr-2" />Disputes</TabsTrigger>
          <TabsTrigger value="integrity"><ShieldCheck className="h-4 w-4 mr-2" />Ledger Integrity</TabsTrigger>
          <TabsTrigger value="fx"><Globe2 className="h-4 w-4 mr-2" />FX</TabsTrigger>
          <TabsTrigger value="regulatory"><FileBarChart2 className="h-4 w-4 mr-2" />Regulatory</TabsTrigger>
        </TabsList>

        <TabsContent value="treasury" className="mt-4"><TreasuryPanel /></TabsContent>
        <TabsContent value="settlements" className="mt-4"><SettlementsPanel /></TabsContent>
        <TabsContent value="revenue" className="mt-4"><RevenuePanel /></TabsContent>
        <TabsContent value="disputes" className="mt-4"><DisputesPanel /></TabsContent>
        <TabsContent value="integrity" className="mt-4"><IntegrityPanel /></TabsContent>
        <TabsContent value="fx" className="mt-4"><FxPanel /></TabsContent>
        <TabsContent value="regulatory" className="mt-4"><RegulatoryPanel /></TabsContent>
      </Tabs>
    </div>
  );
}

function TreasuryPanel() {
  const [accounts, setAccounts] = useState<LooseRow[]>([]);
  const [positions, setPositions] = useState<LooseRow[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.from("treasury_accounts").select("*").eq("active", true).order("kind"),
      supabase.from("treasury_positions").select("*").order("as_of", { ascending: false }).limit(50),
    ]).then(([a, p]) => { setAccounts(a.data || []); setPositions(p.data || []); });
  }, []);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Treasury Accounts</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Name</TableHead><TableHead>Kind</TableHead><TableHead>Currency</TableHead><TableHead>Provider</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {accounts.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No treasury accounts configured.</TableCell></TableRow> :
              accounts.map(a => (
                <TableRow key={a.id}>
                  <TableCell>{a.name}</TableCell>
                  <TableCell><Badge variant="outline">{a.kind}</Badge></TableCell>
                  <TableCell>{a.currency}</TableCell>
                  <TableCell>{a.provider || "—"}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Latest Positions</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>As of</TableHead><TableHead>Account</TableHead><TableHead className="text-right">Opening</TableHead>
            <TableHead className="text-right">Inflows</TableHead><TableHead className="text-right">Outflows</TableHead><TableHead className="text-right">Closing</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {positions.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No positions snapshotted yet.</TableCell></TableRow> :
              positions.map(p => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{p.as_of}</TableCell>
                  <TableCell className="font-mono text-xs">{p.account_id.slice(0,8)}…</TableCell>
                  <TableCell className="text-right font-mono">{fmt(p.opening_cents, p.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-status-success">{fmt(p.inflows_cents, p.currency)}</TableCell>
                  <TableCell className="text-right font-mono text-status-danger">{fmt(p.outflows_cents, p.currency)}</TableCell>
                  <TableCell className="text-right font-mono font-semibold">{fmt(p.closing_cents, p.currency)}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function SettlementsPanel() {
  const [batches, setBatches] = useState<LooseRow[]>([]);
  const [recon, setRecon] = useState<LooseRow[]>([]);
  const load = () => Promise.all([
    supabase.from("settlement_batches").select("*").order("cutoff_at", { ascending: false }).limit(50),
    supabase.from("settlement_reconciliation").select("*").order("ran_at", { ascending: false }).limit(50),
  ]).then(([b, r]) => { setBatches(b.data || []); setRecon(r.data || []); });
  useEffect(() => { load(); }, []);

  const reconcile = async (id: string) => {
    const { error } = await supabase.rpc("reconcile_settlement_batch", { _batch_id: id });
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Reconciled" }); load(); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Settlement Batches</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Provider</TableHead><TableHead>Batch Ref</TableHead><TableHead>Cutoff</TableHead>
            <TableHead className="text-right">Count</TableHead><TableHead className="text-right">Amount</TableHead>
            <TableHead>Status</TableHead><TableHead></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {batches.length === 0 ? <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-6">No settlement batches.</TableCell></TableRow> :
              batches.map(b => (
                <TableRow key={b.id}>
                  <TableCell>{b.provider}</TableCell>
                  <TableCell className="font-mono text-xs">{b.batch_ref}</TableCell>
                  <TableCell className="text-xs">{new Date(b.cutoff_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right">{b.total_count}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(b.total_amount_cents, b.currency)}</TableCell>
                  <TableCell><Badge>{b.status}</Badge></TableCell>
                  <TableCell>
                    {["OPEN","SETTLED","FAILED"].includes(b.status) && (
                      <Button size="sm" variant="outline" onClick={() => reconcile(b.id)}>Reconcile</Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Recent Reconciliation Runs</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Ran</TableHead><TableHead>Batch</TableHead><TableHead className="text-right">Expected</TableHead>
            <TableHead className="text-right">Actual</TableHead><TableHead className="text-right">Variance</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {recon.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No reconciliations yet.</TableCell></TableRow> :
              recon.map(r => (
                <TableRow key={r.id} className={r.status !== "OK" ? "bg-status-danger/10 dark:bg-status-danger/20" : ""}>
                  <TableCell className="text-xs">{new Date(r.ran_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{r.batch_id.slice(0,8)}…</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.expected_amount_cents)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.actual_amount_cents)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(r.variance_cents)}</TableCell>
                  <TableCell><Badge variant={r.status === "OK" ? "default" : "destructive"}>{r.status}</Badge></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function RevenuePanel() {
  const [events, setEvents] = useState<LooseRow[]>([]);
  const [commissions, setCommissions] = useState<LooseRow[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.from("revenue_events").select("*").order("occurred_at", { ascending: false }).limit(50),
      supabase.from("commission_calculations").select("*").order("calculated_at", { ascending: false }).limit(50),
    ]).then(([e, c]) => { setEvents(e.data || []); setCommissions(c.data || []); });
  }, []);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Revenue Events</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Type</TableHead><TableHead>Occurred</TableHead><TableHead className="text-right">Gross</TableHead><TableHead>Status</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {events.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No revenue events recognized yet.</TableCell></TableRow> :
              events.map(e => (
                <TableRow key={e.id}>
                  <TableCell><Badge variant="outline">{e.event_type}</Badge></TableCell>
                  <TableCell className="text-xs">{new Date(e.occurred_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(e.gross_amount_cents, e.currency)}</TableCell>
                  <TableCell><Badge>{e.status}</Badge></TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Commission Calculations</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>When</TableHead><TableHead className="text-right">Driver Share</TableHead>
            <TableHead className="text-right">Commission</TableHead><TableHead className="text-right">Rate</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {commissions.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">None yet.</TableCell></TableRow> :
              commissions.map(c => (
                <TableRow key={c.id}>
                  <TableCell className="text-xs">{new Date(c.calculated_at).toLocaleString()}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(c.driver_share_cents, c.currency)}</TableCell>
                  <TableCell className="text-right font-mono">{fmt(c.commission_cents, c.currency)}</TableCell>
                  <TableCell className="text-right">{c.commission_rate ? `${(c.commission_rate * 100).toFixed(2)}%` : "—"}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function DisputesPanel() {
  const [rows, setRows] = useState<LooseRow[]>([]);
  const load = () => supabase.from("payment_disputes").select("*").order("created_at", { ascending: false }).limit(100).then(({ data }) => setRows(data || []));
  useEffect(() => { load(); }, []);

  const update = async (id: string, status: string) => {
    const { error } = await supabase.from("payment_disputes").update({ status: status as LooseRow, resolved_at: ["RESOLVED","REJECTED"].includes(status) ? new Date().toISOString() : null }).eq("id", id);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else load();
  };

  return (
    <Card className="p-4">
      <Table>
        <TableHeader><TableRow>
          <TableHead>Created</TableHead><TableHead>Reason</TableHead><TableHead className="text-right">Amount</TableHead>
          <TableHead>Status</TableHead><TableHead>Description</TableHead><TableHead></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {rows.length === 0 ? <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">No disputes raised.</TableCell></TableRow> :
            rows.map(d => (
              <TableRow key={d.id}>
                <TableCell className="text-xs">{new Date(d.created_at).toLocaleString()}</TableCell>
                <TableCell><Badge variant="outline">{d.reason}</Badge></TableCell>
                <TableCell className="text-right font-mono">{fmt(d.amount_cents, d.currency)}</TableCell>
                <TableCell><Badge>{d.status}</Badge></TableCell>
                <TableCell className="max-w-xs truncate text-sm">{d.description}</TableCell>
                <TableCell className="space-x-1">
                  {!["RESOLVED","REJECTED"].includes(d.status) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => update(d.id, "INVESTIGATING")}>Investigate</Button>
                      <Button size="sm" onClick={() => update(d.id, "RESOLVED")}>Resolve</Button>
                      <Button size="sm" variant="destructive" onClick={() => update(d.id, "REJECTED")}>Reject</Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
        </TableBody>
      </Table>
    </Card>
  );
}

function IntegrityPanel() {
  const [hashes, setHashes] = useState<LooseRow[]>([]);
  const [breaks, setBreaks] = useState<LooseRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => supabase.from("audit_hashes").select("*").order("as_of", { ascending: false }).limit(50).then(({ data }) => setHashes(data || []));
  useEffect(() => { load(); }, []);

  const snapshot = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("snapshot_audit_hash", { _notes: "manual snapshot" });
    setBusy(false);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { toast({ title: "Snapshot taken" }); load(); }
  };
  const verify = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("verify_ledger_chain", { _from: null, _to: null });
    setBusy(false);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else { setBreaks(data || []); toast({ title: (data?.length || 0) === 0 ? "Chain intact" : `${data.length} break(s) found`, variant: (data?.length || 0) === 0 ? "default" : "destructive" }); }
  };

  return (
    <div className="space-y-4">
      <Card className="p-4 flex items-center gap-3">
        <Button onClick={snapshot} disabled={busy}>Take Chain Snapshot</Button>
        <Button variant="outline" onClick={verify} disabled={busy}>Verify Ledger Chain</Button>
        {breaks !== null && <Badge variant={breaks.length === 0 ? "default" : "destructive"}>{breaks.length === 0 ? "✓ Chain intact" : `⚠ ${breaks.length} break(s)`}</Badge>}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Audit Chain Snapshots</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>As of</TableHead><TableHead>Entries</TableHead><TableHead>Root (hex)</TableHead><TableHead>Notes</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {hashes.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No snapshots yet.</TableCell></TableRow> :
              hashes.map(h => (
                <TableRow key={h.id}>
                  <TableCell className="text-xs">{new Date(h.as_of).toLocaleString()}</TableCell>
                  <TableCell>{h.entry_count}</TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-xs">{String(h.chain_root).slice(0, 32)}…</TableCell>
                  <TableCell className="text-xs">{h.notes}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function FxPanel() {
  const [currencies, setCurrencies] = useState<LooseRow[]>([]);
  const [rates, setRates] = useState<LooseRow[]>([]);
  useEffect(() => {
    Promise.all([
      supabase.from("currencies").select("*").order("code"),
      supabase.from("exchange_rates").select("*").order("rate_date", { ascending: false }).limit(50),
    ]).then(([c, r]) => { setCurrencies(c.data || []); setRates(r.data || []); });
  }, []);
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Currencies</h3>
        <div className="flex flex-wrap gap-2">
          {currencies.map(c => (
            <Badge key={c.code} variant={c.is_base ? "default" : "outline"}>
              {c.code} — {c.name}{c.is_base && " (base)"}
            </Badge>
          ))}
        </div>
      </Card>
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Recent Exchange Rates</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Date</TableHead><TableHead>Pair</TableHead><TableHead className="text-right">Rate</TableHead><TableHead>Type</TableHead><TableHead>Provider</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {rates.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No rates loaded yet.</TableCell></TableRow> :
              rates.map(r => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.rate_date}</TableCell>
                  <TableCell className="font-mono">{r.base_currency}/{r.quote_currency}</TableCell>
                  <TableCell className="text-right font-mono">{Number(r.rate).toFixed(6)}</TableCell>
                  <TableCell><Badge variant="outline">{r.rate_type}</Badge></TableCell>
                  <TableCell className="text-xs">{r.provider}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function RegulatoryPanel() {
  const [reports, setReports] = useState<LooseRow[]>([]);
  const [exports, setExports] = useState<LooseRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [vat, setVat] = useState<any>(null);
  const [from, setFrom] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  useEffect(() => {
    Promise.all([
      supabase.from("regulatory_reports").select("*").order("kind"),
      supabase.from("regulatory_exports").select("*").order("generated_at", { ascending: false }).limit(50),
    ]).then(([r, e]) => { setReports(r.data || []); setExports(e.data || []); });
  }, []);

  const runVat = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("generate_vat_report", { _period_start: from, _period_end: to });
    setBusy(false);
    if (error) toast({ title: "Failed", description: error.message, variant: "destructive" });
    else setVat(data);
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <h3 className="font-semibold mb-3">Report Catalog</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Kind</TableHead><TableHead>Name</TableHead><TableHead>Regulator</TableHead><TableHead>Cadence</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {reports.map(r => (
              <TableRow key={r.id}>
                <TableCell><Badge variant="outline">{r.kind}</Badge></TableCell>
                <TableCell>{r.name}</TableCell>
                <TableCell>{r.regulator}</TableCell>
                <TableCell>{r.cadence}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Card className="p-4 space-y-3">
        <h3 className="font-semibold">Quick: VAT Aggregation</h3>
        <div className="flex flex-wrap gap-2 items-center">
          <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="w-44" />
          <span>→</span>
          <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="w-44" />
          <Button onClick={runVat} disabled={busy}>{busy ? "Running…" : "Run VAT report"}</Button>
        </div>
        {vat && (
          <pre className="text-xs bg-muted p-3 rounded overflow-x-auto">{JSON.stringify(vat, null, 2)}</pre>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="font-semibold mb-3">Recent Exports</h3>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Generated</TableHead><TableHead>Report</TableHead><TableHead>Period</TableHead><TableHead>Format</TableHead><TableHead>SHA-256</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {exports.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No exports yet.</TableCell></TableRow> :
              exports.map(e => (
                <TableRow key={e.id}>
                  <TableCell className="text-xs">{new Date(e.generated_at).toLocaleString()}</TableCell>
                  <TableCell className="font-mono text-xs">{e.report_id.slice(0,8)}…</TableCell>
                  <TableCell className="text-xs">{e.period_start} → {e.period_end}</TableCell>
                  <TableCell><Badge>{e.format}</Badge></TableCell>
                  <TableCell className="font-mono text-xs truncate max-w-xs">{e.sha256 || "—"}</TableCell>
                </TableRow>
              ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
