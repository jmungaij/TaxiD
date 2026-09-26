/**
 * DRIVER WITHDRAWAL QUEUE — the finance desk's own queue for driver payouts.
 *
 * The same authoritative control path used for every operator withdrawal
 * (checks → named approvals → separate release → send → paid on Safaricom's
 * confirmation), but showing only withdrawals whose recipient is a driver, with
 * their own status counts and a status filter. Nothing is decided in the
 * browser: each button calls the routine in the database.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { untypedDb } from "@/integrations/supabase/untyped";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, Clock, Send, ShieldCheck, TriangleAlert, Car } from "lucide-react";
import { PAYOUT_STATE_LABEL, sendPayout, settlementMoney } from "@/lib/provider/settlement";
import {
  WORKFLOW_STAGES,
  approvePayout,
  isOpen,
  loadPayoutWorkflow,
  nextAction,
  rejectPayout,
  releasePayout,
  screenPayout,
  slaReading,
  stageIndex,
  type WorkflowRequest,
} from "@/lib/provider/payoutWorkflow";

interface DriverRecipient {
  user_id: string;
  driver_id: string;
  driver_code: string | null;
  status: string | null;
  clearance_state: string | null;
}

async function loadDriverRecipients(): Promise<DriverRecipient[]> {
   
  const { data, error } = await untypedDb.rpc("driver_payout_recipients");
  if (error) throw new Error(error.message);
  return ((data?.drivers ?? []) as DriverRecipient[]).filter((d) => !!d.user_id);
}

const FILTERS = [
  { key: "OPEN", label: "In the queue" },
  { key: "PENDING_APPROVAL", label: "Awaiting approval" },
  { key: "APPROVED", label: "Approved" },
  { key: "ON_HOLD", label: "On hold" },
  { key: "PROCESSING", label: "Sent" },
  { key: "PAID", label: "Paid" },
  { key: "ALL", label: "Everything" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

const matches = (r: WorkflowRequest, f: FilterKey) =>
  f === "ALL" ? true : f === "OPEN" ? isOpen(r) : r.state === f;

export default function DriverWithdrawalQueue() {
  const qc = useQueryClient();
  const workflow = useQuery({ queryKey: ["provider-payout-workflow"], queryFn: loadPayoutWorkflow });
  const drivers = useQuery({ queryKey: ["driver-payout-recipients"], queryFn: loadDriverRecipients });
  const [filter, setFilter] = React.useState<FilterKey>("OPEN");
  const [notes, setNotes] = React.useState<Record<string, string>>({});

  const act = useMutation({
    mutationFn: async ({
      id,
      action,
    }: {
      id: string;
      action: "screen" | "approve" | "reject" | "release" | "send";
    }) => {
      const note = notes[id] ?? "";
      if (action === "screen") return { title: "Checks re-run", body: await screenPayout(id) };
      if (action === "approve") {
        const r = await approvePayout(id, note);
        return { title: r.state === "APPROVED" ? "Fully approved" : "Approval recorded", body: r };
      }
      if (action === "reject") {
        if (!note.trim()) throw new Error("Give a reason before rejecting a withdrawal.");
        return { title: "Withdrawal rejected", body: await rejectPayout(id, note) };
      }
      if (action === "release") return { title: "Released for payment", body: await releasePayout(id, note) };
      return { title: "Sent to M-Pesa", body: await sendPayout(id) };
    },
    onSuccess: ({ title }) => {
      toast({ title });
      qc.invalidateQueries({ queryKey: ["provider-payout-workflow"] });
      qc.invalidateQueries({ queryKey: ["provider-settlement-console"] });
    },
    onError: (e: Error) =>
      toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  if (workflow.isLoading || drivers.isLoading) return <Skeleton className="h-72 w-full" />;
  if (workflow.error) return <p className="text-sm text-destructive">{(workflow.error as Error).message}</p>;
  if (drivers.error) return <p className="text-sm text-destructive">{(drivers.error as Error).message}</p>;

  const byUser = new Map((drivers.data ?? []).map((d) => [d.user_id, d]));
  const all = (workflow.data?.requests ?? []).filter((r) => byUser.has(r.provider_user_id));
  const rows = all.filter((r) => matches(r, filter));
  const canDecide = !!workflow.data?.can_decide;

  const count = (f: FilterKey) => all.filter((r) => matches(r, f)).length;
  const sum = (f: FilterKey) =>
    all.filter((r) => matches(r, f)).reduce((t, r) => t + Number(r.amount_cents ?? 0), 0);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Car className="h-4 w-4" />
            Driver withdrawals
          </CardTitle>
          <CardDescription>
            Only withdrawals going to a driver's own M-Pesa number. Each one is checked, approved,
            released by someone who did not approve it, then sent — and is marked paid only when
            Safaricom confirms it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {(["ON_HOLD", "PENDING_APPROVAL", "APPROVED", "PROCESSING", "PAID"] as FilterKey[]).map((f) => (
              <div key={f} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">
                  {FILTERS.find((x) => x.key === f)?.label}
                </p>
                <p className="text-lg font-semibold">{count(f)}</p>
                <p className="text-xs text-muted-foreground">{settlementMoney(sum(f))}</p>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="sm"
                variant={filter === f.key ? "default" : "outline"}
                onClick={() => setFilter(f.key)}
              >
                {f.label} ({count(f.key)})
              </Button>
            ))}
          </div>
          {!canDecide && (
            <p className="text-xs text-muted-foreground">
              You can follow this queue, but only finance settlement staff may decide on a withdrawal.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {FILTERS.find((f) => f.key === filter)?.label} ({rows.length})
          </CardTitle>
          <CardDescription>Each withdrawal shows the one action it is waiting on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No driver withdrawal here yet. Drivers submit these from their own wallet balance once
              their trips are fulfilled.
            </p>
          ) : (
            rows.map((r) => {
              const d = byUser.get(r.provider_user_id)!;
              const sla = slaReading(r);
              const reached = stageIndex(r);
              const outstanding = Math.max(r.required_approvals - r.approvals_count, 0);
              return (
                <div key={r.id} className="rounded-lg border p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <p className="font-mono text-xs text-muted-foreground">{r.reference}</p>
                      <p className="text-sm font-semibold">
                        {settlementMoney(r.amount_cents, r.currency)} to {r.msisdn}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Driver {d.driver_code ?? d.driver_id.slice(0, 8)} ·{" "}
                        {settlementMoney(r.gross_cents ?? r.amount_cents, r.currency)} from wallet ·{" "}
                        {settlementMoney(r.fee_cents ?? 0, r.currency)} withdrawal fee ·{" "}
                        {r.tier_label ?? "Unbanded"} band · {r.approvals_count}/{r.required_approvals}{" "}
                        approvals{r.requires_dual_release ? " · separate release" : ""}
                      </p>
                      {d.clearance_state && d.clearance_state !== "CLEARED" && (
                        <p className="text-xs text-destructive">
                          This driver's payout clearance is {d.clearance_state.toLowerCase()}.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1 text-right">
                      <Badge
                        variant={
                          r.state === "PAID" ? "default" : r.state === "ON_HOLD" ? "destructive" : "outline"
                        }
                      >
                        {PAYOUT_STATE_LABEL[r.state]}
                      </Badge>
                      {isOpen(r) && (
                        <p
                          className={`flex items-center justify-end gap-1 text-xs ${
                            sla.tone === "risk"
                              ? "text-destructive"
                              : sla.tone === "watch"
                                ? "text-warning"
                                : "text-muted-foreground"
                          }`}
                        >
                          <Clock className="h-3 w-3" />
                          {sla.label}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {WORKFLOW_STAGES.map((s, i) => (
                      <Badge key={s.key} variant={i <= reached ? "default" : "outline"} className="text-[11px]">
                        {s.label}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">Waiting on: {nextAction(r)}</p>

                  {r.checks.length > 0 && (
                    <>
                      <Separator className="my-3" />
                      <ul className="grid gap-1 sm:grid-cols-2">
                        {r.checks.map((c) => (
                          <li key={c.check_key} className="flex items-start gap-2 text-xs">
                            {c.result === "PASS" ? (
                              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" />
                            ) : (
                              <TriangleAlert
                                className={`mt-0.5 h-3.5 w-3.5 ${
                                  c.result === "FAIL" ? "text-destructive" : "text-warning"
                                }`}
                              />
                            )}
                            <span className={c.result === "FAIL" ? "text-destructive" : "text-muted-foreground"}>
                              {c.label}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}

                  {r.provider_transaction_id && (
                    <p className="mt-2 font-mono text-xs text-muted-foreground">{r.provider_transaction_id}</p>
                  )}
                  {r.failure_reason && <p className="mt-2 text-xs text-destructive">{r.failure_reason}</p>}

                  {canDecide && isOpen(r) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <Input
                        className="h-9 max-w-xs"
                        placeholder="Decision note / reason"
                        value={notes[r.id] ?? ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                      {(r.state === "PENDING_SCREENING" || r.state === "ON_HOLD") && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: r.id, action: "screen" })}
                        >
                          Run checks
                        </Button>
                      )}
                      {r.state === "PENDING_APPROVAL" && (
                        <Button
                          size="sm"
                          disabled={act.isPending || r.viewer_has_approved}
                          onClick={() => act.mutate({ id: r.id, action: "approve" })}
                        >
                          {r.viewer_has_approved
                            ? "You already approved"
                            : outstanding > 1
                              ? "Give first approval"
                              : "Approve"}
                        </Button>
                      )}
                      {r.state === "APPROVED" && !r.released_at && (
                        <Button
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: r.id, action: "release" })}
                        >
                          <ShieldCheck className="mr-2 h-4 w-4" />
                          Release for payment
                        </Button>
                      )}
                      {r.state === "APPROVED" && r.released_at && (
                        <Button
                          size="sm"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: r.id, action: "send" })}
                        >
                          <Send className="mr-2 h-4 w-4" />
                          Send to M-Pesa
                        </Button>
                      )}
                      {r.state !== "PROCESSING" && (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={act.isPending}
                          onClick={() => act.mutate({ id: r.id, action: "reject" })}
                        >
                          Reject
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>
    </div>
  );
}
