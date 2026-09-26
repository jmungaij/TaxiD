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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertTriangle, Boxes, ClipboardList, DoorOpen, PackageSearch,
  RefreshCw, ScanLine, Truck, Warehouse, WifiOff,
} from "lucide-react";
import { toast } from "sonner";
import {
  LOCATION_TYPES,
  ZONE_TYPES,
  consolidate,
  createPickList,
  dispatchManifest,
  findPackage,
  hubSupports,
  listDocks,
  listLocations,
  listOfflineQueue,
  listOperations,
  listOutboundManifests,
  listPickLines,
  listPickLists,
  listPlacements,
  listReceivingSessions,
  listWarehouseHubs,
  listZones,
  operationKey,
  packPackage,
  pickLine,
  putAway,
  reconcileOffline,
  receiveScan,
  reconcileReceiving,
  recordGateEvent,
  sortPackage,
  stageOutbound,
  tracePackage,
  upsertDock,
  upsertLocation,
  upsertZone,
  type DockRow,
  type HubOption,
  type LocationRow,
  type OfflineQueueRow,
  type OpenManifestOption,
  type PackageLookup,
  type PackageTrace,
  type PickLineRow,
  type PickListRow,
  type PlacementRow,
  type ReceivingSessionRow,
  type WhOperationRow,
  type WhResult,
  type ZoneRow,
  type ZoneType,
  type LocationType,
} from "@/lib/logistics/warehouse/warehouseEngine";

const DEVICE_ID = "WEB-CONSOLE";

/** Surfaces the server's own verdict — the console never decides an outcome. */
function report(action: string, result: WhResult) {
  if (result.ok && result.duplicate) {
    toast.info(`${action}: already recorded, nothing changed`);
    return;
  }
  if (result.ok) {
    toast.success(`${action} recorded`);
    return;
  }
  toast.error(`${action} refused`, { description: result.message ?? result.code ?? "Refused" });
}

