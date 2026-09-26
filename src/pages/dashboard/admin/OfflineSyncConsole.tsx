/**
 * OFFLINE EXECUTION & SYNCHRONISATION CONTROL — /dashboard/admin/logistics-sync
 *
 * Operations surface over the Phase 8 spine. Every number is read from the
 * authoritative journal (no dashboard-side arithmetic on invented data), and
 * every control terminates in a real server verdict:
 *   replay / discard / manually-applied  → lg_offline_resolve
 *   suspend / reinstate a device         → logistics_devices (RLS enforced)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  Search,
  ShieldAlert,
  Smartphone,
  WifiOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTabDeepLink } from "@/hooks/useTabDeepLink";
import { offlineOps, conflictCopy } from "@/lib/logistics/offline";
import type {
  CommandEventRow,
  CommandRow,
  DeviceRow,
  ResolutionKind,
  SyncHealth,
  SyncSessionRow,
} from "@/lib/logistics/offline/opsConsole";

const TABS = ["health", "queue", "conflicts", "devices", "sessions", "operations"] as const;

const NOT_AVAILABLE = "DATA_NOT_AVAILABLE";

function stateBadge(state: CommandRow["state"]) {
  const tone = offlineOps.STATE_TONE[state];
  const variant =
    tone === "ok" ? "secondary" : tone === "danger" ? "destructive" : tone === "warn" ? "default" : "outline";
  return <Badge variant={variant as never}>{state.replace(/_/g, " ")}</Badge>;
}

export default function OfflineSyncConsole() {
  const { toast } = useToast();
  const { tab: activeTab, onTabChange } = useTabDeepLink(TABS, "health");

  const [health, setHealth] = useState<SyncHealth | null>(null);
  const [devices, setDevices] = useState<DeviceRow[]>([]);
  const [commands, setCommands] = useState<CommandRow[]>([]);
  const [sessions, setSessions] = useState<SyncSessionRow[]>([]);
  const [types, setTypes] = useState<Awaited<ReturnType<typeof offlineOps.listCommandTypes>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [target, setTarget] = useState<CommandRow | null>(null);
  const [history, setHistory] = useState<CommandEventRow[]>([]);
  const [resolution, setResolution] = useState<ResolutionKind>("REPLAY");
  const [notes, setNotes] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [h, d, c, s, t] = await Promise.all([
        offlineOps.syncHealth(),
        offlineOps.listDevices({ limit: 200 }),
        offlineOps.listCommands({ limit: 300 }),
        offlineOps.listSyncSessions(50),
        offlineOps.listCommandTypes(),
      ]);
      setHealth(h);
      setDevices(d);
      setCommands(c);
      setSessions(s);
      setTypes(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to read the offline journal.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const conflicts = useMemo(
    () => commands.filter((c) => ["CONFLICT", "PERMANENT_FAILURE", "REJECTED"].includes(c.state)),
    [commands],
  );
  const queue = useMemo(
    () =>
      commands
        .filter((c) => ["QUEUED", "SYNCING", "RETRYABLE_FAILURE"].includes(c.state))
        .filter((c) => !search || c.operation.includes(search) || c.device_id.includes(search)),
    [commands, search],
  );

  const openResolver = async (row: CommandRow) => {
    setTarget(row);
    setResolution("REPLAY");
    setNotes("");
    setHistory(await offlineOps.listCommandHistory(row.id));
  };

  const submitResolution = async () => {
    if (!target) return;
    setWorking(true);
    const result = await offlineOps.resolveCommand(target.id, resolution, notes);
    setWorking(false);
    if (!result.ok) {
      toast({
        variant: "destructive",
        title: result.error?.code ?? "PERMANENT_FAILURE",
        description: result.error?.message ?? "The server refused this resolution.",
      });
      return;
    }
    toast({
      title: `Resolution recorded — ${resolution}`,
      description:
        resolution === "REPLAY"
          ? "The command was re-applied through the authoritative operation."
          : "The journal now carries your decision and the reason.",
    });
    setTarget(null);
    await load();
  };

  const changeDeviceState = async (device: DeviceRow, state: "ACTIVE" | "SUSPENDED") => {
    const reason =
      state === "SUSPENDED" ? "Suspended from the offline operations console" : "Reinstated by operations";
    const result = await offlineOps.setDeviceState(device.id, state, reason);
    if (!result.ok) {
      toast({ variant: "destructive", title: "AUTHORIZATION_DENIED", description: result.error });
      return;
    }
    toast({ title: `Device ${state === "SUSPENDED" ? "suspended" : "reinstated"}`, description: device.device_id });
    await load();
  };

  const exportQueue = () => {
    const csv = offlineOps.toCsv(
      ["Captured", "Received", "Device", "Operation", "Entity", "State", "Attempts", "Error", "Conflict", "Correlation"],
      commands.map((c) => [
        c.client_captured_at, c.server_received_at, c.device_id, c.operation,
        c.entity_id, c.state, c.attempts, c.error_code, c.conflict_reason, c.correlation_id,
      ]),
    );
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `offline-command-journal-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const metric = (label: string, value: number | string | null | undefined) => (
    <Card key={label}>
      <CardHeader className="pb-2">
        <CardTitle className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-2xl font-semibold tabular-nums">
          {value === null || value === undefined ? (
            <span className="text-xs font-normal text-muted-foreground">{NOT_AVAILABLE}</span>
          ) : (
            value
          )}
        </p>
      </CardContent>
    </Card>
  );

  if (loading) {
    return (
      <div className="space-y-4 p-4 md:p-6">
        <Skeleton className="h-9 w-80" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-24" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  const denied = health && health.ok === false && health.code === "AUTHORIZATION_DENIED";

  return (
    <div className="space-y-6 p-4 md:p-6">
      <Helmet>
        <title>Offline Execution & Sync Control | SAFARID</title>
        <meta
          name="description"
          content="Monitor driver devices, the offline command journal, conflicts and synchronisation health across SAFARID field operations."
        />
      </Helmet>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Offline Execution & Synchronisation</h1>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Field captures are journalled on the device and applied through the existing authoritative
            operations. The server always wins: conflicts are surfaced here for a decision, never
            overwritten silently.
          </p>
        </div>
        <div className="flex gap-2">
          <Button data-analytics="offline_sync_export_journal" variant="outline" size="sm" onClick={exportQueue} disabled={commands.length === 0}>
            <Download className="mr-2 h-4 w-4" /> Export journal
          </Button>
          <Button size="sm" onClick={() => void load()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        </div>
      </header>

      {denied ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <ShieldAlert className="mt-0.5 h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">AUTHORIZATION_DENIED</p>
              <p className="text-sm text-muted-foreground">{health?.message}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <CardContent className="flex items-start gap-3 py-6">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-destructive" />
            <div>
              <p className="font-medium">Journal unavailable</p>
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
        {metric("Devices active", health?.devices?.active ?? null)}
        {metric("Devices stale", health?.devices?.stale ?? null)}
        {metric("Queued", health?.queue?.queued ?? null)}
        {metric("Conflicts", health?.queue?.conflict ?? null)}
        {metric("Permanent failures", health?.queue?.permanent_failure ?? null)}
        {metric("Oldest pending (min)", health?.oldest_pending_age_minutes ?? null)}
      </div>

      <Tabs value={activeTab} onValueChange={onTabChange}>
        <TabsList className="flex-wrap">
          <TabsTrigger value="health">Health</TabsTrigger>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="conflicts">Conflicts ({conflicts.length})</TabsTrigger>
          <TabsTrigger value="devices">Devices</TabsTrigger>
          <TabsTrigger value="sessions">Sync sessions</TabsTrigger>
          <TabsTrigger value="operations">Supported operations</TabsTrigger>
        </TabsList>

        <TabsContent value="health" className="space-y-3">
          <Card>
            <CardHeader><CardTitle className="text-base">Synchronisation health</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {health?.data_available === false || !health?.queue ? (
                <p className="text-muted-foreground">
                  {NOT_AVAILABLE} — no devices have registered or synchronised yet.
                </p>
              ) : (
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["Accepted (24h)", health.queue.accepted_24h],
                    ["Awaiting retry", health.queue.retryable],
                    ["Rejected", health.queue.rejected],
                    ["Journal total", health.queue.total],
                    ["Devices total", health.devices?.total ?? NOT_AVAILABLE],
                    ["Max clock skew (ms)", health.devices?.max_clock_skew_ms ?? NOT_AVAILABLE],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="rounded-md border p-3">
                      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                      <dd className="text-lg font-semibold tabular-nums">{String(value)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="text-xs text-muted-foreground">
                Server time: {health?.server_time ?? NOT_AVAILABLE}
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="queue" className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-8"
                placeholder="Filter by operation or device"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Filter the offline queue"
              />
            </div>
          </div>
          {queue.length === 0 ? (
            <EmptyState
              icon={<WifiOff className="h-5 w-5" />}
              title="Nothing waiting to synchronise"
              detail="Every captured command has reached a terminal verdict."
            />
          ) : (
            <CommandTable rows={queue} onSelect={openResolver} />
          )}
        </TabsContent>

        <TabsContent value="conflicts" className="space-y-3">
          {conflicts.length === 0 ? (
            <EmptyState
              icon={<AlertTriangle className="h-5 w-5" />}
              title="No conflicts to resolve"
              detail="No offline capture disagrees with authoritative server state."
            />
          ) : (
            <CommandTable rows={conflicts} onSelect={openResolver} showConflict />
          )}
        </TabsContent>

        <TabsContent value="devices" className="space-y-3">
          {devices.length === 0 ? (
            <EmptyState
              icon={<Smartphone className="h-5 w-5" />}
              title="No devices registered"
              detail="Driver devices appear here the first time they register with the platform."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Device</th>
                    <th className="p-3">Platform</th>
                    <th className="p-3">State</th>
                    <th className="p-3 text-right">Queued</th>
                    <th className="p-3 text-right">Conflicts</th>
                    <th className="p-3 text-right">Failed</th>
                    <th className="p-3 text-right">Last seen (min)</th>
                    <th className="p-3 text-right">Skew (ms)</th>
                    <th className="p-3" />
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d) => (
                    <tr key={d.id} className="border-t">
                      <td className="p-3 font-mono text-xs">{d.device_id}</td>
                      <td className="p-3">{d.platform} · {d.app_version}</td>
                      <td className="p-3">
                        <Badge variant={d.state === "ACTIVE" ? "secondary" : "destructive"}>
                          {offlineOps.isStale(d) ? "STALE" : d.state}
                        </Badge>
                      </td>
                      <td className="p-3 text-right tabular-nums">{d.queued_count}</td>
                      <td className="p-3 text-right tabular-nums">{d.conflict_count}</td>
                      <td className="p-3 text-right tabular-nums">{d.failed_count}</td>
                      <td className="p-3 text-right tabular-nums">
                        {offlineOps.ageMinutes(d.last_seen_at) ?? NOT_AVAILABLE}
                      </td>
                      <td className="p-3 text-right tabular-nums">
                        {d.last_clock_skew_ms ?? NOT_AVAILABLE}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void changeDeviceState(d, d.state === "SUSPENDED" ? "ACTIVE" : "SUSPENDED")}
                        >
                          {d.state === "SUSPENDED" ? "Reinstate" : "Suspend"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="sessions" className="space-y-3">
          {sessions.length === 0 ? (
            <EmptyState
              icon={<RefreshCw className="h-5 w-5" />}
              title="No synchronisation sessions yet"
              detail="Each device push opens a session recording accepted, rejected, conflicted and duplicate counts."
            />
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="p-3">Started</th>
                    <th className="p-3">State</th>
                    <th className="p-3 text-right">Submitted</th>
                    <th className="p-3 text-right">Accepted</th>
                    <th className="p-3 text-right">Conflict</th>
                    <th className="p-3 text-right">Rejected</th>
                    <th className="p-3 text-right">Deferred</th>
                    <th className="p-3 text-right">Duplicates</th>
                    <th className="p-3 text-right">Skew (ms)</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((s) => (
                    <tr key={s.id} className="border-t">
                      <td className="p-3">{new Date(s.started_at).toLocaleString()}</td>
                      <td className="p-3"><Badge variant="outline">{s.state}</Badge></td>
                      <td className="p-3 text-right tabular-nums">{s.commands_submitted}</td>
                      <td className="p-3 text-right tabular-nums">{s.commands_accepted}</td>
                      <td className="p-3 text-right tabular-nums">{s.commands_conflict}</td>
                      <td className="p-3 text-right tabular-nums">{s.commands_rejected}</td>
                      <td className="p-3 text-right tabular-nums">{s.commands_deferred}</td>
                      <td className="p-3 text-right tabular-nums">{s.duplicates_suppressed}</td>
                      <td className="p-3 text-right tabular-nums">{s.clock_skew_ms ?? NOT_AVAILABLE}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="operations" className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Operations enabled for offline capture</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {types.length === 0 ? (
                <p className="text-sm text-muted-foreground">{NOT_AVAILABLE}</p>
              ) : (
                types.map((t) => (
                  <div key={t.operation} className="rounded-md border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs">{t.operation}</span>
                      <Badge variant="outline">{t.entity_type}</Badge>
                      {t.requires_gps ? <Badge variant="secondary">GPS required</Badge> : null}
                      {t.offline_allowed ? null : <Badge variant="destructive">disabled</Badge>}
                      <span className="ml-auto text-xs text-muted-foreground">
                        applies via {t.target_rpc} · {t.max_attempts} attempts
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{t.description}</p>
                    {t.required_keys.length > 0 ? (
                      <p className="mt-1 text-xs text-muted-foreground">
                        Required payload: {t.required_keys.join(", ")}
                      </p>
                    ) : null}
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={!!target} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Resolve offline command</DialogTitle>
            <DialogDescription>
              {target ? `${target.operation} · sequence ${target.sequence_number} · ${target.device_id}` : ""}
            </DialogDescription>
          </DialogHeader>

          {target ? (
            <div className="space-y-4 text-sm">
              {target.conflict_reason ? (
                <div className="rounded-md border p-3">
                  <p className="font-medium">{conflictCopy(target.conflict_reason)?.title}</p>
                  <p className="text-muted-foreground">{conflictCopy(target.conflict_reason)?.guidance}</p>
                </div>
              ) : null}

              <dl className="grid gap-2 sm:grid-cols-2">
                {[
                  ["State", target.state],
                  ["Error code", target.error_code ?? NOT_AVAILABLE],
                  ["Category", target.error_category ?? NOT_AVAILABLE],
                  ["Retryable", target.retryable === null ? NOT_AVAILABLE : String(target.retryable)],
                  ["Attempts", target.attempts],
                  ["Captured (device)", new Date(target.client_captured_at).toLocaleString()],
                  ["Received (server)", target.server_received_at ? new Date(target.server_received_at).toLocaleString() : NOT_AVAILABLE],
                  ["Clock skew (ms)", target.client_clock_skew_ms ?? NOT_AVAILABLE],
                  ["Correlation id", target.correlation_id],
                  ["Idempotency key", target.idempotency_key],
                  ["Transaction id", target.transaction_id ?? NOT_AVAILABLE],
                  ["Payload hash", target.payload_hash.slice(0, 16)],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
                    <dd className="break-all font-mono text-xs">{String(value)}</dd>
                  </div>
                ))}
              </dl>

              {target.error_message ? (
                <p className="rounded-md border p-3 text-xs">{target.error_message}</p>
              ) : null}

              <div>
                <p className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Journal history</p>
                <ol className="space-y-1">
                  {history.map((h) => (
                    <li key={h.id} className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="text-muted-foreground">{new Date(h.occurred_at).toLocaleString()}</span>
                      <span className="font-mono">
                        {h.from_state ?? "—"} → {h.to_state}
                      </span>
                      {h.reason ? <span className="text-muted-foreground">{h.reason}</span> : null}
                      <Badge variant="outline">{h.actor_type}</Badge>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="space-y-2">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Decision</p>
                <div className="flex flex-wrap gap-2">
                  {(["REPLAY", "DISCARD", "MANUALLY_APPLIED"] as ResolutionKind[]).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={resolution === k ? "default" : "outline"}
                      onClick={() => setResolution(k)}
                    >
                      {k === "REPLAY" ? "Replay now" : k === "DISCARD" ? "Discard" : "Handled manually"}
                    </Button>
                  ))}
                </div>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Why is this the correct resolution? (required, min 6 characters)"
                  aria-label="Resolution notes"
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)}>Cancel</Button>
            <Button onClick={() => void submitResolution()} disabled={working || notes.trim().length < 6}>
              {working ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  detail,
}: {
  icon: React.ReactNode;
  title: string;
  detail: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-start gap-3 py-8">
        <span className="mt-0.5 text-muted-foreground">{icon}</span>
        <div>
          <p className="font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{detail}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function CommandTable({
  rows,
  onSelect,
  showConflict = false,
}: {
  rows: CommandRow[];
  onSelect: (row: CommandRow) => void | Promise<void>;
  showConflict?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="p-3">Captured</th>
            <th className="p-3">Operation</th>
            <th className="p-3">Device</th>
            <th className="p-3">State</th>
            <th className="p-3">{showConflict ? "Conflict" : "Error"}</th>
            <th className="p-3 text-right">Attempts</th>
            <th className="p-3" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="p-3 whitespace-nowrap">
                {new Date(row.client_captured_at).toLocaleString()}
              </td>
              <td className="p-3 font-mono text-xs">{row.operation}</td>
              <td className="p-3 font-mono text-xs">{row.device_id.slice(0, 14)}…</td>
              <td className="p-3">{stateBadge(row.state)}</td>
              <td className="p-3 text-xs">
                {showConflict
                  ? conflictCopy(row.conflict_reason)?.title ?? row.error_code ?? "—"
                  : row.error_code ?? "—"}
              </td>
              <td className="p-3 text-right tabular-nums">{row.attempts}</td>
              <td className="p-3 text-right">
                <Button size="sm" variant="outline" onClick={() => void onSelect(row)}>
                  Inspect
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
