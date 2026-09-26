import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertTriangle, ArrowDown, ArrowUp, MapPin, Package as PackageIcon, Plus,
  RefreshCw, Route as RouteIcon, Trash2, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  ELIGIBILITY_COPY,
  ROUTE_TRANSITIONS,
  ROUTE_TYPES,
  STOP_TRANSITIONS,
  STOP_TYPES,
  applyOptimization,
  assignRoute,
  attachPackage,
  createRouteVersion,
  detachPackage,
  estimatePlanDistanceKm,
  evaluateEligibility,
  getRouteDetail,
  listAssignablePackages,
  listEligibleDrivers,
  listHubOptions,
  listRouteProviders,
  listRoutes,
  listVehicleOptions,
  manualNearestNeighbourOrder,
  recordDeviation,
  removeStop,
  reorderStops,
  requestOptimization,
  resolveDeviation,
  routeCompletionBlockers,
  saveRouteProvider,
  transitionRoute,
  transitionStop,
  upsertRoute,
  upsertStop,
  type EligibilityResult,
  type LogisticsRoute,
  type PackageRole,
  type RouteDetail,
  type RouteStatus,
  type RouteType,
  type StopStatus,
  type StopType,
} from "@/lib/logistics/routes/routeEngine";

const STATUS_TONE: Record<string, string> = {
  DRAFT: "bg-muted text-muted-foreground",
  PLANNED: "bg-primary/10 text-primary",
  ASSIGNED: "bg-primary/15 text-primary",
  READY: "bg-primary/20 text-primary",
  IN_PROGRESS: "bg-accent/20 text-accent-foreground",
  PAUSED: "bg-muted text-muted-foreground",
  COMPLETED: "bg-primary/10 text-primary",
  FAILED: "bg-destructive/10 text-destructive",
  CANCELLED: "bg-destructive/10 text-destructive",
  SKIPPED: "bg-muted text-muted-foreground",
};

const errText = (e: unknown) => (e instanceof Error ? e.message : "Unexpected error");
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("en-KE", { timeZone: "Africa/Nairobi" }) : "—");

