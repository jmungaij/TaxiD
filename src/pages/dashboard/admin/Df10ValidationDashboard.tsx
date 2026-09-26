/**
 * DF-10 Adversarial Validation Dashboard.
 *
 * User-facing HOLD register: every control with its status, the evidence that
 * produced it, and the remediation action that would clear it. Nothing here is
 * inferred from source-code existence — statuses come from the executed gate.
 */
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AppButton } from "@/components/nav/AppButton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ShieldAlert, CheckCircle2, XCircle, Clock, HelpCircle, Download, Database, FileCheck2 } from "lucide-react";
import {
  df10AdversarialControls,
  df10AdversarialVerdict,
  reconcileEntityStorage,
  rlsMatrixSummary,
  rpcFuzzSummary,
  webhookProbeSummary,
  staleEventSummary,
  simulationSummary,
  assessIsolatedEnvironment,
  buildProductionEvidenceCertificate,
  renderCertificateMarkdown,
  EXECUTION_SEQUENCE,
  SYNTHETIC_DATASET,
  type AdvControlStatus,
  type SimulationSummary,
} from "@/lib/logistics/domain";
import LogisticsReadinessControlPlanePanel from "@/components/logistics/LogisticsReadinessControlPlanePanel";
import { useReadinessExecution } from "@/hooks/useReadinessExecution";

const STATUS_ICON: Record<AdvControlStatus, JSX.Element> = {
  PASS: <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" />,
  FAIL: <XCircle className="mt-0.5 h-4 w-4 text-destructive" />,
  BLOCKED: <Clock className="mt-0.5 h-4 w-4 text-muted-foreground" />,
  NOT_TESTED: <HelpCircle className="mt-0.5 h-4 w-4 text-muted-foreground" />,
};

/** Actionable remediation per control. */
const REMEDIATION: Record<string, { action: string; to: string; label: string }> = {
  "AV-06": { action: "Provision the isolated forensic environment, then run the cross-tenant probe set.", to: "/dashboard/admin/logistics-df10?tab=environment", label: "Environment checklist" },
  "AV-07": { action: "Deploy the RPCs to the isolated instance and execute the documented probes.", to: "/dashboard/admin/logistics-df10?tab=rpc", label: "RPC fuzz results" },
  "AV-09": { action: "Re-run the concurrency races against Postgres with real parallel sessions.", to: "/dashboard/admin/logistics-df10?tab=simulations", label: "Simulation results" },
  "AV-10": { action: "Re-run the duplicate-command set against the deployed RPCs.", to: "/dashboard/admin/logistics-df10?tab=simulations", label: "Simulation results" },
  "AV-11": { action: "Attempt UPDATE/DELETE on logistics_events as every role on the isolated instance.", to: "/dashboard/admin/logistics-df10?tab=rls", label: "RLS matrix" },
  "AV-17": { action: "Restore a backup into the second isolated target and verify schema, rows, RLS, RPCs and events.", to: "/dashboard/admin/logistics-df10?tab=environment", label: "Restore target" },
  "AV-18": { action: "Provision a fresh isolated project, set VITE_LOGISTICS_STAGING_URL and VITE_LOGISTICS_RESTORE_URL, and load only synthetic adversarial data.", to: "/dashboard/admin/logistics-df10?tab=environment", label: "Provisioning steps" },
  "AV-19": { action: "Instrument the remaining business-event sinks once the migration creates them.", to: "/dashboard/admin/logistics-center", label: "Logistics centre" },
  "AV-28": { action: "Replay the generated RLS matrix as SQL against the isolated instance.", to: "/dashboard/admin/logistics-df10?tab=rls", label: "RLS matrix" },
  "AV-29": { action: "Execute the fuzz cases as real RPC calls per role.", to: "/dashboard/admin/logistics-df10?tab=rpc", label: "RPC fuzz results" },
  "AV-30": { action: "Repeat the races with parallel database sessions and compare authoritative effects.", to: "/dashboard/admin/logistics-df10?tab=simulations", label: "Simulation results" },
};

