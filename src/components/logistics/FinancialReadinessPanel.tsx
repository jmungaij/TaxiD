/**
 * FINANCIAL READINESS PANEL (FN-01 … FN-08).
 *
 * Shows the two independent halves of every financial control and never merges
 * them: the sealed technical execution against the isolated staging instance,
 * and the Finance owner's approved acceptance record. Every button triggers a
 * real orchestrator execution. There is no control that marks a result by hand.
 */
import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, PlayCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { FN_RESULT_TONE } from "@/lib/logistics/finance/fnControls";
import {
  buildFnView,
  deployFinanceSchema,
  fnSummary,
  loadFnExecutions,
  runFnCertification,
  runFnControl,
  type FnControlView,
  type FnProviderExecutionOptions,
} from "@/lib/logistics/finance/fnCertification";
import { FnCollectionDialog } from "@/components/logistics/FnCollectionDialog";
import type { CommandCenterControl } from "@/lib/logistics/readiness/execution";

/** Controls whose execution collects from a real payer via M-Pesa STK. */
const PAYER_EXECUTED_CONTROLS = new Set(["FN-01"]);


const TONE_CLASS: Record<"ok" | "warn" | "danger" | "info", string> = {
  ok: "bg-status-success/15 text-status-success",
  warn: "bg-status-warning/15 text-status-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-muted text-muted-foreground",
};

function AcceptanceBadge({ control }: { control: CommandCenterControl | undefined }) {
  if (!control) return <Badge variant="outline" className="text-[10px]">acceptance record not in register</Badge>;
  const accepted = control.status === "PASS";
  return (
    <Badge variant="secondary" className={accepted ? TONE_CLASS.ok : TONE_CLASS.warn}>
      {accepted ? "finance acceptance approved" : "finance acceptance outstanding"}
    </Badge>
  );
}

