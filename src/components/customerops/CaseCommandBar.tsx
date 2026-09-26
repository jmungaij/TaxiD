/**
 * Unified Case Command Bar.
 *
 * Exposes every operational action for a case, authorized at API level by the
 * zero-trust governance layer, capturing correlation IDs, approval chains and
 * an append-only audit history.
 */
import { useMemo, useState } from "react";
import { History, Lock, ShieldCheck, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { toast } from "@/hooks/use-toast";
import { appendAudit, availableActions, executeCommand, type CommandAuditEntry } from "@/lib/customerops/commandBar";
import type { OrchestrationPlan } from "@/lib/customerops/orchestration";

export interface CaseCommandBarProps {
  plan: OrchestrationPlan;
  roles: string[];
  actor: string;
  canClose?: boolean;
  onExecuted?: (entry: CommandAuditEntry) => void;
}

export default function CaseCommandBar({ plan, roles, actor, canClose = true, onExecuted }: CaseCommandBarProps) {
  const [note, setNote] = useState("");
  const [log, setLog] = useState<readonly CommandAuditEntry[]>([]);
  const actions = useMemo(() => availableActions(plan, { roles }), [plan, roles]);

  const run = (actionId: string) => {
    const result = executeCommand({ plan, actionId, actor, ctx: { roles }, note: note.trim() || undefined, canClose });
    if (!result.ok) {
      const reason =
        result.error === "note_required" ? "Add a justification note before running this action."
        : result.error === "closure_blocked" ? "Mandatory domain steps are still outstanding."
        : result.error === "forbidden" ? "Your role is not authorized for this action."
        : result.error;
      toast({ title: "Action blocked", description: reason, variant: "destructive" });
      return;
    }
    setLog((prev) => appendAudit(prev, result.audit));
    setNote("");
    onExecuted?.(result.audit);
    toast({
      title: result.outcome === "pending_approval" ? "Sent for approval" : "Action executed",
      description: result.approval
        ? `Approval chain: ${result.approval.chain.join(" → ")}`
        : `Correlation ${result.audit.correlationId}`,
    });
  };

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Terminal className="h-4 w-4" aria-hidden />
          Case command bar
          <Badge variant="outline" className="ml-auto font-mono text-[10px]">{plan.correlationId}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Justification note (required for irreversible and monetary actions)"
          rows={2}
          aria-label="Command justification note"
        />
        <div className="flex flex-wrap gap-2">
          {actions.map(({ action, enabled, reason, needsApproval }) => (
            <Button
              key={action.id}
              size="sm"
              variant={action.group === "financial" || action.group === "safety" ? "secondary" : "outline"}
              disabled={!enabled}
              title={enabled ? action.description : reason}
              onClick={() => run(action.id)}
            >
              {!enabled && <Lock className="mr-1 h-3.5 w-3.5" aria-hidden />}
              {needsApproval && enabled && <ShieldCheck className="mr-1 h-3.5 w-3.5" aria-hidden />}
              {action.label}
            </Button>
          ))}
        </div>

        {log.length > 0 && (
          <>
            <Separator />
            <div className="space-y-2">
              <p className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
                <History className="h-3.5 w-3.5" aria-hidden />
                Append-only command audit
              </p>
              {log.map((entry) => (
                <div key={entry.id} className="rounded-md border p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium">{entry.actionId}</span>
                    <Badge variant="outline" className="capitalize">{entry.outcome.replace("_", " ")}</Badge>
                  </div>
                  <p className="mt-1 text-muted-foreground">
                    {entry.actor} · {new Date(entry.at).toLocaleString()}
                    {entry.note ? ` · ${entry.note}` : ""}
                  </p>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