export default function LogisticsRoutes() {
  const [routes, setRoutes] = useState<LogisticsRoute[]>([]);
  const [statusFilter, setStatusFilter] = useState<RouteStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RouteDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [hubs, setHubs] = useState<{ id: string; name: string; code: string; status: string }[]>([]);
  const [drivers, setDrivers] = useState<{ user_id: string; full_name: string }[]>([]);
  const [vehicles, setVehicles] = useState<{ id: string; vehicle_code: string; number_plate: string; vehicle_type: string }[]>([]);
  const [providers, setProviders] = useState<Awaited<ReturnType<typeof listRouteProviders>>>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState({
    route_type: "delivery" as RouteType,
    planned_start: "",
    planned_end: "",
    origin_hub_id: "",
    destination_hub_id: "",
    required_capacity_kg: "",
    required_vehicle_type: "",
    notes: "",
  });

  const [stopOpen, setStopOpen] = useState(false);
  const [stopForm, setStopForm] = useState({
    stop_type: "delivery" as StopType,
    hub_id: "",
    address: "",
    lat: "",
    lng: "",
    contact_name: "",
    contact_phone: "",
    instructions: "",
    planned_arrival: "",
  });

  const [assignOpen, setAssignOpen] = useState(false);
  const [assignDriver, setAssignDriver] = useState("");
  const [assignVehicle, setAssignVehicle] = useState("");
  const [assignReason, setAssignReason] = useState("");
  const [eligibility, setEligibility] = useState<EligibilityResult | null>(null);
  const [forceAssign, setForceAssign] = useState(false);

  const [pkgOpen, setPkgOpen] = useState(false);
  const [pkgStopId, setPkgStopId] = useState<string | null>(null);
  const [pkgRole, setPkgRole] = useState<PackageRole>("delivery");
  const [pkgSearch, setPkgSearch] = useState("");
  const [pkgResults, setPkgResults] = useState<Awaited<ReturnType<typeof listAssignablePackages>>>([]);

  const [busy, setBusy] = useState(false);

  const refreshRoutes = useCallback(async () => {
    setLoading(true);
    try {
      setRoutes(await listRoutes({ status: statusFilter, search }));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setLoading(false);
    }
  }, [statusFilter, search]);

  const refreshDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      setDetail(await getRouteDetail(id));
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void refreshRoutes(); }, [refreshRoutes]);
  useEffect(() => { if (selectedId) void refreshDetail(selectedId); }, [selectedId, refreshDetail]);
  useEffect(() => {
    void (async () => {
      try {
        const [h, d, v, p] = await Promise.all([
          listHubOptions(), listEligibleDrivers(), listVehicleOptions(), listRouteProviders(),
        ]);
        setHubs(h);
        setDrivers(d);
        setVehicles(v);
        setProviders(p);
      } catch (e) {
        toast.error(errText(e));
      }
    })();
  }, []);

  const stops = detail?.stops ?? [];
  const blockers = useMemo(() => routeCompletionBlockers(stops), [stops]);
  const planDistance = useMemo(
    () => estimatePlanDistanceKm(stops.map((s) => ({ lat: s.stop.lat, lng: s.stop.lng }))),
    [stops],
  );
  const plannedLoad = useMemo(
    () => stops.reduce((sum, s) => sum + s.packages.reduce((n, p) => n + (p.package.weight_kg ?? 0), 0), 0),
    [stops],
  );

  const guard = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      if (selectedId) await refreshDetail(selectedId);
      await refreshRoutes();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  };

  const handleCreate = () =>
    guard(async () => {
      const created = await upsertRoute(null, {
        route_type: createForm.route_type,
        planned_start: createForm.planned_start || null,
        planned_end: createForm.planned_end || null,
        origin_hub_id: createForm.origin_hub_id || null,
        destination_hub_id: createForm.destination_hub_id || null,
        required_capacity_kg: createForm.required_capacity_kg || null,
        required_vehicle_type: createForm.required_vehicle_type || null,
        notes: createForm.notes || null,
      }, "route created from control centre");
      setCreateOpen(false);
      setSelectedId(created.id);
      toast.success(`Route ${created.route_number} created`);
    });

  const handleAddStop = () =>
    guard(async () => {
      if (!selectedId) return;
      await upsertStop(null, selectedId, {
        stop_type: stopForm.stop_type,
        hub_id: stopForm.hub_id || null,
        address: stopForm.address || null,
        lat: stopForm.lat || null,
        lng: stopForm.lng || null,
        contact_name: stopForm.contact_name || null,
        contact_phone: stopForm.contact_phone || null,
        instructions: stopForm.instructions || null,
        planned_arrival: stopForm.planned_arrival || null,
      });
      setStopOpen(false);
      toast.success("Stop added");
    });

  const move = (index: number, delta: number) =>
    guard(async () => {
      if (!selectedId) return;
      const ids = stops.map((s) => s.stop.id);
      const target = index + delta;
      if (target < 0 || target >= ids.length) return;
      [ids[index], ids[target]] = [ids[target], ids[index]];
      await reorderStops(selectedId, ids, "manual dispatcher reorder");
      toast.success("Stop sequence updated");
    });

  const checkEligibility = async () => {
    if (!selectedId || !assignDriver) return;
    try {
      setEligibility(await evaluateEligibility(selectedId, assignDriver, assignVehicle || null));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const handleAssign = () =>
    guard(async () => {
      if (!selectedId || !assignDriver) return;
      await assignRoute(selectedId, assignDriver, assignVehicle || null, assignReason, forceAssign);
      setAssignOpen(false);
      setForceAssign(false);
      setAssignReason("");
      toast.success("Route assigned");
    });

  const routeMove = (to: RouteStatus) =>
    guard(async () => {
      if (!selectedId) return;
      let reason: string | undefined;
      if (["FAILED", "CANCELLED"].includes(to)) {
        reason = window.prompt(`Reason for moving this route to ${to}?`) ?? undefined;
        if (!reason) return;
      }
      await transitionRoute(selectedId, to, reason);
      toast.success(`Route moved to ${to}`);
    });

  const stopMove = (stopId: string, to: StopStatus) =>
    guard(async () => {
      let reason: string | undefined;
      if (["FAILED", "SKIPPED", "CANCELLED"].includes(to)) {
        reason = window.prompt(`Reason for ${to}?`) ?? undefined;
        if (!reason) return;
      }
      await transitionStop(stopId, to, reason);
      toast.success(`Stop moved to ${to}`);
    });

  const handleOptimize = (providerKey: string) =>
    guard(async () => {
      if (!selectedId) return;
      const run = await requestOptimization(selectedId, providerKey, {
        stops: stops.map((s) => ({ id: s.stop.id, lat: s.stop.lat, lng: s.stop.lng, window_end: s.stop.service_window_end })),
      });
      if (run.status === "skipped") {
        toast.warning("Provider not configured — use manual planning or configure it under Providers.");
        return;
      }
      if (providerKey !== "manual") {
        toast.info("Optimisation requested. Results are applied once the provider responds — nothing is fabricated.");
        return;
      }
      const ordered = manualNearestNeighbourOrder(stops.map((s) => ({ id: s.stop.id, lat: s.stop.lat, lng: s.stop.lng })));
      const result = await applyOptimization(run.run_id, ordered, {
        method: "manual_nearest_neighbour",
        distance_km: estimatePlanDistanceKm(stops.map((s) => ({ lat: s.stop.lat, lng: s.stop.lng }))) ?? undefined,
      }, "manual planning fallback applied");
      toast.success(`Manual plan applied as version ${result.version}`);
    });

  const handleNewVersion = () =>
    guard(async () => {
      if (!selectedId) return;
      const reason = window.prompt("Reason for the new route version?");
      if (!reason) return;
      const v = await createRouteVersion(selectedId, reason);
      toast.success(`Version ${v.version_number} created`);
    });

  const openPackages = async (stopId: string, role: PackageRole) => {
    setPkgStopId(stopId);
    setPkgRole(role);
    setPkgOpen(true);
    try {
      setPkgResults(await listAssignablePackages());
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const searchPackages = async () => {
    try {
      setPkgResults(await listAssignablePackages(pkgSearch));
    } catch (e) {
      toast.error(errText(e));
    }
  };

  const handleAttach = (packageId: string) =>
    guard(async () => {
      if (!pkgStopId) return;
      await attachPackage(pkgStopId, packageId, pkgRole);
      setPkgOpen(false);
      toast.success("Package attached");
    });

  const handleDeviation = () =>
    guard(async () => {
      if (!selectedId) return;
      const narrative = window.prompt("Describe the observed deviation (operational fact, not a verdict):");
      if (!narrative) return;
      await recordDeviation({ routeId: selectedId, kind: "route_deviation", narrative });
      toast.success("Deviation recorded");
    });

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <RouteIcon className="h-6 w-6 text-primary" /> Route Control Centre
          </h1>
          <p className="text-sm text-muted-foreground">
            Planned routes, versions, stops and execution — server-authoritative across the manifest → hub → route → stop → dispatch chain.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void refreshRoutes()} disabled={loading}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> New route
          </Button>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-[340px_1fr]">
        <Card className="p-4">
          <div className="space-y-3">
            <Input placeholder="Search route number" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as RouteStatus | "all")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {Object.keys(ROUTE_TRANSITIONS).map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Separator className="my-4" />
          <div className="max-h-[70vh] space-y-2 overflow-y-auto">
            {loading && <Skeleton className="h-24 w-full" />}
            {!loading && routes.length === 0 && (
              <p className="text-sm text-muted-foreground">No routes yet. Create the first planned route.</p>
            )}
            {routes.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setSelectedId(r.id)}
                className={`w-full rounded-md border p-3 text-left transition ${selectedId === r.id ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{r.route_number}</span>
                  <Badge className={STATUS_TONE[r.status]}>{r.status}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.route_type} · v{r.current_version} · {fmt(r.planned_start)}
                </p>
              </button>
            ))}
          </div>
        </Card>

        <Card className="p-4">
          {!selectedId && <p className="text-sm text-muted-foreground">Select a route to open its execution detail.</p>}
          {selectedId && detailLoading && <Skeleton className="h-64 w-full" />}
          {selectedId && detail && !detailLoading && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{detail.route.route_number}</h2>
                  <p className="text-sm text-muted-foreground">
                    v{detail.route.current_version} · {detail.route.route_type} · optimisation: {detail.route.optimization_status}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {(ROUTE_TRANSITIONS[detail.route.status] ?? []).map((to) => (
                    <Button key={to} size="sm" variant="outline" disabled={busy} onClick={() => void routeMove(to)}>
                      {to}
                    </Button>
                  ))}
                </div>
              </div>

              {blockers.length > 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                  <div>
                    <p className="font-medium text-destructive">Completion blocked</p>
                    <ul className="list-inside list-disc text-muted-foreground">
                      {blockers.map((b) => <li key={b}>{b}</li>)}
                    </ul>
                  </div>
                </div>
              )}

              <div className="grid gap-3 sm:grid-cols-4">
                {[
                  { label: "Stops", value: String(stops.length) },
                  { label: "Planned load", value: `${plannedLoad.toFixed(1)} kg` },
                  { label: "Plan distance (est.)", value: planDistance ? `${planDistance} km` : "—" },
                  { label: "Open deviations", value: String(detail.deviations.filter((d) => d.status === "open").length) },
                ].map((m) => (
                  <div key={m.label} className="rounded-md border p-3">
                    <p className="text-xs text-muted-foreground">{m.label}</p>
                    <p className="text-lg font-semibold">{m.value}</p>
                  </div>
                ))}
              </div>

              <Tabs defaultValue="stops">
                <TabsList className="flex-wrap">
                  <TabsTrigger value="stops">Stops</TabsTrigger>
                  <TabsTrigger value="assignment">Driver & vehicle</TabsTrigger>
                  <TabsTrigger value="optimisation">Optimisation</TabsTrigger>
                  <TabsTrigger value="dispatch">Dispatch</TabsTrigger>
                  <TabsTrigger value="deviations">Deviations</TabsTrigger>
                  <TabsTrigger value="versions">Versions</TabsTrigger>
                  <TabsTrigger value="events">Audit</TabsTrigger>
                  <TabsTrigger value="providers">Providers</TabsTrigger>
                </TabsList>

                <TabsContent value="stops" className="space-y-3 pt-4">
                  <div className="flex justify-between">
                    <p className="text-sm text-muted-foreground">Sequence, service state and packages for the current version.</p>
                    <Button size="sm" onClick={() => setStopOpen(true)}><Plus className="mr-2 h-4 w-4" /> Add stop</Button>
                  </div>
                  {stops.length === 0 && <p className="text-sm text-muted-foreground">No stops planned yet.</p>}
                  {stops.map((s, i) => (
                    <div key={s.stop.id} className="rounded-md border p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                            {s.stop.sequence}
                          </span>
                          <span className="font-medium capitalize">{s.stop.stop_type}</span>
                          <Badge className={STATUS_TONE[s.stop.status]}>{s.stop.status}</Badge>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button size="icon" variant="ghost" disabled={busy || i === 0} onClick={() => void move(i, -1)}>
                            <ArrowUp className="h-4 w-4" />
                          </Button>
                          <Button size="icon" variant="ghost" disabled={busy || i === stops.length - 1} onClick={() => void move(i, 1)}>
                            <ArrowDown className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => void guard(async () => {
                              const reason = window.prompt("Reason for removing this stop?");
                              if (!reason) return;
                              await removeStop(s.stop.id, reason);
                              toast.success("Stop removed");
                            })}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 flex items-center gap-1 text-sm text-muted-foreground">
                        <MapPin className="h-3.5 w-3.5" /> {s.stop.address ?? "No address"}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        ETA {fmt(s.stop.eta)} ({s.stop.eta_source ?? "planned"}) · arrived {fmt(s.stop.actual_arrival)}
                      </p>
                      <div className="mt-2 space-y-1">
                        {s.packages.map((p) => (
                          <div key={p.link_id} className="flex items-center justify-between rounded bg-muted/40 px-2 py-1 text-xs">
                            <span className="flex items-center gap-2">
                              <PackageIcon className="h-3.5 w-3.5" /> {p.package.tracking_number}
                              <Badge variant="outline">{p.role}</Badge>
                            </span>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => void guard(async () => {
                                const reason = window.prompt("Reason for detaching this package?") ?? "";
                                if (!reason) return;
                                await detachPackage(p.link_id, reason);
                                toast.success("Package detached");
                              })}
                            >
                              Detach
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {(STOP_TRANSITIONS[s.stop.status] ?? []).map((to) => (
                          <Button key={to} size="sm" variant="outline" disabled={busy} onClick={() => void stopMove(s.stop.id, to)}>
                            {to}
                          </Button>
                        ))}
                        <Button size="sm" variant="secondary" onClick={() => void openPackages(s.stop.id, s.stop.stop_type === "pickup" ? "pickup" : s.stop.stop_type === "return" ? "return" : "delivery")}>
                          Attach package
                        </Button>
                      </div>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="assignment" className="space-y-3 pt-4">
                  <div className="rounded-md border p-3 text-sm">
                    <p><span className="text-muted-foreground">Driver:</span> {detail.route.driver_user_id ?? "unassigned"}</p>
                    <p><span className="text-muted-foreground">Vehicle:</span> {detail.route.vehicle_id ?? "unassigned"}</p>
                    <p className="text-xs text-muted-foreground">Eligibility is evaluated server-side; the list below never authorises on its own.</p>
                  </div>
                  <Button onClick={() => setAssignOpen(true)}>Assign driver & vehicle</Button>
                </TabsContent>

                <TabsContent value="optimisation" className="space-y-3 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Optimisation runs are stored against a route version. If no external provider is configured, the authorised manual plan is used — provider results are never fabricated.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {providers.map((p) => (
                      <Button key={p.id} variant={p.provider_key === "manual" ? "default" : "outline"} disabled={busy} onClick={() => void handleOptimize(p.provider_key)}>
                        <Wand2 className="mr-2 h-4 w-4" /> {p.display_name}
                      </Button>
                    ))}
                    <Button variant="secondary" disabled={busy} onClick={() => void handleNewVersion()}>New version</Button>
                  </div>
                  <div className="space-y-2">
                    {detail.optimization_runs.map((r) => (
                      <div key={r.id} className="rounded-md border p-2 text-xs">
                        <span className="font-medium">{r.provider_key}</span> · {r.status} · {fmt(r.created_at)}
                        {r.error && <span className="text-destructive"> — {r.error}</span>}
                      </div>
                    ))}
                  </div>
                </TabsContent>

                <TabsContent value="dispatch" className="space-y-2 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Routes reference the existing dispatch engine — dispatch jobs are linked, never duplicated.
                  </p>
                  {detail.dispatch_jobs.length === 0 && <p className="text-sm text-muted-foreground">No dispatch jobs linked.</p>}
                  {detail.dispatch_jobs.map((d) => (
                    <div key={d.link.id} className="rounded-md border p-2 text-xs">
                      Job {String((d.job as { id?: string }).id)} · status {String((d.job as { status?: string }).status)}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="deviations" className="space-y-2 pt-4">
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleDeviation()}>Record deviation</Button>
                  {detail.deviations.map((d) => (
                    <div key={d.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{d.kind.replace(/_/g, " ")}</span>
                        <Badge variant="outline">{d.status}</Badge>
                      </div>
                      <p className="text-muted-foreground">{d.narrative}</p>
                      {d.status === "open" && (
                        <div className="mt-1 flex gap-2">
                          {(["acknowledged", "resolved", "dismissed"] as const).map((s) => (
                            <Button key={s} size="sm" variant="ghost" disabled={busy}
                              onClick={() => void guard(async () => { await resolveDeviation(d.id, s); toast.success(`Deviation ${s}`); })}>
                              {s}
                            </Button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="versions" className="space-y-2 pt-4">
                  {detail.versions.map((v) => (
                    <div key={v.id} className="rounded-md border p-2 text-xs">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">v{v.version_number}</span>
                        <span className="text-muted-foreground">{v.superseded_at ? "superseded" : "current"}</span>
                      </div>
                      <p className="text-muted-foreground">{v.change_reason} · source {v.optimization_source} · {fmt(v.created_at)}</p>
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="events" className="space-y-2 pt-4">
                  {detail.events.map((e) => (
                    <div key={e.id} className="rounded-md border p-2 text-xs">
                      <span className="font-medium">{e.event_type}</span>
                      {e.to_status && <span> → {e.to_status}</span>}
                      <span className="text-muted-foreground"> · {fmt(e.created_at)}</span>
                      {e.reason && <p className="text-muted-foreground">{e.reason}</p>}
                    </div>
                  ))}
                </TabsContent>

                <TabsContent value="providers" className="space-y-3 pt-4">
                  <p className="text-sm text-muted-foreground">
                    Owner configuration for optimisation providers. Credentials are stored as backend secrets — only the secret name is recorded here.
                  </p>
                  {providers.map((p) => (
                    <div key={p.id} className="space-y-2 rounded-md border p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-medium">{p.display_name}</p>
                          <p className="text-xs text-muted-foreground">{p.provider_key} · health: {p.health_status}</p>
                        </div>
                        <Switch
                          checked={p.enabled}
                          disabled={p.provider_key === "manual" || busy}
                          onCheckedChange={(checked) => void guard(async () => {
                            await saveRouteProvider({ id: p.id, enabled: checked, base_url: p.base_url, credential_secret_name: p.credential_secret_name });
                            setProviders(await listRouteProviders());
                            toast.success("Provider updated");
                          })}
                        />
                      </div>
                      {p.provider_key !== "manual" && (
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            placeholder="Base URL"
                            defaultValue={p.base_url ?? ""}
                            onBlur={(e) => void guard(async () => {
                              await saveRouteProvider({ id: p.id, enabled: p.enabled, base_url: e.target.value, credential_secret_name: p.credential_secret_name });
                              setProviders(await listRouteProviders());
                            })}
                          />
                          <Input
                            placeholder="Credential secret name"
                            defaultValue={p.credential_secret_name ?? ""}
                            onBlur={(e) => void guard(async () => {
                              await saveRouteProvider({ id: p.id, enabled: p.enabled, base_url: p.base_url, credential_secret_name: e.target.value });
                              setProviders(await listRouteProviders());
                            })}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </TabsContent>
              </Tabs>
            </div>
          )}
        </Card>
      </div>

      {/* create route */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New planned route</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Route type</Label>
              <Select value={createForm.route_type} onValueChange={(v) => setCreateForm((f) => ({ ...f, route_type: v as RouteType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ROUTE_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Planned start</Label>
                <Input type="datetime-local" value={createForm.planned_start} onChange={(e) => setCreateForm((f) => ({ ...f, planned_start: e.target.value }))} />
              </div>
              <div>
                <Label>Planned end</Label>
                <Input type="datetime-local" value={createForm.planned_end} onChange={(e) => setCreateForm((f) => ({ ...f, planned_end: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Origin hub</Label>
                <Select value={createForm.origin_hub_id} onValueChange={(v) => setCreateForm((f) => ({ ...f, origin_hub_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                  <SelectContent>
                    {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.name} ({h.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Destination hub</Label>
                <Select value={createForm.destination_hub_id} onValueChange={(v) => setCreateForm((f) => ({ ...f, destination_hub_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                  <SelectContent>
                    {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.name} ({h.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Required capacity (kg)</Label>
                <Input value={createForm.required_capacity_kg} onChange={(e) => setCreateForm((f) => ({ ...f, required_capacity_kg: e.target.value }))} />
              </div>
              <div>
                <Label>Required vehicle type</Label>
                <Input value={createForm.required_vehicle_type} onChange={(e) => setCreateForm((f) => ({ ...f, required_vehicle_type: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Notes</Label>
              <Textarea value={createForm.notes} onChange={(e) => setCreateForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void handleCreate()}>Create route</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* add stop */}
      <Dialog open={stopOpen} onOpenChange={setStopOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Add stop</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Stop type</Label>
              <Select value={stopForm.stop_type} onValueChange={(v) => setStopForm((f) => ({ ...f, stop_type: v as StopType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STOP_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {stopForm.stop_type === "hub" && (
              <div>
                <Label>Hub</Label>
                <Select value={stopForm.hub_id} onValueChange={(v) => setStopForm((f) => ({ ...f, hub_id: v }))}>
                  <SelectTrigger><SelectValue placeholder="Select hub" /></SelectTrigger>
                  <SelectContent>
                    {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.name} ({h.code})</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div>
              <Label>Address</Label>
              <Input value={stopForm.address} onChange={(e) => setStopForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Latitude</Label>
                <Input value={stopForm.lat} onChange={(e) => setStopForm((f) => ({ ...f, lat: e.target.value }))} />
              </div>
              <div>
                <Label>Longitude</Label>
                <Input value={stopForm.lng} onChange={(e) => setStopForm((f) => ({ ...f, lng: e.target.value }))} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label>Contact name</Label>
                <Input value={stopForm.contact_name} onChange={(e) => setStopForm((f) => ({ ...f, contact_name: e.target.value }))} />
              </div>
              <div>
                <Label>Contact phone</Label>
                <Input value={stopForm.contact_phone} onChange={(e) => setStopForm((f) => ({ ...f, contact_phone: e.target.value }))} />
              </div>
            </div>
            <div>
              <Label>Planned arrival</Label>
              <Input type="datetime-local" value={stopForm.planned_arrival} onChange={(e) => setStopForm((f) => ({ ...f, planned_arrival: e.target.value }))} />
            </div>
            <div>
              <Label>Instructions</Label>
              <Textarea value={stopForm.instructions} onChange={(e) => setStopForm((f) => ({ ...f, instructions: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStopOpen(false)}>Cancel</Button>
            <Button disabled={busy} onClick={() => void handleAddStop()}>Add stop</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* assign */}
      <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Assign driver & vehicle</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div>
              <Label>Driver</Label>
              <Select value={assignDriver} onValueChange={(v) => { setAssignDriver(v); setEligibility(null); }}>
                <SelectTrigger><SelectValue placeholder="Select driver" /></SelectTrigger>
                <SelectContent>
                  {drivers.map((d) => <SelectItem key={d.user_id} value={d.user_id}>{d.full_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Vehicle</Label>
              <Select value={assignVehicle} onValueChange={(v) => { setAssignVehicle(v); setEligibility(null); }}>
                <SelectTrigger><SelectValue placeholder="Select vehicle" /></SelectTrigger>
                <SelectContent>
                  {vehicles.map((v) => (
                    <SelectItem key={v.id} value={v.id}>{v.number_plate ?? v.vehicle_code} · {v.vehicle_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="outline" onClick={() => void checkEligibility()} disabled={!assignDriver}>
              Check eligibility
            </Button>
            {eligibility && (
              <div className={`rounded-md border p-3 text-sm ${eligibility.status === "ELIGIBLE" ? "border-primary/40 bg-primary/5" : "border-destructive/40 bg-destructive/5"}`}>
                <p className="font-medium">{ELIGIBILITY_COPY[eligibility.status]}</p>
                <ul className="list-inside list-disc text-muted-foreground">
                  {eligibility.reasons.map((r) => <li key={r}>{ELIGIBILITY_COPY[r] ?? r}</li>)}
                </ul>
                <p className="text-xs text-muted-foreground">Planned load {eligibility.planned_load_kg} kg</p>
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch checked={forceAssign} onCheckedChange={setForceAssign} />
              <span className="text-sm">Override an ineligible assignment (reason required, recorded)</span>
            </div>
            <div>
              <Label>Reason</Label>
              <Textarea value={assignReason} onChange={(e) => setAssignReason(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
            <Button disabled={busy || !assignDriver} onClick={() => void handleAssign()}>Assign</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* attach package */}
      <Dialog open={pkgOpen} onOpenChange={setPkgOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Attach package ({pkgRole})</DialogTitle></DialogHeader>
          <div className="flex gap-2">
            <Input placeholder="Tracking number" value={pkgSearch} onChange={(e) => setPkgSearch(e.target.value)} />
            <Button variant="outline" onClick={() => void searchPackages()}>Search</Button>
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto">
            {pkgResults.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={busy}
                onClick={() => void handleAttach(p.id)}
                className="w-full rounded-md border p-2 text-left text-sm hover:bg-muted/50"
              >
                <span className="font-medium">{p.tracking_number}</span>
                <span className="text-muted-foreground"> · {p.status} · {p.dropoff_address ?? p.pickup_address ?? "—"}</span>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
