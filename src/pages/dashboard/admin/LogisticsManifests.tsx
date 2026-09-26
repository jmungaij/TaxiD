import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, Boxes, PackageCheck, RefreshCw, ScanLine } from "lucide-react";
import { toast } from "sonner";
import {
  MANIFEST_STATUS_LABELS,
  MANIFEST_TYPES,
  allowedScanStates,
  allowedTransitions,
  createManifest,
  loadEligibleDrivers,
  loadHubs,
  loadManifestEvents,
  loadManifestLines,
  loadManifests,
  loadReconciliation,
  reconcilable,
  reconciliationVerdict,
  removeFromManifest,
  scanOntoManifest,
  transitionManifest,
  type EligibleDriver,
  type Hub,
  type Manifest,
  type ManifestEvent,
  type ManifestLine,
  type ManifestReconciliation,
  type ManifestStatus,
  type ManifestType,
  type ScanState,
} from "@/lib/logistics/manifests/manifestEngine";

const STATUS_VARIANT: Record<ManifestStatus, "default" | "secondary" | "outline" | "destructive"> = {
  open: "secondary",
  closed: "outline",
  assigned: "default",
  dispatched: "default",
  received: "outline",
  reconciled: "outline",
  cancelled: "destructive",
};

const SCAN_VARIANT: Record<ScanState, "default" | "secondary" | "outline" | "destructive"> = {
  expected: "outline",
  loaded: "secondary",
  received: "default",
  missing: "destructive",
  damaged: "destructive",
  rejected: "destructive",
};

/**
 * Manifest & Hub Custody Console — the operational surface over
 * `logistics_manifests`. Creation, scanning, removal, lifecycle moves and
 * reconciliation all execute server RPCs; the client never edits a line state.
 */
