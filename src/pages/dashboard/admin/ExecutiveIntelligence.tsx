/**
 * Phase D8.1 — Executive Intelligence & Decision Support.
 *
 * Answers the strategic question "is the BUSINESS healthy?" using only
 * canonical services already populated by other phases:
 *   • executive_metrics / executive_forecasts (KPIs + trends)
 *   • executive_alerts (open executive-level risks)
 *   • Workspace360 governance report (scorecard)
 *
 * No new metric engines, no duplicate KPIs, no new scoring math — this
 * layer summarises and interprets what the rest of the platform already
 * emits.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  ArrowRight, Brain, Building, Car, CreditCard, Crown, DollarSign, FileDown, FileText,
  GitCompare, Gauge, RefreshCw, ShieldAlert, ShieldCheck, TrendingDown, TrendingUp, Users,
} from "lucide-react";
import { certifyWorkspace360Governance } from "@/lib/workspace360/governance";
import { certifyExecutiveConsistency } from "@/lib/workspace360/executive";
import { buildRecommendations } from "@/lib/workspace360/decisionEngine";
import { DecisionEnginePanel } from "@/components/executive/DecisionEnginePanel";
import { RecoveryPlanPanel } from "@/components/executive/RecoveryPlanPanel";
import { buildBusinessOutcomeReport } from "@/lib/workspace360/businessOutcome";
import { buildBusinessReadiness } from "@/lib/workspace360/businessReadiness";
import {
  executiveBusinessReadiness,
  certifyRollingBusiness,
  certifyBusinessOutcomes,
} from "@/lib/platform/businessCertification";
import { capabilityImprovementPlans } from "@/lib/logistics/capabilityIntelligence";
import { strictReleaseAuthority, topCertificationGaps } from "@/lib/platform/bcra";
import { BusinessOutcomePanel } from "@/components/executive/BusinessOutcomePanel";
import { buildBusinessForecastReport } from "@/lib/workspace360/businessForecast";
import { BusinessForecastPanel } from "@/components/executive/BusinessForecastPanel";
import { composeBlockerInventory } from "@/lib/workspace360/blockerInventory";
import { BlockerInventoryPanel } from "@/components/executive/BlockerInventoryPanel";
import { certifyProductionValidation } from "@/lib/workspace360/productionValidation";
import { certifyProductionEvidenceVault } from "@/lib/workspace360/productionEvidenceVault";
import { certifyProductionExecution } from "@/lib/workspace360/productionExecution";
import { certifyProductionAcceptance } from "@/lib/workspace360/productionAcceptance";
import { certifyProductionClosure } from "@/lib/workspace360/productionClosure";
import { ROUTES } from "@/lib/routes";
import { certifyNavigationGovernance } from "@/lib/platform/navigationGovernance";
import contract from "../../../../contracts/schema-contract.v1.json";
import { ExecutiveScorecardDrawer, type ScorecardDrilldown } from "@/components/executive/ScorecardDrawer";
import { ReconciliationExplorer } from "@/components/executive/ReconciliationExplorer";
import { exportExecutiveCsv, exportExecutivePdf } from "@/lib/executive/export";
import { buildExecutiveDigest } from "@/lib/executive/digest";
import { useToast } from "@/hooks/use-toast";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AiAssistantPanel } from "@/components/layout/AiAssistantPanel";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import StatCard from "@/components/common/StatCard";
import { cn } from "@/lib/utils";

interface ExecMetric {
  id: string; metric_key: string; label: string; category: string;
  value_numeric: number | null; value_text: string | null; unit: string | null;
  trend_pct: number | null; measured_at: string;
}
interface ExecForecast {
  id: string; forecast_key: string; horizon: string;
  value_numeric: number | null; confidence: number | null;
  model_name: string | null; generated_at: string;
}
interface ExecAlert {
  id: string; severity: string; category: string; title: string;
  body: string | null; created_at: string; acknowledged_at: string | null;
}

const CATEGORY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  revenue: DollarSign, operations: Car, risk: ShieldAlert,
  satisfaction: Users, system: Gauge,
};

function fmtValue(m: ExecMetric): string {
  if (m.value_text) return m.value_text;
  if (m.value_numeric == null) return "—";
  const v = Number(m.value_numeric);
  if (m.unit === "KES") return `KES ${v.toLocaleString()}`;
  if (m.unit === "%") return `${v.toFixed(1)}%`;
  return v.toLocaleString();
}

export default function ExecutiveIntelligence() {
  const [busy, setBusy] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<ExecMetric[]>([]);
  const [forecasts, setForecasts] = useState<ExecForecast[]>([]);
  const [alerts, setAlerts] = useState<ExecAlert[]>([]);
  const [lastSync, setLastSync] = useState(new Date());

  const { toast } = useToast();
  const [drawerItem, setDrawerItem] = useState<ScorecardDrilldown | null>(null);
  const [reconOpen, setReconOpen] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const [m, f, a] = await Promise.all([
        supabase.from("executive_metrics").select("*").order("category"),
        supabase.from("executive_forecasts").select("*").order("generated_at", { ascending: false }).limit(50),
        supabase.from("executive_alerts").select("*").is("acknowledged_at", null)
          .order("created_at", { ascending: false }).limit(10),
      ]);
      setMetrics((m.data ?? []) as ExecMetric[]);
      setForecasts((f.data ?? []) as ExecForecast[]);
      setAlerts((a.data ?? []) as ExecAlert[]);
      setLastSync(new Date());
    } catch (e) {
      setError(e?.message ?? "Failed to load executive intelligence.");
    } finally {
      setBusy(false);
      setFirstLoad(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const gov = useMemo(() => {
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

  /** Phase 4 — deterministic executive readiness roll-up (registry + evidence driven). */
  const readiness = useMemo(() => executiveBusinessReadiness(), []);
  /* Enterprise Hardening WS4 — trends, investment queue and release authority. */
  const rolling = useMemo(() => certifyRollingBusiness(), []);
  const outcomes = useMemo(() => certifyBusinessOutcomes(readiness), [readiness]);
  const investmentQueue = useMemo(() => capabilityImprovementPlans().slice(0, 5), []);
  const authority = useMemo(() => strictReleaseAuthority(), []);
  const certificationGaps = useMemo(() => topCertificationGaps(undefined, 6), []);


  const grouped = useMemo(() => {
    const g: Record<string, ExecMetric[]> = {};
    for (const m of metrics) (g[m.category] ??= []).push(m);
    return g;
  }, [metrics]);

  const trendLeaders = useMemo(() => {
    return [...metrics]
      .filter((m) => m.trend_pct != null)
      .sort((a, b) => Math.abs(Number(b.trend_pct)) - Math.abs(Number(a.trend_pct)))
      .slice(0, 6);
  }, [metrics]);

  const scorecard: ScorecardDrilldown[] = [
    {
      label: "Platform Readiness", score: gov.certification.score, passed: gov.certification.passed,
      href: "/dashboard/admin/ops-center",
      definition: "Aggregate certification of every Workspace360 domain against registry, health, and route contracts.",
      source: "certifyWorkspace360 (Workspace360 Registry)",
      owner: "Operations Center",
      threshold: "≥ 100/100 to release",
      failures: gov.certification.globalFailures,
      lastReconciledAt: lastSync.toISOString(),
    },
    {
      label: "Financial Integrity", score: gov.consistency.score, passed: gov.consistency.passed,
      href: "/dashboard/admin/payment-certification",
      definition: "Wallet → Ledger → Journal → Settlement chain reconciliation and KPI cross-domain equality.",
      source: "certifyBusinessConsistency (canonical financial chain)",
      owner: "Payment Certification",
      threshold: "0 drift, 0 duplicate finance forks",
      failures: gov.consistency.failures,
      lastReconciledAt: lastSync.toISOString(),
    },
    {
      label: "Business Consistency", score: gov.workflows.score, passed: gov.workflows.passed,
      href: "/dashboard/admin/ops-center",
      definition: "Cross-domain workflow determinism: rider → trip → driver → ledger → payout.",
      source: "certifyCrossDomainWorkflows",
      owner: "Operations Center",
      threshold: "100% of workflows pass",
      failures: gov.workflows.workflows.filter((w) => !w.passed).map((w) => w.title),
      lastReconciledAt: lastSync.toISOString(),
    },
    {
      label: "Operational Qual.", score: gov.operations.score, passed: gov.operations.passed,
      href: "/dashboard/admin/ops-center",
      definition: "Load, resilience, recovery/replay, and observability qualification of the platform.",
      source: "certifyOperationalQualification",
      owner: "Operations Center",
      threshold: "≥ 100/100 — all four sub-scores green",
      failures: gov.operations.failures,
      lastReconciledAt: lastSync.toISOString(),
    },
    {
      label: "Workspace360 Adoption", score: gov.health.adoptionPct, passed: gov.health.passed,
      href: "/dashboard/admin/ops-center",
      definition: "Percentage of enumerated business domains that have adopted the Workspace360 shell + governance.",
      source: "certifyWorkspace360Health.adoptionPct",
      owner: "Operations Center",
      threshold: "100% of enumerated domains adopted",
      failures: gov.domains.filter((d) => !d.adopted).map((d) => `${d.domain} not adopted`),
      lastReconciledAt: lastSync.toISOString(),
    },
    {
      label: "Security Posture", score: gov.certification.score, passed: gov.certification.passed,
      href: "/dashboard/admin/security-audit",
      definition: "RLS + route protection + policy assurance rollup from certification.",
      source: "certifyWorkspace360 (RBAC / route contract)",
      owner: "Security Center",
      threshold: "0 unresolved policy gaps",
      failures: gov.certification.globalFailures,
      lastReconciledAt: lastSync.toISOString(),
    },
  ];

  // Executive consistency: ensure scorecard values match canonical scores.
  const knownOwners = ["/dashboard/admin/ops-center", "/dashboard/admin/payment-certification",
                       "/dashboard/admin/security-audit", "/dashboard/admin/payment-ops",
                       "/dashboard/admin/assurance", "/dashboard/admin/executive"];
  const execConsistency = certifyExecutiveConsistency(
    scorecard.map((s) => ({
      label: s.label, score: s.score, passed: s.passed, href: s.href, canonicalSource: s.source,
    })),
    {
      "certifyWorkspace360 (Workspace360 Registry)": gov.certification.score,
      "certifyBusinessConsistency (canonical financial chain)": gov.consistency.score,
      "certifyCrossDomainWorkflows": gov.workflows.score,
      "certifyOperationalQualification": gov.operations.score,
      "certifyWorkspace360Health.adoptionPct": gov.health.adoptionPct,
      "certifyWorkspace360 (RBAC / route contract)": gov.certification.score,
    },
    knownOwners,
  );

  const doExportCsv = () => exportExecutiveCsv({
    scorecard: scorecard.map(({ label, score, passed, href }) => ({ label, score, passed, href })),
    metrics, alerts, governance: gov,
  });
  const doExportPdf = () => exportExecutivePdf({
    scorecard: scorecard.map(({ label, score, passed, href }) => ({ label, score, passed, href })),
    metrics, alerts, governance: gov,
  });
  const emitDigest = (window: "daily" | "weekly") => {
    const digest = buildExecutiveDigest(window, metrics, alerts, {
      score: gov.score, passed: gov.passed, failures: gov.failures,
    });
    void navigator.clipboard?.writeText(digest.text).catch(() => {});
    toast({
      title: digest.headline,
      description: `${digest.sections.reduce((n, s) => n + s.lines.length, 0)} lines copied to clipboard for existing notification channels.`,
    });
  };

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>Admin · Executive</span>}
        title={<span className="flex items-center gap-2"><Brain className="h-6 w-6" /> Executive Intelligence</span>}
        subtitle="Strategic decision support built from canonical KPIs, forecasts, and governance — no duplicate math."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className={cn(
                "backdrop-blur bg-background/10 border-primary-foreground/30 text-primary-foreground",
              )}
            >
              <span
                className={cn(
                  "mr-2 inline-flex h-2 w-2 rounded-full",
                  gov.passed ? "bg-status-success animate-pulse" : "bg-status-warning",
                )}
              />
              Governance {gov.passed ? "green" : "attention"} · {gov.score}/100
            </Badge>
            <span className="text-xs text-primary-foreground/70">Last sync {lastSync.toLocaleTimeString()}</span>
            <Button size="sm" variant="secondary" onClick={() => void load()} disabled={busy} aria-label="Refresh executive intelligence">
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", busy && "animate-spin")} /> Refresh
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReconOpen(true)}>
              <GitCompare className="h-3.5 w-3.5 mr-1" /> Reconcile
            </Button>
            <Button size="sm" variant="secondary" onClick={() => emitDigest("daily")}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Daily digest
            </Button>
            <Button size="sm" variant="secondary" onClick={() => emitDigest("weekly")}>
              <FileText className="h-3.5 w-3.5 mr-1" /> Weekly digest
            </Button>
            <Button size="sm" variant="secondary" onClick={doExportCsv}>
              <FileDown className="h-3.5 w-3.5 mr-1" /> CSV
            </Button>
            <Button size="sm" variant="secondary" onClick={doExportPdf}>
              <FileDown className="h-3.5 w-3.5 mr-1" /> PDF
            </Button>
          </div>
        }
      />

      <AsyncState loading={firstLoad && busy} error={error} onRetry={() => void load()}>

      {!execConsistency.passed && (
        <Card className="border-status-warning/40">
          <CardContent className="py-3 text-sm flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-status-warning mt-0.5" />
            <div>
              <div className="font-medium">Executive KPI drift detected ({execConsistency.score}/100)</div>
              <div className="text-xs text-muted-foreground">
                {execConsistency.failures.slice(0, 3).join(" · ")}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* D11.0 — Business Outcome Intelligence */}
      <SectionErrorBoundary sectionName="Business Outcome Intelligence">
        {(() => {
          const decision = buildRecommendations({ governance: gov, metrics, alerts, opsSignals: {} });
          const outcome = buildBusinessOutcomeReport(decision);
          const readiness = buildBusinessReadiness(gov, outcome);
          const forecast = buildBusinessForecastReport({ metrics, governance: gov, outcome, readiness, decision });
          const pv = certifyProductionValidation({ governance: gov });
          const vault = certifyProductionEvidenceVault({ governance: gov, validation: pv });
          const execRep = certifyProductionExecution({ governance: gov, validation: pv, vault });
          const acc = certifyProductionAcceptance({ governance: gov, validation: pv, vault, execution: execRep });
          const cls = certifyProductionClosure({ governance: gov, validation: pv, vault, execution: execRep, acceptance: acc });
          const inventory = composeBlockerInventory({
            governance: gov, validation: pv, vault, execution: execRep, acceptance: acc, closure: cls,
          });
          return (
            <div className="space-y-6">
              <BusinessOutcomePanel outcome={outcome} readiness={readiness} />
              <BusinessForecastPanel report={forecast} />
              <BlockerInventoryPanel inventory={inventory} />
              <DecisionEnginePanel title="Executive Recommendations" report={decision} />
              <RecoveryPlanPanel recommendations={decision.recommendations} />
            </div>
          );
        })()}
      </SectionErrorBoundary>

      {/* Executive scorecard (frozen StatCard primitive) */}
      <SectionErrorBoundary sectionName="Executive Scorecard">
        <section aria-label="Executive scorecard">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
            <Crown className="h-4 w-4" /> Executive Scorecard
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {scorecard.map((s) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setDrawerItem(s)}
                className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
                aria-label={`${s.label} scorecard ${s.score} of 100`}
              >
                <StatCard
                  title={s.label}
                  value={`${s.score}/100`}
                  icon={s.passed
                    ? <ShieldCheck className="h-5 w-5 text-status-success" />
                    : <ShieldAlert className="h-5 w-5 text-status-warning" />}
                  description={s.passed ? "Within threshold" : "Attention required"}
                  className={cn(
                    "enterprise-surface transition-shadow hover:shadow-enterprise-lg",
                    s.passed ? "border-status-success/25" : "border-status-warning/40 ring-1 ring-status-warning/20",
                  )}
                />
              </button>
            ))}
          </div>
        </section>
      </SectionErrorBoundary>

      {/* Navigation governance KPIs — derived from the navigation governance
          reconciliation engine (no new dashboard, no duplicate math). */}
      <SectionErrorBoundary sectionName="Navigation Governance">
        {(() => {
          const navCert = certifyNavigationGovernance();
          return (
            <section aria-label="Navigation governance intelligence">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" /> Navigation Governance
                <Badge variant={navCert.passed ? "secondary" : "destructive"} className="ml-1">
                  {navCert.passed ? "Certified" : "Failing"} · {navCert.certifiedRoutes}/{navCert.totalRoutes} routes · fp {navCert.fingerprint}
                </Badge>
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {navCert.kpis.map((k) => (
                  <StatCard
                    key={k.key}
                    title={k.label}
                    value={k.unit === "pct" ? `${k.value}%` : String(k.value)}
                    icon={<Crown className="h-5 w-5 text-primary" />}
                    description={k.unit === "count" ? "count" : k.unit === "score" ? "avg depth" : "of registered routes"}
                    className="enterprise-surface"
                  />
                ))}
              </div>
            </section>
          );
        })()}
      </SectionErrorBoundary>



      {/* Top remaining certification gaps — directs engineering effort at the
          highest-impact blockers. Pure projection over the BCRA certificate. */}
      <SectionErrorBoundary sectionName="Certification Gaps">
        <section aria-label="Top remaining certification gaps">
          <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Top Remaining Certification Gaps
            <Badge variant={certificationGaps.length ? "outline" : "secondary"} className="ml-1">
              {certificationGaps.length ? `${certificationGaps.length} open` : "All areas at target"}
            </Badge>
          </h2>
          {certificationGaps.length ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {certificationGaps.map((gap) => (
                <div key={gap.id} className="enterprise-surface rounded-lg border p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold leading-snug">{gap.title}</p>
                    <Badge variant={gap.severity === "critical" ? "destructive" : gap.severity === "high" ? "default" : "secondary"}>
                      {gap.severity}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {gap.score} → {gap.target} · blocks {gap.blocks.join(", ") || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground">{gap.businessImpact}</p>
                  <p className="text-xs">
                    <span className="font-medium">Evidence required: </span>
                    <span className="text-muted-foreground">{gap.evidenceRequired.join("; ")}</span>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Every certified area is at target — no remaining gaps.</p>
          )}
        </section>
      </SectionErrorBoundary>

      {/* KPI panels by category (frozen StatCard primitive) */}
      {(["revenue", "operations", "risk", "satisfaction", "system"] as const).map((cat) =>
        grouped[cat]?.length ? (
          <SectionErrorBoundary key={cat} sectionName={`KPI · ${cat}`}>
            <section aria-label={`${cat} KPIs`}>
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2 capitalize">
                {(() => { const I = CATEGORY_ICON[cat] ?? Gauge; return <I className="h-4 w-4" />; })()}
                {cat}
              </h2>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                {grouped[cat].map((m) => (
                  <StatCard
                    key={m.id}
                    title={m.label}
                    value={fmtValue(m)}
                    trend={m.trend_pct != null ? {
                      value: Math.round(Math.abs(Number(m.trend_pct)) * 10) / 10,
                      isPositive: Number(m.trend_pct) >= 0,
                    } : undefined}
                    className="enterprise-surface"
                  />
                ))}
              </div>
            </section>
          </SectionErrorBoundary>
        ) : null,
      )}

      {/* AI Copilot + Predictive insights */}
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionErrorBoundary sectionName="AI Assistant">
          <AiAssistantPanel
            title="Executive Copilot"
            subtitle="Reuses the platform AI service"
            suggestions={[
              "Summarize this week's revenue movement",
              "Which KPI category is trending down?",
              "Draft a board-ready governance update",
            ]}
          />
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Forecasts">
          <Card className="enterprise-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Brain className="h-4 w-4" /> Forecasts
                <Badge variant="outline">{forecasts.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {forecasts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No forecasts recorded yet. Populate <code>executive_forecasts</code> from analytics jobs.
                </p>
              )}
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {forecasts.slice(0, 10).map((f) => {
                  const up = (f.value_numeric ?? 0) >= 0;
                  return (
                    <div key={f.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm">
                      <div>
                        <div className="font-medium">{f.forecast_key}</div>
                        <div className="text-xs text-muted-foreground">
                          horizon {f.horizon}
                          {f.confidence != null && ` · confidence ${Math.round(Number(f.confidence) * 100)}%`}
                          {f.model_name && ` · ${f.model_name}`}
                        </div>
                      </div>
                      <div className={cn("text-sm font-mono flex items-center gap-1", up ? "text-status-success" : "text-status-danger")}>
                        {up ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                        {f.value_numeric != null ? Number(f.value_numeric).toLocaleString() : "—"}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Top Movers">
          <Card className="enterprise-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Top Movers (by % change)
              </CardTitle>
            </CardHeader>
            <CardContent>
              {trendLeaders.length === 0 && (
                <p className="text-sm text-muted-foreground">No trend data available yet.</p>
              )}
              <div className="space-y-2">
                {trendLeaders.map((m) => (
                  <div key={m.id} className="flex items-center justify-between gap-3 rounded-md border border-border p-2 text-sm">
                    <div>
                      <div className="font-medium">{m.label}</div>
                      <div className="text-xs text-muted-foreground capitalize">{m.category}</div>
                    </div>
                    <div className={cn("font-mono text-sm flex items-center gap-1",
                      Number(m.trend_pct) >= 0 ? "text-status-success" : "text-status-danger")}>
                      {Number(m.trend_pct) >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
                      {Math.abs(Number(m.trend_pct)).toFixed(1)}%
                      <span className="text-muted-foreground ml-2">{fmtValue(m)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </SectionErrorBoundary>
      </div>

      {/* Executive risks */}
      <SectionErrorBoundary sectionName="Executive Risks">
        <Card className="enterprise-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-status-warning" /> Open Executive Risks ({alerts.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            {alerts.length === 0 && (
              <p className="text-sm text-muted-foreground">No unacknowledged executive-level alerts.</p>
            )}
            <div className="space-y-2">
              {alerts.map((a) => (
                <div key={a.id} className="flex items-start justify-between gap-3 rounded-md border border-border p-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <Badge variant={a.severity === "critical" ? "destructive" : "outline"} className="uppercase text-[10px]">
                        {a.severity}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{a.category}</span>
                      <span className="text-xs text-muted-foreground">
                        · {new Date(a.created_at).toLocaleString()}
                      </span>
                    </div>
                    <div className="font-medium mt-1">{a.title}</div>
                    {a.body && <div className="text-sm text-muted-foreground">{a.body}</div>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </SectionErrorBoundary>

      {/* Phase 4 — Executive Business Readiness (capabilities · value streams · AI maturity · evidence) */}
      <SectionErrorBoundary sectionName="Business Readiness">
        <Card className="enterprise-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Enterprise business readiness
              <Badge
                variant={readiness.decision === "go" ? "default" : readiness.decision === "no_go" ? "destructive" : "outline"}
                className="uppercase text-[10px]"
              >
                {readiness.decision.replace("_", " ")}
              </Badge>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                {readiness.score}/100 · risk {readiness.operationalRisk} · {readiness.fingerprint}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {readiness.pillars.map((p) => (
                <div key={p.id} className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground">{p.label}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={cn("text-xl font-semibold", p.passed ? "text-status-success" : "text-status-warning")}>
                      {p.score}
                    </span>
                    <span className="text-[11px] text-muted-foreground">/ floor {p.floor}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">{p.detail}</div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs font-medium mb-2">Weakest value streams</div>
                {[...readiness.valueStreams.streams]
                  .sort((a, b) => a.score - b.score)
                  .slice(0, 4)
                  .map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-2 py-1 text-sm">
                      <span className="truncate">{s.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {s.score} · {s.status.replace("_", " ")}
                      </span>
                    </div>
                  ))}
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs font-medium mb-2">
                  Priority actions · AI maturity level {readiness.aiMaturity.levelIndex}/5 ({readiness.aiMaturity.level})
                </div>
                {readiness.topActions.length === 0 && (
                  <p className="text-sm text-muted-foreground">No open readiness actions.</p>
                )}
                {readiness.topActions.slice(0, 5).map((a, i) => (
                  <div key={`${a.area}-${i}`} className="py-1 text-sm">
                    <span className="text-muted-foreground text-xs">{a.area} · </span>
                    {a.action}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </SectionErrorBoundary>

      {/* Enterprise Hardening WS4 — readiness trends, investment queue, release authority */}
      <SectionErrorBoundary sectionName="Readiness Trends">
        <Card className="enterprise-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              Readiness trends &amp; release authority
              <Badge
                variant={authority.approved ? "default" : "destructive"}
                className="uppercase text-[10px]"
              >
                {authority.decision}
              </Badge>
              <span className="ml-auto text-xs font-normal text-muted-foreground">
                rolling {rolling.score}/100 · {authority.failedGates.length} failing gate(s) · {authority.fingerprint}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {rolling.windows.map((w) => (
                <div key={w.window} className="rounded-md border border-border p-3">
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">{w.window}</div>
                  <div className="mt-1 flex items-baseline gap-2">
                    <span className={cn("text-xl font-semibold", !w.observed ? "text-muted-foreground" : w.status === "certified" ? "text-status-success" : "text-status-warning")}>
                      {w.readiness}
                    </span>
                    <span className="text-[11px] text-muted-foreground">{w.observed ? w.trend : "unobserved"}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground mt-0.5">
                    confidence {w.confidence}% · SLA drift {w.slaDriftPct}%
                  </div>
                </div>
              ))}
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs font-medium mb-2">Investment priority queue</div>
                {investmentQueue.map((p) => (
                  <div key={p.capabilityId} className="flex items-center justify-between gap-2 py-1 text-sm">
                    <span className="truncate">{p.capabilityLabel}</span>
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {p.currentScore}→{p.targetScore} · ROI {p.expectedRoi}%
                    </span>
                  </div>
                ))}
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs font-medium mb-2">
                  Business outcomes · confidence {outcomes.businessConfidencePct}%
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                  <span className="text-muted-foreground text-xs">Revenue at risk</span>
                  <span className="text-xs">KES {outcomes.revenueAtRiskKes.toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs">Revenue protected</span>
                  <span className="text-xs">KES {outcomes.revenueProtectedKes.toLocaleString()}</span>
                  <span className="text-muted-foreground text-xs">Expected SLA</span>
                  <span className="text-xs">{outcomes.expectedSlaPct}%</span>
                  <span className="text-muted-foreground text-xs">Predicted churn</span>
                  <span className="text-xs">{outcomes.predictedChurnPct}%</span>
                  <span className="text-muted-foreground text-xs">Risk reduction</span>
                  <span className="text-xs">{outcomes.riskReductionPct}%</span>
                </div>
                {authority.failedGates.length > 0 && (
                  <p className="mt-2 text-[11px] text-status-warning">
                    Blocked by: {authority.failedGates.slice(0, 4).join(", ")}
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </SectionErrorBoundary>

      {/* Deep links back into canonical surfaces */}
      <SectionErrorBoundary sectionName="Related surfaces">

        <Card className="enterprise-surface">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Drill into the source of truth</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            {[
              { label: "Executive Command Center (live)", href: "/dashboard/admin/executive",     icon: Crown },
              { label: "Operations Center",               href: "/dashboard/admin/ops-center",    icon: Gauge },
              { label: "Payment Operations",              href: "/dashboard/admin/payment-ops",   icon: CreditCard },
              { label: "Corporate Dashboard",             href: "/dashboard/corporate",           icon: Building },
              { label: "Assurance Dashboard",             href: "/dashboard/admin/assurance",     icon: ShieldCheck },
              { label: "Payment Certification",           href: "/dashboard/admin/payment-certification", icon: DollarSign },
            ].map((r) => (
              <Link key={r.href} to={r.href} className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-accent/10 hover:border-primary/40 transition-colors">
                <span className="flex items-center gap-2">
                  <r.icon className="h-3.5 w-3.5 text-muted-foreground" />
                  {r.label}
                </span>
                <ArrowRight className="h-3.5 w-3.5 opacity-60" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </SectionErrorBoundary>

      </AsyncState>

      <ExecutiveScorecardDrawer
        open={drawerItem !== null}
        onOpenChange={(v) => !v && setDrawerItem(null)}
        item={drawerItem}
      />
      <ReconciliationExplorer open={reconOpen} onOpenChange={setReconOpen} />
    </div>
  );
}
