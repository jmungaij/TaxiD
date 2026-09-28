/**
 * REAL-TIME LOGISTICS CONTROL TOWER — /dashboard/admin/logistics-control-tower
 *
 * The single operational command surface over the logistics spine. Every
 * number is a server verdict (ct_* RPCs); every control terminates in
 * ct_command_execute, which authorises, executes through the authoritative
 * logistics RPCs and records an observability row. Nothing is computed here.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  Activity,
  AlertTriangle,
  Boxes,
  Building2,
  Loader2,
  MapPin,
  Radar,
  RefreshCw,
  Search,
  ShieldAlert,
  Sliders,
  Truck,
  WifiOff,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { cn } from "@/lib/utils";
import * as ct from "@/lib/logistics/controlTower";

const TABS = ["board", "map", "alerts", "capacity", "warehouse", "carriers", "finance", "sync", "config"] as const;
type TabKey = (typeof TABS)[number];

const NOT_AVAILABLE = ct.NOT_AVAILABLE;

function toneClass(tone: "ok" | "warn" | "danger" | "info") {
  return tone === "ok"
    ? "border-success/40 text-success"
    : tone === "warn"
      ? "border-warning/50 text-warning"
      : tone === "danger"
        ? "border-destructive/50 text-destructive"
        : "border-info/40 text-info";
}

function StateBadge({ state }: { state?: string | null }) {
  if (!state) return <span className="text-xs text-muted-foreground">—</span>;
  const key = state as ct.OperationalState;
  const label = ct.OPERATIONAL_STATE_LABEL[key] ?? state.replace(/_/g, " ").toLowerCase();
  const tone = ct.OPERATIONAL_STATE_TONE[key] ?? "info";
  return (
    <Badge variant="outline" className={cn("text-[10px] uppercase tracking-wide", toneClass(tone))}>
      {label}
    </Badge>
  );
}

function SlaBadge({ state }: { state?: ct.SlaState }) {
  if (!state) return null;
  return (
    <Badge variant="outline" className={cn("text-[10px] tracking-wide", toneClass(ct.SLA_TONE[state]))}>
      {state.toLowerCase()}
    </Badge>
  );
}

/** A surface withheld by the server: never rendered as an empty dataset. */
function Withheld({ message }: { message: string }) {
  return (
    <Card className="border-destructive/30">
      <CardContent className="flex items-start gap-3 p-6">
        <ShieldAlert className="mt-0.5 h-5 w-5 text-destructive" />
        <div>
          <p className="text-sm font-semibold">Surface withheld</p>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Unavailable({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-warning/40 bg-warning/5 p-4 text-sm">
      <span className="font-mono text-xs text-warning">{NOT_AVAILABLE}</span>
      <p className="mt-1 text-muted-foreground">{message}</p>
    </div>
  );
}

function Kpi({
  label,
  value,
  caption,
  tone = "info",
  active,
  onClick,
}: {
  label: string;
  value: number | null;
  caption?: string;
  tone?: "ok" | "warn" | "danger" | "info";
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-lg border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5" : "border-border/70",
        onClick && "hover:border-primary/60",
      )}
    >
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone === "danger" && "text-destructive", tone === "warn" && "text-warning")}>
        {value === null ? "—" : value}
      </p>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
    </button>
  );
}

