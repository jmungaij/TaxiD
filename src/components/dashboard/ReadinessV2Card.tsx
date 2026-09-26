/**
 * Phase D5.5 — Enhanced Readiness Gate card.
 * Renders the 5 forensic readiness fields alongside the classic score.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ShieldCheck, ShieldAlert, Clock } from "lucide-react";
import { certifyWorkspace360, type Workspace360Contract } from "@/lib/workspace360/certification";
import { certifyWorkspace360Health, unwiredTabCount } from "@/lib/workspace360/health";
import { certifyWorkspace360Governance } from "@/lib/workspace360/governance";
import { certifyProductionQualification } from "@/lib/workspace360/productionQualification";
import { certifyProductionValidation } from "@/lib/workspace360/productionValidation";
import { certifyProductionEvidenceVault } from "@/lib/workspace360/productionEvidenceVault";
import { certifyProductionExecution } from "@/lib/workspace360/productionExecution";
import { certifyProductionAcceptance } from "@/lib/workspace360/productionAcceptance";
import { certifyProductionClosure } from "@/lib/workspace360/productionClosure";
import { composeBlockerInventory } from "@/lib/workspace360/blockerInventory";
import { loadLatestEvpEvidence, isEvpFresh, EMPTY_DIAGNOSTICS, type EvpEvidenceOverlay } from "@/lib/workspace360/evpEvidence";
import { HoldGapChecklist } from "./HoldGapChecklist";
import { ROUTES } from "@/lib/routes";
import contract from "../../../contracts/schema-contract.v1.json";

interface ReadinessV2 {
  status: "READY" | "BLOCKED";
  readiness_score: number;
  evidence_confidence: number;
  blocking_component: string | null;
  first_failure_at: string | null;
  affected_functions: string[];
  recovery_recommendation: string;
  chain_progress: { total: number; failing: number; classified: number; green_pinned: number };
  next_action: { action: string; scenario_key?: string; failure_class?: string };
}

export function ReadinessV2Card() {
  const [r, setR] = useState<ReadinessV2 | null>(null);
  const [ops, setOps] = useState<{ avg_score: number; failed_drivers: number; sample_size: number; passed: boolean } | null>(null);
  const [evp, setEvp] = useState<EvpEvidenceOverlay | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    const [{ data }, { data: opsData }, evpOverlay] = await Promise.all([
      supabase.rpc("compute_platform_readiness_v2" as never),
      supabase.rpc("driver_operational_consistency_scoreboard" as never, { _sample_size: 10 } as never),
      loadLatestEvpEvidence(),
    ]);
    setR((data as unknown) as ReadinessV2);
    setOps((opsData as { avg_score: number; failed_drivers: number; sample_size: number; passed: boolean } | null) ?? null);
    setEvp(evpOverlay);
    setBusy(false);
  }, []);
  useEffect(() => { void load(); }, [load]);

  const ws = useMemo(
    () => certifyWorkspace360(
      (contract as { workspace360?: Workspace360Contract }).workspace360 ?? {
        domains: [], adopted_domains: [], tabs: [], shared_modules: [], domain_routes: {},
      },
      ROUTES,
    ),
    [],
  );

  const wsHealth = useMemo(() => {
    const c = contract as {
      workspace360?: { adopted_domains?: string[] };
      tables?: string[]; rpcs?: string[]; edge_functions?: string[];
      columns?: Array<{ table: string; column: string }>;
    };
    return certifyWorkspace360Health(
      c.workspace360?.adopted_domains ?? [],
      {
        tables: c.tables ?? [],
        columns: c.columns ?? [],
        rpcs: c.rpcs ?? [],
        edge_functions: c.edge_functions ?? [],
      },
    );
  }, []);

  const wsGov = useMemo(() => {
    const c = contract as {
      workspace360?: {
        domains?: string[]; adopted_domains?: string[]; tabs?: string[];
        shared_modules?: string[];
        domain_routes?: Record<string, { directory: string; workspace: string }>;
      };
      tables?: string[]; rpcs?: string[]; edge_functions?: string[];
      columns?: Array<{ table: string; column: string }>;
    };
    return certifyWorkspace360Governance(
      {
        domains: c.workspace360?.domains ?? [],
        adopted_domains: c.workspace360?.adopted_domains ?? [],
        tabs: c.workspace360?.tabs ?? [],
        shared_modules: c.workspace360?.shared_modules ?? [],
        domain_routes: c.workspace360?.domain_routes ?? {},
        tables: c.tables ?? [],
        columns: c.columns ?? [],
        rpcs: c.rpcs ?? [],
        edge_functions: c.edge_functions ?? [],
      },
      ROUTES,
    );
  }, []);


  const ready = r?.status === "READY";
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {ready ? <ShieldCheck className="h-4 w-4 text-status-success" /> : <ShieldAlert className="h-4 w-4 text-status-warning" />}
          Production Readiness (v2)
          <Badge variant="outline" className={ready
            ? "bg-status-success/15 text-status-success border-status-success/30"
            : "bg-status-warning/15 text-status-warning border-status-warning/30"}>
            {r?.status ?? "…"}
          </Badge>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => void load()} disabled={busy}>
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? "animate-spin" : ""}`} />
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <Row k="Readiness score"     v={`${r?.readiness_score ?? 0}`} />
        <Row k="Evidence confidence" v={`${r?.evidence_confidence ?? 0}%`} />
        <Row k="Blocking component"  v={<code>{r?.blocking_component ?? "—"}</code>} />
        <Row k="First failure"       v={r?.first_failure_at
          ? <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(r.first_failure_at).toLocaleString()}</span>
          : "—"} />
        <Row k="Affected functions"  v={
          <span className="font-mono text-xs">
            {(r?.affected_functions ?? []).length ? r!.affected_functions.join(", ") : "—"}
          </span>
        } />
        <Row k="Chain progress" v={
          <span className="font-mono text-xs">
            {r?.chain_progress
              ? `${r.chain_progress.green_pinned}/${r.chain_progress.total} pinned · ${r.chain_progress.failing} failing · ${r.chain_progress.classified} classified`
              : "…"}
          </span>
        } />
        <Row k="Driver op-consistency" v={
          <span className="font-mono text-xs">
            {ops
              ? `${ops.avg_score}/100 · ${ops.failed_drivers}/${ops.sample_size} failing${ops.passed ? "" : " ⚠"}`
              : "…"}
          </span>
        } />
        <Row k="Workspace360 certification" v={
          <span className="font-mono text-xs">
            {`${ws.score}/100 · ${ws.passingDomains}/${ws.adoptedDomains} adopted domains${ws.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Workspace360 health" v={
          <span className="font-mono text-xs">
            {`${wsHealth.platformScore}/100 · adoption ${wsHealth.adoptionPct}% · ${unwiredTabCount(wsHealth)} unwired tabs${wsHealth.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Workspace360 governance" v={
          <span className="font-mono text-xs">
            {`${wsGov.score}/100 · workflows ${wsGov.workflows.score}% · canonical ${wsGov.canonical.passed ? "✓" : "✗"}${wsGov.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Business consistency" v={
          <span className="font-mono text-xs">
            {`${wsGov.consistency.score}/100 · kpi ${wsGov.consistency.kpi.score} · fin ${wsGov.consistency.financial.score} · entity ${wsGov.consistency.entity.score} · flow ${wsGov.consistency.workflow.score}${wsGov.consistency.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Operational qualification" v={
          <span className="font-mono text-xs">
            {`${wsGov.operations.score}/100 · load ${wsGov.operations.load.score} · resil ${wsGov.operations.resilience.score} · replay ${wsGov.operations.recovery.score} · obs ${wsGov.operations.observability.score}${wsGov.operations.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Data contract (D8.3)" v={
          <span className="font-mono text-xs">
            {`${wsGov.dataContract.score}/100 · dep ${wsGov.dataContract.deprecated.score} · fare ${wsGov.dataContract.fare.score} · jobs ${wsGov.dataContract.scheduledJobs.score} · proj ${wsGov.dataContract.projections.score} · alert ${wsGov.dataContract.alertCorrelation.score}${wsGov.dataContract.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Freeze audit (pre-D9)" v={
          <span className="font-mono text-xs">
            {`${wsGov.freeze.score}/100 · P0 ${wsGov.freeze.p0.length} · P1 ${wsGov.freeze.p1.length} · P2 ${wsGov.freeze.p2.length}${wsGov.freeze.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Convergence (D9.0)" v={
          <span className="font-mono text-xs">
            {`${wsGov.convergence.score}/100 · adopt ${wsGov.convergence.axisScores.domainAdoption} · fin ${wsGov.convergence.axisScores.financialEngine} · flow ${wsGov.convergence.axisScores.workflowConvergence} · perf ${wsGov.convergence.axisScores.performanceBaseline} · P0 ${wsGov.convergence.p0.length}${wsGov.convergence.passed ? "" : " ⚠"}`}
          </span>
        } />
        <Row k="Business forecast (D11.1)" v={
          <span className="font-mono text-xs">
            {`${wsGov.forecast.score}/100 · det ${wsGov.forecast.determinismChecked ? "✓" : "✗"} · deps ${wsGov.forecast.dependenciesResolved ? "✓" : "✗"} · conf ${wsGov.forecast.confidenceCalibrated ? "✓" : "✗"}${wsGov.forecast.passed ? "" : " ⚠"}`}
          </span>
        } />
        {(() => {
          const pq = certifyProductionQualification({
            governance: wsGov,
            readinessScore: r?.readiness_score ?? null,
          });
          const lifecyclePass = pq.lifecycles.filter((l) => l.passed).length;
          return (
            <>
              <Row k="Production qualification (D12.1)" v={
                <span className="font-mono text-xs">
                  {`${pq.score}/100 · lifecycles ${lifecyclePass}/${pq.lifecycles.length} · cross ${pq.crossDomainIntegrity.score} · freeze ${pq.freeze.freezeScore} · cert ${pq.summary.certificationPassRate}%${pq.passed ? "" : " ⚠"}`}
                </span>
              } />
              <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
                <div className="font-medium mb-0.5">Lifecycle qualification</div>
                {pq.lifecycles.map((l) => (
                  <div key={l.id} className="flex items-center justify-between font-mono text-[11px]">
                    <span className="text-muted-foreground">{l.id}</span>
                    <span>
                      {l.adopted ? "adopted" : "unadopted"} ·{" "}
                      {l.covered ? `${l.workflowPass}/${l.workflowTotal} wf` : "no workflow"}
                      {l.severity !== "ok" ? ` · ${l.severity}` : ""}
                      {l.passed ? " ✓" : " ⚠"}
                    </span>
                  </div>
                ))}
                {pq.summary.blockingIssues.length > 0 && (
                  <div className="pt-1 text-[11px] text-status-warning">
                    {pq.summary.blockingIssues.length} blocking issue(s)
                  </div>
                )}
              </div>
              {(() => {
                // D13.0 fix: live EVP / load-test / DR evidence must feed the
                // release authority. Previously it was loaded but discarded,
                // pinning integrations + scalability at 0 and perf at the
                // 70-point ops fallback regardless of real evidence.
                const overlay = evp?.validationOverlay ?? {};
                const pv = certifyProductionValidation({
                  governance: wsGov,
                  readinessScore: overlay.readinessScore ?? r?.readiness_score ?? null,
                  integrationTelemetry: overlay.integrationTelemetry,
                  performance: overlay.performance,
                  scalability: overlay.scalability,
                  disasterRecovery: overlay.disasterRecovery,
                  security: overlay.security,
                });

                const vault = certifyProductionEvidenceVault({
                  governance: wsGov,
                  validation: pv,
                });
                const decision = vault.decision;
                const tone =
                  decision === "PROMOTE" ? "bg-status-success/15 text-status-success border-status-success/30"
                  : decision === "HOLD"  ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                                         : "bg-status-danger/15 text-status-danger border-status-danger/30";
                return (
                  <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">Release Authority (D13.0)</span>
                      <Badge variant="outline" className={tone}>{decision}</Badge>
                    </div>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      score {pv.score}/100 · gov {pv.releaseAuthority.pillarScores.governance} · prod {pv.releaseAuthority.pillarScores.production} · intg {pv.releaseAuthority.pillarScores.integrations} · perf {pv.releaseAuthority.pillarScores.performance} · scale {pv.releaseAuthority.pillarScores.scalability} · dr {pv.releaseAuthority.pillarScores.recovery} · sec {pv.releaseAuthority.pillarScores.security} · biz {pv.releaseAuthority.pillarScores.business}
                    </div>
                    {pv.failures.length > 0 && (
                      <div className="text-[11px] text-status-warning">{pv.failures.slice(0, 3).join(" · ")}</div>
                    )}
                    <div className="font-mono text-[10px] text-muted-foreground">
                      evidence fp {pv.evidencePackage.fingerprint}
                    </div>
                    <HoldGapChecklist
                      validation={pv}
                      diagnostics={evp?.diagnostics ?? EMPTY_DIAGNOSTICS}
                      rebuiltAt={evp?.rebuiltAt ?? ""}
                      busy={busy}
                      onRebuild={() => void load()}
                    />

                    <div className="pt-1 border-t mt-1 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">Evidence Vault (D13.1)</span>
                        <span className="font-mono text-[10px]">
                          freeze {vault.architectureFreeze.certified ? "✓" : `✗ (${vault.architectureFreeze.totalIssues})`} · vault fp {vault.record.fingerprint}
                        </span>
                      </div>
                      <div className="font-mono text-[11px] text-muted-foreground">
                        ratchet {vault.ratchet.deployment_blocked ? `BLOCKED · ${vault.ratchet.blocking_gates.length} gate(s)` : "clear"}
                        {vault.ratchet.blocking_gates.length ? ` · ${vault.ratchet.blocking_gates.slice(0, 3).join(", ")}` : ""}
                      </div>
                    </div>
                    {(() => {
                      const exec = certifyProductionExecution({ governance: wsGov, validation: pv, vault });
                      const execTone =
                        exec.decision === "PROMOTE" ? "bg-status-success/15 text-status-success border-status-success/30"
                        : exec.decision === "HOLD"  ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                                                    : "bg-status-danger/15 text-status-danger border-status-danger/30";
                      return (
                        <div className="pt-1 border-t mt-1 space-y-0.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium">Production Execution (D14.0)</span>
                            <Badge variant="outline" className={execTone}>{exec.decision}</Badge>
                          </div>
                          <div className="font-mono text-[11px] text-muted-foreground">
                            overall {exec.summary.overallScore}/100 · journeys {exec.journeys.totalPassing}/{exec.journeys.journeys.length} · pilots {exec.pilots.pilots.filter((p) => p.passed).length}/{exec.pilots.pilots.length} · runbook {exec.runbook.score}/100
                          </div>
                          {exec.summary.blockingGates.length > 0 && (
                            <div className="text-[11px] text-status-warning">
                              blocking: {exec.summary.blockingGates.slice(0, 4).join(", ")}
                            </div>
                          )}
                          <div className="font-mono text-[10px] text-muted-foreground">
                            exec fp {exec.summary.fingerprint}
                          </div>
                          {(() => {
                            const acc = certifyProductionAcceptance({ governance: wsGov, validation: pv, vault, execution: exec });
                            const accTone =
                              acc.decision === "PROMOTE" ? "bg-status-success/15 text-status-success border-status-success/30"
                              : acc.decision === "HOLD"  ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                                                         : "bg-status-danger/15 text-status-danger border-status-danger/30";
                            return (
                              <div className="pt-1 border-t mt-1 space-y-0.5">
                                <div className="flex items-center justify-between">
                                  <span className="font-medium">Production Acceptance (D14.1)</span>
                                  <Badge variant="outline" className={accTone}>{acc.decision}</Badge>
                                </div>
                                <div className="font-mono text-[11px] text-muted-foreground">
                                  checklist {acc.checklist.score}/100 · baseline {acc.baseline.captured ? "captured" : `missing (${acc.baseline.missingSignals.length})`} · runbooks {acc.runbooks.totalComposed}/{acc.runbooks.totalRunbooks}
                                </div>
                                {acc.blockingGates.length > 0 && (
                                  <div className="text-[11px] text-status-warning">
                                    blocking: {acc.blockingGates.slice(0, 4).join(", ")}
                                  </div>
                                )}
                                <div className="font-mono text-[10px] text-muted-foreground">
                                  release fp {acc.releasePackage.productionFingerprint} · evidence {acc.releasePackage.evidenceHash}
                                </div>
                                {(() => {
                                  const cls = certifyProductionClosure({
                                    governance: wsGov, validation: pv, vault, execution: exec, acceptance: acc,
                                  });
                                  const clsTone =
                                    cls.decision === "PROMOTE" ? "bg-status-success/15 text-status-success border-status-success/30"
                                    : cls.decision === "HOLD"  ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                                                               : "bg-status-danger/15 text-status-danger border-status-danger/30";
                                  const pass = cls.gates.filter((g) => g.passed).length;
                                  return (
                                    <div className="pt-1 border-t mt-1 space-y-0.5">
                                      <div className="flex items-center justify-between">
                                        <span className="font-medium">Production Closure (D14.2)</span>
                                        <Badge variant="outline" className={clsTone}>{cls.decision}</Badge>
                                      </div>
                                      <div className="font-mono text-[11px] text-muted-foreground">
                                        gates {pass}/{cls.gates.length} · score {cls.score}/100 · convergent {cls.convergence.convergent ? "✓" : "✗"}
                                      </div>
                                      {cls.blockingGates.length > 0 && (
                                        <div className="text-[11px] text-status-warning">
                                          blocking: {cls.blockingGates.slice(0, 4).join(", ")}
                                        </div>
                                      )}
                                      <div className="font-mono text-[10px] text-muted-foreground">
                                        closure fp {cls.fingerprint}
                                      </div>
                                      {(() => {
                                        const inv = composeBlockerInventory({
                                          governance: wsGov, validation: pv, vault, execution: exec, acceptance: acc, closure: cls,
                                        });
                                        const invTone =
                                          inv.total === 0 ? "bg-status-success/15 text-status-success border-status-success/30"
                                          : inv.decision === "PROMOTE" ? "bg-status-success/15 text-status-success border-status-success/30"
                                          : inv.decision === "HOLD"  ? "bg-status-warning/15 text-status-warning border-status-warning/30"
                                                                     : "bg-status-danger/15 text-status-danger border-status-danger/30";
                                        const top = inv.blockers[0];
                                        return (
                                          <div className="pt-1 border-t mt-1 space-y-0.5">
                                            <div className="flex items-center justify-between">
                                              <span className="font-medium">Production Blockers (P1)</span>
                                              <Badge variant="outline" className={invTone}>{inv.total === 0 ? "CLEAR" : inv.decision}</Badge>
                                            </div>
                                            <div className="font-mono text-[11px] text-muted-foreground">
                                              blockers {inv.total} · auto-fix {inv.autoFixableCount} · gain +{inv.expectedTotalGain} pts
                                            </div>
                                            {top && (
                                              <div className="text-[11px] text-status-warning truncate">
                                                top: {top.title} · owner {top.owner} · +{top.expectedReadinessGain}
                                              </div>
                                            )}
                                            <div className="font-mono text-[10px] text-muted-foreground">
                                              inventory fp {inv.fingerprint}
                                            </div>
                                            {(() => {
                                              if (!evp || evp.empty) {
                                                return (
                                                  <div className="pt-1 border-t mt-1 space-y-0.5">
                                                    <div className="flex items-center justify-between">
                                                      <span className="font-medium">Execution Validation (P2)</span>
                                                      <Badge variant="outline" className="bg-muted-foreground/15 text-muted-foreground border-border/30">NO RUN</Badge>
                                                    </div>
                                                    <div className="font-mono text-[11px] text-muted-foreground">
                                                      run `evp-run` to publish live evidence
                                                    </div>
                                                  </div>
                                                );
                                              }
                                              const fresh = isEvpFresh(evp);
                                              const tone = evp.overallStatus === "passed" && fresh
                                                ? "bg-status-success/15 text-status-success border-status-success/30"
                                                : evp.overallStatus === "failed"
                                                ? "bg-status-danger/15 text-status-danger border-status-danger/30"
                                                : "bg-status-warning/15 text-status-warning border-status-warning/30";
                                              const passedStages = evp.stages.filter((s) => s.status === "passed").length;
                                              const totalRun = evp.stages.filter((s) => s.status !== "skipped").length;
                                              const ageHrs = evp.ageMs != null ? Math.round(evp.ageMs / 3_600_000) : null;
                                              return (
                                                <div className="pt-1 border-t mt-1 space-y-0.5">
                                                  <div className="flex items-center justify-between">
                                                    <span className="font-medium">Execution Validation (P2)</span>
                                                    <Badge variant="outline" className={tone}>
                                                      {String(evp.overallStatus ?? "unknown").toUpperCase()}{!fresh ? " · STALE" : ""}
                                                    </Badge>
                                                  </div>
                                                  <div className="font-mono text-[11px] text-muted-foreground">
                                                    score {evp.overallScore ?? "—"} · stages {passedStages}/{totalRun} · age {ageHrs ?? "?"}h
                                                  </div>
                                                  <div className="font-mono text-[10px] text-muted-foreground">
                                                    prod fp {evp.productionFingerprint ?? "—"}
                                                  </div>
                                                </div>
                                              );
                                            })()}
                                          </div>
                                        );
                                      })()}
                                    </div>
                                  );
                                })()}
                              </div>
                            );
                          })()}
                        </div>
                      );
                    })()}
                  </div>
                );
              })()}
            </>
          );
        })()}

        <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
          <div className="font-medium mb-0.5">Per-domain governance</div>
          {wsGov.domains.filter((d) => d.adopted).map((d) => (
            <div key={d.domain} className="flex items-center justify-between font-mono text-[11px]">
              <span className="text-muted-foreground">{d.domain}</span>
              <span>
                health {d.healthScore} · flow {d.workflowScore}% · canon {d.canonicalServiceCount}
                {d.duplicatedFinancialTables.length ? ` · dup ${d.duplicatedFinancialTables.length}⚠` : ""}
                {d.missingDependencies.tables.length + d.missingDependencies.rpcs.length + d.missingDependencies.edgeFunctions.length
                  ? ` · miss ${d.missingDependencies.tables.length + d.missingDependencies.rpcs.length + d.missingDependencies.edgeFunctions.length}⚠`
                  : ""}
              </span>
            </div>
          ))}
        </div>

        <div className="rounded-md border bg-muted/30 p-2 text-xs">
          <div className="font-medium mb-0.5">Recovery recommendation</div>
          <div className="text-muted-foreground">{r?.recovery_recommendation ?? "…"}</div>
        </div>
      </CardContent>
    </Card>
  );
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span className="truncate">{v}</span>
    </div>
  );
}
