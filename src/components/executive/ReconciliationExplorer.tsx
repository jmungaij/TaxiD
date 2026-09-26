/**
 * Phase D8.2 — Business Reconciliation Explorer.
 *
 * One reusable drawer that traces a business event across the canonical
 * financial chain (Wallet → Ledger → Journal → Settlement → Revenue →
 * Certification → Readiness) using existing tables. No new engines and no
 * duplicate reconciliation logic — every read hits the canonical service
 * already populated by upstream phases.
 */
import { useEffect, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { Search, CheckCircle2, XCircle, Circle } from "lucide-react";

type StageStatus = "ok" | "missing" | "pending";
interface Stage {
  name: string;
  status: StageStatus;
  detail: string;
  count: number;
}

async function safeCount(
  table: string,
  column: string,
  correlationId: string,
): Promise<{ count: number; err: string | null }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const q = supabase.from(table as any).select("*", { count: "exact", head: true }).eq(column, correlationId);
    const { count, error } = await q;
    if (error) return { count: 0, err: error.message };
    return { count: count ?? 0, err: null };
  } catch (e) {
    return { count: 0, err: String((e as Error).message ?? e) };
  }
}

export function ReconciliationExplorer({
  open, onOpenChange, initialCorrelationId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initialCorrelationId?: string;
}) {
  const [correlationId, setCorrelationId] = useState(initialCorrelationId ?? "");
  const [busy, setBusy] = useState(false);
  const [stages, setStages] = useState<Stage[]>([]);
  const [failurePoint, setFailurePoint] = useState<string | null>(null);

  useEffect(() => { if (initialCorrelationId) setCorrelationId(initialCorrelationId); }, [initialCorrelationId]);

  const trace = async () => {
    if (!correlationId.trim()) return;
    setBusy(true);
    setStages([]);
    setFailurePoint(null);
    // Every table below is canonical and already used by upstream phases.
    const probes: Array<{ name: string; table: string; column: string }> = [
      { name: "Business Event",   table: "event_store",              column: "correlation_id" },
      { name: "Wallet",           table: "wallet_transactions",      column: "correlation_id" },
      { name: "Ledger",           table: "journal_lines",            column: "correlation_id" },
      { name: "Journal",          table: "journals",                 column: "correlation_id" },
      { name: "Payment Attempt",  table: "payment_attempts",         column: "correlation_id" },
      { name: "Settlement",       table: "settlements",              column: "correlation_id" },
      { name: "Revenue",          table: "revenue_events",           column: "correlation_id" },
      { name: "Certification",    table: "payment_certification_runs", column: "correlation_id" },
      { name: "Readiness",        table: "platform_readiness_snapshots", column: "correlation_id" },
    ];
    const out: Stage[] = [];
    let firstFail: string | null = null;
    for (const p of probes) {
      const { count, err } = await safeCount(p.table, p.column, correlationId.trim());
      const status: StageStatus = err ? "pending" : count > 0 ? "ok" : "missing";
      if (!firstFail && status !== "ok") firstFail = p.name;
      out.push({
        name: p.name,
        status,
        detail: err ? `unreachable: ${err}` : `${p.table} • ${count} row${count === 1 ? "" : "s"}`,
        count,
      });
    }
    setStages(out);
    setFailurePoint(firstFail);
    setBusy(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Business Reconciliation Explorer</SheetTitle>
          <SheetDescription>
            Trace a business event across the canonical financial chain. Reuses existing wallet, ledger,
            journal, payment, settlement, revenue, and certification services — no duplicate logic.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 flex gap-2">
          <Input
            placeholder="Correlation ID or trace ID"
            value={correlationId}
            onChange={(e) => setCorrelationId(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void trace()}
          />
          <Button onClick={() => void trace()} disabled={busy || !correlationId.trim()}>
            <Search className="h-4 w-4 mr-1" /> Trace
          </Button>
        </div>

        {stages.length > 0 && (
          <div className="mt-4 space-y-2">
            {failurePoint && (
              <div className="rounded border border-status-warning/40 bg-status-warning/10 dark:bg-status-warning/20 p-2 text-sm">
                First unresolved stage: <strong>{failurePoint}</strong>
              </div>
            )}
            {!failurePoint && (
              <div className="rounded border border-status-success/40 bg-status-success/10 dark:bg-status-success/20 p-2 text-sm">
                Fully reconciled across all canonical stages.
              </div>
            )}
            <ol className="relative border-l pl-4 space-y-3">
              {stages.map((s) => (
                <li key={s.name} className="ml-2">
                  <div className="flex items-center gap-2">
                    {s.status === "ok" && <CheckCircle2 className="h-4 w-4 text-status-success" />}
                    {s.status === "missing" && <XCircle className="h-4 w-4 text-status-warning" />}
                    {s.status === "pending" && <Circle className="h-4 w-4 text-muted-foreground" />}
                    <span className="font-medium text-sm">{s.name}</span>
                    <Badge variant="outline" className="text-[10px]">{s.status.toUpperCase()}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground ml-6">{s.detail}</div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