export default function LogisticsManifests() {
  const [rows, setRows] = useState<Manifest[]>([]);
  const [hubs, setHubs] = useState<Hub[]>([]);
  const [drivers, setDrivers] = useState<EligibleDriver[]>([]);
  const [statusFilter, setStatusFilter] = useState<ManifestStatus | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Manifest | null>(null);
  const [lines, setLines] = useState<ManifestLine[]>([]);
  const [events, setEvents] = useState<ManifestEvent[]>([]);
  const [recon, setRecon] = useState<ManifestReconciliation | null>(null);

  const [newType, setNewType] = useState<ManifestType>("delivery_run");
  const [originHub, setOriginHub] = useState<string>("none");
  const [destHub, setDestHub] = useState<string>("none");
  const [scanValue, setScanValue] = useState("");
  const [scanState, setScanState] = useState<ScanState | "">("");
  const [driverId, setDriverId] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: data, error: err } = await loadManifests(statusFilter);
    setRows(data);
    setError(err);
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void loadHubs().then(setHubs); }, []);
  useEffect(() => { void loadEligibleDrivers().then(setDrivers); }, []);

  const openManifest = useCallback(async (manifest: Manifest) => {
    setSelected(manifest);
    setScanState(allowedScanStates(manifest.status)[0] ?? "");
    setNote("");
    setDriverId(manifest.assigned_driver_id ?? "");
    setLines(await loadManifestLines(manifest.id));
    setEvents(await loadManifestEvents(manifest.id));
    const r = await loadReconciliation(manifest.id);
    setRecon(r.ok ? (r.data ?? null) : null);
  }, []);

  const reload = useCallback(async () => {
    await refresh();
    if (selected) {
      const { rows: fresh } = await loadManifests(statusFilter);
      const updated = fresh.find((m) => m.id === selected.id);
      await openManifest(updated ?? selected);
    }
  }, [refresh, selected, statusFilter, openManifest]);

  async function doCreate() {
    setBusy(true);
    const result = await createManifest({
      type: newType,
      originHubId: originHub === "none" ? null : originHub,
      destinationHubId: destHub === "none" ? null : destHub,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The manifest could not be created.");
      return;
    }
    toast.success(`Manifest ${result.data?.manifest_number} created.`);
    await refresh();
  }

  async function doScan() {
    if (!selected || !scanValue.trim() || !scanState) return;
    setBusy(true);
    const result = await scanOntoManifest({
      manifestId: selected.id,
      identifier: scanValue.trim(),
      scanState,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The scan was rejected.");
      return;
    }
    if (result.data?.duplicate) {
      toast.info(`${result.data.tracking_number} was already scanned — not counted twice.`);
    } else {
      toast.success(`${result.data?.tracking_number} → ${result.data?.scan_state}`);
    }
    setScanValue("");
    await reload();
  }

  async function doRemove(line: ManifestLine) {
    setBusy(true);
    const result = await removeFromManifest({ manifestId: line.manifest_id, packageId: line.package_id });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The package could not be removed.");
      return;
    }
    toast.success(`${line.tracking_number} removed from the manifest.`);
    await reload();
  }

  async function doTransition(to: ManifestStatus) {
    if (!selected) return;
    setBusy(true);
    const result = await transitionManifest({
      manifestId: selected.id,
      toStatus: to,
      driverId: to === "assigned" ? driverId.trim() || null : null,
      note: note.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The manifest could not be updated.");
      return;
    }
    toast.success(`Manifest ${MANIFEST_STATUS_LABELS[to].toLowerCase()}.`);
    setNote("");
    await reload();
  }

  const verdict = useMemo(() => (recon ? reconciliationVerdict(recon) : null), [recon]);
  const scanStates = selected ? allowedScanStates(selected.status) : [];

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Boxes className="h-6 w-6 text-primary" /> Manifest &amp; Hub Custody
          </h1>
          <p className="text-sm text-muted-foreground">
            Group packages into manifests, scan them in and out of custody, dispatch, receive at the
            destination hub and reconcile physical against system. Every scan writes a custody record.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </header>

      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">New manifest type</Label>
          <Select value={newType} onValueChange={(v) => setNewType(v as ManifestType)}>
            <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MANIFEST_TYPES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Origin hub</Label>
          <Select value={originHub} onValueChange={setOriginHub}>
            <SelectTrigger className="w-44"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Destination hub</Label>
          <Select value={destHub} onValueChange={setDestHub}>
            <SelectTrigger className="w-44"><SelectValue placeholder="None" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Not set</SelectItem>
              {hubs.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={() => void doCreate()} disabled={busy}>Create manifest</Button>
        <div className="space-y-1 ml-auto">
          <Label className="text-xs">Filter</Label>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ManifestStatus | "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {(Object.keys(MANIFEST_STATUS_LABELS) as ManifestStatus[]).map((s) => (
                <SelectItem key={s} value={s}>{MANIFEST_STATUS_LABELS[s]}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {hubs.length === 0 && (
        <Card className="p-4 text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4" />
          No hubs are configured yet. Manifests still work without hubs; an administrator can add depots,
          warehouses and cross-dock sites to enable hub-to-hub line hauls.
        </Card>
      )}

      {error && (
        <Card className="p-4 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No manifests yet. Create one above, then scan packages onto it.
            </div>
          ) : (
            <ul className="divide-y">
              {rows.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => void openManifest(m)}
                    className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${selected?.id === m.id ? "bg-muted/60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm">{m.manifest_number}</span>
                      <Badge variant={STATUS_VARIANT[m.status]}>{MANIFEST_STATUS_LABELS[m.status]}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {m.manifest_type.replace(/_/g, " ")} · created {new Date(m.created_at).toLocaleString()}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select a manifest to scan, dispatch and reconcile it.</p>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-sm">{selected.manifest_number}</div>
                  <div className="text-xs text-muted-foreground">
                    {selected.manifest_type.replace(/_/g, " ")}
                    {selected.assigned_driver_id ? " · driver assigned" : ""}
                  </div>
                </div>
                <Badge variant={STATUS_VARIANT[selected.status]}>{MANIFEST_STATUS_LABELS[selected.status]}</Badge>
              </div>

              {recon && (
                <div className="rounded-md border p-3 text-xs space-y-1">
                  <div className="text-sm font-semibold flex items-center gap-2">
                    <PackageCheck className="h-4 w-4" /> Reconciliation
                  </div>
                  <div className="text-muted-foreground">
                    {recon.total} lines · {recon.loaded} loaded · {recon.received} received · {recon.missing} missing ·{" "}
                    {recon.damaged} damaged · {recon.rejected} rejected
                  </div>
                  {verdict && (
                    <div className={verdict.clean ? "text-foreground" : "text-destructive"}>
                      {verdict.clean
                        ? "Physical matches system."
                        : `Discrepancies: ${verdict.discrepancies.join(", ")}`}
                    </div>
                  )}
                </div>
              )}

              {scanStates.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs flex items-center gap-1"><ScanLine className="h-3 w-3" /> Scan a package</Label>
                  <div className="flex flex-wrap gap-2">
                    <Input
                      className="flex-1 min-w-[180px]"
                      value={scanValue}
                      onChange={(e) => setScanValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") void doScan(); }}
                      placeholder="Tracking number or package ID"
                    />
                    <Select value={scanState} onValueChange={(v) => setScanState(v as ScanState)}>
                      <SelectTrigger className="w-40"><SelectValue placeholder="Scan state" /></SelectTrigger>
                      <SelectContent>
                        {scanStates.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button onClick={() => void doScan()} disabled={busy || !scanValue.trim() || !scanState}>
                      Scan
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-sm font-semibold">Packages ({lines.length})</div>
                {lines.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No packages on this manifest yet.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {lines.map((l) => (
                      <li key={l.id} className="flex items-center justify-between gap-2 border-b pb-1">
                        <span className="font-mono">{l.tracking_number}</span>
                        <span className="flex items-center gap-2">
                          <Badge variant={SCAN_VARIANT[l.scan_state]}>{l.scan_state}</Badge>
                          {selected.status === "open" && (
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => void doRemove(l)}>
                              Remove
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {allowedTransitions(selected.status).length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  {allowedTransitions(selected.status).includes("assigned") && (
                    <div className="space-y-1">
                      <Label className="text-xs">Eligible driver (active &amp; verified only)</Label>
                      <Select value={driverId} onValueChange={setDriverId}>
                        <SelectTrigger>
                          <SelectValue placeholder={drivers.length ? "Select a driver" : "No eligible drivers"} />
                        </SelectTrigger>
                        <SelectContent>
                          {drivers.map((d) => (
                            <SelectItem key={d.user_id} value={d.user_id}>
                              {d.full_name}{d.driver_type ? ` · ${d.driver_type}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {drivers.length === 0 && (
                        <p className="text-xs text-muted-foreground">
                          No active, verified driver is available to assign. Verify a driver in Driver
                          Administration and they will appear here.
                        </p>
                      )}
                    </div>
                  )}
                  <Label className="text-xs">Note (optional)</Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                  <div className="flex flex-wrap gap-2">
                    {allowedTransitions(selected.status).map((to) => (
                      <Button
                        key={to}
                        size="sm"
                        variant={to === "cancelled" ? "outline" : "default"}
                        disabled={
                          busy ||
                          (to === "assigned" && !driverId.trim()) ||
                          (to === "reconciled" && !(recon && reconcilable(recon)))
                        }
                        onClick={() => void doTransition(to)}
                      >
                        {MANIFEST_STATUS_LABELS[to]}
                      </Button>
                    ))}
                  </div>
                  {selected.status === "received" && recon && !reconcilable(recon) && (
                    <p className="text-xs text-muted-foreground">
                      Reconciliation is blocked until every line is accounted for (received, missing, damaged or rejected).
                    </p>
                  )}
                </div>
              )}

              <div className="space-y-1 border-t pt-3">
                <div className="text-sm font-semibold">History</div>
                <ol className="space-y-1 text-xs text-muted-foreground max-h-56 overflow-auto">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="font-mono">{e.event_name}</span>
                      {e.note ? ` — ${e.note}` : ""} ({new Date(e.created_at).toLocaleString()})
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