function ControlCard({
  view,
  acceptance,
  onRun,
  onResolve,
  busy,
}: {
  view: FnControlView;
  acceptance: CommandCenterControl | undefined;
  onRun: (id: string, force: boolean) => void;
  onResolve: (id: string) => void;
  busy: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const d = view.definition;
  const running = busy === d.control_id;
  const tone = TONE_CLASS[FN_RESULT_TONE[view.result] ?? "info"];

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold">{d.control_id}</span>
            <Badge variant="secondary" className={tone}>{view.result.split("_").join(" ")}</Badge>
            <AcceptanceBadge control={acceptance} />
            {d.provider_execution_required && (
              <Badge variant="outline" className="text-[10px]">external provider execution in scope</Badge>
            )}
          </div>
          <p className="mt-1 text-sm">{d.title}</p>
          <p className="mt-1 text-xs text-muted-foreground"><strong>Scope:</strong> {d.scope}</p>
          <p className="text-xs text-muted-foreground"><strong>Success:</strong> {d.success_condition}</p>
          <p className="text-xs text-muted-foreground"><strong>Technical state:</strong> {view.reason}</p>
          {d.depends_on.length > 0 && (
            <p className="text-xs text-muted-foreground"><strong>Depends on:</strong> {d.depends_on.join(", ")}</p>
          )}
          {view.outstanding.length > 0 && (
            <ul className="mt-1 space-y-1">
              {view.outstanding.map((o) => (
                <li key={o} className="rounded-md bg-status-warning/10 p-2 text-xs">{o}</li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Button size="sm" variant="outline" disabled={running} onClick={() => onRun(d.control_id, false)}>
            {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" />}
            Execute
          </Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => onRun(d.control_id, true)}>
            Re-execute
          </Button>
          {acceptance && acceptance.status !== "PASS" && (
            <Button size="sm" variant="ghost" onClick={() => onResolve(d.control_id)}>
              Record acceptance
            </Button>
          )}
          {view.latest && (
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide evidence" : "Evidence"}
            </Button>
          )}
        </div>
      </div>

      {open && view.latest && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3">
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <p><strong>Execution:</strong> <span className="font-mono">{view.latest.id}</span></p>
            <p><strong>Environment:</strong> {view.latest.environment_key ?? "control plane"}</p>
            <p><strong>Database identity:</strong> <span className="font-mono">{(view.latest.environment_fingerprint ?? "n/a").slice(0, 16)}</span></p>
            <p><strong>Evidence digest:</strong> <span className="font-mono">{(view.latest.evidence_sha256 ?? "n/a").slice(0, 16)}</span></p>
            <p><strong>Finished:</strong> {view.latest.finished_at ?? "—"}</p>
            <p><strong>Assertions:</strong> {view.assertionsPassed}/{view.assertionsTotal} observed</p>
          </div>
          <div className="space-y-1">
            {(view.latest.assertions ?? []).map((a) => (
              <div key={a.key} className="flex items-start gap-2 text-xs">
                {a.passed
                  ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden />
                  : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-warning" aria-hidden />}
                <p className="min-w-0">
                  <span className="font-mono">{a.key}</span> — expected {a.expected}; observed {a.observed}
                </p>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground"><strong>Required evidence:</strong> {d.evidence}</p>
        </div>
      )}
    </div>
  );
}

export function FinancialReadinessPanel({
  controls,
  onResolve,
}: {
  controls: CommandCenterControl[];
  onResolve: (controlId: string) => void;
}) {
  const [views, setViews] = React.useState<FnControlView[]>(() => buildFnView([]));
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // FN-01 collects from a real payer: the number is captured per execution.
  const [collectFor, setCollectFor] = React.useState<{ id: string; force: boolean } | null>(null);


  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      setViews(buildFnView(await loadFnExecutions()));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const act = React.useCallback(
    async (key: string, fn: () => Promise<{ ok: boolean; code?: string; message?: string }>) => {
      setBusy(key);
      try {
        const r = await fn();
        toast({
          title: r.ok ? "Execution complete" : (r.code ?? "Execution incomplete").split("_").join(" "),
          description: r.message ?? (r.ok ? "Every executed control observed its success condition." : "See the control detail for the exact outstanding item."),
          variant: r.ok ? undefined : "destructive",
        });
      } catch (e) {
        toast({ title: "Execution failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      } finally {
        setBusy(null);
        await refresh();
      }
    },
    [refresh],
  );

  const summary = fnSummary(views);
  const acceptanceFor = (id: string) => controls.find((c) => c.control_id === id);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div>
          <CardTitle className="text-base">Financial certification (FN-01 … FN-08)</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Executed against the isolated staging instance. A financial control is production-ready only when the sealed
            execution AND the Finance owner's approved acceptance both hold — neither can be set by hand here.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
          <Button size="sm" variant="outline" disabled={!!busy}
            onClick={() => void act("schema", deployFinanceSchema)}>
            Deploy finance schema
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => void act("wave", () => runFnCertification())}>
            {busy === "wave" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" />}
            Execute FN wave
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {error && (
          <p className="flex items-start gap-2 rounded-md bg-destructive/10 p-2 text-xs text-destructive">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {[
            { label: "Technically verified", value: summary.verified },
            { label: "Provider blocked", value: summary.providerBlocked },
            { label: "Failed", value: summary.failed },
            { label: "Never executed", value: summary.notExecuted },
            { label: "Evidence stale", value: summary.stale },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-border p-2">
              <p className="text-lg font-semibold">{s.value}</p>
              <p className="text-xs text-muted-foreground">{s.label}</p>
            </div>
          ))}
        </div>

        {views.map((v) => (
          <ControlCard
            key={v.definition.control_id}
            view={v}
            acceptance={acceptanceFor(v.definition.control_id)}
            onRun={(id, force) => {
              if (PAYER_EXECUTED_CONTROLS.has(id)) { setCollectFor({ id, force }); return; }
              void act(id, () => runFnControl(id, force));
            }}

            onResolve={onResolve}
            busy={busy}
          />
        ))}
      </CardContent>

      <FnCollectionDialog
        open={!!collectFor}
        controlId={collectFor?.id ?? "FN-01"}
        busy={busy === collectFor?.id}
        onOpenChange={(o) => { if (!o) setCollectFor(null); }}
        onExecute={(options: FnProviderExecutionOptions) => {
          const target = collectFor;
          if (!target) return;
          setCollectFor(null);
          void act(target.id, () => runFnControl(target.id, target.force, options));
        }}
      />
    </Card>
  );
}


export default FinancialReadinessPanel;
