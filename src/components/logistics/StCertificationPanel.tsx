/**
 * ST CERTIFICATION PANEL — the operator surface for the staging certification
 * programme.
 *
 * Every button invokes a real backend workflow. There is no "mark PASS", no
 * manual status override and no placeholder action: a control turns green only
 * when the orchestrator has executed it against the isolated database and
 * recorded immutable evidence.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Loader2, PlayCircle, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import {
  buildStView,
  loadStOverview,
  runStCertification,
  runStControl,
  type StControlView,
  type StOverview,
  type StRunStep,
} from "@/lib/logistics/certification/stCertification";
import { ST_REQUIREMENT_LABEL, ST_RESULT_TONE, type StRequirement } from "@/lib/logistics/certification/stControls";

const TONE_CLASS: Record<"ok" | "warn" | "danger" | "info", string> = {
  ok: "bg-status-success/15 text-status-success",
  warn: "bg-status-warning/15 text-status-warning",
  danger: "bg-destructive/15 text-destructive",
  info: "bg-muted text-muted-foreground",
};

function GateFacts({ overview }: { overview: StOverview }) {
  const g = overview.gate;
  const facts: { label: string; ok: boolean; detail: string }[] = [
    { label: "Staging registered", ok: g.staging_registered, detail: g.staging_key ?? "not registered" },
    { label: "Restore registered", ok: g.restore_registered, detail: g.restore_key ?? "not registered" },
    { label: "Staging verified", ok: g.staging_verification === "PASS", detail: g.staging_verification },
    { label: "Restore verified", ok: g.restore_verification === "PASS", detail: g.restore_verification },
    { label: "Targets independent", ok: g.targets_independent, detail: g.targets_independent ? "distinct fingerprints" : "not proven" },
    { label: "Certification schema", ok: !!g.staging_schema_version, detail: g.staging_schema_version ?? "not deployed" },
    { label: "Synthetic fixtures", ok: g.synthetic_fixtures_loaded, detail: g.synthetic_fixtures_loaded ? "loaded and scanned" : "not loaded" },
    { label: "Verified backup", ok: g.verified_backup, detail: g.verified_backup ? "integrity verified" : "none" },
    { label: "Verified restore", ok: g.verified_restore, detail: g.verified_restore ? "verified" : "none" },
  ];
  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {facts.map((f) => (
        <div key={f.label} className="flex items-start gap-2 rounded-lg border border-border p-2">
          {f.ok ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-status-success" aria-hidden />
          ) : (
            <AlertTriangle className="mt-0.5 h-4 w-4 text-status-warning" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="text-xs font-semibold">{f.label}</p>
            <p className="truncate text-xs text-muted-foreground">{f.detail}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ControlCard({
  view,
  onRun,
  busy,
}: {
  view: StControlView;
  onRun: (controlId: string, force: boolean) => void;
  busy: string | null;
}) {
  const [open, setOpen] = React.useState(false);
  const { definition: d, latest } = view;
  const tone = TONE_CLASS[ST_RESULT_TONE[view.result]];
  const running = busy === d.control_id;

  return (
    <div className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold">{d.control_id}</span>
            <Badge variant="secondary" className={tone}>{view.result.split("_").join(" ")}</Badge>
            <Badge variant="outline" className="text-[10px]">{d.target.split("_").join(" ").toLowerCase()}</Badge>
            <Badge variant="outline" className="text-[10px]">{d.owner}</Badge>
            {view.executable && view.result !== "PASS" && (
              <Badge variant="outline" className="text-[10px]">executable now</Badge>
            )}
          </div>
          <p className="mt-1 text-sm">{d.title}</p>
          <p className="mt-1 text-xs text-muted-foreground"><strong>Success:</strong> {d.success_condition}</p>
          <p className="text-xs text-muted-foreground"><strong>State:</strong> {view.reason}</p>
          {d.depends_on.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <strong>Depends on:</strong> {d.depends_on.join(", ")}
            </p>
          )}
          {view.unmet_requirements.length > 0 && (
            <p className="text-xs text-muted-foreground">
              <strong>Requires:</strong>{" "}
              {view.unmet_requirements.map((r) => ST_REQUIREMENT_LABEL[r as StRequirement] ?? r).join(" · ")}
            </p>
          )}
          {d.owner_input && view.result === "OWNER_ACTION_REQUIRED" && (
            <p className="mt-1 rounded-md bg-status-warning/10 p-2 text-xs">
              <strong>Owner input required — {d.owner_input.key}:</strong> {d.owner_input.description}{" "}
              <Link className="underline" to="/dashboard/admin/production-command-center?tab=approvals">
                Record the approval
              </Link>
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col gap-2">
          <Button size="sm" variant="outline" disabled={running} onClick={() => onRun(d.control_id, false)}>
            {running ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" />}
            Run
          </Button>
          <Button size="sm" variant="ghost" disabled={running} onClick={() => onRun(d.control_id, true)}>
            Re-execute
          </Button>
          {latest && (
            <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
              {open ? "Hide evidence" : "Evidence"}
            </Button>
          )}
        </div>
      </div>

      {open && latest && (
        <div className="mt-3 space-y-2 rounded-md bg-muted/40 p-3">
          <div className="grid gap-1 text-xs sm:grid-cols-2">
            <p><strong>Execution:</strong> <span className="font-mono">{latest.id}</span></p>
            <p><strong>Attempt:</strong> {latest.attempt}</p>
            <p><strong>Environment:</strong> {latest.environment_key ?? "control plane"}</p>
            <p><strong>Fingerprint:</strong> <span className="font-mono">{(latest.environment_fingerprint ?? "n/a").slice(0, 16)}</span></p>
            <p><strong>Correlation:</strong> <span className="font-mono">{latest.correlation_id.slice(0, 8)}</span></p>
            <p><strong>Request:</strong> <span className="font-mono">{latest.request_id.slice(0, 8)}</span></p>
            <p><strong>Evidence hash:</strong> <span className="font-mono">{(latest.evidence_sha256 ?? "n/a").slice(0, 16)}</span></p>
            <p><strong>Finished:</strong> {latest.finished_at ? new Date(latest.finished_at).toLocaleString() : "—"}</p>
            <p><strong>Duration:</strong> {latest.duration_ms ?? 0} ms</p>
            <p><strong>Expires:</strong> {latest.expires_at ? new Date(latest.expires_at).toLocaleDateString() : "—"}</p>
          </div>
          {latest.assertions.length > 0 && (
            <ul className="space-y-1">
              {latest.assertions.map((a) => (
                <li key={a.key} className="flex items-start gap-2 text-xs">
                  {a.passed ? (
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-success" aria-hidden />
                  ) : (
                    <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                  )}
                  <span>
                    <span className="font-mono">{a.key}</span> — expected <em>{a.expected}</em>, observed <em>{a.observed}</em>
                  </span>
                </li>
              ))}
            </ul>
          )}
          {latest.first_failure && (
            <p className="text-xs text-destructive">
              <strong>First failing step:</strong> {latest.first_failure.assertion} — expected{" "}
              {latest.first_failure.expected}, observed {latest.first_failure.observed}
              {latest.retryable ? " (retryable)" : ""}
            </p>
          )}
          <details>
            <summary className="cursor-pointer text-xs text-muted-foreground">Raw evidence</summary>
            <pre className="mt-1 max-h-64 overflow-auto rounded bg-background p-2 text-[10px]">
              {JSON.stringify(latest.evidence, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </div>
  );
}

export function StCertificationPanel() {
  const [overview, setOverview] = React.useState<StOverview | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [steps, setSteps] = React.useState<StRunStep[]>([]);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await loadStOverview());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  const view = React.useMemo(() => (overview ? buildStView(overview) : null), [overview]);

  const onRun = async (controlId: string, force: boolean) => {
    setBusy(controlId);
    try {
      const r = await runStControl(controlId, force);
      const result = ((r.results ?? []) as Record<string, unknown>[])[0];
      toast({
        title: `${controlId}: ${String(result?.result ?? "no result")}`,
        description: String(result?.remediation ?? result?.result ?? "Execution recorded."),
      });
      await refresh();
    } catch (e) {
      toast({ title: `${controlId} execution failed`, description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  const onRunAll = async () => {
    setBusy("ALL");
    setSteps([]);
    try {
      const r = await runStCertification((s) => setSteps((prev) => [...prev, s]));
      const passed = r.results.filter((x) => x.result === "PASS").length;
      toast({ title: "ST certification run complete", description: `${passed}/${r.results.length} controls passed.` });
      await refresh();
    } catch (e) {
      toast({ title: "ST certification run failed", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setBusy(null);
    }
  };

  if (loading && !overview) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading the ST certification state…
        </CardContent>
      </Card>
    );
  }

  if (error || !overview?.ok || !view) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">ST certification</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p className="text-muted-foreground">
            {error ?? overview?.code ?? "The authoritative certification state could not be read."}
          </p>
          <Button size="sm" variant="outline" onClick={() => void refresh()}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            Staging certification — {view.passed}/{view.total} controls proven
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void onRunAll()} disabled={busy !== null}>
              {busy === "ALL" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-1 h-3.5 w-3.5" />}
              Run ST certification
            </Button>
            <Button size="sm" variant="outline" onClick={() => void refresh()} disabled={busy !== null}>
              <RefreshCw className="mr-1 h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" variant="ghost" asChild>
              <Link to="/dashboard/admin/infrastructure-di00">DI-00 control plane</Link>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {view.certified
              ? "Every ST control has authoritative evidence from the isolated staging and restore databases."
              : "Controls stay unproven until the orchestrator executes them against the isolated databases. Nothing on this page can set a result by hand."}
          </p>
          <GateFacts overview={overview} />
          {steps.length > 0 && (
            <ol className="space-y-1 rounded-md bg-muted/40 p-3 text-xs">
              {steps.map((s, i) => (
                <li key={`${s.step}-${i}`} className="flex items-center gap-2">
                  {s.ok ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-status-success" aria-hidden />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5 text-status-warning" aria-hidden />
                  )}
                  <span className="font-medium">{s.label}</span>
                  <span className="text-muted-foreground">— {s.detail}</span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Controls in dependency order</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          {view.waves.map((wave, i) => (
            <div key={`wave-${i}`} className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Wave {i + 1} — {wave.length === 1 ? "single control" : "executed in parallel"}
              </p>
              {wave.map((id) => {
                const c = view.controls.find((x) => x.definition.control_id === id)!;
                return <ControlCard key={id} view={c} onRun={onRun} busy={busy} />;
              })}
            </div>
          ))}
        </CardContent>
      </Card>

      {overview.runs.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Execution history</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {overview.runs.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border p-2 text-xs">
                <span className="font-mono">{r.run_key}</span>
                <Badge variant="outline">{r.state}</Badge>
                <span className="text-muted-foreground">
                  <Clock className="mr-1 inline h-3 w-3" />
                  {new Date(r.started_at).toLocaleString()}
                </span>
                <span className="text-muted-foreground">
                  {String((r.summary as { passed?: number }).passed ?? 0)}/{String((r.summary as { total?: number }).total ?? 0)} passed
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
