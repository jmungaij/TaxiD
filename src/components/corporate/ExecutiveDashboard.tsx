import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Bookmark, ShieldAlert, Clock, FileText, Car, AlertTriangle, Trash2, Users, CheckCircle2, Wallet, Download, Siren } from "lucide-react";
import { DutyOfCarePanel } from "./DutyOfCarePanel";

const kes = (c: number | null | undefined) => `KES ${(Number(c || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
type Group = "cost_center" | "department" | "program" | "employee" | "trip" | "invoice" | "period" | "month" | "status";
type Drill = "spend" | "safety" | "live" | "approvals" | "compliance" | "exceptions" | "invoices" | null;
interface Filters { from: string; to: string; group: Group; drill?: Drill; minCents?: number }
interface Item { id: string; description: string | null; employee_name: string | null; cost_center: string | null; trip_origin: string | null; trip_destination: string | null; trip_ended_at: string | null; total_cents: number; invoice_number: string | null; inv_status: string | null; booking_number: string | null }
interface Summary {
  ok: boolean; error?: string;
  groups: { key: string; trips: number; total_cents: number }[];
  items: Item[];
  totals: { trips: number; total_cents: number };
  invoices: { open_cents: number; count: number };
  exceptions: number; delays: number; live_trips: number; trips_today: number;
  pending_approvals: number; active_travellers: number;
  compliance: { total: number; compliant: number; warnings: number; exceptions: number; blocked: number };
  wallet: { balance_cents: number; credit_limit_cents: number | null; mode: string | null };
  safety: { open: number; total: number; recent: { reference: string; type: string; severity: string; status: string; at: string; trip: string | null }[] };
}
interface SavedView { id: string; name: string; filters: Filters }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

const PRESETS: { name: string; f: () => Filters }[] = [
  { name: "Today's company trips", f: () => ({ from: today(), to: today(), group: "trip", drill: "live" }) },
  { name: "Pending approvals", f: () => ({ from: monthStart(), to: today(), group: "cost_center", drill: "approvals" }) },
  { name: "Policy exceptions", f: () => ({ from: monthStart(), to: today(), group: "employee", drill: "compliance" }) },
  { name: "Unpaid invoices", f: () => ({ from: monthStart(), to: today(), group: "status", drill: "invoices" }) },
  { name: "Active travellers", f: () => ({ from: monthStart(), to: today(), group: "employee", drill: "spend" }) },
  { name: "Safety alerts", f: () => ({ from: monthStart(), to: today(), group: "cost_center", drill: "safety" }) },
  { name: "High-value trips", f: () => ({ from: monthStart(), to: today(), group: "trip", drill: "spend", minCents: 300000 }) },
];

function csv(rows: Item[]) {
  const esc = (v: unknown) => { const s = String(v ?? ""); const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; return `"${safe.replace(/"/g, '""')}"`; };
  const head = ["Trip", "Traveller", "Cost centre", "From", "To", "Ended", "Invoice", "Status", "Amount KES"];
  const body = rows.map((r) => [r.booking_number ?? r.description, r.employee_name, r.cost_center, r.trip_origin, r.trip_destination, r.trip_ended_at, r.invoice_number, r.inv_status, (r.total_cents / 100).toFixed(2)].map(esc).join(","));
  const blob = new Blob([[head.join(","), ...body].join("\n")], { type: "text/csv" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `invoice-lines-${today()}.csv`; a.click();
}

export function ExecutiveDashboard({ corporateId }: { corporateId: string }) {
  const [f, setF] = useState<Filters>({ from: monthStart(), to: today(), group: "cost_center", drill: null });
  const [s, setS] = useState<Summary | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");

  const load = () => supabase.rpc("corporate_executive_summary", { _corp: corporateId, _from: f.from, _to: f.to, _group: f.group })
    .then(({ data }) => setS(data as Summary));
  const loadViews = () => supabase.from("corporate_saved_views").select("id,name,filters").eq("corporate_id", corporateId).order("created_at")
    .then(({ data }) => setViews((data ?? []) as SavedView[]));
  useEffect(() => { load(); }, [corporateId, f.from, f.to, f.group]);
  useEffect(() => { loadViews(); }, [corporateId]);

  const items = useMemo(() => (s?.items ?? []).filter((i) => !f.minCents || i.total_cents >= f.minCents), [s, f.minCents]);

  const saveView = async () => {
    if (!viewName.trim()) return;
    const { error } = await supabase.from("corporate_saved_views").insert({ corporate_id: corporateId, name: viewName.trim(), filters: f });
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" }); else { setViewName(""); loadViews(); }
  };

  if (s && !s.ok) return <Card className="p-4 text-sm">Only company admins and managers can see the executive dashboard.</Card>;
  const max = Math.max(1, ...(s?.groups ?? []).map((g) => g.total_cents));
  const c = s?.compliance;
  const compliancePct = c && c.total ? Math.round((c.compliant / c.total) * 100) : null;
  const kpi = (drill: Drill, icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <button type="button" onClick={() => setF({ ...f, drill: f.drill === drill ? null : drill })} className="text-left">
      <Card className={`p-4 h-full transition-colors hover:border-primary ${f.drill === drill ? "border-primary" : ""}`}>
        <div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div>
        <div className="text-xl font-semibold mt-1">{value}</div>
      </Card>
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-2">
        <div><div className="text-xs text-muted-foreground">From</div><Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></div>
        <div><div className="text-xs text-muted-foreground">To</div><Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
        <div><div className="text-xs text-muted-foreground">Group invoices by</div>
          <Select value={f.group} onValueChange={(v) => setF({ ...f, group: v as Group })}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="cost_center">Cost centre</SelectItem><SelectItem value="department">Department</SelectItem>
              <SelectItem value="program">Program</SelectItem><SelectItem value="employee">Traveller</SelectItem>
              <SelectItem value="trip">Trip</SelectItem><SelectItem value="invoice">Invoice group</SelectItem>
              <SelectItem value="period">Billing week</SelectItem><SelectItem value="month">Month</SelectItem>
              <SelectItem value="status">Invoice status</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input className="w-44" placeholder="Name this view" value={viewName} onChange={(e) => setViewName(e.target.value)} />
        <Button variant="outline" className="gap-1" onClick={saveView}><Bookmark className="h-4 w-4" /> Save view</Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => <Button key={p.name} size="sm" variant="outline" onClick={() => setF(p.f())}>{p.name}</Button>)}
        {views.map((v) => (
          <span key={v.id} className="inline-flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => setF(v.filters)}>{v.name}</Button>
            <Button size="icon" variant="ghost" className="h-7 w-7" aria-label={`Delete ${v.name}`} onClick={async () => { await supabase.from("corporate_saved_views").delete().eq("id", v.id); loadViews(); }}><Trash2 className="h-3 w-3" /></Button>
          </span>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {kpi("spend", <FileText className="h-3 w-3" />, "Spend in period", s ? kes(s.totals.total_cents) : "…")}
        {kpi("spend", <Car className="h-3 w-3" />, "Trips billed", s?.totals.trips ?? "…")}
        {kpi("live", <Users className="h-3 w-3" />, "Active travellers", s?.active_travellers ?? "…")}
        {kpi("live", <Car className="h-3 w-3" />, "Live trips now", s?.live_trips ?? "…")}
        {kpi("approvals", <Clock className="h-3 w-3" />, "Pending approvals", s?.pending_approvals ?? "…")}
        {kpi("compliance", <CheckCircle2 className="h-3 w-3" />, "Policy compliance", compliancePct === null ? "No checks yet" : `${compliancePct}%`)}
        {kpi("invoices", <Wallet className="h-3 w-3" />, "Wallet balance", s ? kes(s.wallet.balance_cents) : "…")}
        {kpi("invoices", <Wallet className="h-3 w-3" />, "Credit", s ? (s.wallet.mode ? `${s.wallet.mode} · ${kes(s.wallet.credit_limit_cents)}` : "No credit arrangement") : "…")}
        {kpi("invoices", <FileText className="h-3 w-3" />, "Unpaid invoices", s ? kes(s.invoices.open_cents) : "…")}
        {kpi("exceptions", <AlertTriangle className="h-3 w-3" />, "Billing exceptions", s?.exceptions ?? "…")}
        {kpi("safety", <ShieldAlert className="h-3 w-3" />, "Open safety alerts", s?.safety.open ?? "…")}
        {kpi("safety", <Siren className="h-3 w-3" />, "Late arrivals", s?.delays ?? "…")}
      </div>
      <p className="text-xs text-muted-foreground">Budget utilisation will appear once department budgets are set. Click any figure to see the records behind it.</p>

      {f.drill === "compliance" && c && (
        <Card className="p-4 text-sm">Policy checks in period: {c.total} · compliant {c.compliant} · warnings {c.warnings} · needed approval {c.exceptions} · blocked {c.blocked}</Card>
      )}
      {f.drill === "approvals" && <Card className="p-4 text-sm">{s?.pending_approvals ?? 0} items waiting. Open the Approvals tab to decide them.</Card>}
      {f.drill === "exceptions" && <Card className="p-4 text-sm">{s?.exceptions ?? 0} trips could not be charged automatically. Finance resolves these under Billing.</Card>}
      {(f.drill === "live" || f.drill === "safety") && <DutyOfCarePanel corporateId={corporateId} />}

      <div className="grid lg:grid-cols-2 gap-4">
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold">Grouped invoice spend</h3>
          {!s?.groups.length ? <p className="text-sm text-muted-foreground">No billed trips in this period.</p> : s.groups.map((g) => (
            <div key={g.key} className="text-sm">
              <div className="flex justify-between"><span>{g.key}</span><span>{kes(g.total_cents)} · {g.trips} trips</span></div>
              <div className="h-2 rounded bg-muted"><div className="h-2 rounded bg-primary" style={{ width: `${(g.total_cents / max) * 100}%` }} /></div>
            </div>
          ))}
        </Card>
        <Card className="p-4 space-y-2">
          <h3 className="font-semibold flex items-center gap-2"><ShieldAlert className="h-4 w-4" /> Safety &amp; duty of care</h3>
          <p className="text-sm text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> {s?.delays ?? 0} late-arrival alerts · {s?.safety.total ?? 0} safety incidents in period</p>
          {!s?.safety.recent.length ? <p className="text-sm text-muted-foreground">No safety incidents on company trips.</p> : s.safety.recent.slice(0, 8).map((i) => (
            <div key={i.reference} className="flex justify-between text-sm border-t pt-1">
              <span><span className="font-mono">{i.reference}</span> · {i.type?.replace(/_/g, " ")}{i.trip ? ` · ${i.trip}` : ""}</span>
              <span className="flex gap-1"><Badge variant={i.severity === "critical" ? "destructive" : "outline"}>{i.severity}</Badge><Badge variant="secondary">{i.status}</Badge></span>
            </div>
          ))}
        </Card>
      </div>

      {(f.drill === "spend" || f.drill === "invoices") && (
        <Card className="p-4 space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Invoice lines{f.minCents ? ` over ${kes(f.minCents)}` : ""}{f.drill === "invoices" ? " (unpaid)" : ""}</h3>
            <Button size="sm" variant="outline" className="gap-1" onClick={() => csv(items)} disabled={!items.length}><Download className="h-4 w-4" /> Export CSV</Button>
          </div>
          {!items.length ? <p className="text-sm text-muted-foreground">No billed trips match.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground"><th>Trip</th><th>Traveller</th><th>Cost centre</th><th>Route</th><th>Invoice</th><th className="text-right">Amount</th></tr></thead>
              <tbody>{items.filter((i) => f.drill !== "invoices" || !["paid", "void", "voided"].includes(i.inv_status ?? "")).map((i) => (
                <tr key={i.id} className="border-t"><td>{i.booking_number ?? i.description}</td><td>{i.employee_name ?? "Guest"}</td><td>{i.cost_center ?? "—"}</td>
                  <td>{i.trip_origin} → {i.trip_destination}</td><td>{i.invoice_number ?? "Draft"} · {i.inv_status}</td><td className="text-right">{kes(i.total_cents)}</td></tr>
              ))}</tbody>
            </table></div>
          )}
        </Card>
      )}
    </div>
  );
}
