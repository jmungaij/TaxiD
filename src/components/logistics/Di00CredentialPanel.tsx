/**
 * DI-00 — OWNER CREDENTIAL INTAKE, DSN PREFLIGHT & ORCHESTRATION AUDIT.
 *
 * The only surface where the two isolated database connection strings are
 * entered. Laws honoured here:
 *   • Visible to the platform owner (super_admin) only; the server re-checks.
 *   • Values are write-only: submitted once, sealed server-side, never read
 *     back, never rendered, never stored in component state after submission.
 *   • A DSN can be preflight-validated first: the server authenticates against
 *     the live endpoint and returns the exact failure reason before any
 *     orchestration starts.
 *   • Saving a credential resumes the DI-00 chain automatically from the
 *     blocked step; the run reference, every step transition and the final
 *     outcome are read back from the server audit log.
 *   • Independence and every step outcome are server verdicts; this panel can
 *     only display them.
 */
import { useCallback, useEffect, useState } from "react";
import {
  AlertTriangle, CheckCircle2, History, KeyRound, Loader2, PlayCircle,
  RotateCcw, ShieldAlert, ShieldCheck, SkipForward, XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import * as di00 from "@/lib/infrastructure/di00";
import type {
  DsnValidationResponse, OrchestrationAlertRow, OrchestrationRunRow, OrchestrationStepSummary,
} from "@/lib/infrastructure/di00";
import {
  INDEPENDENCE_TONE, independenceState,
  type CredentialStatusRow, type IndependenceAssertion,
} from "@/lib/infrastructure/independence";

const toneClass = (tone: "ok" | "warn" | "danger" | "info") =>
  tone === "ok" ? "border-success/40 text-success"
    : tone === "warn" ? "border-warning/50 text-warning"
      : tone === "danger" ? "border-destructive/50 text-destructive"
        : "border-info/40 text-info";

const RUN_TONE: Record<string, "ok" | "warn" | "danger" | "info"> = {
  SUCCEEDED: "ok", RUNNING: "info", PARTIAL: "warn", BLOCKED: "warn", FAILED: "danger", CANCELLED: "danger",
};

const STEP_ICON: Record<string, JSX.Element> = {
  SUCCEEDED: <CheckCircle2 className="h-3 w-3 text-success" />,
  SKIPPED: <SkipForward className="h-3 w-3 text-info" />,
  STARTED: <Loader2 className="h-3 w-3 animate-spin text-info" />,
  RETRYING: <RotateCcw className="h-3 w-3 text-warning" />,
  BLOCKED: <AlertTriangle className="h-3 w-3 text-warning" />,
  ROLLED_BACK: <RotateCcw className="h-3 w-3 text-destructive" />,
  FAILED: <XCircle className="h-3 w-3 text-destructive" />,
};

type Busy = "configure" | "independence" | "orchestrate" | "validate-staging" | "validate-restore" | null;

export function Di00CredentialPanel({ onCompleted }: { onCompleted?: () => void }) {
  const { isSuperAdmin, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [staging, setStaging] = useState("");
  const [restore, setRestore] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [steps, setSteps] = useState<OrchestrationStepSummary[]>([]);
  const [runReference, setRunReference] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<Record<string, DsnValidationResponse & { code: string }>>({});
  const [credentials, setCredentials] = useState<CredentialStatusRow[]>([]);
  const [assertion, setAssertion] = useState<IndependenceAssertion | null>(null);
  const [runs, setRuns] = useState<OrchestrationRunRow[]>([]);
  const [alerts, setAlerts] = useState<OrchestrationAlertRow[]>([]);

  const load = useCallback(async () => {
    const [status, log] = await Promise.all([di00.credentialStatus(), di00.orchestrationLog(8)]);
    if (status.ok) {
      setCredentials(status.data.credentials ?? []);
      setAssertion(status.data.independence ?? null);
    }
    if (log.ok) {
      setRuns(log.data.runs ?? []);
      setAlerts(log.data.notifications ?? []);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const state = independenceState(assertion);

  const runIndependence = async () => {
    setBusy("independence");
    const res = await di00.checkIndependence();
    setBusy(null);
    await load();
    toast(res.ok
      ? { title: "Independence proven", description: "Both targets are distinct non-production databases." }
      : { title: "Independence not proven", description: res.ok === false ? res.message : "The invariants did not pass.", variant: "destructive" });
  };

  /** Preflight only: authenticates the candidate DSN and reports the reason. */
  const validate = async (role: "staging" | "restore") => {
    const key = role === "staging" ? "logistics-staging" : "logistics-restore";
    const candidate = (role === "staging" ? staging : restore).trim();
    setBusy(role === "staging" ? "validate-staging" : "validate-restore");
    const res = await di00.validateDsn(key, candidate || undefined);
    setBusy(null);
    const verdict: DsnValidationResponse & { code: string } = res.ok
      ? res.data
      : {
        ok: false,
        stage: ((res.detail as DsnValidationResponse | undefined)?.stage) ?? "CONNECT",
        code: res.code,
        message: res.message,
        detail: ((res.detail as DsnValidationResponse | undefined)?.detail) ?? {},
      };
    setPreflight((p) => ({ ...p, [key]: verdict }));
    toast(verdict.ok
      ? { title: `${role} DSN validated`, description: verdict.message }
      : { title: `${role} DSN rejected — ${verdict.code.replace(/_/g, " ").toLowerCase()}`, description: verdict.message, variant: "destructive" });
    await load();
  };

  const applyRun = (data: { steps?: OrchestrationStepSummary[]; run_reference?: string | null; state?: string | null; blocked_reason?: string | null }) => {
    setSteps(data.steps ?? []);
    setRunReference(data.run_reference ?? null);
  };

  const submit = async () => {
    setBusy("configure");
    setSteps([]);
    const res = await di00.configureCredentials(staging.trim(), restore.trim());
    // Write-only: clear the plaintext from component state immediately.
    setStaging("");
    setRestore("");
    setBusy(null);
    if (!res.ok) {
      applyRun((res.detail as { steps?: OrchestrationStepSummary[] } | undefined) ?? {});
      toast({ title: res.code.replace(/_/g, " ").toLowerCase(), description: res.message, variant: "destructive" });
    } else {
      applyRun(res.data);
      toast(res.data.state === "SUCCEEDED"
        ? { title: `DI-00 ${res.data.run_reference ?? "run"} succeeded`, description: "Health, independence, schema, fixtures, backup, restore and ST certification all completed." }
        : {
          title: `DI-00 ${res.data.run_reference ?? "run"} ${String(res.data.state ?? "").toLowerCase()}`,
          description: res.data.blocked_reason ?? "The chain stopped; the audit log below records every transition.",
          variant: "destructive",
        });
    }
    await load();
    onCompleted?.();
  };

  const resume = async (force = false) => {
    setBusy("orchestrate");
    setSteps([]);
    const res = await di00.runOrchestration({ trigger: force ? "AUTO_RETRY" : "RESUME", force });
    setBusy(null);
    if (res.ok) {
      applyRun(res.data);
      toast({
        title: `DI-00 ${res.data.run_reference ?? "run"} ${String(res.data.state ?? "").toLowerCase()}`,
        description: res.data.blocked_reason ?? "Completed steps were skipped; the chain resumed from the blocked step.",
        variant: res.data.state === "SUCCEEDED" ? undefined : "destructive",
      });
    } else {
      applyRun((res.detail as { steps?: OrchestrationStepSummary[] } | undefined) ?? {});
      toast({ title: res.code.replace(/_/g, " ").toLowerCase(), description: res.message, variant: "destructive" });
    }
    await load();
    onCompleted?.();
  };

  const acknowledge = async (id: string) => {
    await di00.acknowledgeAlert(id);
    await load();
  };

  if (authLoading) return null;
  if (!isSuperAdmin) {
    return (
      <Card className="border-warning/30">
        <CardContent className="flex items-start gap-3 p-6">
          <ShieldAlert className="mt-0.5 h-5 w-5 text-warning" />
          <div className="text-sm">
            <p className="font-semibold">Owner-only surface</p>
            <p className="text-muted-foreground">
              Only the platform owner may supply the isolated database credentials. The independence verdict below is
              read-only for all other staff.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }


  const preflightRow = (key: string) => {
    const v = preflight[key];
    if (!v) return null;
    return (
      <div className={cn("rounded-md border p-2", v.ok ? "border-success/40" : "border-destructive/40")}>
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px]">{v.code.replace(/_/g, " ").toLowerCase()}</span>
          <Badge variant="outline" className={cn("text-[10px]", toneClass(v.ok ? "ok" : "danger"))}>
            {v.stage.toLowerCase()}
          </Badge>
        </div>
        <p className="mt-1 text-[11px]">{v.message}</p>
        {typeof v.detail?.host === "string" && (
          <p className="text-[10px] text-muted-foreground">
            host {String(v.detail.host)}
            {typeof v.detail.database_name === "string" ? ` · database ${String(v.detail.database_name)}` : ""}
            {v.detail.ssl === true ? " · TLS verified" : ""}
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <KeyRound className="h-4 w-4" /> Isolated database credentials — owner only
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          <p className="text-muted-foreground">
            Paste the connection string of each isolated non-production PostgreSQL database. Validate first to test
            authentication and see the exact failure reason. On save, values are sealed server-side, never shown again,
            and the DI-00 chain resumes automatically from the blocked step. The two must be separate databases.
          </p>
          <div className="space-y-1">
            <Label htmlFor="di00-staging" className="text-[11px]">LOGISTICS_STAGING_DATABASE_URL</Label>
            <div className="flex gap-2">
              <Input
                id="di00-staging" type="password" autoComplete="off" spellCheck={false}
                placeholder="postgresql://user:password@host:5432/database"
                value={staging} onChange={(e) => setStaging(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={() => validate("staging")} disabled={busy !== null}>
                {busy === "validate-staging" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Validate"}
              </Button>
            </div>
            {preflightRow("logistics-staging")}
          </div>
          <div className="space-y-1">
            <Label htmlFor="di00-restore" className="text-[11px]">LOGISTICS_RESTORE_DATABASE_URL</Label>
            <div className="flex gap-2">
              <Input
                id="di00-restore" type="password" autoComplete="off" spellCheck={false}
                placeholder="postgresql://user:password@host:5432/database"
                value={restore} onChange={(e) => setRestore(e.target.value)}
              />
              <Button size="sm" variant="outline" onClick={() => validate("restore")} disabled={busy !== null}>
                {busy === "validate-restore" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Validate"}
              </Button>
            </div>
            {preflightRow("logistics-restore")}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={submit} disabled={busy !== null || (!staging.trim() && !restore.trim())}>
              {busy === "configure" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Seal credentials &amp; resume DI-00
            </Button>
            <Button size="sm" variant="outline" onClick={() => resume(false)} disabled={busy !== null}>
              {busy === "orchestrate" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="mr-2 h-3.5 w-3.5" />}
              Resume chain
            </Button>
            <Button size="sm" variant="outline" onClick={runIndependence} disabled={busy !== null}>
              {busy === "independence" ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
              Re-check independence
            </Button>
          </div>

          {credentials.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              {credentials.map((c) => (
                <div key={c.environment_key} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px]">{c.secret_name}</span>
                  <span className="text-muted-foreground">
                    {c.host_ref ?? "host withheld"} · sealed {new Date(c.rotated_at ?? c.configured_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}

          {steps.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              <p className="text-[11px] font-semibold">
                Automatic execution{runReference ? ` · ${runReference}` : ""}
              </p>
              {steps.map((s, i) => (
                <div key={`${s.step}-${i}`} className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px]">{s.step}</span>
                  <span className="flex items-center gap-1">
                    {STEP_ICON[s.state ?? (s.ok ? "SUCCEEDED" : "FAILED")] ?? (s.ok
                      ? <CheckCircle2 className="h-3 w-3 text-success" />
                      : <XCircle className="h-3 w-3 text-destructive" />)}
                    <span className="text-[10px] text-muted-foreground">
                      {(s.state ?? (s.ok ? "SUCCEEDED" : "FAILED")).toLowerCase()}
                      {s.code && s.code !== "OK" ? ` · ${s.code}` : ""}
                      {s.attempt && s.attempt > 1 ? ` · attempt ${s.attempt}` : ""}
                      {s.rollback_result ? ` · rollback ${s.rollback_result.toLowerCase()}` : ""}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>


      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ShieldCheck className="h-4 w-4" /> Independence invariants
            <Badge variant="outline" className={cn("ml-auto text-[10px]", toneClass(INDEPENDENCE_TONE[state.state]))}>
              {state.state.replace(/_/g, " ").toLowerCase()}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-xs">
          <p className="text-muted-foreground">{state.reason}</p>
          {assertion?.invariants?.length
            ? assertion.invariants.map((i) => (
              <div key={i.invariant_id} className="rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[10px]">{i.invariant_id}</span>
                  <Badge
                    variant="outline"
                    className={cn("text-[10px]", toneClass(i.result === "PASS" ? "ok" : i.result === "FAIL" ? "danger" : "warn"))}
                  >
                    {i.result.replace(/_/g, " ").toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1 text-[11px]">{i.requirement}</p>
                <p className="text-[10px] text-muted-foreground">observed: {i.observed}</p>
              </div>
            ))
            : <p className="text-muted-foreground">No invariant record yet.</p>}
          {assertion && (
            <p className="text-[10px] text-muted-foreground">
              asserted {new Date(assertion.asserted_at).toLocaleString()} · staging{" "}
              {assertion.staging_identity_sha256?.slice(0, 12) ?? "—"}… · restore{" "}
              {assertion.restore_identity_sha256?.slice(0, 12) ?? "—"}…
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="lg:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm">
            <History className="h-4 w-4" /> Orchestration audit log
            <span className="ml-auto text-[10px] font-normal text-muted-foreground">
              every run, step transition and outcome, recorded server-side
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-xs">
          {runs.length === 0 && <p className="text-muted-foreground">No orchestration run recorded yet.</p>}
          {runs.map((r) => (
            <div key={r.id} className="rounded-md border p-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px]">{r.run_reference}</span>
                <Badge variant="outline" className={cn("text-[10px]", toneClass(RUN_TONE[r.state] ?? "info"))}>
                  {r.state.toLowerCase()}
                </Badge>
                <span className="text-[10px] text-muted-foreground">
                  {r.trigger_source.replace(/_/g, " ").toLowerCase()} · {new Date(r.started_at).toLocaleString()}
                  {r.duration_ms != null ? ` · ${Math.round(r.duration_ms / 100) / 10}s` : ""}
                </span>
              </div>
              {r.blocked_reason && (
                <p className="mt-1 text-[11px] text-warning">
                  blocked at {r.blocked_step ?? "?"}: {r.blocked_reason}
                </p>
              )}
              <div className="mt-2 space-y-0.5">
                {r.steps.map((s) => (
                  <div key={s.id} className="flex items-start justify-between gap-2">
                    <span className="flex items-center gap-1 font-mono text-[10px]">
                      {STEP_ICON[s.state] ?? <CheckCircle2 className="h-3 w-3 text-muted-foreground" />}
                      {s.step_key}
                      {s.attempt > 1 ? ` (attempt ${s.attempt})` : ""}
                    </span>
                    <span className="text-right text-[10px] text-muted-foreground">
                      {s.state.toLowerCase()}
                      {s.error_code ? ` · ${s.error_code}` : ""}
                      {s.rollback_result ? ` · rollback ${s.rollback_result.toLowerCase()}` : ""}
                      {s.reused_evidence ? " · evidence reused" : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {alerts.length > 0 && (
            <div className="space-y-1 border-t pt-2">
              <p className="text-[11px] font-semibold">Administrator notifications</p>
              {alerts.slice(0, 12).map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-2 rounded-md border p-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn("text-[10px]", toneClass(a.severity === "CRITICAL" ? "danger" : a.severity === "WARNING" ? "warn" : "info"))}
                      >
                        {a.severity.toLowerCase()}
                      </Badge>
                      <span className="text-[11px] font-medium">{a.title}</span>
                    </div>
                    <p className="text-[10px] text-muted-foreground">{a.body}</p>
                    <p className="text-[10px] text-muted-foreground">{new Date(a.created_at).toLocaleString()}</p>
                  </div>
                  {a.acknowledged_at
                    ? <span className="text-[10px] text-muted-foreground">acknowledged</span>
                    : (
                      <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={() => acknowledge(a.id)}>
                        Acknowledge
                      </Button>
                    )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>

  );
}

export default Di00CredentialPanel;
