/**
 * FINANCE RECONCILIATION PANEL.
 * Finance reviews each revenue entry once: approve, adjust with a corrected
 * amount, or reject. A written reason is required and history is never edited —
 * adjustments and rejections post a compensating entry.
 */
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AlertTriangle, CheckCircle2, Scale } from "lucide-react";
import { toast } from "sonner";
import { kes } from "@/lib/commercial/pipelineValue";
import {
  fetchRevenueReconciliationQueue,
  reviewRevenueEvent,
  type RevenueDecision,
  type RevenueQueueEvent,
  type RevenueReconciliationQueue,
} from "@/lib/commercial/revenueReconciliation";

const decisionLabel: Record<RevenueDecision, string> = {
  APPROVED: "Approve",
  ADJUSTED: "Adjust",
  REJECTED: "Reject",
};

export function RevenueReconciliationPanel() {
  const [state, setState] = useState<RevenueReconciliationQueue | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [target, setTarget] = useState<RevenueQueueEvent | null>(null);
  const [decision, setDecision] = useState<RevenueDecision>("APPROVED");
  const [reason, setReason] = useState("");
  const [adjusted, setAdjusted] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    fetchRevenueReconciliationQueue()
      .then(setState)
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const submit = async () => {
    if (!target) return;
    if (reason.trim().length < 5) {
      toast.error("Write a reason for the decision (at least 5 characters).");
      return;
    }
    if (decision === "ADJUSTED" && !adjusted.trim()) {
      toast.error("Enter the corrected amount.");
      return;
    }
    setSaving(true);
    const res = await reviewRevenueEvent({
      revenueEventId: target.id,
      decision,
      reason: reason.trim(),
      adjustedAmount: decision === "ADJUSTED" ? Number(adjusted) : null,
    });
    setSaving(false);
    if (!res.ok) {
      toast.error(res.detail ?? res.error ?? "The decision could not be saved.");
      return;
    }
    toast.success(
      decision === "ADJUSTED"
        ? `Adjusted by ${kes(res.delta ?? 0)} — a correction entry was posted.`
        : decision === "REJECTED"
          ? "Rejected — a reversing entry was posted."
          : "Approved.",
    );
    setTarget(null);
    setReason("");
    setAdjusted("");
    load();
  };

  if (loading) return <Skeleton className="h-64 w-full" />;
  if (!state?.ok) {
    return (
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertDescription>
          {state?.error === "NOT_AUTHORISED"
            ? "Revenue reconciliation is open to finance and sales managers only."
            : `The reconciliation queue is unavailable${state?.error ? `: ${state.error}` : ""}.`}
        </AlertDescription>
      </Alert>
    );
  }

  const t = state.totals;
  const events = state.events ?? [];
  const rows = pendingOnly ? events.filter((r) => !r.review_decision) : events;
  const mismatches = events.filter((r) => (r.variance ?? 0) !== 0).length;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Awaiting review</CardDescription>
            <CardTitle className="text-2xl">{t?.unreviewed ?? 0}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            {kes(t?.unreviewed_kes ?? 0)} not yet reviewed
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Posted revenue</CardDescription>
            <CardTitle className="text-2xl">{kes(t?.net_kes ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">{t?.events ?? 0} entries</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Approved</CardDescription>
            <CardTitle className="text-2xl">{kes(t?.approved_kes ?? 0)}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">
            Adjustments {kes(t?.adjusted_kes ?? 0)} · reversed {kes(t?.rejected_kes ?? 0)}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Value mismatches</CardDescription>
            <CardTitle className="text-2xl">{mismatches}</CardTitle>
          </CardHeader>
          <CardContent className="text-xs text-muted-foreground">Entry differs from the contract value</CardContent>
        </Card>
      </div>

      {(state.periods ?? []).length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">By revenue period</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(state.periods ?? []).map((p) => (
              <Badge key={p.revenue_period ?? "none"} variant="outline" className="gap-2">
                {p.revenue_period ?? "No period"} · {kes(p.amount_kes)} · {p.unreviewed} awaiting
              </Badge>
            ))}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Scale className="h-4 w-4" /> Revenue reconciliation
            </CardTitle>
            <CardDescription>
              {state.can_decide
                ? "Approve, adjust or reject each entry with a reason."
                : "You can review the queue; finance approval is restricted."}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <Switch id="pending-only" checked={pendingOnly} onCheckedChange={setPendingOnly} />
            <Label htmlFor="pending-only">Awaiting review only</Label>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>Customer</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead>Status</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                    Nothing to reconcile.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {r.contract_number ?? "—"}
                      <div className="text-xs text-muted-foreground">{r.event_type}</div>
                    </TableCell>
                    <TableCell>{r.customer ?? "—"}</TableCell>
                    <TableCell>{r.owner_name ?? "—"}</TableCell>
                    <TableCell>{r.revenue_period ?? "—"}</TableCell>
                    <TableCell className="text-right tabular-nums">{kes(r.amount)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.variance ? (
                        <span className="text-destructive">{kes(r.variance)}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {r.review_decision ? (
                        <div className="space-y-1">
                          <Badge variant={r.review_decision === "APPROVED" ? "default" : "secondary"}>
                            {r.review_decision}
                          </Badge>
                          <div className="max-w-[16rem] truncate text-xs text-muted-foreground">
                            {r.reviewer_name ? `${r.reviewer_name}: ` : ""}
                            {r.review_reason}
                          </div>
                        </div>
                      ) : (
                        <Badge variant="outline">Awaiting review</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {!r.review_decision && state.can_decide && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setTarget(r);
                            setDecision("APPROVED");
                            setReason("");
                            setAdjusted(String(r.contract_value ?? r.amount));
                          }}
                        >
                          Review
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={!!target} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Review revenue entry</DialogTitle>
            <DialogDescription>
              {target?.contract_number ?? "Contract"} · {kes(target?.amount)} · {target?.revenue_period ?? "no period"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex gap-2">
              {(Object.keys(decisionLabel) as RevenueDecision[]).map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={decision === d ? "default" : "outline"}
                  onClick={() => setDecision(d)}
                >
                  {decisionLabel[d]}
                </Button>
              ))}
            </div>
            {decision === "ADJUSTED" && (
              <div className="space-y-1">
                <Label htmlFor="adjusted-amount">Corrected amount (KES)</Label>
                <Input
                  id="adjusted-amount"
                  type="number"
                  value={adjusted}
                  onChange={(e) => setAdjusted(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  A correction entry is posted for the difference. The original entry stays on record.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="review-reason">Reason</Label>
              <Textarea
                id="review-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why this decision — what was checked against"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={saving}>
              <CheckCircle2 className="mr-2 h-4 w-4" />
              {saving ? "Saving…" : `${decisionLabel[decision]} entry`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default RevenueReconciliationPanel;
