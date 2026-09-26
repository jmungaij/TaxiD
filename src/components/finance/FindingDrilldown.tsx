/**
 * Discrepancy drill-down.
 *
 * Opens a single reconciliation finding and shows the underlying evidence:
 * the wallet's append-only ledger entries (expected) beside the settlement
 * items — the M-Pesa funding requests that should back them (actual) — plus
 * links to the reconciliation run that produced the finding.
 *
 * Acknowledge / resolve is executed by `charter_wallet_resolve_finding`, which
 * enforces the `recon.resolve` permission server-side.
 */
import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import type { ReconFindingLike, ReconRunLike } from "@/lib/charter/reconciliationExports";
import { findingVariance } from "@/lib/charter/reconciliationExports";
import { reconDeniedReason } from "@/lib/charter/reconPermissions";
import { recordReconAction } from "@/lib/charter/reconAudit";

interface LedgerItem {
  id: string; direction: string; amount_kes: number; balance_after: number;
  reference: string | null; created_at: string; entry_hash: string | null;
}
interface SettlementItem {
  id: string; reference: string | null; status: string; amount_kes: number;
  mpesa_receipt: string | null; ledger_entry_id: string | null; created_at: string;
}

const money = (n: unknown) => `KSh ${new Intl.NumberFormat("en-KE").format(Math.round(Number(n ?? 0)))}`;
const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-KE") : "—");

