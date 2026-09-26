import { useCallback, useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle, RefreshCw, ShieldAlert, Timer } from "lucide-react";
import { toast } from "sonner";
import DeliveryAttemptDialog from "@/components/logistics/orders/DeliveryAttemptDialog";
import {
  CLOSED_EXCEPTION_STATUSES,
  EXCEPTION_STATUSES,
  classifyFulfilment,
  loadExceptionEvents,
  loadExceptions,
  loadOrderDeliverySummary,
  loadPackageAttempts,
  slaState,
  transitionException,
  type DeliveryAttempt,
  type ExceptionEvent,
  type ExceptionStatus,
  type LogisticsException,
  type OrderDeliverySummary,
} from "@/lib/logistics/orders/attempts";
import { FLEETBASE_PARITY_REGISTER, summariseParity } from "@/lib/logistics/fleetbaseParity";

const SEVERITY_VARIANT: Record<LogisticsException["severity"], "default" | "secondary" | "destructive" | "outline"> = {
  low: "outline",
  medium: "secondary",
  high: "default",
  critical: "destructive",
};

/**
 * Logistics Exception Control Centre — the operational surface over
 * `logistics_exceptions`. Every status change is a server RPC
 * (`logistics_exception_transition`) with an append-only event trail; the client
 * only renders what the database already decided.
 */
