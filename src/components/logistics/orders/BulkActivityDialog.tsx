import { useMemo, useRef, useState } from "react";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { toast } from "sonner";
import {
  activityLabel, bulkTargets, type ActivityModel,
} from "@/lib/logistics/orders/activityModel";
import {
  newCorrelationId, retryableFailures, runBulkActivityUpdate,
  type BatchItemResult, type BatchProgress,
} from "@/lib/logistics/orders/batchController";

export interface BulkOrderRef {
  id: string;
  order_number: string;
  status: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orders: BulkOrderRef[];
  model: ActivityModel;
  onCompleted: () => void;
}

export function BulkActivityDialog({ open, onOpenChange, orders, model, onCompleted }: Props) {
  const [target, setTarget] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<BatchProgress | null>(null);
  const [results, setResults] = useState<BatchItemResult[]>([]);
  const [batchId, setBatchId] = useState<string | null>(null);
  const idempotency = useRef<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const distribution = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of orders) map.set(o.status, (map.get(o.status) ?? 0) + 1);
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [orders]);

  const targets = useMemo(() => bulkTargets(model, orders.map((o) => o.status)), [model, orders]);
  const chosen = targets.find((t) => t.activity.code === target) ?? null;
  const reasonMissing = !!chosen?.requiresReason && reason.trim().length === 0;

  const reset = () => {
    setTarget(null); setReason(""); setProgress(null); setResults([]); setBatchId(null);
    idempotency.current = null;
  };

  const execute = async (subset?: BatchItemResult[]) => {
    if (!chosen || running) return;
    const ids = subset ? subset.map((r) => r.orderId) : orders.map((o) => o.id);
    if (ids.length === 0) return;
    // A fresh idempotency key per attempt; retries reuse the same batch ledger
    // server-side, so succeeded rows are never re-applied.
    idempotency.current = subset ? `${idempotency.current}` : `bulk-activity-${newCorrelationId()}`;
    const key = subset ? `${idempotency.current}` : idempotency.current!;
    setRunning(true);
    abort.current = new AbortController();
    const numbers = Object.fromEntries(orders.map((o) => [o.id, o.order_number]));
    const outcome = await runBulkActivityUpdate({
      orderIds: ids,
      orderNumbers: numbers,
      targetActivity: chosen.activity.code,
      reason: reason.trim() || undefined,
      idempotencyKey: key,
      concurrency: 4,
      signal: abort.current.signal,
      onProgress: (p, r) => { setProgress(p); setResults((prev) => merge(prev, r)); },
    });
    setRunning(false);
    setBatchId(outcome.batchId);
    if (outcome.fatal) {
      toast.error(outcome.fatal.message);
      return;
    }
    setProgress(outcome.progress);
    setResults((prev) => merge(prev, outcome.results));
    if (outcome.progress.failed === 0) {
      toast.success(`${outcome.progress.succeeded} order${outcome.progress.succeeded === 1 ? "" : "s"} updated`);
    } else {
      toast.warning(`${outcome.progress.succeeded} updated · ${outcome.progress.failed} failed`);
    }
    onCompleted();
  };

  const failures = results.filter((r) => r.status === "failed");
  const retryable = retryableFailures(results);
  const done = !!progress && progress.remaining === 0 && !running;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (running) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-h-[90vh] w-[min(96vw,42rem)] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Update activity · {orders.length} order{orders.length === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>
            Every order is validated, persisted and audited individually by the server.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Current distribution</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {distribution.map(([code, count]) => (
                <Badge key={code} variant="outline" className="text-[11px]">
                  {activityLabel(model, code)} · {count}
                </Badge>
              ))}
            </div>
          </div>

          <div>
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Target activity</Label>
            {targets.length === 0 ? (
              <p className="mt-1.5 text-sm text-muted-foreground">
                No activity change is valid for this selection.
              </p>
            ) : (
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                {targets.map((t) => (
                  <button
                    key={t.activity.code}
                    type="button"
                    disabled={running}
                    aria-pressed={target === t.activity.code}
                    onClick={() => setTarget(t.activity.code)}
                    className={`rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 ${
                      target === t.activity.code ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="text-sm font-semibold">{t.activity.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {t.eligible} eligible
                      {t.blocked > 0 && ` · ${t.blocked} not allowed`}
                      {t.alreadyThere > 0 && ` · ${t.alreadyThere} already there`}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {chosen && chosen.warnings.length > 0 && (
            <div className="flex gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden />
              <ul className="space-y-1 text-xs text-status-warning">
                {chosen.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </div>
          )}

          {chosen && (
            <div>
              <Label htmlFor="bulk-reason" className="text-xs uppercase tracking-wide text-muted-foreground">
                Reason {chosen.requiresReason ? "(required)" : "(optional)"}
              </Label>
              <Textarea
                id="bulk-reason"
                value={reason}
                disabled={running}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Recorded on every affected order's audit trail"
                className="mt-1.5"
              />
            </div>
          )}

          {progress && (
            <div className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">
                  {running ? `Processing ${progress.processed} / ${progress.total}` : `${progress.total} selected`}
                </span>
                {batchId && <span className="font-mono text-[10px] text-muted-foreground">batch {batchId.slice(0, 8)}</span>}
              </div>
              <Progress value={progress.total ? (progress.processed / progress.total) * 100 : 0} />
              <div className="flex flex-wrap gap-3 text-xs">
                <span className="flex items-center gap-1 text-status-success">
                  <CheckCircle2 className="h-3.5 w-3.5" /> {progress.succeeded} successful
                </span>
                <span className="flex items-center gap-1 text-status-danger">
                  <XCircle className="h-3.5 w-3.5" /> {progress.failed} failed
                </span>
                <span className="text-muted-foreground">{progress.remaining} remaining</span>
              </div>
            </div>
          )}

          {failures.length > 0 && (
            <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-status-danger/30 p-2">
              {failures.map((f) => (
                <div key={f.orderId} className="flex items-start justify-between gap-2 text-xs">
                  <span className="font-mono">{f.orderNumber ?? f.orderId.slice(0, 8)}</span>
                  <span className="text-right text-muted-foreground">
                    <span className="font-mono text-[10px]">{f.code}</span> — {f.message}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" disabled={running} onClick={() => { reset(); onOpenChange(false); }}>
            Close
          </Button>
          {done && retryable.length > 0 && (
            <Button variant="outline" onClick={() => execute(retryable)}>
              Retry failed ({retryable.length})
            </Button>
          )}
          <Button
            onClick={() => execute()}
            disabled={!chosen || running || reasonMissing || done}
          >
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {running ? "Executing…" : `Confirm · ${chosen?.eligible ?? 0} order${(chosen?.eligible ?? 0) === 1 ? "" : "s"}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function merge(prev: BatchItemResult[], next: BatchItemResult[]): BatchItemResult[] {
  const byId = new Map(prev.map((r) => [r.orderId, r]));
  for (const r of next) byId.set(r.orderId, r);
  return [...byId.values()];
}

export default BulkActivityDialog;