export function FindingDrilldown({
  finding, run, canResolve, onClose, onResolved,
}: {
  finding: ReconFindingLike | null;
  run: ReconRunLike | null;
  canResolve: boolean;
  onClose: () => void;
  onResolved: () => void | Promise<void>;
}) {
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [settlements, setSettlements] = useState<SettlementItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (f: ReconFindingLike) => {
    setLoading(true);
    const [l, s] = await Promise.all([
      f.wallet_id
        ? supabase.from("charter_wallet_ledger").select("*")
            .eq("wallet_id", f.wallet_id).order("created_at", { ascending: false }).limit(25)
        : Promise.resolve({ data: [] as unknown[] }),
      f.wallet_id
        ? supabase.from("charter_wallet_funding_requests").select("*")
            .eq("wallet_id", f.wallet_id).order("created_at", { ascending: false }).limit(25)
        : Promise.resolve({ data: [] as unknown[] }),
    ]);
    setLedger(((l as { data: unknown[] }).data ?? []) as LedgerItem[]);
    setSettlements(((s as { data: unknown[] }).data ?? []) as SettlementItem[]);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (finding) { setNotes(finding.resolution_notes ?? ""); void load(finding); }
  }, [finding, load]);

  const act = async (status: "acknowledged" | "resolved" | "false_positive") => {
    if (!finding) return;
    if (!canResolve) {
      await recordReconAction({
        action: status === "acknowledged" ? "acknowledge" : "resolve",
        permission: "recon.resolve", targetType: "finding", targetId: finding.id,
        outcome: "denied", detail: { status, kind: finding.kind },
      });
      toast({ title: "Not permitted", description: reconDeniedReason("recon.resolve"), variant: "destructive" });
      return;
    }
    setBusy(status);
    try {
      const { error } = await supabase.rpc("charter_wallet_resolve_finding", {
        _finding_id: finding.id, _status: status, _notes: notes.trim() || null,
      } as never);
      if (error) throw new Error(error.message);
      await recordReconAction({
        action: status === "acknowledged" ? "acknowledge" : "resolve",
        permission: "recon.resolve", targetType: "finding", targetId: finding.id,
        resolutionNotes: notes.trim() || null,
        detail: {
          status, kind: finding.kind, severity: finding.severity,
          run_id: finding.run_id, wallet_id: finding.wallet_id,
          expected_kes: finding.expected_kes, actual_kes: finding.actual_kes,
        },
      });
      toast({ title: `Finding ${status.replace("_", " ")}`, description: "Recorded with your notes and included in exports." });
      await onResolved();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error";
      await recordReconAction({
        action: status === "acknowledged" ? "acknowledge" : "resolve",
        permission: "recon.resolve", targetType: "finding", targetId: finding.id,
        outcome: "failed", detail: { status, error: msg },
      });
      toast({ title: "Could not update finding", description: msg, variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };


  const ledgerSum = ledger.reduce(
    (sum, e) => sum + (e.direction === "credit" ? Number(e.amount_kes) : -Number(e.amount_kes)), 0,
  );
  const settledSum = settlements
    .filter((s) => s.status === "paid")
    .reduce((sum, s) => sum + Number(s.amount_kes), 0);

  return (
    <Dialog open={!!finding} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[85vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" aria-hidden /> Discrepancy detail
          </DialogTitle>
          <DialogDescription>{finding?.detail}</DialogDescription>
        </DialogHeader>

        {finding && (
          <div className="space-y-6">
            <div className="grid gap-3 rounded-xl border border-border p-4 text-xs sm:grid-cols-3">
              <div>
                <p className="text-muted-foreground">Severity</p>
                <Badge variant={finding.severity === "critical" ? "destructive" : "secondary"}>{finding.severity}</Badge>
              </div>
              <div><p className="text-muted-foreground">Kind</p><p className="font-mono">{finding.kind}</p></div>
              <div><p className="text-muted-foreground">Detected</p><p>{when(finding.created_at)}</p></div>
              <div><p className="text-muted-foreground">Expected (ledger)</p><p className="tabular-nums">{finding.expected_kes == null ? "—" : money(finding.expected_kes)}</p></div>
              <div><p className="text-muted-foreground">Actual (wallet)</p><p className="tabular-nums">{finding.actual_kes == null ? "—" : money(finding.actual_kes)}</p></div>
              <div><p className="text-muted-foreground">Variance</p><p className="tabular-nums">{findingVariance(finding) == null ? "—" : money(findingVariance(finding))}</p></div>
              <div className="sm:col-span-3">
                <p className="text-muted-foreground">Reconciliation run</p>
                <p className="font-mono">{finding.run_id}</p>
                {run && (
                  <p className="text-muted-foreground">
                    {when(run.window_start)} → {when(run.window_end)} · {run.triggered_by} ·{" "}
                    {run.findings} finding(s), {run.critical} critical
                  </p>
                )}
              </div>
              <div className="sm:col-span-3">
                <p className="text-muted-foreground">Status</p>
                <Badge variant={(finding.resolution_status ?? "open") === "open" ? "destructive" : "outline"}>
                  {finding.resolution_status ?? "open"}
                </Badge>
                {finding.resolved_at && <span className="ml-2">resolved {when(finding.resolved_at)}</span>}
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <p className="mb-2 text-sm font-semibold">
                  Ledger entries <span className="text-muted-foreground">· net {money(ledgerSum)}</span>
                </p>
                {loading ? <Skeleton className="h-24 w-full" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead><TableHead>Dir</TableHead>
                        <TableHead className="text-right">Amount</TableHead><TableHead>Reference</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-xs text-muted-foreground">No ledger entries for this wallet.</TableCell></TableRow>
                      )}
                      {ledger.map((e) => (
                        <TableRow key={e.id}>
                          <TableCell className="text-xs">{when(e.created_at)}</TableCell>
                          <TableCell className="text-xs">{e.direction}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{money(e.amount_kes)}</TableCell>
                          <TableCell className="font-mono text-xs">{e.reference ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold">
                  Settlement items <span className="text-muted-foreground">· paid {money(settledSum)}</span>
                </p>
                {loading ? <Skeleton className="h-24 w-full" /> : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>When</TableHead><TableHead>Status</TableHead>
                        <TableHead className="text-right">Amount</TableHead><TableHead>Receipt</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {settlements.length === 0 && (
                        <TableRow><TableCell colSpan={4} className="text-xs text-muted-foreground">No funding requests for this wallet.</TableCell></TableRow>
                      )}
                      {settlements.map((s) => (
                        <TableRow key={s.id} className={s.id === finding.funding_request_id ? "bg-muted/50" : undefined}>
                          <TableCell className="text-xs">{when(s.created_at)}</TableCell>
                          <TableCell className="text-xs">{s.status}</TableCell>
                          <TableCell className="text-right text-xs tabular-nums">{money(s.amount_kes)}</TableCell>
                          <TableCell className="font-mono text-xs">
                            {s.mpesa_receipt ?? <span className="text-destructive">missing</span>}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="finding-notes">Resolution notes (included in exports)</Label>
              <Textarea id="finding-notes" value={notes} onChange={(e) => setNotes(e.target.value)}
                placeholder="What was verified, what was corrected and by whom." rows={3} />
            </div>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>Close</Button>
          <Button variant="outline" disabled={!canResolve || busy !== null} onClick={() => void act("acknowledged")}>
            {busy === "acknowledged" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            Acknowledge
          </Button>
          <Button variant="outline" disabled={!canResolve || busy !== null} onClick={() => void act("false_positive")}>
            {busy === "false_positive" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
            False positive
          </Button>
          <Button disabled={!canResolve || busy !== null} onClick={() => void act("resolved")}>
            {busy === "resolved"
              ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              : <CheckCircle2 className="mr-2 h-4 w-4" aria-hidden />}
            Resolve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