export default function LogisticsControlTower() {
  const { toast } = useToast();
  const { tab: activeTab, onTabChange } = useTabDeepLink(TABS, "board");

  const [snapshot, setSnapshot] = useState<ct.BoardSnapshot | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [lens, setLens] = useState<ct.BoardLens>("packages");
  const [stateFilter, setStateFilter] = useState<string | null>(null);
  const [page, setPage] = useState<ct.BoardPage | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [rowsLoading, setRowsLoading] = useState(false);
  const [offset, setOffset] = useState(0);

  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<ct.SearchHit[] | null>(null);

  const [map, setMap] = useState<ct.LiveMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);

  const [alerts, setAlerts] = useState<ct.AlertRow[] | null>(null);
  const [alertsError, setAlertsError] = useState<string | null>(null);
  const [alertTarget, setAlertTarget] = useState<ct.AlertRow | null>(null);
  const [resolution, setResolution] = useState("");
  const [working, setWorking] = useState(false);

  const [capacity, setCapacity] = useState<ct.CapacitySnapshot | null>(null);
  const [capacityError, setCapacityError] = useState<string | null>(null);
  const [warehouse, setWarehouse] = useState<ct.WarehouseSnapshot | null>(null);
  const [warehouseError, setWarehouseError] = useState<string | null>(null);
  const [carriers, setCarriers] = useState<ct.CarrierSnapshot | null>(null);
  const [carriersError, setCarriersError] = useState<string | null>(null);
  const [finance, setFinance] = useState<ct.FinanceSnapshot | null>(null);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [offline, setOffline] = useState<ct.OfflineSnapshot | null>(null);
  const [offlineError, setOfflineError] = useState<string | null>(null);
  const [config, setConfig] = useState<ct.ConfigOverview | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);

  const [commandTarget, setCommandTarget] = useState<{ row: ct.BoardRow; command: ct.CtCommand } | null>(null);
  const [commandNote, setCommandNote] = useState("");

  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const loadSnapshot = useCallback(async () => {
    const res = await ct.boardSnapshot();
    if (!mounted.current) return;
    if (res.ok) {
      setSnapshot(res.data);
      setSnapshotError(null);
      setDenied(null);
    } else if (res.denied) {
      setDenied(res.message);
    } else {
      setSnapshotError(res.message);
    }
    setLoading(false);
  }, []);

  const loadRows = useCallback(async () => {
    setRowsLoading(true);
    const res = await ct.boardRows({ lens, offset, state: stateFilter, search: query || null });
    if (!mounted.current) return;
    if (res.ok) {
      setPage(res.data);
      setPageError(null);
    } else {
      setPage(null);
      setPageError(res.message);
    }
    setRowsLoading(false);
  }, [lens, offset, stateFilter, query]);

  const loadAlerts = useCallback(async () => {
    const res = await ct.alertsList({ limit: 100 });
    if (!mounted.current) return;
    if (res.ok) { setAlerts(res.data.rows); setAlertsError(null); }
    else { setAlerts(null); setAlertsError(res.message); }
  }, []);

  const loadTab = useCallback(async (tab: TabKey) => {
    if (tab === "map") {
      const r = await ct.liveMap();
      if (!mounted.current) return;
      if (r.ok) {
        setMap(r.data);
        setMapError(null);
      } else {
        setMap(null);
        setMapError(r.message);
      }
    } else if (tab === "alerts") {
      await loadAlerts();
    } else if (tab === "capacity") {
      const r = await ct.capacitySnapshot();
      if (!mounted.current) return;
      if (r.ok) {
        setCapacity(r.data);
        setCapacityError(null);
      } else {
        setCapacity(null);
        setCapacityError(r.message);
      }
    } else if (tab === "warehouse") {
      const r = await ct.warehouseSnapshot();
      if (!mounted.current) return;
      if (r.ok) {
        setWarehouse(r.data);
        setWarehouseError(null);
      } else {
        setWarehouse(null);
        setWarehouseError(r.message);
      }
    } else if (tab === "carriers") {
      const r = await ct.carrierSnapshot(15);
      if (!mounted.current) return;
      if (r.ok) {
        setCarriers(r.data);
        setCarriersError(null);
      } else {
        setCarriers(null);
        setCarriersError(r.message);
      }
    } else if (tab === "finance") {
      const r = await ct.financeSnapshot();
      if (!mounted.current) return;
      if (r.ok) {
        setFinance(r.data);
        setFinanceError(null);
      } else {
        setFinance(null);
        setFinanceError(r.message);
      }
    } else if (tab === "sync") {
      const r = await ct.offlineSnapshot();
      if (!mounted.current) return;
      if (r.ok) {
        setOffline(r.data);
        setOfflineError(null);
      } else {
        setOffline(null);
        setOfflineError(r.message);
      }
    } else if (tab === "config") {
      const r = await ct.configOverview();
      if (!mounted.current) return;
      if (r.ok) {
        setConfig(r.data);
        setConfigError(null);
      } else {
        setConfig(null);
        setConfigError(r.message);
      }
    }
  }, [loadAlerts]);

  useEffect(() => { void loadSnapshot(); }, [loadSnapshot]);
  useEffect(() => { if (!denied) void loadRows(); }, [loadRows, denied]);
  useEffect(() => { if (!denied) void loadTab(activeTab as TabKey); }, [activeTab, denied, loadTab]);

  // Event-driven refresh: the alert stream drives the board, with no polling.
  useEffect(() => {
    if (denied) return;
    const channel = supabase
      .channel("control-tower-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "control_tower_alerts" }, () => {
        void loadSnapshot();
        void loadAlerts();
      })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [denied, loadSnapshot, loadAlerts]);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([loadSnapshot(), loadRows(), loadTab(activeTab as TabKey)]);
  }, [loadSnapshot, loadRows, loadTab, activeTab]);

  const runScan = useCallback(async () => {
    setWorking(true);
    const res = await ct.alertScan();
    setWorking(false);
    if (!res.ok) {
      toast({ title: "Scan not completed", description: res.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Alert scan complete",
      description: `${res.data.conditions_raised} conditions raised · ${res.data.open_alerts} open alerts.`,
    });
    void loadSnapshot();
    void loadAlerts();
  }, [toast, loadSnapshot, loadAlerts]);

  const runSearch = useCallback(async () => {
    if (query.trim().length < 2) { setHits(null); return; }
    const res = await ct.search(query.trim());
    if (!res.ok) { toast({ title: "Search unavailable", description: res.message, variant: "destructive" }); return; }
    setHits(res.data.results);
  }, [query, toast]);

  const transition = useCallback(async (alert: ct.AlertRow, action: ct.AlertAction, note?: string) => {
    setWorking(true);
    const res = await ct.alertTransition({
      alertId: alert.id,
      action,
      notes: note ?? null,
      resolution: action === "RESOLVE" ? note ?? null : null,
    });
    setWorking(false);
    if (!res.ok) {
      toast({ title: "Not applied", description: res.message, variant: "destructive" });
      return;
    }
    toast({ title: "Alert updated", description: `${alert.alert_number} → ${ct.ALERT_STATUS_LABEL[res.data.status]}.` });
    setAlertTarget(null);
    setResolution("");
    void loadAlerts();
  }, [toast, loadAlerts]);

  const executeCommand = useCallback(async () => {
    if (!commandTarget) return;
    const { row, command } = commandTarget;
    const entityType =
      command === "ESCALATE_EXCEPTION" || command === "RESOLVE_EXCEPTION" || command === "ASSIGN_EXCEPTION"
        ? "logistics_exception"
        : command === "CREATE_RETURN" || command === "REATTEMPT_DELIVERY"
          ? "package"
          : "route";
    setWorking(true);
    const res = await ct.commandExecute({
      operation: command,
      entityType,
      entityId: row.id,
      payload: { reason: commandNote || ct.COMMAND_LABEL[command], note: commandNote, resolution: commandNote },
    });
    setWorking(false);
    if (!res.ok) {
      toast({ title: ct.COMMAND_LABEL[command] + " refused", description: res.message, variant: "destructive" });
      return;
    }
    toast({ title: "Command applied", description: `${ct.COMMAND_LABEL[command]} on ${row.reference ?? row.id}.` });
    setCommandTarget(null);
    setCommandNote("");
    void loadRows();
    void loadSnapshot();
  }, [commandTarget, commandNote, toast, loadRows, loadSnapshot]);

  const counters = snapshot?.counters;
  const lensCommands = useMemo<Record<ct.BoardLens, ct.CtCommand[]>>(() => ({
    packages: ["REATTEMPT_DELIVERY", "CREATE_RETURN"],
    dispatch: ["REATTEMPT_DELIVERY"],
    routes: ["HOLD_DISPATCH", "RELEASE_DISPATCH", "RECALCULATE_ROUTE"],
    stops: [],
    exceptions: ["ASSIGN_EXCEPTION", "ESCALATE_EXCEPTION", "RESOLVE_EXCEPTION"],
    pod_pending: [],
    returns: [],
  }), []);

  if (denied) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Helmet><title>Control Tower | TaxiD</title></Helmet>
        <Withheld message={denied} />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Helmet>
        <title>Logistics Control Tower | TaxiD</title>
        <meta name="description" content="Real-time logistics control tower: live operations, SLA intelligence, exceptions and operator commands." />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            <Radar className="h-6 w-6 text-primary" /> Logistics Control Tower
          </h1>
          <p className="text-sm text-muted-foreground">
            Live operational truth across shipments, dispatch, routes, hubs, carriers, finance and field devices.
            {snapshot && <> · Measured {ct.relativeTime(snapshot.measured_at)}</>}
            {snapshot?.policy_scope && <> · SLA policy <span className="font-mono">{snapshot.policy_scope}</span></>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={runScan} disabled={working}>
            {working ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <AlertTriangle className="mr-1 h-4 w-4" />}
            Run alert scan
          </Button>
          <Button size="sm" variant="ghost" onClick={refreshAll}>
            <RefreshCw className={cn("mr-1 h-4 w-4", loading && "animate-spin")} /> Refresh
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }}
            placeholder="Search tracking number, route, manifest, exception, hub, vehicle, carrier or alert"
            className="pl-8"
          />
        </div>
        <Button size="sm" variant="secondary" onClick={runSearch}>Search</Button>
        {hits && <Button size="sm" variant="ghost" onClick={() => { setHits(null); setQuery(""); }}>Clear</Button>}
      </div>

      {hits && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Search results ({hits.length})</CardTitle></CardHeader>
          <CardContent className="space-y-1">
            {hits.length === 0 && <p className="text-sm text-muted-foreground">No matching operational record.</p>}
            {hits.map((h) => (
              <div key={`${h.kind}-${h.id}`} className="flex items-center justify-between border-b border-border/50 py-1.5 text-sm last:border-0">
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] uppercase">{h.kind}</Badge>
                  <span className="font-mono text-xs">{h.reference ?? h.id}</span>
                </span>
                <span className="text-xs text-muted-foreground">{h.status ?? "—"} · {ct.relativeTime(h.created_at)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {snapshotError && <Unavailable message={snapshotError} />}

      {loading && !snapshot ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : counters ? (
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Kpi label="Active shipments" value={counters.active_packages} caption={`${counters.active_orders} orders`} onClick={() => { setLens("packages"); setStateFilter(null); setOffset(0); onTabChange("board"); }} active={lens === "packages"} />
          <Kpi label="Dispatch jobs" value={counters.active_dispatch_jobs} caption={`${counters.active_drivers} drivers online`} onClick={() => { setLens("dispatch"); setStateFilter(null); setOffset(0); }} active={lens === "dispatch"} />
          <Kpi label="Active routes" value={counters.active_routes} caption={`${counters.active_stops} stops open`} onClick={() => { setLens("routes"); setStateFilter(null); setOffset(0); }} active={lens === "routes"} />
          <Kpi label="At risk" value={counters.sla_at_risk} tone="warn" caption="SLA warning or critical" onClick={() => { setLens("packages"); setStateFilter("AT_RISK"); setOffset(0); }} active={stateFilter === "AT_RISK"} />
          <Kpi label="Breached" value={counters.sla_breached} tone="danger" caption="Past deadline + grace" onClick={() => { setLens("packages"); setStateFilter("DELAYED"); setOffset(0); }} active={stateFilter === "DELAYED"} />
          <Kpi label="Exceptions" value={counters.open_exceptions} tone="danger" caption={`${counters.failed_deliveries_24h} failed attempts 24h`} onClick={() => { setLens("exceptions"); setStateFilter(null); setOffset(0); }} active={lens === "exceptions"} />
          <Kpi label="POD pending" value={counters.pod_pending} tone="warn" onClick={() => { setLens("pod_pending"); setStateFilter(null); setOffset(0); }} active={lens === "pod_pending"} />
          <Kpi label="Returns open" value={counters.open_returns} tone="warn" onClick={() => { setLens("returns"); setStateFilter(null); setOffset(0); }} active={lens === "returns"} />
          <Kpi label="Capacity constrained" value={counters.capacity_constrained} tone="warn" onClick={() => onTabChange("capacity")} />
          <Kpi label="Warehouse backlog" value={counters.warehouse_backlog} caption={`${counters.hub_operations_24h} ops 24h`} onClick={() => onTabChange("warehouse")} />
          <Kpi label="Recon exceptions" value={counters.recon_exceptions} tone="danger" onClick={() => onTabChange("finance")} />
          <Kpi label="Open alerts" value={counters.open_alerts} tone="danger" caption={`${counters.offline_conflicts} sync conflicts`} onClick={() => onTabChange("alerts")} />
        </div>
      ) : (
        <Unavailable message="The operations snapshot could not be read from the spine." />
      )}

      <Tabs value={activeTab} onValueChange={onTabChange} className="space-y-4">
        <TabsList className="grid h-auto grid-cols-3 lg:grid-cols-9">
          <TabsTrigger value="board" className="text-[11px]">Operations</TabsTrigger>
          <TabsTrigger value="map" className="text-[11px]">Live map</TabsTrigger>
          <TabsTrigger value="alerts" className="text-[11px]">Alerts</TabsTrigger>
          <TabsTrigger value="capacity" className="text-[11px]">Capacity</TabsTrigger>
          <TabsTrigger value="warehouse" className="text-[11px]">Warehouse</TabsTrigger>
          <TabsTrigger value="carriers" className="text-[11px]">Carriers</TabsTrigger>
          <TabsTrigger value="finance" className="text-[11px]">Finance</TabsTrigger>
          <TabsTrigger value="sync" className="text-[11px]">Field sync</TabsTrigger>
          <TabsTrigger value="config" className="text-[11px]">Configuration</TabsTrigger>
        </TabsList>

        {/* ------------------------------ OPERATIONS BOARD ---------------- */}
        <TabsContent value="board" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            {ct.BOARD_LENSES.map((l) => (
              <Button
                key={l}
                size="sm"
                variant={lens === l ? "default" : "outline"}
                onClick={() => { setLens(l); setOffset(0); setStateFilter(null); }}
              >
                {ct.BOARD_LENS_LABEL[l]}
              </Button>
            ))}
            {stateFilter && (
              <Badge variant="outline" className="ml-2">
                Filter: {ct.OPERATIONAL_STATE_LABEL[stateFilter as ct.OperationalState] ?? stateFilter}
                <button className="ml-2 underline" onClick={() => { setStateFilter(null); setOffset(0); }}>clear</button>
              </Badge>
            )}
          </div>

          {pageError ? (
            <Unavailable message={pageError} />
          ) : rowsLoading && !page ? (
            <Skeleton className="h-64" />
          ) : page && page.rows.length === 0 ? (
            <p className="rounded-md border border-border/60 p-6 text-sm text-muted-foreground">
              No records in this lens right now.
            </p>
          ) : page ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm">
                  {ct.BOARD_LENS_LABEL[page.lens]} — {page.total} record{page.total === 1 ? "" : "s"}
                </CardTitle>
                <span className="text-[11px] text-muted-foreground">Measured {ct.relativeTime(page.measured_at)}</span>
              </CardHeader>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Reference</th>
                      <th className="px-3 py-2">State</th>
                      <th className="px-3 py-2">SLA</th>
                      <th className="px-3 py-2">Due</th>
                      <th className="px-3 py-2">Detail</th>
                      <th className="px-3 py-2 text-right">Commands</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row) => (
                      <tr key={row.id} className="border-t border-border/50 align-top">
                        <td className="px-3 py-2">
                          <div className="font-mono text-xs">{row.reference ?? row.id.slice(0, 8)}</div>
                          <div className="text-[11px] text-muted-foreground">{row.status ?? "—"}</div>
                        </td>
                        <td className="px-3 py-2"><StateBadge state={row.op_state} /></td>
                        <td className="px-3 py-2"><SlaBadge state={row.sla_state} /></td>
                        <td className="px-3 py-2 text-xs">
                          {row.minutes_remaining !== undefined && row.minutes_remaining !== null
                            ? ct.minutesLabel(row.minutes_remaining)
                            : row.deadline
                              ? new Date(row.deadline).toLocaleString("en-KE")
                              : "—"}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {row.party ?? row.location ?? row.narrative ?? row.reason_code ?? "—"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          <div className="flex flex-wrap justify-end gap-1">
                            {lensCommands[page.lens].map((c) => (
                              <Button
                                key={c}
                                size="sm"
                                variant="outline"
                                className="h-7 text-[11px]"
                                onClick={() => { setCommandTarget({ row, command: c }); setCommandNote(""); }}
                              >
                                {ct.COMMAND_LABEL[c]}
                              </Button>
                            ))}
                            {lensCommands[page.lens].length === 0 && (
                              <span className="text-[11px] text-muted-foreground">No command available</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
              <div className="flex items-center justify-between border-t border-border/50 px-3 py-2 text-xs">
                <span className="text-muted-foreground">
                  Showing {page.offset + 1}–{Math.min(page.offset + page.rows.length, page.total)} of {page.total}
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - page.limit))}>Previous</Button>
                  <Button size="sm" variant="ghost" disabled={offset + page.limit >= page.total} onClick={() => setOffset(offset + page.limit)}>Next</Button>
                </div>
              </div>
            </Card>
          ) : null}
        </TabsContent>

        {/* ---------------------------------- LIVE MAP -------------------- */}
        <TabsContent value="map" className="space-y-3">
          {mapError ? <Unavailable message={mapError} /> : !map ? <Skeleton className="h-64" /> : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Truck className="h-4 w-4" /> Drivers live ({map.drivers.length})</CardTitle></CardHeader>
                <CardContent className="max-h-72 space-y-1 overflow-y-auto text-xs">
                  {map.drivers.length === 0 && <p className="text-muted-foreground">No driver telemetry in the freshness window.</p>}
                  {map.drivers.map((d) => (
                    <div key={d.driver_id} className="flex justify-between border-b border-border/40 py-1 last:border-0">
                      <span className="font-mono">{d.driver_id.slice(0, 8)}…</span>
                      <span className="text-muted-foreground">
                        {d.lat?.toFixed(3)}, {d.lng?.toFixed(3)} · {ct.relativeTime(d.updated_at)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Building2 className="h-4 w-4" /> Hubs ({map.hubs.length})</CardTitle></CardHeader>
                <CardContent className="max-h-72 space-y-1 overflow-y-auto text-xs">
                  {map.hubs.map((h) => (
                    <div key={h.id} className="flex justify-between border-b border-border/40 py-1 last:border-0">
                      <span className="font-mono">{h.code}</span>
                      <span className="text-muted-foreground">
                        {h.max_capacity ? `${h.current_capacity ?? 0}/${h.max_capacity}` : "capacity not set"}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><MapPin className="h-4 w-4" /> Open stops ({map.stops.length})</CardTitle></CardHeader>
                <CardContent className="max-h-72 space-y-1 overflow-y-auto text-xs">
                  {map.stops.map((s) => (
                    <div key={s.id} className="flex justify-between border-b border-border/40 py-1 last:border-0">
                      <span>#{s.sequence} · {s.type ?? "stop"}</span>
                      <span className="text-muted-foreground">{s.eta ? new Date(s.eta).toLocaleTimeString("en-KE") : "no ETA"}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><AlertTriangle className="h-4 w-4" /> Exceptions & deviations</CardTitle></CardHeader>
                <CardContent className="max-h-72 space-y-1 overflow-y-auto text-xs">
                  {map.exceptions.map((e) => (
                    <div key={e.id} className="flex justify-between border-b border-border/40 py-1">
                      <span className="font-mono">{e.reference}</span>
                      <span className="text-destructive">{e.severity}</span>
                    </div>
                  ))}
                  {map.deviations.map((d) => (
                    <div key={d.id} className="flex justify-between border-b border-border/40 py-1 last:border-0">
                      <span>{d.kind ?? "deviation"}</span>
                      <span className="text-warning">{d.distance_m ? `${Math.round(d.distance_m)} m` : "—"}</span>
                    </div>
                  ))}
                  {map.exceptions.length === 0 && map.deviations.length === 0 && (
                    <p className="text-muted-foreground">No open geospatial exceptions.</p>
                  )}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ----------------------------------- ALERTS --------------------- */}
        <TabsContent value="alerts" className="space-y-3">
          {alertsError ? <Unavailable message={alertsError} /> : !alerts ? <Skeleton className="h-64" /> : alerts.length === 0 ? (
            <p className="rounded-md border border-border/60 p-6 text-sm text-muted-foreground">
              No alerts recorded. Run an alert scan to evaluate current conditions.
            </p>
          ) : (
            <div className="space-y-2">
              {alerts.map((a) => (
                <Card key={a.id} className={cn("border-l-4", a.severity === "critical" ? "border-l-destructive" : a.severity === "warning" ? "border-l-warning" : "border-l-info")}>
                  <CardContent className="flex flex-wrap items-start justify-between gap-3 p-4">
                    <div className="min-w-[240px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs">{a.alert_number}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{a.severity}</Badge>
                        <Badge variant="outline" className="text-[10px]">{ct.ALERT_STATUS_LABEL[a.status]}</Badge>
                        {a.occurrence_count > 1 && <span className="text-[11px] text-muted-foreground">×{a.occurrence_count}</span>}
                      </div>
                      <p className="mt-1 text-sm">{a.reason}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {a.entity_type.replace(/_/g, " ")} {a.entity_ref ? `· ${a.entity_ref}` : ""} · last seen {ct.relativeTime(a.last_seen_at)}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {a.status === "CREATED" && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={working} onClick={() => transition(a, "ACKNOWLEDGE")}>Acknowledge</Button>
                      )}
                      {(a.status === "ACKNOWLEDGED" || a.status === "ASSIGNED") && (
                        <Button size="sm" variant="outline" className="h-7 text-[11px]" disabled={working} onClick={() => transition(a, "START")}>Start work</Button>
                      )}
                      {a.status !== "RESOLVED" && a.status !== "CLOSED" && (
                        <Button size="sm" className="h-7 text-[11px]" onClick={() => { setAlertTarget(a); setResolution(""); }}>Resolve</Button>
                      )}
                      {a.status === "RESOLVED" && (
                        <Button size="sm" variant="ghost" className="h-7 text-[11px]" disabled={working} onClick={() => transition(a, "CLOSE")}>Close</Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        {/* ---------------------------------- CAPACITY -------------------- */}
        <TabsContent value="capacity" className="space-y-3">
          {capacityError ? <Unavailable message={capacityError} /> : !capacity ? <Skeleton className="h-64" /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Carrier capacity (threshold {capacity.threshold_pct}%)</CardTitle></CardHeader>
                <CardContent className="max-h-96 space-y-1 overflow-y-auto text-xs">
                  {capacity.carrier_slots.length === 0 && <p className="text-muted-foreground">No live capacity slots.</p>}
                  {capacity.carrier_slots.map((s) => (
                    <div key={s.id} className="flex items-center justify-between border-b border-border/40 py-1.5 last:border-0">
                      <div>
                        <span className="font-mono">{s.slot_reference ?? s.id.slice(0, 8)}</span>
                        <span className="ml-2 text-muted-foreground">{s.carrier ?? "—"} · {s.corridor ?? "—"}</span>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px]", s.state === "OVERBOOKED" ? toneClass("danger") : s.state === "CONSTRAINED" ? toneClass("warn") : toneClass("ok"))}>
                        {s.utilisation_pct !== null ? `${s.utilisation_pct}%` : "—"} · {s.state}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Hub utilisation</CardTitle></CardHeader>
                <CardContent className="max-h-96 space-y-1 overflow-y-auto text-xs">
                  {capacity.hubs.map((h) => (
                    <div key={h.id} className="flex justify-between border-b border-border/40 py-1.5 last:border-0">
                      <span className="font-mono">{h.code}</span>
                      <span className="text-muted-foreground">
                        {h.utilisation_pct !== null ? `${h.utilisation_pct}%` : "capacity not configured"}
                      </span>
                    </div>
                  ))}
                  <p className="pt-2 text-muted-foreground">
                    Reservations active {capacity.reservations.active} · expiring 24h {capacity.reservations.expiring_24h}
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* --------------------------------- WAREHOUSE -------------------- */}
        <TabsContent value="warehouse" className="space-y-3">
          {warehouseError ? <Unavailable message={warehouseError} /> : !warehouse ? <Skeleton className="h-48" /> : (
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
                <Kpi label="Receiving open" value={warehouse.backlogs.receiving} />
                <Kpi label="Pick lists open" value={warehouse.backlogs.pick} tone="warn" />
                <Kpi label="Pack units open" value={warehouse.backlogs.pack} />
                <Kpi label="Returns received 7d" value={warehouse.backlogs.returns} />
                <Kpi label="Staged packages" value={warehouse.backlogs.staged} />
              </div>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Boxes className="h-4 w-4" /> Operations last 24h · {warehouse.dock_activity_24h} gate events</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-xs">
                  {warehouse.operations_24h.length === 0 && <p className="text-muted-foreground">No warehouse operations recorded in the last 24 hours.</p>}
                  {warehouse.operations_24h.map((o) => (
                    <div key={o.operation_type} className="flex justify-between border-b border-border/40 py-1 last:border-0">
                      <span>{o.operation_type.replace(/_/g, " ")}</span>
                      <span className="text-muted-foreground">{o.events} · {ct.relativeTime(o.last_at)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ---------------------------------- CARRIERS -------------------- */}
        <TabsContent value="carriers" className="space-y-3">
          {carriersError ? <Unavailable message={carriersError} /> : !carriers ? <Skeleton className="h-48" /> : carriers.carriers.length === 0 ? (
            <p className="rounded-md border border-border/60 p-6 text-sm text-muted-foreground">No carriers registered.</p>
          ) : (
            <Card>
              <CardContent className="overflow-x-auto p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr><th className="px-3 py-2">Carrier</th><th className="px-3 py-2">Operating</th><th className="px-3 py-2">Contract</th><th className="px-3 py-2">Active bookings</th><th className="px-3 py-2">Open exceptions</th></tr>
                  </thead>
                  <tbody>
                    {carriers.carriers.map((c) => (
                      <tr key={c.carrier_id} className="border-t border-border/50">
                        <td className="px-3 py-2">{c.name}<span className="ml-2 font-mono text-[11px] text-muted-foreground">{c.code}</span></td>
                        <td className="px-3 py-2 text-xs">{c.operating_status ?? "—"}</td>
                        <td className="px-3 py-2 text-xs">{c.contract_status ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{c.active_bookings}</td>
                        <td className={cn("px-3 py-2 tabular-nums", c.open_exceptions > 0 && "text-destructive")}>{c.open_exceptions}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ----------------------------------- FINANCE -------------------- */}
        <TabsContent value="finance" className="space-y-3">
          {financeError ? <Withheld message={financeError} /> : !finance ? <Skeleton className="h-48" /> : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Kpi label="Open charges (90d)" value={finance.charges.open} caption={`KES ${Math.round(finance.charges.amount).toLocaleString("en-KE")}`} />
              <Kpi label="Invoices issued" value={finance.invoices.issued} caption={`KES ${Math.round(finance.invoices.outstanding).toLocaleString("en-KE")} outstanding`} />
              <Kpi label="Invoices overdue" value={finance.invoices.overdue} tone="danger" />
              <Kpi label="Settlements pending" value={finance.settlements.pending} caption={`variance KES ${Math.round(finance.settlements.variance).toLocaleString("en-KE")}`} tone="warn" />
              <Kpi label="Recon exceptions" value={finance.reconciliation.open_exceptions} tone="danger" caption={`variance KES ${Math.round(finance.reconciliation.variance).toLocaleString("en-KE")}`} />
              <Kpi label="Payments allocated" value={finance.payments.allocated} />
              <Kpi label="Payments unmatched" value={finance.payments.unmatched} tone="warn" />
            </div>
          )}
        </TabsContent>

        {/* --------------------------------- FIELD SYNC ------------------- */}
        <TabsContent value="sync" className="space-y-3">
          {offlineError ? <Unavailable message={offlineError} /> : !offline ? <Skeleton className="h-40" /> : (
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <Kpi label="Devices active" value={offline.devices.active} caption={`${offline.devices.total} registered`} />
              <Kpi label="Devices stale" value={offline.devices.stale} tone="warn" />
              <Kpi label="Queued commands" value={offline.queue.queued} />
              <Kpi label="Conflicts" value={offline.queue.conflicts} tone="danger" caption={offline.queue.oldest_pending_at ? `oldest ${ct.relativeTime(offline.queue.oldest_pending_at)}` : undefined} />
              <Kpi label="Applied 24h" value={offline.queue.applied_24h} tone="ok" />
              <Card className="sm:col-span-3 lg:col-span-5">
                <CardContent className="flex items-center gap-2 p-4 text-xs text-muted-foreground">
                  <WifiOff className="h-4 w-4" />
                  Conflict resolution stays in the Offline Execution &amp; Sync console — the Control Tower reports, it does not duplicate that authority.
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>

        {/* -------------------------------- CONFIGURATION ----------------- */}
        <TabsContent value="config" className="space-y-3">
          {configError ? <Unavailable message={configError} /> : !config ? <Skeleton className="h-64" /> : (
            <div className="grid gap-3 lg:grid-cols-2">
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Sliders className="h-4 w-4" /> Settings</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-xs">
                  {config.settings.map((s) => (
                    <div key={s.setting_key} className="flex items-start justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
                      <div>
                        <p className="text-sm">{s.label}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{s.setting_key}</p>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px]", s.state === "SET" ? toneClass("ok") : toneClass("warn"))}>
                        {s.state === "SET" ? JSON.stringify(s.value) : "OWNER_CONFIGURATION_REQUIRED"}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">SLA policies</CardTitle></CardHeader>
                <CardContent className="space-y-1 text-xs">
                  {config.sla_policies.map((p) => (
                    <div key={p.id} className="border-b border-border/40 py-1.5 last:border-0">
                      <p className="text-sm">{p.label}</p>
                      <p className="text-muted-foreground">
                        {p.scope_kind}{p.scope_value ? `:${p.scope_value}` : ""} · target {p.target_minutes}m ·
                        warn {p.warning_threshold_pct}% · critical {p.critical_threshold_pct}% · grace {p.breach_grace_minutes}m
                      </p>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Alert rules</CardTitle></CardHeader>
                <CardContent className="max-h-80 space-y-1 overflow-y-auto text-xs">
                  {config.alert_rules.map((r) => (
                    <div key={r.rule_key} className="flex items-center justify-between border-b border-border/40 py-1.5 last:border-0">
                      <div>
                        <p className="text-sm">{r.label}</p>
                        <p className="font-mono text-[11px] text-muted-foreground">{r.rule_key} · owner {r.owner_role}</p>
                      </div>
                      <Badge variant="outline" className={cn("text-[10px]", r.enabled ? toneClass("ok") : toneClass("info"))}>
                        {r.enabled ? r.severity : "disabled"}
                      </Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader className="pb-2"><CardTitle className="flex items-center gap-2 text-sm"><Activity className="h-4 w-4" /> Recent operator commands</CardTitle></CardHeader>
                <CardContent className="max-h-80 space-y-1 overflow-y-auto text-xs">
                  {config.recent_commands.length === 0 && <p className="text-muted-foreground">No commands executed yet.</p>}
                  {config.recent_commands.map((c) => (
                    <div key={c.id} className="flex items-center justify-between border-b border-border/40 py-1.5 last:border-0">
                      <span>{c.operation.replace(/_/g, " ").toLowerCase()}</span>
                      <span className={cn("text-muted-foreground", c.outcome !== "APPLIED" && "text-destructive")}>
                        {c.outcome} · {c.latency_ms ?? "—"}ms · {ct.relativeTime(c.created_at)}
                      </span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Resolve alert */}
      <Dialog open={!!alertTarget} onOpenChange={(o) => !o && setAlertTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve {alertTarget?.alert_number}</DialogTitle>
            <DialogDescription>{alertTarget?.reason}</DialogDescription>
          </DialogHeader>
          <Textarea
            value={resolution}
            onChange={(e) => setResolution(e.target.value)}
            placeholder="What was done to resolve this condition? This is recorded on the alert history."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setAlertTarget(null)}>Cancel</Button>
            <Button
              disabled={working || resolution.trim().length === 0}
              onClick={() => alertTarget && transition(alertTarget, "RESOLVE", resolution.trim())}
            >
              {working && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Resolve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Operator command */}
      <Dialog open={!!commandTarget} onOpenChange={(o) => !o && setCommandTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{commandTarget ? ct.COMMAND_LABEL[commandTarget.command] : ""}</DialogTitle>
            <DialogDescription>
              {commandTarget?.row.reference ?? commandTarget?.row.id} — the server authorises and executes this through the
              authoritative logistics workflow, and records the outcome.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={commandNote}
            onChange={(e) => setCommandNote(e.target.value)}
            placeholder="Reason / note recorded with this command"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCommandTarget(null)}>Cancel</Button>
            <Button disabled={working} onClick={executeCommand}>
              {working && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Execute
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