export default function LogisticsWarehouse() {
  const [hubs, setHubs] = useState<HubOption[]>([]);
  const [hubId, setHubId] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [locations, setLocations] = useState<LocationRow[]>([]);
  const [docks, setDocks] = useState<DockRow[]>([]);
  const [sessions, setSessions] = useState<ReceivingSessionRow[]>([]);
  const [operations, setOperations] = useState<WhOperationRow[]>([]);
  const [placements, setPlacements] = useState<PlacementRow[]>([]);
  const [pickLists, setPickLists] = useState<PickListRow[]>([]);
  const [pickLines, setPickLines] = useState<PickLineRow[]>([]);
  const [activePickList, setActivePickList] = useState<string>("");
  const [manifests, setManifests] = useState<OpenManifestOption[]>([]);
  const [offline, setOffline] = useState<OfflineQueueRow[]>([]);

  const hub = useMemo(() => hubs.find((h) => h.id === hubId) ?? null, [hubs, hubId]);

  const loadHubs = useCallback(async () => {
    const rows = await listWarehouseHubs();
    setHubs(rows);
    setHubId((current) => current || rows[0]?.id || "");
    setLoading(false);
  }, []);

  const refresh = useCallback(async () => {
    if (!hubId) return;
    const [z, l, d, s, o, p, pl, m, q] = await Promise.all([
      listZones(hubId), listLocations(hubId), listDocks(hubId),
      listReceivingSessions(hubId), listOperations(hubId), listPlacements(hubId),
      listPickLists(hubId), listOutboundManifests(hubId), listOfflineQueue(),
    ]);
    setZones(z); setLocations(l); setDocks(d); setSessions(s);
    setOperations(o); setPlacements(p); setPickLists(pl); setManifests(m); setOffline(q);
  }, [hubId]);

  useEffect(() => { void loadHubs(); }, [loadHubs]);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!activePickList) { setPickLines([]); return; }
    void listPickLines(activePickList).then(setPickLines);
  }, [activePickList]);

  const run = useCallback(async (action: string, fn: () => Promise<WhResult>) => {
    setBusy(true);
    try {
      report(action, await fn());
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [refresh]);

  /* ---------------------------------------------------------------- layout */
  const [zoneForm, setZoneForm] = useState({ code: "", name: "", zoneType: "STORAGE" as ZoneType });
  const [locForm, setLocForm] = useState({
    code: "", zoneId: "", locationType: "BIN" as LocationType,
    aisle: "", rack: "", shelf: "", bin: "",
  });
  const [dockForm, setDockForm] = useState({ code: "", dockType: "BOTH" as const });

  /* ---------------------------------------------------------------- inbound */
  const [gateForm, setGateForm] = useState({
    vehicleRegistration: "", manifestId: "", dockId: "", sealId: "",
    declaredPackageCount: "", notes: "",
  });
  const [scanSession, setScanSession] = useState("");
  const [scanValue, setScanValue] = useState("");
  const [varianceNote, setVarianceNote] = useState("");

  /* ---------------------------------------------------------------- movement */
  const [lookup, setLookup] = useState("");
  const [found, setFound] = useState<PackageLookup | null>(null);
  const [targetLocation, setTargetLocation] = useState("");
  const [targetManifest, setTargetManifest] = useState("");
  const [trace, setTrace] = useState<PackageTrace | null>(null);

  const doLookup = useCallback(async () => {
    const row = await findPackage(lookup);
    setFound(row);
    setTrace(row ? await tracePackage(row.id) : null);
    if (!row) toast.error("No package with that tracking number");
  }, [lookup]);

  /* ---------------------------------------------------------------- pack */
  const [packForm, setPackForm] = useState({
    stationCode: "", packagingType: "", weightKg: "", lengthCm: "", widthCm: "", heightCm: "",
  });

  const openSession = sessions.find((s) => s.status !== "RECONCILED");

  if (loading) {
    return (
      <div className="space-y-4 p-6">
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <Warehouse className="h-6 w-6 text-primary" aria-hidden />
            Warehouse Control Centre
          </h1>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Physical execution against the existing logistics spine. Every action here writes to the
            same package, manifest, hub, route and custody records used everywhere else — this console
            holds no separate warehouse state.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={hubId} onValueChange={setHubId}>
            <SelectTrigger className="w-64"><SelectValue placeholder="Select a hub" /></SelectTrigger>
            <SelectContent>
              {hubs.map((h) => (
                <SelectItem key={h.id} value={h.id}>{h.code} — {h.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={() => void refresh()} aria-label="Refresh">
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </header>

      {hub && (
        <div className="flex flex-wrap gap-1.5">
          {(hub.capabilities ?? []).map((c) => (
            <Badge key={c} variant="secondary">{c.replace(/_/g, " ")}</Badge>
          ))}
          {(hub.capabilities ?? []).length === 0 && (
            <Badge variant="outline">no capabilities configured</Badge>
          )}
        </div>
      )}

      <Tabs defaultValue="inbound">
        <TabsList className="flex-wrap">
          <TabsTrigger value="inbound"><DoorOpen className="mr-1.5 h-4 w-4" />Inbound</TabsTrigger>
          <TabsTrigger value="floor"><Boxes className="mr-1.5 h-4 w-4" />Storage &amp; Floor</TabsTrigger>
          <TabsTrigger value="fulfilment"><ClipboardList className="mr-1.5 h-4 w-4" />Fulfilment</TabsTrigger>
          <TabsTrigger value="outbound"><Truck className="mr-1.5 h-4 w-4" />Outbound</TabsTrigger>
          <TabsTrigger value="layout"><Warehouse className="mr-1.5 h-4 w-4" />Layout</TabsTrigger>
          <TabsTrigger value="offline"><WifiOff className="mr-1.5 h-4 w-4" />Offline queue</TabsTrigger>
          <TabsTrigger value="trace"><PackageSearch className="mr-1.5 h-4 w-4" />Trace</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------------ inbound */}
        <TabsContent value="inbound" className="space-y-4">
          {!hubSupports(hub, "receive") && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                This hub does not hold the receiving capability. The server will refuse receipts here.
              </AlertDescription>
            </Alert>
          )}

          <Card className="space-y-4 p-5">
            <h2 className="font-medium">Vehicle arrival</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="veh">Vehicle registration</Label>
                <Input id="veh" value={gateForm.vehicleRegistration}
                  onChange={(e) => setGateForm({ ...gateForm, vehicleRegistration: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Arriving manifest</Label>
                <Input placeholder="manifest id (optional)" value={gateForm.manifestId}
                  onChange={(e) => setGateForm({ ...gateForm, manifestId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label>Dock</Label>
                <Select value={gateForm.dockId} onValueChange={(v) => setGateForm({ ...gateForm, dockId: v })}>
                  <SelectTrigger><SelectValue placeholder="Select dock" /></SelectTrigger>
                  <SelectContent>
                    {docks.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.code} — {d.status}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="seal">Seal id</Label>
                <Input id="seal" value={gateForm.sealId}
                  onChange={(e) => setGateForm({ ...gateForm, sealId: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="declared">Declared packages</Label>
                <Input id="declared" inputMode="numeric" value={gateForm.declaredPackageCount}
                  onChange={(e) => setGateForm({ ...gateForm, declaredPackageCount: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="gnote">Notes</Label>
                <Input id="gnote" value={gateForm.notes}
                  onChange={(e) => setGateForm({ ...gateForm, notes: e.target.value })} />
              </div>
            </div>
            <Button disabled={busy || !hubId} onClick={() => void run("Arrival", () => recordGateEvent({
              hubId,
              direction: "ARRIVAL",
              operationKey: operationKey({ device: DEVICE_ID, action: "gate-in", subject: gateForm.vehicleRegistration || "unknown" }),
              manifestId: gateForm.manifestId || null,
              vehicleRegistration: gateForm.vehicleRegistration || null,
              dockId: gateForm.dockId || null,
              sealId: gateForm.sealId || null,
              sealIntact: gateForm.sealId ? true : null,
              declaredPackageCount: gateForm.declaredPackageCount ? Number(gateForm.declaredPackageCount) : null,
              notes: gateForm.notes || null,
            }))}>
              Record arrival
            </Button>
          </Card>

          <Card className="space-y-4 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Receiving scans</h2>
              {openSession && <Badge variant="secondary">session open</Badge>}
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-1">
                <Label>Receiving session</Label>
                <Select value={scanSession} onValueChange={setScanSession}>
                  <SelectTrigger><SelectValue placeholder="Select session" /></SelectTrigger>
                  <SelectContent>
                    {sessions.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.status} · {s.received_count ?? 0}/{s.expected_count ?? 0} · {new Date(s.opened_at).toLocaleString()}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="scan">Scan tracking number</Label>
                <div className="flex gap-2">
                  <Input id="scan" value={scanValue} placeholder="Scan or type a label"
                    onChange={(e) => setScanValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== "Enter" || !scanSession || !scanValue.trim()) return;
                      const identifier = scanValue.trim();
                      setScanValue("");
                      void run("Receive scan", () => receiveScanCall(scanSession, identifier));
                    }} />
                  <Button variant="secondary" disabled={busy || !scanSession || !scanValue.trim()}
                    onClick={() => {
                      const identifier = scanValue.trim();
                      setScanValue("");
                      void run("Receive scan", () => receiveScanCall(scanSession, identifier));
                    }}>
                    <ScanLine className="mr-1.5 h-4 w-4" />Scan
                  </Button>
                </div>
              </div>
            </div>

            <Separator />
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="variance">Variance explanation</Label>
                <Textarea id="variance" rows={2} value={varianceNote}
                  onChange={(e) => setVarianceNote(e.target.value)}
                  placeholder="Required before closing a receipt with a shortfall" />
              </div>
              <div className="flex items-end gap-2">
                <Button variant="outline" disabled={busy || !scanSession}
                  onClick={() => void run("Reconcile", () => reconcileReceiving({
                    sessionId: scanSession, varianceNote: varianceNote || null, close: false,
                  }))}>
                  Check
                </Button>
                <Button disabled={busy || !scanSession}
                  onClick={() => void run("Close receipt", () => reconcileReceiving({
                    sessionId: scanSession, varianceNote: varianceNote || null, close: true,
                  }))}>
                  Close receipt
                </Button>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Closing a receipt reconciles the arriving manifest, which releases its packages for
              outbound movement. A shortfall cannot be closed without an explanation.
            </p>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ floor */}
        <TabsContent value="floor" className="space-y-4">
          <Card className="space-y-4 p-5">
            <h2 className="font-medium">Package actions</h2>
            <div className="flex flex-wrap gap-2">
              <Input className="max-w-xs" value={lookup} placeholder="Tracking number"
                onChange={(e) => setLookup(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void doLookup(); }} />
              <Button variant="secondary" onClick={() => void doLookup()}>Find</Button>
              {found && (
                <Badge variant="outline" className="self-center">
                  {found.tracking_number} · {found.status}
                </Badge>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Location</Label>
                <Select value={targetLocation} onValueChange={setTargetLocation}>
                  <SelectTrigger><SelectValue placeholder="Select location" /></SelectTrigger>
                  <SelectContent>
                    {locations.map((l) => (
                      <SelectItem key={l.id} value={l.id}>
                        {l.code} · {l.location_type} · {l.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button disabled={busy || !found || !targetLocation}
                  onClick={() => found && void run("Put-away", () => putAway({
                    packageId: found.id, hubId, locationId: targetLocation,
                    operationKey: operationKey({ device: DEVICE_ID, action: "putaway", subject: found.id }),
                    deviceId: DEVICE_ID,
                  }))}>
                  Put away
                </Button>
                <Button variant="outline" disabled={busy || !found}
                  onClick={() => found && void run("Sort", () => sortPackage({
                    packageId: found.id, hubId,
                    operationKey: operationKey({ device: DEVICE_ID, action: "sort", subject: found.id }),
                    deviceId: DEVICE_ID,
                  }))}>
                  Sort
                </Button>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-medium">Inventory on hand</h2>
            {placements.length === 0 ? (
              <p className="text-sm text-muted-foreground">No packages placed at this hub.</p>
            ) : (
              <div className="max-h-80 overflow-auto text-sm">
                <table className="w-full">
                  <thead className="sticky top-0 bg-background text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Package</th><th>Location</th><th>State</th><th>Updated</th></tr>
                  </thead>
                  <tbody>
                    {placements.map((p) => (
                      <tr key={p.package_id} className="border-t">
                        <td className="py-1.5 font-mono text-xs">{p.package_id.slice(0, 8)}</td>
                        <td>{locations.find((l) => l.id === p.location_id)?.code ?? "—"}</td>
                        <td><Badge variant="secondary">{p.inventory_state}</Badge></td>
                        <td className="text-muted-foreground">{new Date(p.updated_at).toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ fulfilment */}
        <TabsContent value="fulfilment" className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Pick lists</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" disabled={busy || !found}
                onClick={() => found && void run("Pick list", () => createPickList({
                  hubId, packageIds: [found.id],
                }))}>
                Create list for {found?.tracking_number ?? "selected package"}
              </Button>
              <Select value={activePickList} onValueChange={setActivePickList}>
                <SelectTrigger className="w-72"><SelectValue placeholder="Open a pick list" /></SelectTrigger>
                <SelectContent>
                  {pickLists.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.status} · {p.picked_count ?? 0}/{p.line_count ?? 0} · {new Date(p.created_at).toLocaleString()}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {pickLines.length > 0 && (
              <div className="space-y-2">
                {pickLines.map((line) => (
                  <div key={line.id} className="flex items-center justify-between rounded-md border p-2 text-sm">
                    <span className="font-mono text-xs">{line.package_id.slice(0, 8)}</span>
                    <Badge variant="secondary">{line.state}</Badge>
                    <Button size="sm" variant="outline" disabled={busy || line.state === "PICKED"}
                      onClick={() => void run("Pick", () => pickLine({
                        lineId: line.id,
                        operationKey: operationKey({ device: DEVICE_ID, action: "pick", subject: line.id }),
                        deviceId: DEVICE_ID,
                      }))}>
                      Pick
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Packing station</h2>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="station">Station</Label>
                <Input id="station" value={packForm.stationCode}
                  onChange={(e) => setPackForm({ ...packForm, stationCode: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ptype">Packaging</Label>
                <Input id="ptype" value={packForm.packagingType}
                  onChange={(e) => setPackForm({ ...packForm, packagingType: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pw">Weight (kg)</Label>
                <Input id="pw" inputMode="decimal" value={packForm.weightKg}
                  onChange={(e) => setPackForm({ ...packForm, weightKg: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pl">Length (cm)</Label>
                <Input id="pl" inputMode="numeric" value={packForm.lengthCm}
                  onChange={(e) => setPackForm({ ...packForm, lengthCm: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pwid">Width (cm)</Label>
                <Input id="pwid" inputMode="numeric" value={packForm.widthCm}
                  onChange={(e) => setPackForm({ ...packForm, widthCm: e.target.value })} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ph">Height (cm)</Label>
                <Input id="ph" inputMode="numeric" value={packForm.heightCm}
                  onChange={(e) => setPackForm({ ...packForm, heightCm: e.target.value })} />
              </div>
            </div>
            <Button disabled={busy || !found}
              onClick={() => found && void run("Pack", () => packPackage({
                packageId: found.id, hubId,
                operationKey: operationKey({ device: DEVICE_ID, action: "pack", subject: found.id }),
                stationCode: packForm.stationCode || null,
                packagingType: packForm.packagingType || null,
                weightKg: packForm.weightKg ? Number(packForm.weightKg) : null,
                lengthCm: packForm.lengthCm ? Number(packForm.lengthCm) : null,
                widthCm: packForm.widthCm ? Number(packForm.widthCm) : null,
                heightCm: packForm.heightCm ? Number(packForm.heightCm) : null,
                deviceId: DEVICE_ID,
              }))}>
              Pack package
            </Button>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ outbound */}
        <TabsContent value="outbound" className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Consolidation &amp; staging</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Outbound manifest</Label>
                <Select value={targetManifest} onValueChange={setTargetManifest}>
                  <SelectTrigger><SelectValue placeholder="Select manifest" /></SelectTrigger>
                  <SelectContent>
                    {manifests.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.manifest_number} · {m.manifest_type} · {m.status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-end gap-2">
                <Button variant="outline" disabled={busy || !found || !targetManifest}
                  onClick={() => found && void run("Consolidate", () => consolidate({
                    packageId: found.id, hubId, manifestId: targetManifest,
                    operationKey: operationKey({ device: DEVICE_ID, action: "consolidate", subject: found.id }),
                    deviceId: DEVICE_ID,
                  }))}>
                  Add to manifest
                </Button>
                <Button variant="outline" disabled={busy || !found}
                  onClick={() => found && void run("Stage", () => stageOutbound({
                    packageId: found.id, hubId,
                    operationKey: operationKey({ device: DEVICE_ID, action: "stage", subject: found.id }),
                    locationId: targetLocation || null,
                    manifestId: targetManifest || null,
                    deviceId: DEVICE_ID,
                  }))}>
                  Stage outbound
                </Button>
              </div>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Departure</h2>
            <p className="text-sm text-muted-foreground">
              Dispatch transitions the manifest, dispatches every package on it and records the gate
              departure. It is refused while an inbound receipt for the hub is still open.
            </p>
            <Button disabled={busy || !targetManifest}
              onClick={() => void run("Dispatch", () => dispatchManifest({
                manifestId: targetManifest, hubId,
                operationKey: operationKey({ device: DEVICE_ID, action: "dispatch", subject: targetManifest }),
                dockId: gateForm.dockId || null,
                sealId: gateForm.sealId || null,
              }))}>
              <Truck className="mr-1.5 h-4 w-4" />Dispatch manifest
            </Button>
          </Card>

          <Card className="p-5">
            <h2 className="mb-3 font-medium">Recent operations</h2>
            <div className="max-h-80 overflow-auto text-sm">
              <table className="w-full">
                <thead className="sticky top-0 bg-background text-left text-xs uppercase text-muted-foreground">
                  <tr><th className="py-2">When</th><th>Operation</th><th>Package</th><th>Stage</th></tr>
                </thead>
                <tbody>
                  {operations.map((op) => (
                    <tr key={op.id} className="border-t">
                      <td className="py-1.5 text-muted-foreground">{new Date(op.created_at).toLocaleString()}</td>
                      <td><Badge variant="secondary">{op.operation_type}</Badge></td>
                      <td className="font-mono text-xs">{op.package_id ? op.package_id.slice(0, 8) : "—"}</td>
                      <td>{op.stage ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ layout */}
        <TabsContent value="layout" className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Zones</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <Input placeholder="Code" value={zoneForm.code}
                onChange={(e) => setZoneForm({ ...zoneForm, code: e.target.value })} />
              <Input placeholder="Name" value={zoneForm.name}
                onChange={(e) => setZoneForm({ ...zoneForm, name: e.target.value })} />
              <Select value={zoneForm.zoneType} onValueChange={(v) => setZoneForm({ ...zoneForm, zoneType: v as ZoneType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {ZONE_TYPES.map((z) => <SelectItem key={z} value={z}>{z}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button disabled={busy || !zoneForm.code || !zoneForm.name}
                onClick={() => void run("Zone", () => upsertZone({
                  hubId, code: zoneForm.code, name: zoneForm.name, zoneType: zoneForm.zoneType,
                }))}>
                Add zone
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {zones.map((z) => <Badge key={z.id} variant="outline">{z.code} · {z.zone_type}</Badge>)}
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Locations</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <Input placeholder="Code (A-01-01-01)" value={locForm.code}
                onChange={(e) => setLocForm({ ...locForm, code: e.target.value })} />
              <Select value={locForm.zoneId} onValueChange={(v) => setLocForm({ ...locForm, zoneId: v })}>
                <SelectTrigger><SelectValue placeholder="Zone" /></SelectTrigger>
                <SelectContent>
                  {zones.map((z) => <SelectItem key={z.id} value={z.id}>{z.code}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={locForm.locationType}
                onValueChange={(v) => setLocForm({ ...locForm, locationType: v as LocationType })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LOCATION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
              <Button disabled={busy || !locForm.code}
                onClick={() => void run("Location", () => upsertLocation({
                  hubId, zoneId: locForm.zoneId || null, code: locForm.code,
                  locationType: locForm.locationType,
                  aisle: locForm.aisle || null, rack: locForm.rack || null,
                  shelf: locForm.shelf || null, bin: locForm.bin || null,
                }))}>
                Add location
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{locations.length} locations configured.</p>
          </Card>

          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Docks</h2>
            <div className="grid gap-3 md:grid-cols-4">
              <Input placeholder="Dock code" value={dockForm.code}
                onChange={(e) => setDockForm({ ...dockForm, code: e.target.value })} />
              <Button disabled={busy || !dockForm.code}
                onClick={() => void run("Dock", () => upsertDock({ hubId, code: dockForm.code }))}>
                Add dock
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {docks.map((d) => <Badge key={d.id} variant="outline">{d.code} · {d.status}</Badge>)}
            </div>
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ offline */}
        <TabsContent value="offline" className="space-y-4">
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium">Captured while offline</h2>
              <Button variant="secondary" disabled={busy}
                onClick={() => void run("Replay", () => reconcileOffline(50))}>
                Replay queue
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              Queued scans replay with the key they were captured under, so a scan that already
              reached the server is recorded as a duplicate rather than applied twice.
            </p>
            {offline.length === 0 ? (
              <p className="text-sm text-muted-foreground">Queue is empty.</p>
            ) : (
              <div className="max-h-80 overflow-auto text-sm">
                <table className="w-full">
                  <thead className="sticky top-0 bg-background text-left text-xs uppercase text-muted-foreground">
                    <tr><th className="py-2">Captured</th><th>Device</th><th>Type</th><th>State</th><th>Reason</th></tr>
                  </thead>
                  <tbody>
                    {offline.map((q) => (
                      <tr key={q.id} className="border-t">
                        <td className="py-1.5 text-muted-foreground">{new Date(q.captured_at).toLocaleString()}</td>
                        <td>{q.device_id}</td>
                        <td>{q.operation_type}</td>
                        <td><Badge variant="secondary">{q.state}</Badge></td>
                        <td className="text-muted-foreground">{q.failure_reason ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ------------------------------------------------------------ trace */}
        <TabsContent value="trace" className="space-y-4">
          <Card className="space-y-3 p-5">
            <h2 className="font-medium">Package trace</h2>
            <div className="flex gap-2">
              <Input className="max-w-xs" value={lookup} placeholder="Tracking number"
                onChange={(e) => setLookup(e.target.value)} />
              <Button variant="secondary" onClick={() => void doLookup()}>Trace</Button>
            </div>
            {trace ? (
              <div className="grid gap-3 md:grid-cols-4">
                <Stat label="Custody events" value={trace.custody?.length ?? 0} />
                <Stat label="Warehouse operations" value={trace.warehouse_operations?.length ?? 0} />
                <Stat label="Manifests" value={trace.manifests?.length ?? 0} />
                <Stat label="Route stops" value={trace.stops?.length ?? 0} />
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Find a package to see its single custody history across every hub it passed through.
              </p>
            )}
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );

  function receiveScanCall(sessionId: string, identifier: string) {
    return receiveScan({
      sessionId,
      identifier,
      operationKey: operationKey({ device: DEVICE_ID, action: "receive", subject: identifier }),
      deviceId: DEVICE_ID,
    });
  }
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs uppercase text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold">{value}</p>
    </div>
  );
}
