import type { LooseRow } from "@/lib/types/loose";
import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Car, Users, Wrench, ShieldCheck } from "lucide-react";
import {
  Workspace360Shell,
  Workspace360EmptyPanel,
  type Workspace360TabConfig,
} from "@/components/workspace360/Workspace360Shell";

/**
 * Fleet 360 — Phase D7.6 lean adoption of Workspace360Shell.
 * Wires the canonical tab surface to existing fleet tables only.
 * Reuses drivers, vehicles, maintenance, insurance, GPS, and daily-metric
 * modules already present in the platform. No new services.
 */
const kes = (c: number | null | undefined) =>
  `KES ${Math.abs((c ?? 0) / 100).toLocaleString("en-KE", { maximumFractionDigits: 0 })}`;

export default function Fleet360() {
  const { fleetId = "" } = useParams();
  const [fleet, setFleet] = useState<LooseRow | null>(null);
  const [vehicles, setVehicles] = useState<LooseRow[]>([]);
  const [drivers, setDrivers] = useState<LooseRow[]>([]);
  const [maintenance, setMaintenance] = useState<LooseRow[]>([]);
  const [insurance, setInsurance] = useState<LooseRow[]>([]);
  const [gps, setGps] = useState<LooseRow[]>([]);
  const [performance, setPerformance] = useState<LooseRow[]>([]);
  const [compliance, setCompliance] = useState<LooseRow | null>(null);
  const [documents, setDocuments] = useState<LooseRow[]>([]);
  const [audit, setAudit] = useState<LooseRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!fleetId) return;
    void (async () => {
      setLoading(true);
      const c: LooseRow = supabase;
      const { data: f } = await c
        .from("fleet_companies")
        .select("*")
        .eq("id", fleetId)
        .maybeSingle();
      setFleet(f);

      // Fleet ↔ Vehicle / Driver relationships live on the legacy `fleets`
      // table via fleet_vehicles / fleet_drivers. Resolve gracefully whether
      // the id maps to a fleet_company or a legacy fleets row.
      const { data: fv } = await c
        .from("fleet_vehicles").select("vehicle_id,added_at").eq("fleet_id", fleetId).limit(200);
      const vehicleIds = ((fv as LooseRow[]) ?? []).map((r) => r.vehicle_id);
      const { data: fd } = await c
        .from("fleet_drivers").select("driver_id,added_at").eq("fleet_id", fleetId).limit(200);
      const driverIds = ((fd as LooseRow[]) ?? []).map((r) => r.driver_id);

      const [veh, drv, maint, ins, loc, perf, comp, docs] = await Promise.all([
        vehicleIds.length
          ? c.from("vehicles").select("id,make,model,year,number_plate,vehicle_status,vehicle_type").in("id", vehicleIds)
          : Promise.resolve({ data: [] }),
        driverIds.length
          ? c.from("drivers").select("id,full_name,phone_number,status,rating").in("id", driverIds)
          : Promise.resolve({ data: [] }),
        vehicleIds.length
          ? c.from("vehicle_maintenance").select("id,vehicle_id,category,description,performed_at,next_due_at,cost_cents").in("vehicle_id", vehicleIds).order("performed_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [] }),
        driverIds.length
          ? c.from("driver_insurance").select("id,driver_id,product,provider,status,premium_cents,starts_at,ends_at").in("driver_id", driverIds).order("ends_at", { ascending: false }).limit(100)
          : Promise.resolve({ data: [] }),
        driverIds.length
          ? c.from("driver_locations").select("driver_id,lat,lng,is_online,is_available,updated_at").in("driver_id", driverIds).limit(200)
          : Promise.resolve({ data: [] }),
        c.from("fleet_performance").select("id,metric_date,active_vehicles,active_drivers,total_trips,total_revenue_cents,utilization_pct,avg_rating").eq("fleet_company_id", fleetId).order("metric_date", { ascending: false }).limit(30),
        c.from("fleet_compliance").select("*").eq("fleet_company_id", fleetId).maybeSingle(),
        vehicleIds.length
          ? c.from("vehicle_documents").select("id,vehicle_id,document_number,verification_status,issue_date,expiry_date").in("vehicle_id", vehicleIds).order("expiry_date", { ascending: false }).limit(100)
          : Promise.resolve({ data: [] }),
      ]);
      const vehicleRows = ((veh as LooseRow).data as LooseRow[]) ?? [];
      const driverRows = ((drv as LooseRow).data as LooseRow[]) ?? [];
      const maintRows = ((maint as LooseRow).data as LooseRow[]) ?? [];
      const insRows = ((ins as LooseRow).data as LooseRow[]) ?? [];
      const locRows = ((loc as LooseRow).data as LooseRow[]) ?? [];
      const perfRows = ((perf as LooseRow).data as LooseRow[]) ?? [];
      const docRows = ((docs as LooseRow).data as LooseRow[]) ?? [];
      setVehicles(vehicleRows);
      setDrivers(driverRows);
      setMaintenance(maintRows);
      setInsurance(insRows);
      setGps(locRows);
      setPerformance(perfRows);
      setCompliance((comp as LooseRow).data ?? null);
      setDocuments(docRows);

      const events: LooseRow[] = [];
      maintRows.forEach((m) =>
        events.push({ ts: m.performed_at, kind: "maintenance", label: `${m.category} · ${kes(m.cost_cents)}` }));
      insRows.forEach((i) =>
        events.push({ ts: i.starts_at, kind: "insurance", label: `${i.provider} · ${i.status}` }));
      docRows.forEach((d) =>
        events.push({ ts: d.issue_date ?? d.expiry_date, kind: "document", label: `${d.document_number ?? "doc"} · ${d.verification_status}` }));
      perfRows.forEach((p) =>
        events.push({ ts: p.metric_date, kind: "performance", label: `${p.total_trips} trips · ${kes(p.total_revenue_cents)}` }));
      events.sort((a, b) => (String(a.ts) < String(b.ts) ? 1 : -1));
      setAudit(events.slice(0, 100));
      setLoading(false);
    })();
  }, [fleetId]);

  if (loading) return <div className="p-8 text-muted-foreground">Loading fleet…</div>;
  if (!fleet)
    return (
      <div className="p-8">
        Fleet not found.{" "}
        <Link className="underline" to="/dashboard/admin/fleet">Back</Link>
      </div>
    );

  const displayName = fleet.trading_name || fleet.legal_name || "Fleet";
  const initials = displayName.slice(0, 2).toUpperCase();
  const activeVehicles = vehicles.filter((v) => v.vehicle_status === "active").length;
  const onlineDrivers = gps.filter((g) => g.is_online).length;
  const latestPerf = performance[0];

  const tabs: Workspace360TabConfig[] = [
    {
      tab: "overview",
      render: () => (
        <div className="grid md:grid-cols-4 gap-3">
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Vehicles</div>
            <div className="text-xl font-semibold">{vehicles.length}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Drivers</div>
            <div className="text-xl font-semibold">{drivers.length}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Online now</div>
            <div className="text-xl font-semibold">{onlineDrivers}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Compliance score</div>
            <div className="text-xl font-semibold">{compliance?.compliance_score ?? "—"}</div>
          </CardContent></Card>
        </div>
      ),
    },
    {
      tab: "financial",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Date</TableHead><TableHead>Trips</TableHead>
              <TableHead>Revenue</TableHead><TableHead>Utilization</TableHead>
              <TableHead>Rating</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {performance.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="text-xs">{p.metric_date}</TableCell>
                  <TableCell>{p.total_trips ?? 0}</TableCell>
                  <TableCell>{kes(p.total_revenue_cents)}</TableCell>
                  <TableCell className="text-xs">{p.utilization_pct ?? 0}%</TableCell>
                  <TableCell className="text-xs">{p.avg_rating ?? "—"}</TableCell>
                </TableRow>
              ))}
              {performance.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No revenue data.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "timeline",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Source</TableHead><TableHead>Event</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {audit.map((e, i) => (
                <TableRow key={`${e.kind}-${i}`}>
                  <TableCell className="text-xs">{e.ts ? new Date(e.ts).toLocaleString() : "—"}</TableCell>
                  <TableCell><Badge variant="outline">{e.kind}</Badge></TableCell>
                  <TableCell className="text-xs">{e.label}</TableCell>
                </TableRow>
              ))}
              {audit.length === 0 && (
                <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">No events.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "documents",
      render: () => (
        <Card><CardContent className="pt-4">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Number</TableHead><TableHead>Status</TableHead>
              <TableHead>Issued</TableHead><TableHead>Expires</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {documents.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-mono text-xs">{d.document_number ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{d.verification_status}</Badge></TableCell>
                  <TableCell className="text-xs">{d.issue_date ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.expiry_date ?? "—"}</TableCell>
                </TableRow>
              ))}
              {documents.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No vehicle documents.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "compliance",
      render: () => (
        <Card><CardContent className="pt-4 space-y-3">
          <div className="grid md:grid-cols-3 gap-3">
            <div><div className="text-xs text-muted-foreground">Score</div><div className="text-xl font-semibold">{compliance?.compliance_score ?? "—"}</div></div>
            <div><div className="text-xs text-muted-foreground">Expired documents</div><div className="text-xl font-semibold">{compliance?.expired_documents ?? 0}</div></div>
            <div><div className="text-xs text-muted-foreground">Open incidents</div><div className="text-xl font-semibold">{compliance?.open_incidents ?? 0}</div></div>
          </div>
          <div className="text-xs text-muted-foreground">Insurance policies</div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Provider</TableHead><TableHead>Product</TableHead>
              <TableHead>Status</TableHead><TableHead>Expires</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {insurance.map((i) => (
                <TableRow key={i.id}>
                  <TableCell className="text-xs">{i.provider}</TableCell>
                  <TableCell className="text-xs">{i.product}</TableCell>
                  <TableCell><Badge variant="outline">{i.status}</Badge></TableCell>
                  <TableCell className="text-xs">{i.ends_at ?? "—"}</TableCell>
                </TableRow>
              ))}
              {insurance.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No insurance policies.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "performance",
      render: () => (
        <div className="grid md:grid-cols-3 gap-3">
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Latest trips</div>
            <div className="text-xl font-semibold">{latestPerf?.total_trips ?? 0}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Latest revenue</div>
            <div className="text-xl font-semibold">{kes(latestPerf?.total_revenue_cents)}</div>
          </CardContent></Card>
          <Card><CardContent className="pt-4 text-sm">
            <div className="text-muted-foreground text-xs mb-1">Utilization</div>
            <div className="text-xl font-semibold">{latestPerf?.utilization_pct ?? 0}%</div>
          </CardContent></Card>
        </div>
      ),
    },
    {
      tab: "support",
      render: () => (
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground mb-2">Vehicles ({vehicles.length})</div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Plate</TableHead><TableHead>Make/Model</TableHead>
              <TableHead>Year</TableHead><TableHead>Status</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {vehicles.map((v) => (
                <TableRow key={v.id}>
                  <TableCell className="font-mono text-xs">{v.number_plate ?? "—"}</TableCell>
                  <TableCell className="text-xs">{v.make} {v.model}</TableCell>
                  <TableCell className="text-xs">{v.year ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{v.vehicle_status}</Badge></TableCell>
                </TableRow>
              ))}
              {vehicles.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No vehicles.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <div className="text-xs text-muted-foreground mt-4 mb-2">Drivers ({drivers.length})</div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>Name</TableHead><TableHead>Phone</TableHead>
              <TableHead>Status</TableHead><TableHead>Rating</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {drivers.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="text-xs">{d.full_name ?? "—"}</TableCell>
                  <TableCell className="text-xs">{d.phone_number ?? "—"}</TableCell>
                  <TableCell><Badge variant="outline">{d.status}</Badge></TableCell>
                  <TableCell className="text-xs">{d.rating ?? "—"}</TableCell>
                </TableRow>
              ))}
              {drivers.length === 0 && (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-6">No drivers.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "analytics",
      render: () => (
        <Workspace360EmptyPanel
          title="Analytics"
          description="Fleet analytics roll-ups will surface here in a later phase."
        />
      ),
    },
    {
      tab: "twin",
      render: () => (
        <Workspace360EmptyPanel
          title="Digital Twin"
          description="Fleet Digital Twin scenarios will surface here."
        />
      ),
    },
    {
      tab: "audit",
      render: () => (
        <Card><CardContent className="pt-4">
          <div className="text-xs text-muted-foreground mb-2">Maintenance history</div>
          <Table>
            <TableHeader><TableRow>
              <TableHead>When</TableHead><TableHead>Category</TableHead>
              <TableHead>Description</TableHead><TableHead>Cost</TableHead>
              <TableHead>Next due</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {maintenance.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{m.performed_at ? new Date(m.performed_at).toLocaleDateString() : "—"}</TableCell>
                  <TableCell className="text-xs">{m.category}</TableCell>
                  <TableCell className="text-xs">{m.description ?? "—"}</TableCell>
                  <TableCell>{kes(m.cost_cents)}</TableCell>
                  <TableCell className="text-xs">{m.next_due_at ?? "—"}</TableCell>
                </TableRow>
              ))}
              {maintenance.length === 0 && (
                <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground py-6">No maintenance records.</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent></Card>
      ),
    },
    {
      tab: "settings",
      render: () => (
        <Workspace360EmptyPanel
          title="Settings"
          description="Fleet preferences and account controls will surface here."
        />
      ),
    },
  ];

  return (
    <Workspace360Shell
      domain="fleet"
      entityId={fleetId}
      title={displayName}
      subtitle={`${fleet.registration_number ?? "—"} · ${fleet.entity_type ?? "fleet"}`}
      initials={initials}
      statusBadges={[{ label: fleet.status ?? "unknown" }]}
      kpis={[
        { icon: Car, label: "Vehicles", value: `${activeVehicles}/${vehicles.length}` },
        { icon: Users, label: "Drivers", value: String(drivers.length) },
        { icon: Wrench, label: "Maintenance", value: String(maintenance.length) },
        { icon: ShieldCheck, label: "Compliance", value: String(compliance?.compliance_score ?? "—") },
      ]}
      tabs={tabs}
      directoryLabel="Fleets"
    />
  );
}
