// Admin-only DLQ operator view — lists event_outbox_dlq rows and lets ops
// safely replay a dead-lettered message. Replay preserves correlation id +
// idempotency key so consumers stay exactly-once (see outbox-replay fn).
import { useEffect, useMemo, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { RefreshCw, RotateCcw, Copy, AlertOctagon } from "lucide-react";
import { RequireRole } from "@/components/auth/RequireRole";

type DlqRow = {
  id: string;
  event_id: string;
  event_type: string;
  aggregate: string | null;
  aggregate_id: string | null;
  correlation_id: string | null;
  trace_id: string | null;
  idempotency_key: string | null;
  payload: { correlation_id?: string; request_id?: string; [k: string]: unknown } | null;
  retry_count: number | null;
  failure_reason: string | null;
  stack_trace: string | null;
  poisoned: boolean | null;
  resolution_status: string | null;
  created_at: string;
  last_retry_at: string | null;
};

function correlationOf(row: DlqRow): string {
  const p = row.payload ?? {};
  return (
    row.correlation_id ||
    (typeof p.correlation_id === "string" && p.correlation_id) ||
    (typeof p.request_id === "string" && p.request_id) ||
    `evt-${row.event_id}`
  );
}

function fmt(ts: string | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleString();
}

function OutboxDlqInner() {
  const [rows, setRows] = useState<DlqRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("");
  const [replayingId, setReplayingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    // Table was replaced post-typegen; cast to any to bypass generated types.
    const { data, error } = await (supabase as any)
      .from("event_outbox_dlq")
      .select("id,event_id,event_type,aggregate,aggregate_id,correlation_id,trace_id,idempotency_key,payload,retry_count,failure_reason,stack_trace,poisoned,resolution_status,created_at,last_retry_at")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) {
      toast.error(`Failed to load DLQ: ${error.message}`);
      setRows([]);
    } else {
      setRows((data ?? []) as DlqRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return rows;
    const q = filter.trim().toLowerCase();
    return rows.filter((r) =>
      [r.event_id, r.event_type, r.aggregate ?? "", correlationOf(r), r.failure_reason ?? "", r.resolution_status ?? ""]
        .some((s) => s.toLowerCase().includes(q)),
    );
  }, [rows, filter]);

  const handleReplay = useCallback(async (row: DlqRow) => {
    const corr = correlationOf(row);
    if (!confirm(
      `Replay dead-lettered event?\n\n` +
      `Event: ${row.event_id}\n` +
      `Type: ${row.event_type}\n` +
      `Correlation ID: ${corr}\n\n` +
      `The original correlation_id + idempotency_key will be preserved so ` +
      `consumers that already processed this event will treat the replay as a no-op.`,
    )) return;

    setReplayingId(row.event_id);
    try {
      const { data, error } = await supabase.functions.invoke("outbox-replay", {
        body: { message_id: row.event_id },
      });
      if (error) throw error;
      const res = data as { ok?: boolean; correlation_id?: string; idempotency_key?: string; error?: string };
      if (!res?.ok) throw new Error(res?.error ?? "replay_failed");
      toast.success(`Replay queued (correlation_id=${res.correlation_id})`);
      await load();
    } catch (e) {
      toast.error(`Replay failed: ${(e as Error).message}`);
    } finally {
      setReplayingId(null);
    }
  }, [load]);

  const copy = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success(`${label} copied`),
      () => toast.error("Copy failed"),
    );
  };

  return (
    <main className="container mx-auto p-6 space-y-4">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <AlertOctagon className="h-6 w-6 text-destructive" aria-hidden />
            Event Outbox — Dead-Letter Queue
          </h1>
          <p className="text-sm text-muted-foreground">
            Failed events that exhausted delivery retries. Replays preserve the
            original correlation ID and idempotency key.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            aria-label="Filter DLQ rows"
            placeholder="Filter by id, type, consumer, error…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-72"
          />
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {loading ? "Loading…" : `${filtered.length} of ${rows.length} rows`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-muted-foreground">
              <tr className="text-left">
                <th className="p-3">Event</th>
                <th className="p-3">Correlation ID</th>
                <th className="p-3">Status</th>
                <th className="p-3">Failure</th>
                <th className="p-3">Created</th>
                <th className="p-3">Last retry</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const corr = correlationOf(row);
                return (
                  <tr key={row.id} className="border-t align-top">
                    <td className="p-3 font-mono text-xs">
                      <div className="font-medium text-foreground">{row.event_type}</div>
                      <div className="flex items-center gap-1 text-muted-foreground">
                        {row.event_id.slice(0, 8)}…
                        <button aria-label="Copy event id" onClick={() => copy(row.event_id, "Event ID")}>
                          <Copy className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                      <div className="text-muted-foreground">{row.aggregate ?? "—"}</div>
                    </td>
                    <td className="p-3 font-mono text-xs">
                      <div className="flex items-center gap-1">
                        {corr.slice(0, 16)}{corr.length > 16 ? "…" : ""}
                        <button aria-label="Copy correlation id" onClick={() => copy(corr, "Correlation ID")}>
                          <Copy className="h-3 w-3" aria-hidden />
                        </button>
                      </div>
                    </td>
                    <td className="p-3">
                      {row.resolution_status && (
                        <Badge variant="outline">{row.resolution_status}</Badge>
                      )}
                      {row.poisoned && (
                        <Badge variant="destructive" className="ml-1">poisoned</Badge>
                      )}
                    </td>
                    <td className="p-3 max-w-[24rem]">
                      <div className="text-xs text-muted-foreground">
                        attempts: {row.retry_count ?? 0}
                      </div>
                      <p className="text-xs text-destructive break-all mt-1">
                        {row.failure_reason ?? "unknown"}
                      </p>
                    </td>
                    <td className="p-3 text-xs">{fmt(row.created_at)}</td>
                    <td className="p-3 text-xs">{fmt(row.last_retry_at)}</td>
                    <td className="p-3 text-right">
                      <Button
                        size="sm"
                        variant="secondary"
                        disabled={replayingId === row.event_id}
                        onClick={() => handleReplay(row)}
                      >
                        <RotateCcw className={`h-3 w-3 mr-1 ${replayingId === row.event_id ? "animate-spin" : ""}`} aria-hidden />
                        Replay
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-muted-foreground">
                    No dead-lettered events. Nice.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </main>
  );
}

export default function OutboxDlq() {
  return (
    <RequireRole roles={["admin", "super_admin"]}>
      <OutboxDlqInner />
    </RequireRole>
  );
}
