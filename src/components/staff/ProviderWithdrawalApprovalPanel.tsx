/**
 * OPERATOR WITHDRAWAL APPROVAL WORKFLOW PANEL.
 *
 * Shows every withdrawal on its real control path — checked, approved by the
 * number of people its value band demands, released by a separate person, then
 * sent — with the automated checks, the named approvals and the full trail.
 * Nothing here decides anything locally; each button calls the authoritative
 * routine in the database.
 */
import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { CheckCircle2, ShieldCheck, TriangleAlert, Send, Clock } from "lucide-react";
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

const bandRange = (min: number, max: number | null) =>
  max === null
    ? `above ${settlementMoney(min - 1)}`
    : `${settlementMoney(min)} – ${settlementMoney(max)}`;

function StagePath({ request }: { request: WorkflowRequest }) {
  const reached = stageIndex(request);
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {WORKFLOW_STAGES.map((s, i) => (
        <Badge key={s.key} variant={i <= reached ? "default" : "outline"} className="text-[11px]">
          {s.label}
        </Badge>
      ))}
    </div>
  );
}

function RequestCard({
  request,
  canDecide,
  busy,
  note,
  onNote,
  onScreen,
  onApprove,
  onReject,
  onRelease,
  onSend,
}: {
  request: WorkflowRequest;
  canDecide: boolean;
  busy: boolean;
  note: string;
  onNote: (v: string) => void;
  onScreen: () => void;
  onApprove: () => void;
  onReject: () => void;
  onRelease: () => void;
  onSend: () => void;
}) {
  const r = request;
  const sla = slaReading(r);
  const outstanding = Math.max(r.required_approvals - r.approvals_count, 0);

  return (
    <div className="rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="font-mono text-xs text-muted-foreground">{r.reference}</p>
          <p className="text-sm font-semibold">
            {settlementMoney(r.amount_cents, r.currency)} to {r.msisdn}
          </p>
          <p className="text-xs text-muted-foreground">
            {settlementMoney(r.gross_cents ?? r.amount_cents, r.currency)} from wallet ·{" "}
            {settlementMoney(r.fee_cents ?? 0, r.currency)} fee ·{" "}
            {r.tier_label ?? "Unbanded"} band · {r.approvals_count}/{r.required_approvals} approvals
            {r.requires_dual_release ? " · separate release" : ""}
          </p>
        </div>
        <div className="space-y-1 text-right">
          <Badge variant={r.state === "PAID" ? "default" : r.state === "ON_HOLD" ? "destructive" : "outline"}>
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

      <div className="mt-3">
        <StagePath request={r} />
      </div>
      <p className="mt-2 text-xs text-muted-foreground">Waiting on: {nextAction(r)}</p>

      {r.checks.length > 0 && (
        <>
          <Separator className="my-3" />
          <p className="mb-2 text-xs font-medium">Pre-release checks</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {r.checks.map((c) => (
              <li key={c.check_key} className="flex items-start gap-2 text-xs">
                {c.result === "PASS" ? (
                  <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-success" />
                ) : (
                  <TriangleAlert
                    className={`mt-0.5 h-3.5 w-3.5 ${c.result === "FAIL" ? "text-destructive" : "text-warning"}`}
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

      {r.approvals.length > 0 && (
        <>
          <Separator className="my-3" />
          <p className="mb-1 text-xs font-medium">Approvals on record</p>
          <ul className="space-y-1 text-xs text-muted-foreground">
            {r.approvals.map((a) => (
              <li key={a.level}>
                Approval {a.level} · {new Date(a.decided_at).toLocaleString()} ·{" "}
                <span className="font-mono">{a.actor_user_id.slice(0, 8)}</span>
                {a.note ? ` — ${a.note}` : ""}
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
            value={note}
            onChange={(e) => onNote(e.target.value)}
          />
          {(r.state === "PENDING_SCREENING" || r.state === "ON_HOLD") && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onScreen}>
              Run checks
            </Button>
          )}
          {r.state === "PENDING_APPROVAL" && (
            <Button size="sm" disabled={busy || r.viewer_has_approved} onClick={onApprove}>
              {r.viewer_has_approved
                ? "You already approved"
                : outstanding > 1
                  ? "Give first approval"
                  : "Approve"}
            </Button>
          )}
          {r.state === "APPROVED" && !r.released_at && (
            <Button size="sm" disabled={busy} onClick={onRelease}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Release for payment
            </Button>
          )}
          {r.state === "APPROVED" && r.released_at && (
            <Button size="sm" disabled={busy} onClick={onSend}>
              <Send className="mr-2 h-4 w-4" />
              Send to M-Pesa
            </Button>
          )}
          {r.state !== "PROCESSING" && (
            <Button size="sm" variant="outline" disabled={busy} onClick={onReject}>
              Reject
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

export default function ProviderWithdrawalApprovalPanel() {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["provider-payout-workflow"],
    queryFn: loadPayoutWorkflow,
  });
  const [notes, setNotes] = React.useState<Record<string, string>>({});
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["provider-payout-workflow"] });
    qc.invalidateQueries({ queryKey: ["provider-settlement-console"] });
  };

  const act = useMutation({
    mutationFn: async ({ id, action }: { id: string; action: "screen" | "approve" | "reject" | "release" | "send" }) => {
      const note = notes[id] ?? "";
      if (action === "screen") return { title: "Checks re-run", body: await screenPayout(id) };
      if (action === "approve") {
        const r = await approvePayout(id, note);
        return {
          title: r.state === "APPROVED" ? "Fully approved" : "Approval recorded",
          body: r,
        };
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
      refresh();
    },
    onError: (e: Error) => toast({ title: "Not recorded", description: e.message, variant: "destructive" }),
  });

  if (isLoading) return <Skeleton className="h-72 w-full" />;
  if (error) return <p className="text-sm text-destructive">{(error as Error).message}</p>;

  const s = data?.summary;
  const open = (data?.requests ?? []).filter(isOpen);
  const closed = (data?.requests ?? []).filter((r) => !isOpen(r)).slice(0, 15);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldCheck className="h-4 w-4" />
            Withdrawal approval workflow
          </CardTitle>
          <CardDescription>
            Every operator withdrawal is checked automatically, approved by the number of people its value
            band requires, released for payment by someone who did not approve it, then sent over M-Pesa. It
            is only marked paid when Safaricom confirms it.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {[
              { label: "On hold", value: s?.on_hold ?? 0 },
              { label: "Awaiting approval", value: s?.awaiting_approval ?? 0 },
              { label: "Awaiting release", value: s?.awaiting_release ?? 0 },
              { label: "Sent, awaiting confirmation", value: s?.in_flight ?? 0 },
              { label: "Past response target", value: s?.sla_breached ?? 0 },
            ].map((k) => (
              <div key={k.label} className="rounded-lg border p-3">
                <p className="text-xs text-muted-foreground">{k.label}</p>
                <p className="text-lg font-semibold">{k.value}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {(data?.tiers ?? []).map((t) => (
              <div key={t.label} className="rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="font-semibold">{t.label}</p>
                <p className="text-muted-foreground">{bandRange(t.min_cents, t.max_cents)}</p>
                <p className="text-muted-foreground">
                  {t.required_approvals} approval{t.required_approvals === 1 ? "" : "s"}
                  {t.requires_dual_release ? " · separate release" : ""} · {t.sla_hours}h target
                </p>
              </div>
            ))}
          </div>
          {!data?.can_decide && (
            <p className="text-xs text-muted-foreground">
              You can follow this queue but only finance settlement staff may decide on a withdrawal.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">In the workflow ({open.length})</CardTitle>
          <CardDescription>Each withdrawal shows the one action it is waiting on.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {open.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No withdrawal is in the workflow. Operators submit these from their own wallet balance.
            </p>
          ) : (
            open.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                canDecide={!!data?.can_decide}
                busy={act.isPending}
                note={notes[r.id] ?? ""}
                onNote={(v) => setNotes((n) => ({ ...n, [r.id]: v }))}
                onScreen={() => act.mutate({ id: r.id, action: "screen" })}
                onApprove={() => act.mutate({ id: r.id, action: "approve" })}
                onReject={() => act.mutate({ id: r.id, action: "reject" })}
                onRelease={() => act.mutate({ id: r.id, action: "release" })}
                onSend={() => act.mutate({ id: r.id, action: "send" })}
              />
            ))
          )}
        </CardContent>
      </Card>

      {closed.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closed withdrawals</CardTitle>
            <CardDescription>Paid, failed or rejected — kept with their full decision trail.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {closed.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                canDecide={false}
                busy={false}
                note=""
                onNote={() => undefined}
                onScreen={() => undefined}
                onApprove={() => undefined}
                onReject={() => undefined}
                onRelease={() => undefined}
                onSend={() => undefined}
              />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
