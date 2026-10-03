import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download, Radio, UserRound } from "lucide-react";

const kes = (c: number | null | undefined) => (c == null ? "No limit" : `KES ${(Number(c) / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);

interface Profile {
  name: string | null; department: string | null; manager: string | null; group: string | null; role: string;
  per_trip_cap_cents: number | null; monthly_cap_cents: number | null; requires_approval: boolean;
  month_spend_cents: number; month_trips: number; pending_approvals: number; available_cents: number | null;
  policies: string[]; programs: { id: string; name: string }[];
}

/** Everything a travel coordinator needs about one traveller, on one card. */
export function TravellerPanel({ corporateId, employeeId }: { corporateId: string; employeeId: string }) {
  const [p, setP] = useState<Profile | null>(null);
  useEffect(() => {
    supabase.rpc("corporate_traveller_profile", { _corp: corporateId, _employee: employeeId }).then(({ data }) => setP((data as Profile) ?? null));
  }, [corporateId, employeeId]);
  if (!p) return null;
  const row = (k: string, v: React.ReactNode) => <div className="flex justify-between gap-2"><span className="text-muted-foreground">{k}</span><span className="text-right">{v}</span></div>;
  return (
    <Card className="p-3 text-sm space-y-1">
      <div className="font-semibold flex items-center gap-2"><UserRound className="h-4 w-4" />{p.name}</div>
      {row("Department", p.department ?? "—")}
      {row("Manager", p.manager ?? "—")}
      {row("Group", p.group ?? "—")}
      {row("Per-trip limit", kes(p.per_trip_cap_cents))}
      {row("Monthly limit", kes(p.monthly_cap_cents))}
      {row("Spent this month", `${kes(p.month_spend_cents)} · ${p.month_trips} trips`)}
      {row("Available", p.available_cents == null ? "No limit" : kes(p.available_cents))}
      {row("Pending approvals", p.pending_approvals)}
      {p.requires_approval && <Badge variant="secondary">Always needs approval</Badge>}
      <div className="flex flex-wrap gap-1 pt-1">
        {p.policies.map((x) => <Badge key={x} variant="outline">{x}</Badge>)}
        {p.programs.map((x) => <Badge key={x.id}>{x.name}</Badge>)}
      </div>
    </Card>
  );
}

interface BoardRow {
  source: "trip" | "desk"; id: string; ref: string | null; traveller: string; kind?: string; pickup: string; dropoff: string; status: string;
  eta: string | null; driver_assigned: boolean; vehicle: string | null; cost_cents: number; at: string; purpose: string | null;
  cost_center: string | null; project?: string | null; client?: string | null; po?: string | null;
}

const LIVE = ["pending", "scheduled", "awaiting_approval", "assigned", "driver_assigned", "en_route", "arrived", "in_progress", "pending_approval", "confirmed"];

/** Live board of the company's trips and desk bookings (last 30 days), with CSV export for finance. */
export function LiveTravelDesk({ corporateId, refreshKey = 0 }: { corporateId: string; refreshKey?: number }) {
  const [rows, setRows] = useState<BoardRow[]>([]);
  const [onlyLive, setOnlyLive] = useState(true);
  const load = () => supabase.rpc("corporate_traveldesk_board", { _corp: corporateId }).then(({ data }) => setRows((data as BoardRow[]) ?? []));
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [corporateId, refreshKey]);

  const shown = onlyLive ? rows.filter((r) => LIVE.includes(r.status)) : rows;
  const exportCsv = () => {
    const esc = (v: unknown) => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
    const head = ["Reference", "Source", "Traveller", "Pickup", "Drop-off", "Status", "When", "Cost KES", "Purpose", "Cost centre", "Project", "Client", "PO"];
    const lines = rows.map((r) => [r.ref, r.source === "trip" ? "Staff app" : "TravelDesk", r.traveller, r.pickup, r.dropoff, r.status, r.at, (r.cost_cents / 100).toFixed(2), r.purpose, r.cost_center, r.project, r.client, r.po].map(esc).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = `taxid-business-trips-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  };

  return (
    <Card className="p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold flex items-center gap-2"><Radio className="h-4 w-4" /> Live TravelDesk</h3>
        <div className="flex gap-2">
          <Button size="sm" variant={onlyLive ? "default" : "outline"} onClick={() => setOnlyLive(true)}>Active</Button>
          <Button size="sm" variant={!onlyLive ? "default" : "outline"} onClick={() => setOnlyLive(false)}>Last 30 days</Button>
          <Button size="sm" variant="outline" className="gap-1" onClick={exportCsv}><Download className="h-3 w-3" /> Export CSV</Button>
        </div>
      </div>
      {shown.length === 0 ? <p className="text-sm text-muted-foreground">No {onlyLive ? "active " : ""}trips.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground"><tr><th className="p-2">Trip</th><th className="p-2">Traveller</th><th className="p-2">Route</th><th className="p-2">Driver</th><th className="p-2">Status</th><th className="p-2">ETA</th><th className="p-2 text-right">Cost</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.source + r.id} className="border-t">
                  <td className="p-2 font-mono">{r.ref ?? "—"}<div className="text-xs text-muted-foreground font-sans">{r.source === "trip" ? "Staff app" : "TravelDesk"}</div></td>
                  <td className="p-2">{r.traveller}</td>
                  <td className="p-2">{r.pickup} → {r.dropoff}</td>
                  <td className="p-2">{r.driver_assigned ? (r.vehicle ?? "Assigned") : "—"}</td>
                  <td className="p-2"><Badge variant="outline">{r.status.replace(/_/g, " ")}</Badge></td>
                  <td className="p-2">{r.eta ? new Date(r.eta).toLocaleTimeString() : "—"}</td>
                  <td className="p-2 text-right">{kes(r.cost_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