export default function LogisticsExceptions() {
  const [rows, setRows] = useState<LogisticsException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<ExceptionStatus | "all">("open");
  const [severity, setSeverity] = useState<LogisticsException["severity"] | "all">("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LogisticsException | null>(null);
  const [events, setEvents] = useState<ExceptionEvent[]>([]);
  const [attempts, setAttempts] = useState<DeliveryAttempt[]>([]);
  const [summary, setSummary] = useState<OrderDeliverySummary | null>(null);
  const [note, setNote] = useState("");
  const [target, setTarget] = useState<ExceptionStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [attemptOpen, setAttemptOpen] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    const { rows: data, error: err } = await loadExceptions({ status, severity, limit: 200 });
    setRows(data);
    setError(err);
    setLoading(false);
  }, [status, severity]);

  useEffect(() => { void refresh(); }, [refresh]);

  const openDetail = useCallback(async (exception: LogisticsException) => {
    setSelected(exception);
    setNote("");
    setTarget("");
    setEvents(await loadExceptionEvents(exception.id));
    setAttempts(exception.package_id ? await loadPackageAttempts(exception.package_id) : []);
    if (exception.order_id) {
      const result = await loadOrderDeliverySummary(exception.order_id);
      setSummary(result.ok ? (result.data ?? null) : null);
    } else {
      setSummary(null);
    }
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        r.exception_number.toLowerCase().includes(q) ||
        (r.reason_code ?? "").toLowerCase().includes(q) ||
        r.kind.toLowerCase().includes(q),
    );
  }, [rows, search]);

  const breached = useMemo(() => filtered.filter((r) => slaState(r).breached).length, [filtered]);
  const parity = useMemo(() => summariseParity(), []);
  const openParityActions = useMemo(
    () => FLEETBASE_PARITY_REGISTER.filter((r) => r.remaining.length > 0),
    [],
  );

  async function applyTransition() {
    if (!selected || !target) return;
    setBusy(true);
    const isClosing = CLOSED_EXCEPTION_STATUSES.includes(target);
    const result = await transitionException({
      exceptionId: selected.id,
      toStatus: target,
      note: isClosing ? null : note.trim() || null,
      resolution: isClosing ? note.trim() || null : null,
    });
    setBusy(false);
    if (!result.ok) {
      toast.error(result.message ?? "The exception could not be updated.");
      return;
    }
    toast.success(`Exception moved to ${target.replace(/_/g, " ")}.`);
    await refresh();
    const fresh = { ...selected, status: target };
    setSelected(fresh);
    setEvents(await loadExceptionEvents(selected.id));
    setNote("");
    setTarget("");
  }

  return (
    <div className="container mx-auto px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShieldAlert className="h-6 w-6 text-primary" /> Exception Control Centre
          </h1>
          <p className="text-sm text-muted-foreground">
            Every failed delivery attempt opens a numbered exception with severity, owner and SLA. Status
            changes are server-authoritative and permanently recorded.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh()}>
          <RefreshCw className="h-4 w-4 mr-2" /> Refresh
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Exceptions shown</div>
          <div className="text-2xl font-bold">{filtered.length}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">SLA breached</div>
          <div className="text-2xl font-bold text-destructive">{breached}</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Fleetbase parity</div>
          <div className="text-2xl font-bold">{parity.parityPercent}%</div>
          <div className="text-xs text-muted-foreground">
            {parity.parity} at parity · {parity.partial} partial · {parity.gap} gap
          </div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-muted-foreground">Open parity actions</div>
          <div className="text-2xl font-bold">{parity.openActions}</div>
          <div className="text-xs text-muted-foreground">{openParityActions.length} capabilities</div>
        </Card>
      </div>

      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <Label className="text-xs">Status</Label>
          <Select value={status} onValueChange={(v) => setStatus(v as ExceptionStatus | "all")}>
            <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {EXCEPTION_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Severity</Label>
          <Select value={severity} onValueChange={(v) => setSeverity(v as LogisticsException["severity"] | "all")}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All severities</SelectItem>
              <SelectItem value="critical">Critical</SelectItem>
              <SelectItem value="high">High</SelectItem>
              <SelectItem value="medium">Medium</SelectItem>
              <SelectItem value="low">Low</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[200px]">
          <Label className="text-xs">Search</Label>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Exception number, kind or reason code" />
        </div>
      </Card>

      {error && (
        <Card className="p-4 flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {error}
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-0 overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No exceptions match these filters.
            </div>
          ) : (
            <ul className="divide-y">
              {filtered.map((row) => {
                const sla = slaState(row);
                return (
                  <li key={row.id}>
                    <button
                      type="button"
                      onClick={() => void openDetail(row)}
                      className={`w-full text-left p-4 hover:bg-muted/50 transition-colors ${selected?.id === row.id ? "bg-muted/60" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-mono text-sm">{row.exception_number}</span>
                        <Badge variant={SEVERITY_VARIANT[row.severity]}>{row.severity}</Badge>
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground flex flex-wrap items-center gap-2">
                        <span className="capitalize">{row.kind.replace(/_/g, " ")}</span>
                        {row.reason_code && <span className="font-mono">{row.reason_code}</span>}
                        <Badge variant="outline" className="capitalize">{row.status.replace(/_/g, " ")}</Badge>
                        <span className={`flex items-center gap-1 ${sla.breached ? "text-destructive" : ""}`}>
                          <Timer className="h-3 w-3" /> {sla.label}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card className="p-4 space-y-4">
          {!selected ? (
            <p className="text-sm text-muted-foreground">Select an exception to see its attempts, history and actions.</p>
          ) : (
            <>
              <div>
                <div className="font-mono text-sm">{selected.exception_number}</div>
                <div className="text-xs text-muted-foreground capitalize">
                  {selected.kind.replace(/_/g, " ")} · owner {selected.owner_role.replace(/_/g, " ")}
                </div>
                {selected.narrative && <p className="text-sm mt-2">{selected.narrative}</p>}
              </div>

              {summary && summary.total > 0 && (
                <div className="rounded-md border p-3 text-xs space-y-1">
                  <div className="font-semibold text-sm">
                    Order fulfilment: <span className="capitalize">{classifyFulfilment(summary).replace(/_/g, " ")}</span>
                  </div>
                  <div className="text-muted-foreground">
                    {summary.delivered}/{summary.total} delivered · {summary.failed} failed · {summary.returned} returned ·{" "}
                    {summary.in_progress} in progress
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <div className="text-sm font-semibold">Delivery attempts</div>
                {attempts.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No attempts recorded for this package.</p>
                ) : (
                  <ol className="space-y-1 text-xs">
                    {attempts.map((a) => (
                      <li key={a.id} className="flex items-center justify-between gap-2 border-b pb-1">
                        <span>
                          #{a.attempt_number} · <span className="capitalize">{a.outcome}</span>
                          {a.reason_code ? ` · ${a.reason_code}` : ""}
                        </span>
                        <span className="text-muted-foreground">{new Date(a.occurred_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {selected.package_id && !CLOSED_EXCEPTION_STATUSES.includes(selected.status) && (
                  <Button size="sm" variant="outline" onClick={() => setAttemptOpen(true)}>
                    Record a re-attempt
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <div className="text-sm font-semibold">History</div>
                <ol className="space-y-1 text-xs text-muted-foreground">
                  {events.map((e) => (
                    <li key={e.id}>
                      <span className="font-mono">{e.event_name}</span>
                      {e.note ? ` — ${e.note}` : ""}
                      <span className="ml-1">({new Date(e.created_at).toLocaleString()})</span>
                    </li>
                  ))}
                </ol>
              </div>

              {CLOSED_EXCEPTION_STATUSES.includes(selected.status) ? (
                <p className="text-xs text-muted-foreground">
                  This exception is closed. {selected.resolution ? `Resolution: ${selected.resolution}` : ""}
                </p>
              ) : (
                <div className="space-y-2 border-t pt-3">
                  <Label className="text-xs">Move to</Label>
                  <Select value={target} onValueChange={(v) => setTarget(v as ExceptionStatus)}>
                    <SelectTrigger><SelectValue placeholder="Select a status" /></SelectTrigger>
                    <SelectContent>
                      {EXCEPTION_STATUSES.filter((s) => s.value !== selected.status).map((s) => (
                        <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Label className="text-xs">
                    {target && CLOSED_EXCEPTION_STATUSES.includes(target) ? "Resolution (required)" : "Note"}
                  </Label>
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
                  <Button
                    size="sm"
                    disabled={busy || !target || (CLOSED_EXCEPTION_STATUSES.includes(target as ExceptionStatus) && note.trim().length < 3)}
                    onClick={() => void applyTransition()}
                  >
                    {busy ? "Applying…" : "Apply"}
                  </Button>
                </div>
              )}
            </>
          )}
        </Card>
      </div>

      <Card className="p-4">
        <div className="text-sm font-semibold mb-2">Fleetbase parity register — open actions</div>
        <ul className="space-y-1 text-xs text-muted-foreground">
          {openParityActions.map((row) => (
            <li key={row.capability}>
              <span className="font-medium text-foreground">{row.capability}</span>{" "}
              <Badge variant="outline" className="mr-1">{row.status}</Badge>
              {row.remaining.join("; ")}
            </li>
          ))}
        </ul>
      </Card>

      {selected?.package_id && (
        <DeliveryAttemptDialog
          open={attemptOpen}
          onOpenChange={setAttemptOpen}
          packageId={selected.package_id}
          nextAttemptNumber={attempts.length + 1}
          onRecorded={async () => {
            await refresh();
            if (selected) await openDetail(selected);
          }}
        />
      )}
    </div>
  );
}