export default function Df10ValidationDashboard() {
  // The readiness hook publishes the sealed certification evidence; the
  // adversarial engines below are recomputed once it has loaded so this page can
  // never show a projection older than the evidence register.
  const readiness = useReadinessExecution();
  const evidenceStamp = readiness.loading ? "loading" : `${readiness.view.infraReady}:${readiness.view.certification.generated_at}`;
  const controls = useMemo(() => df10AdversarialControls(), [evidenceStamp]);
  const verdict = useMemo(() => df10AdversarialVerdict(), [evidenceStamp]);
  const cert = useMemo(() => buildProductionEvidenceCertificate(), [evidenceStamp]);
  const recon = useMemo(() => reconcileEntityStorage(), []);
  const rls = useMemo(() => rlsMatrixSummary(), []);
  const fuzz = useMemo(() => rpcFuzzSummary(), []);
  const webhooks = useMemo(() => webhookProbeSummary(), []);
  const stale = useMemo(() => staleEventSummary(), []);
  const env = useMemo(() => assessIsolatedEnvironment(), [evidenceStamp]);
  const [sims, setSims] = useState<SimulationSummary | null>(null);

  useEffect(() => {
    void simulationSummary().then(setSims);
  }, []);

  const blockers = controls.filter((c) => c.status !== "PASS");

  const saveFile = (name: string, body: string) => {
    const url = URL.createObjectURL(new Blob([body], { type: "text/markdown" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const download = () => {
    const lines = [
      "# DF-10 Adversarial Validation — HOLD register",
      `${cert.headline} · production migration authorisation ${cert.migrationAuthorisation}`,
      "",
      ...controls.map((c) => `## ${c.id} ${c.name}\nStatus: ${c.status} (${c.priority}, ${c.owner})\nEvidence: ${c.evidence}\nRemediation: ${REMEDIATION[c.id]?.action ?? "None — control passing."}\n`),
    ];
    saveFile("df10-hold-register.md", lines.join("\n"));
  };

  return (
    <div className="container mx-auto max-w-6xl space-y-6 p-4 md:p-8">
      <header className="space-y-4">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                <ShieldAlert className="h-4 w-4 text-destructive" /> DF-10 Isolated Database Forensic Execution Gate
              </p>
              <h1 className="mt-2 text-3xl font-semibold tracking-tight">{cert.headline}</h1>
              <p className="mt-1 text-sm font-medium text-destructive">
                No production migration authorisation — DDL is {cert.migrationAuthorisation.toLowerCase()}.
              </p>
              <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                Architecture/domain foundation and application-level adversarial validation are assessed independently from the
                infrastructure evidence gate. No source-code inspection, unit test, compilation, migration file, policy file or
                simulated result is converted into PASS for a database-dependent control.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AppButton analytics="admin.df10.download_certificate" action="noop" variant="outline" size="sm" onClick={() => saveFile("yalla-logistics-production-readiness-certificate.md", renderCertificateMarkdown(cert))}>
                <FileCheck2 className="mr-2 h-4 w-4" /> Download certificate
              </AppButton>
              <AppButton analytics="admin.df10.download_register" action="noop" variant="outline" size="sm" onClick={download}>
                <Download className="mr-2 h-4 w-4" /> HOLD register
              </AppButton>
            </div>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-3">
            {cert.tracks.slice(0, 3).map((t) => (
              <div key={t.id} className="rounded-md border border-border bg-background p-3">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">{t.title}</p>
                <p className="mt-1 text-lg font-semibold">{t.verdict}</p>
              </div>
            ))}
          </div>

          <p className="mt-4 text-xs uppercase tracking-wide text-muted-foreground">Critical gates (subordinate — not a readiness measure)</p>
          <p className="text-xs text-muted-foreground">
            PASS {cert.counts.PASS} · BLOCKED {cert.counts.BLOCKED} · FAIL {cert.counts.FAIL} · NOT TESTED {cert.counts.NOT_TESTED} ·
            BUSINESS TARGET REQUIRED {cert.counts.BUSINESS_TARGET_REQUIRED} · P0 outstanding {verdict.outstanding.P0.length}
          </p>
        </div>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { label: "Domain reconciliation", value: `${recon.mapped}/${recon.totalEntities}`, note: recon.status },
          { label: "RLS matrix cells", value: String(rls.cells), note: `model ${rls.modelStatus} · db ${rls.databaseStatus}` },
          { label: "RPC fuzz cases", value: String(fuzz.cases), note: `model ${fuzz.modelStatus} · db ${fuzz.databaseStatus}` },
          { label: "Webhook + stale probes", value: `${webhooks.passed + stale.passed}/${webhooks.total + stale.total}`, note: "executed" },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
              <p className="text-2xl font-semibold">{k.value}</p>
              <p className="text-xs text-muted-foreground">{k.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="readiness">
        <TabsList className="flex-wrap">
          <TabsTrigger value="readiness">Production readiness</TabsTrigger>
          <TabsTrigger value="certificate">Evidence certificate</TabsTrigger>
          <TabsTrigger value="blockers">HOLD blockers ({blockers.length})</TabsTrigger>
          <TabsTrigger value="controls">All controls ({controls.length})</TabsTrigger>
          <TabsTrigger value="rls">RLS matrix</TabsTrigger>
          <TabsTrigger value="rpc">RPC fuzz</TabsTrigger>
          <TabsTrigger value="simulations">Simulations</TabsTrigger>
          <TabsTrigger value="environment">Isolated environment</TabsTrigger>
        </TabsList>

        <TabsContent value="readiness" className="pt-4">
          <LogisticsReadinessControlPlanePanel view={readiness.view} loading={readiness.loading} error={readiness.error} />
        </TabsContent>

        <TabsContent value="certificate" className="space-y-3 pt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Track assessment</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {cert.tracks.map((t) => (
                <div key={t.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={t.verdict === "PASS" ? "default" : t.verdict === "FAIL" ? "destructive" : "secondary"} className="text-[10px] uppercase">
                      {t.verdict}
                    </Badge>
                    <span className="text-sm font-medium">{t.title}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{t.tier.replace(/_/g, " ")}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{t.claim}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{t.note}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    PASS {t.counts.PASS} · BLOCKED {t.counts.BLOCKED} · FAIL {t.counts.FAIL} · NOT TESTED {t.counts.NOT_TESTED}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Isolated-environment evidence register ({cert.staging.length} tests)</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {cert.staging.map((s) => (
                <div key={s.id} className="rounded-md border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={s.status === "PASS" ? "default" : s.status === "FAIL" ? "destructive" : "outline"} className="text-[10px] uppercase">
                      {s.status.replace(/_/g, " ")}
                    </Badge>
                    <span className="text-sm font-medium">{s.id} · {s.test}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{s.owner}</Badge>
                  </div>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{s.evidence}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {cert.prohibitionReasons.length > 0 && (
            <Card>
              <CardHeader><CardTitle className="text-base">Why production authorisation is withheld</CardTitle></CardHeader>
              <CardContent className="space-y-1">
                {cert.prohibitionReasons.map((r) => (
                  <p key={r} className="text-xs text-destructive">• {r}</p>
                ))}
              </CardContent>
            </Card>
          )}
        </TabsContent>


        <TabsContent value="blockers" className="space-y-3 pt-4">
          {blockers.map((c) => (
            <Card key={c.id}>
              <CardContent className="flex items-start gap-3 p-4">
                {STATUS_ICON[c.status]}
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium">{c.id} · {c.name}</span>
                    <Badge variant="outline" className="text-[10px] uppercase">{c.status}</Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">{c.priority}</Badge>
                    <Badge variant="outline" className="text-[10px] uppercase">{c.owner}</Badge>
                  </div>
                  <p className="break-words text-xs text-muted-foreground">{c.evidence}</p>
                  {REMEDIATION[c.id] && (
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <p className="text-xs font-medium">Remediation: {REMEDIATION[c.id].action}</p>
                      <AppButton
                        analytics={`admin.df10.remediate.${c.id}`}
                        action="navigate"
                        target={REMEDIATION[c.id].to}
                        variant="outline"
                        size="sm"
                      >
                        {REMEDIATION[c.id].label}
                      </AppButton>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="controls" className="space-y-2 pt-4">
          {controls.map((c) => (
            <div key={c.id} className="flex items-start gap-3 rounded-md border border-border p-3">
              {STATUS_ICON[c.status]}
              <div className="min-w-0">
                <p className="text-sm font-medium">{c.id} · {c.name}</p>
                <p className="break-words text-xs text-muted-foreground">{c.evidence}</p>
              </div>
            </div>
          ))}
        </TabsContent>

        <TabsContent value="rls" className="pt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Role matrix — {rls.roles} principals × {rls.resources} resources</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="text-muted-foreground">
                {rls.cells} evaluated cells, {rls.negativeCells} of them negative. Model violations: {rls.modelViolations.length}.
                Named cross-tenant attacks that were allowed: {rls.namedNegativeFailures.length}.
              </p>
              <p className="text-xs text-muted-foreground">{rls.note}</p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="rpc" className="pt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">RPC authorization fuzz — {fuzz.rpcs} RPCs, {fuzz.cases} cases</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{fuzz.denials} denials recorded; model failures: {fuzz.failures.length}.</p>
              <div className="space-y-1">
                {Object.entries(fuzz.callerMatrix).map(([rpc, roles]) => (
                  <p key={rpc} className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{rpc}</span> — {roles.join(", ")}</p>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="simulations" className="pt-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Concurrency & idempotency simulations</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {sims ? (
                <>
                  <p>Concurrency: {sims.concurrency.passed}/{sims.concurrency.total} produced exactly one authoritative effect.</p>
                  <p>Idempotency: {sims.idempotency.passed}/{sims.idempotency.total} duplicate commands produced no duplicate effect.</p>
                  <p className="text-xs text-muted-foreground">
                    Executed in process against the reference locking store — dispatch acceptance, payment callback/retry/replay, POD
                    submission, return + claim, parallel booking and concurrent transitions. Database-level proof stays {sims.databaseStatus}.
                  </p>
                </>
              ) : (
                <p className="text-muted-foreground">Running simulations…</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="environment" className="space-y-3 pt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4" /> Isolated forensic environment — {env.status}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p className="text-muted-foreground">{env.reason}</p>
              <ul className="space-y-1">
                {env.requirements.map((r) => (
                  <li key={r.id} className="text-xs">
                    {r.satisfied ? "✓" : "•"} <span className="font-medium">{r.id}</span> {r.requirement}
                    {r.envVar ? ` (${r.envVar})` : ""} — <span className="text-muted-foreground">{r.detail}</span>
                  </li>
                ))}
              </ul>
              <div>
                <p className="text-xs font-medium">Synthetic dataset required (no production data):</p>
                <ul className="mt-1 grid gap-1 sm:grid-cols-2">
                  {SYNTHETIC_DATASET.map((d) => (
                    <li key={d} className="text-xs text-muted-foreground">• {d}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="text-xs font-medium">Execution sequence:</p>
                <ul className="mt-1 space-y-1">
                  {EXECUTION_SEQUENCE.map((s) => (
                    <li key={s.step} className="text-xs text-muted-foreground">{s.step}. {s.name} — {s.state}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
