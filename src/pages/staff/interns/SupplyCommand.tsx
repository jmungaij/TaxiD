/**
 * INTERNS 360 → DESTINATIONS MANAGEMENT, MOBILITY SUPPLY & FLEET DEVELOPMENT.
 *
 * The supply cockpit for the DMFD-INT-2608 programme. Every figure on this page
 * comes from an authoritative record or from the database scoring function
 * `intern_supply_score` — the browser computes no score, no activation and no
 * revenue. Verified revenue stays KES 0 unless an authoritative financial
 * record is attached, and demonstration cohorts are labelled DEMO / TEST DATA.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, MapPin, ShieldAlert, Truck, Users } from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";

import {
  COMMERCIAL_PIPELINE, DMFD_COHORT_NAME, DRIVER_PIPELINE, FLEET_PIPELINE,
  cohortKpis, fetchDestinationProfiles, fetchDriverProspects, fetchFieldAssignments,
  fetchFleetSuppliers, fetchSupplyCohorts, fetchSupplyMetrics, fetchSupplyOpportunities,
  fetchSupplyScore, pipelineCounts, rankInterns, scanSupplyIntegrity, stageLabel,
} from "@/lib/interns/supply";
import { DMFD_SUPPLY_SCORE_WEIGHTS, DMFD_PERFORMANCE_WEIGHTS } from "@/lib/interns/seeds/destinationsMobilitySupply";

const kes = (n: number) =>
  `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(n)}`;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="glass-panel rounded-xl border border-border/60 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function Pipeline({ title, rows, icon }: { title: string; rows: Array<{ label: string; count: number }>; icon: React.ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">{icon}{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="space-y-1">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="font-medium tabular-nums">{r.count}</span>
            </div>
            <Progress value={(r.count / max) * 100} className="h-1.5" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function SupplyCommand() {
  const qc = useQueryClient();
  const cohorts = useQuery({ queryKey: ["supply-cohorts"], queryFn: fetchSupplyCohorts });
  const [cohortId, setCohortId] = useState<string>("");

  const activeCohortId = useMemo(() => {
    if (cohortId) return cohortId;
    const list = cohorts.data ?? [];
    return list.find((c) => c.name === DMFD_COHORT_NAME)?.id ?? list[0]?.id ?? "";
  }, [cohortId, cohorts.data]);

  const cohort = (cohorts.data ?? []).find((c) => c.id === activeCohortId);
  const enabled = Boolean(activeCohortId);

  const metrics = useQuery({ queryKey: ["supply-metrics", activeCohortId], queryFn: () => fetchSupplyMetrics(activeCohortId), enabled });
  const prospects = useQuery({ queryKey: ["supply-prospects", activeCohortId], queryFn: () => fetchDriverProspects(activeCohortId), enabled });
  const suppliers = useQuery({ queryKey: ["supply-suppliers", activeCohortId], queryFn: () => fetchFleetSuppliers(activeCohortId), enabled });
  const destinations = useQuery({ queryKey: ["supply-destinations", activeCohortId], queryFn: () => fetchDestinationProfiles(activeCohortId), enabled });
  const opportunities = useQuery({ queryKey: ["supply-opportunities", activeCohortId], queryFn: () => fetchSupplyOpportunities(activeCohortId), enabled });
  const fieldwork = useQuery({ queryKey: ["supply-fieldwork", activeCohortId], queryFn: () => fetchFieldAssignments(activeCohortId), enabled });

  const rows = metrics.data ?? [];
  const kpis = useMemo(() => cohortKpis(rows), [rows]);

  /** Server-computed scores, one authoritative call per intern. */
  const scores = useQuery({
    queryKey: ["supply-scores", activeCohortId, rows.map((r) => r.intern_id).join(",")],
    enabled: enabled && rows.length > 0,
    queryFn: async () => {
      const out = await Promise.all(
        rows.map(async (r) => ({
          ...(await fetchSupplyScore(r.intern_id)),
          full_name: r.full_name,
          track_name: r.track_name,
        })),
      );
      return rankInterns(out);
    },
  });

  const scan = useMutation({
    mutationFn: () => scanSupplyIntegrity(activeCohortId),
    onSuccess: (r) => {
      toast.success(`${r.flags_raised} finding(s) raised — INTEGRITY REVIEW REQUIRED`, { description: r.note });
      qc.invalidateQueries({ queryKey: ["intern-integrity"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const driverStages = pipelineCounts(prospects.data ?? [], DRIVER_PIPELINE);
  const fleetStages = pipelineCounts(
    (suppliers.data ?? []).map((s) => ({ ...s, stage: s.supplier_status })),
    FLEET_PIPELINE,
  );
  const commercialStages = pipelineCounts(opportunities.data ?? [], COMMERCIAL_PIPELINE);

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Staff 360 · Interns 360"
        title="Destinations Management, Mobility Supply & Fleet Development"
        lede="DMFD-INT-2608 · 24 weeks · Nairobi · hybrid / field. Interns build verified mobility supply — drivers, vehicles, fleet suppliers and destination capacity — for corporate mobility, airport transfers, charter, rentals & leasing and logistics."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Select value={activeCohortId} onValueChange={setCohortId}>
              <SelectTrigger className="w-[240px]"><SelectValue placeholder="Select cohort" /></SelectTrigger>
              <SelectContent>
                {(cohorts.data ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name} · {c.status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" onClick={() => scan.mutate()} disabled={!enabled || scan.isPending}>
              <ShieldAlert className="mr-2 h-4 w-4" aria-hidden="true" />
              {scan.isPending ? "Scanning…" : "Run integrity scan"}
            </Button>
            <Button asChild>
              <Link to="/staff/recruitment/internships/new">Open programme builder<ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" /></Link>
            </Button>
          </div>
        }
      />

      {kpis.demoOnly ? (
        <Card className="mb-6 border-warning/50">
          <CardContent className="flex flex-wrap items-center gap-3 py-4 text-sm">
            <Badge variant="outline">DEMO / TEST DATA</Badge>
            <span className="text-muted-foreground">
              Every record in this cohort is seeded demonstration data. No real driver acquisition, fleet activation, customer or
              revenue is claimed — verified revenue remains {kes(0)} because no authoritative financial record is attached.
            </span>
          </CardContent>
        </Card>
      ) : null}

      {metrics.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-24 rounded-xl" />)}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi label="Active interns" value={String(kpis.activeInterns)} hint={cohort?.name ?? "—"} />
          <Kpi label="Driver prospects" value={String(kpis.driverProspects)} />
          <Kpi label="Qualified drivers" value={String(kpis.qualifiedDrivers)} />
          <Kpi label="Drivers in onboarding" value={String(kpis.driversOnboarding)} />
          <Kpi label="Activated drivers" value={String(kpis.driversActivated)} hint="Activation is performed by authorised staff only" />
          <Kpi label="Fleet suppliers" value={String(kpis.fleetSuppliers)} />
          <Kpi label="Vehicles mapped" value={String(kpis.vehiclesMapped)} hint={`${kpis.verifiedFleetCapacity} verified capacity`} />
          <Kpi label="Destination profiles" value={String(kpis.destinationProfiles)} hint="Accepted profiles only" />
          <Kpi label="Commercial opportunities" value={String(kpis.opportunities)} />
          <Kpi label="Verified revenue" value={kes(kpis.verifiedRevenueKes)} hint="Finance records only — never self-declared" />
        </div>
      )}

      <Tabs defaultValue="pipelines" className="mt-8">
        <TabsList className="flex-wrap">
          <TabsTrigger value="pipelines">Supply pipelines</TabsTrigger>
          <TabsTrigger value="ranking">Cohort ranking</TabsTrigger>
          <TabsTrigger value="destinations">Destination matrix</TabsTrigger>
          <TabsTrigger value="fieldwork">Fieldwork</TabsTrigger>
          <TabsTrigger value="model">Scoring model</TabsTrigger>
        </TabsList>

        <TabsContent value="pipelines" className="mt-4 grid gap-4 lg:grid-cols-3">
          <Pipeline title="Driver acquisition" rows={driverStages} icon={<Users className="h-4 w-4 text-primary" aria-hidden="true" />} />
          <Pipeline title="Fleet development" rows={fleetStages} icon={<Truck className="h-4 w-4 text-primary" aria-hidden="true" />} />
          <Pipeline title="Commercial attribution" rows={commercialStages} icon={<ArrowRight className="h-4 w-4 text-primary" aria-hidden="true" />} />
        </TabsContent>

        <TabsContent value="ranking" className="mt-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Evidence-based cohort ranking</CardTitle>
              <p className="text-sm text-muted-foreground">
                Composite = Supply Development Score 45% · productivity 25% · quality 20% · acceptance 10%. Record volume alone never ranks an intern.
              </p>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {scores.isLoading ? <Skeleton className="h-40 w-full" /> : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="py-2 pr-3">#</th><th className="py-2 pr-3">Intern</th><th className="py-2 pr-3">Track</th>
                      <th className="py-2 pr-3 text-right">Supply</th><th className="py-2 pr-3 text-right">Productivity</th>
                      <th className="py-2 pr-3 text-right">Quality</th><th className="py-2 pr-3 text-right">Acceptance</th>
                      <th className="py-2 pr-3 text-right">Composite</th><th className="py-2">Potential</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(scores.data ?? []).map((r, i) => (
                      <tr key={r.intern_id} className="border-t border-border/60">
                        <td className="py-2 pr-3 tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="py-2 pr-3 font-medium">
                          <Link className="hover:underline" to={`/staff/interns/${r.intern_id}`}>{r.full_name ?? r.intern_id}</Link>
                        </td>
                        <td className="py-2 pr-3 text-muted-foreground">{r.track_name ?? "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.supply_score}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.productivity_score}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.quality_score}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{r.acceptance_rate == null ? "—" : `${r.acceptance_rate}%`}</td>
                        <td className="py-2 pr-3 text-right font-semibold tabular-nums">{r.composite}</td>
                        <td className="py-2"><Badge variant="outline">{r.potential}</Badge></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="destinations" className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(destinations.data ?? []).slice(0, 24).map((d) => (
            <Card key={d.id} className="glass-panel">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-start gap-2 text-sm">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                  <span>{d.destination_name}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="flex flex-wrap gap-1">
                  <Badge variant="secondary">{d.destination_type}</Badge>
                  <Badge variant="outline">Demand: {stageLabel(d.demand_status)}</Badge>
                  <Badge variant="outline">{stageLabel(d.status)}</Badge>
                </div>
                <p>Segments: {d.customer_segments.join(", ") || "—"}</p>
                <p>Vehicles: {d.vehicle_categories.join(", ") || "—"}</p>
                <p>TaxiD products: {d.yalla_products.join(", ") || "—"}</p>
                <div className="pt-1"><Progress value={d.completeness} className="h-1.5" /></div>
              </CardContent>
            </Card>
          ))}
          {!destinations.isLoading && (destinations.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No destination profiles captured for this cohort yet.</p>
          ) : null}
        </TabsContent>

        <TabsContent value="fieldwork" className="mt-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Field assignments</CardTitle></CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="py-2 pr-3">Assignment</th><th className="py-2 pr-3">Location</th><th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3 text-right">Contacts</th><th className="py-2 pr-3 text-right">Records</th><th className="py-2">Verification</th>
                  </tr>
                </thead>
                <tbody>
                  {(fieldwork.data ?? []).slice(0, 40).map((f) => (
                    <tr key={f.id} className="border-t border-border/60">
                      <td className="py-2 pr-3">{f.assignment}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{f.location}</td>
                      <td className="py-2 pr-3 text-muted-foreground">{f.scheduled_for}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.contacts_made}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{f.records_created}</td>
                      <td className="py-2">
                        <Badge variant={f.supervisor_verified ? "secondary" : "outline"}>
                          {f.supervisor_verified ? "Supervisor verified" : "Awaiting verification"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="model" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Supply Development Score</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {DMFD_SUPPLY_SCORE_WEIGHTS.map((w) => (
                <div key={w.dimension} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{w.dimension}</span>
                  <span className="font-medium tabular-nums">{w.weight}%</span>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">
                Computed by the database (`intern_supply_score`). Duplicate, unverifiable or rejected records earn nothing, and no
                manager can assign a final score without supporting evidence.
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-base">Productivity Index</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {Object.entries(DMFD_PERFORMANCE_WEIGHTS).map(([k, v]) => (
                <div key={k} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{stageLabel(k)}</span>
                  <span className="font-medium tabular-nums">{v}%</span>
                </div>
              ))}
              <p className="pt-2 text-xs text-muted-foreground">
                Learning score is assessed separately from business productivity — commercial output never replaces learning
                assessment. Interns cannot verify, activate, approve or declare revenue.
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
