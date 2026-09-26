import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { BrainCircuit, CheckCircle2, Download, History, Undo2, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import type { DeliveryModule } from "@/components/delivery/ModuleShell";
import {
  applyDispatchAction,
  dispatchActionPlans,
  revertDispatchAction,
  type DispatchActionPlan,
} from "@/lib/delivery/dispatchActions";
import {
  auditTrailCsv,
  listAudit,
  subscribeAudit,
  verifyAuditChain,
  type AuditEntry,
} from "@/lib/delivery/auditTrail";
import { AppButton } from "@/components/nav/AppButton";

const SEVERITY_STYLE = {
  info: "border-border/70",
  warning: "border-status-warning/40 bg-status-warning/5",
  critical: "border-destructive/40 bg-destructive/5",
} as const;

const TONE_TEXT = {
  good: "text-status-success",
  warn: "text-status-warning",
  neutral: "text-muted-foreground",
} as const;

function useAuditTrail(module: DeliveryModule) {
  const [entries, setEntries] = useState<AuditEntry[]>(() => listAudit({ module }));
  useEffect(() => {
    setEntries(listAudit({ module }));
    return subscribeAudit(() => setEntries(listAudit({ module })));
  }, [module]);
  return entries;
}

/**
 * AI dispatcher with one-click governed actions. Every action is confirmed with
 * its estimated impact, executed against the dispatch plan, and written to the
 * hash-chained audit trail with the operator identity.
 */
export function AiDispatchActions({ module }: { module: DeliveryModule }) {
  const { user, roles } = useAuth();
  const plans = useMemo(() => dispatchActionPlans(module), [module]);
  const entries = useAuditTrail(module);
  const dispatchEntries = entries.filter((e) => e.domain === "dispatch");
  const [pending, setPending] = useState<DispatchActionPlan | null>(null);
  const [reason, setReason] = useState("");
  const [showTrail, setShowTrail] = useState(false);

  const actor = user?.email ?? "unauthenticated operator";
  const canAct = !!user;
  const appliedIds = new Set(
    dispatchEntries.filter((e) => e.status === "applied").map((e) => e.subject),
  );
  const revertedIds = new Set(dispatchEntries.filter((e) => e.status === "reverted").map((e) => e.subject));

  const confirm = () => {
    if (!pending) return;
    if (pending.action.requiresReason && reason.trim().length < 4) {
      toast({ title: "Reason required", description: "Add a short justification before applying this action.", variant: "destructive" });
      return;
    }
    const entry = applyDispatchAction(module, pending, actor, reason.trim() || undefined);
    toast({
      title: `${pending.action.cta} applied`,
      description: `${pending.action.affected} · audit ${entry.hash.slice(0, 8)}`,
    });
    setPending(null);
    setReason("");
  };

  const undo = (entry: AuditEntry) => {
    revertDispatchAction(entry.id, actor, "Operator reverted from control tower");
    toast({ title: "Action reverted", description: `${entry.action} · compensating record written to audit trail` });
  };

  const exportTrail = () => {
    const csv = auditTrailCsv(dispatchEntries);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `dispatch-audit-${module}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Card className="border-border/70 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 grid h-7 w-7 place-items-center rounded-md bg-primary/10">
            <BrainCircuit className="h-4 w-4 text-primary" />
          </span>
          <div>
            <h3 className="text-sm font-semibold">AI dispatcher</h3>
            <p className="text-[11px] text-muted-foreground">
              One-click actions from the live digital twin — confirmed, costed and audited
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Badge variant="secondary" className="text-[10px]">{plans.length} signals</Badge>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" onClick={() => setShowTrail((v) => !v)}>
            <History className="mr-1 h-3 w-3" /> Audit ({dispatchEntries.length})
          </Button>
        </div>
      </div>

      {showTrail && (
        <div className="mt-3 rounded-lg border p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold">
              <ShieldCheck className={cn("h-3.5 w-3.5", verifyAuditChain(dispatchEntries) ? "text-status-success" : "text-destructive")} />
              {verifyAuditChain(dispatchEntries) ? "Hash chain verified" : "Hash chain broken"}
            </div>
            <AppButton analytics="delivery_ai_dispatch_audit_csv_download" action="submit" size="sm" variant="outline" className="h-6 px-2 text-[10px]" aria-label="Download AI dispatch audit trail as CSV" onClick={exportTrail} disabled={dispatchEntries.length === 0}>
              <Download className="mr-1 h-3 w-3" /> CSV
            </AppButton>
          </div>
          <div className="mt-2 max-h-40 space-y-1.5 overflow-y-auto pr-1">
            {dispatchEntries.length === 0 && (
              <p className="text-[11px] text-muted-foreground">No dispatch actions taken yet in this session.</p>
            )}
            {dispatchEntries.map((e) => (
              <div key={e.id} className="rounded-md border p-2 text-[11px]">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{e.action}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {new Date(e.at).toLocaleTimeString("en-KE", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-muted-foreground">{e.subject}</p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", e.status === "reverted" ? "border-border text-muted-foreground" : "border-status-success/50 text-status-success")}
                  >
                    {e.status}
                  </Badge>
                  <span className="text-muted-foreground">by {e.actor}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">#{e.hash.slice(0, 8)}</span>
                  {e.status === "applied" && (
                    <Button size="sm" variant="ghost" className="ml-auto h-5 px-1.5 text-[10px]" onClick={() => undo(e)}>
                      <Undo2 className="mr-1 h-3 w-3" /> Revert
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-4 max-h-[440px] space-y-2.5 overflow-y-auto pr-1">
        {plans.map(({ recommendation: r, action }) => {
          const applied = appliedIds.has(action.title) && !revertedIds.has(action.title);
          return (
            <div key={r.id} className={cn("rounded-lg border p-3 transition-colors", SEVERITY_STYLE[r.severity])}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold capitalize">{r.title}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{r.detail}</p>
                </div>
                <Badge variant="outline" className="shrink-0 text-[10px]">{Math.round(r.confidence * 100)}%</Badge>
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[11px] font-medium text-status-success">{r.impact}</span>
                <Button
                  size="sm"
                  variant={applied ? "secondary" : "outline"}
                  className="h-7 text-[11px]"
                  onClick={() => {
                    setReason("");
                    setPending({ recommendation: r, action });
                  }}
                >
                  {applied ? (
                    <>
                      <CheckCircle2 className="mr-1 h-3 w-3" /> Applied
                    </>
                  ) : (
                    action.cta
                  )}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent className="max-w-lg">
          {pending && (
            <>
              <AlertDialogHeader>
                <AlertDialogTitle className="text-base">{pending.action.title}</AlertDialogTitle>
                <AlertDialogDescription>{pending.action.summary}</AlertDialogDescription>
              </AlertDialogHeader>

              <div className="space-y-3">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    What the dispatcher will do
                  </div>
                  <ol className="mt-1.5 space-y-1 text-xs text-muted-foreground">
                    {pending.action.steps.map((s, i) => (
                      <li key={s} className="flex gap-2">
                        <span className="grid h-4 w-4 shrink-0 place-items-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
                          {i + 1}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Estimated impact</div>
                  <div className="mt-1.5 grid grid-cols-2 gap-2">
                    {pending.action.impact.map((i) => (
                      <div key={i.label} className="rounded-md border p-2">
                        <div className="text-[10px] text-muted-foreground">{i.label}</div>
                        <div className={cn("text-xs font-semibold", TONE_TEXT[i.tone])}>{i.value}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-md border bg-muted/40 p-2 text-[11px] text-muted-foreground">
                  Affects <span className="font-medium text-foreground">{pending.action.affected}</span> ·{" "}
                  {pending.action.reversible ? "reversible" : "not reversible"} · audited as{" "}
                  <span className="font-medium text-foreground">{actor}</span>
                </div>

                <div>
                  <Label htmlFor="dispatch-reason" className="text-[11px]">
                    Justification {pending.action.requiresReason ? "(required)" : "(optional)"}
                  </Label>
                  <Textarea
                    id="dispatch-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Recorded on the audit trail with your identity and timestamp"
                    className="mt-1 min-h-[60px] text-xs"
                  />
                </div>

                {!canAct && (
                  <p className="text-[11px] text-status-warning">
                    You are not signed in — the action is recorded against an unauthenticated operator and is not pushed to
                    production dispatch.
                  </p>
                )}
              </div>

              <AlertDialogFooter>
                <AlertDialogCancel className="text-xs">Cancel</AlertDialogCancel>
                <AlertDialogAction className="text-xs" onClick={confirm}>
                  Confirm · {pending.action.cta}
                </AlertDialogAction>
              </AlertDialogFooter>
            </>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {roles.length > 0 && (
        <p className="mt-3 text-[10px] text-muted-foreground">
          Acting with roles: {roles.join(", ")}
        </p>
      )}
    </Card>
  );
}
