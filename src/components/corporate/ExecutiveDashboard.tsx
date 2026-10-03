import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { Bookmark, ShieldAlert, Clock, FileText, Car, AlertTriangle, Trash2 } from "lucide-react";

const kes = (c: number) => `KES ${(Number(c || 0) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
type Group = "cost_center" | "department" | "employee" | "month" | "invoice";
interface Filters { from: string; to: string; group: Group }
interface Summary {
  ok: boolean; error?: string;
  groups: { key: string; trips: number; total_cents: number }[];
  totals: { trips: number; total_cents: number };
  invoices: { open_cents: number; count: number };
  exceptions: number; delays: number; live_trips: number;
  safety: { open: number; total: number; recent: { reference: string; type: string; severity: string; status: string; at: string; trip: string | null }[] };
}
interface SavedView { id: string; name: string; filters: Filters }

const today = () => new Date().toISOString().slice(0, 10);
const monthStart = () => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10); };

export function ExecutiveDashboard({ corporateId }: { corporateId: string }) {
  const [f, setF] = useState<Filters>({ from: monthStart(), to: today(), group: "cost_center" });
  const [s, setS] = useState<Summary | null>(null);
  const [views, setViews] = useState<SavedView[]>([]);
  const [viewName, setViewName] = useState("");

  const load = () => supabase.rpc("corporate_executive_summary", { _corp: corporateId, _from: f.from, _to: f.to, _group: f.group })
    .then(({ data }) => setS(data as Summary));
  const loadViews = () => supabase.from("corporate_saved_views").select("id,name,filters").eq("corporate_id", corporateId).order("created_at")
    .then(({ data }) => setViews((data ?? []) as SavedView[]));
  useEffect(() => { load(); }, [corporateId, f.from, f.to, f.group]);
  useEffect(() => { loadViews(); }, [corporateId]);

  const saveView = async () => {
    if (!viewName.trim()) return;
    const { error } = await supabase.from("corporate_saved_views").insert({ corporate_id: corporateId, name: viewName.trim(), filters: f });
    if (error) toast({ title: "Not saved", description: error.message, variant: "destructive" }); else { setViewName(""); loadViews(); }
  };

  if (s && !s.ok) return <Card className="p-4 text-sm">Only company admins and managers can see the executive dashboard.</Card>;
  const max = Math.max(1, ...(s?.groups ?? []).map((g) => g.total_cents));
  const kpi = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <Card className="p-4"><div className="text-xs text-muted-foreground flex items-center gap-1">{icon}{label}</div><div className="text-xl font-semibold mt-1">{value}</div></Card>
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
              <SelectItem value="employee">Traveller</SelectItem><SelectItem value="month">Month</SelectItem><SelectItem value="invoice">Invoice</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Input className="w-44" placeholder="Name this view" value={viewName} onChange={(e) => setViewName(e.target.value)} />
        <Button variant="outline" className="gap-1" onClick={saveView}><Bookmark className="h-4 w-4" /> Save view</Button>
      </div>
      {views.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {views.map((v) => (
            <span key={v.id} className="inline-flex items-center gap-1">
              <Button size="sm" variant="secondary" onClick={() => setF(v.filters)}>{v.name}</Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" onClick={async () => { await supabase.from("corporate_saved_views").delete().eq("id", v.id); loadViews(); }}><Trash2 className="h-3 w-3" /></Button>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {kpi(<FileText className="h-3 w-3" />, "Spend in period", s ? kes(s.totals.total_cents) : "…")}
        {kpi(<Car className="h-3 w-3" />, "Trips billed", s?.totals.trips ?? "…")}
        {kpi(<FileText className="h-3 w-3" />, "Unpaid invoices", s ? kes(s.invoices.open_cents) : "…")}
        {kpi(<Car className="h-3 w-3" />, "Live trips now", s?.live_trips ?? "…")}
        {kpi(<ShieldAlert className="h-3 w-3" />, "Open safety alerts", s?.safety.open ?? "…")}
        {kpi(<AlertTriangle className="h-3 w-3" />, "Billing exceptions", s?.exceptions ?? "…")}
      </div>

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
    </div>
  );
}
