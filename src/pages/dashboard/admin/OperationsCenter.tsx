/**
 * Phase D8.0 — Enterprise Operations Center & SRE Governance.
 * Phase 3 (Enterprise Shell Composition): presentation modernized on top of
 * the frozen Design System — EnterpriseHeroBand, StatCard, MapOverlayLegend,
 * AiAssistantPanel, AsyncState, SectionErrorBoundary, chartTheme tokens.
 * No new routes, no new backend, no schema/logic changes.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Activity, AlertTriangle, ArrowRight, DollarSign, Gauge, RefreshCw,
  ShieldAlert, ShieldCheck, Radio, Radar, Database, Siren,
} from "lucide-react";
import { ReadinessV2Card } from "@/components/dashboard/ReadinessV2Card";
import { certifyWorkspace360Governance } from "@/lib/workspace360/governance";
import { buildRecommendations } from "@/lib/workspace360/decisionEngine";
import { DecisionEnginePanel } from "@/components/executive/DecisionEnginePanel";
import { ROUTES } from "@/lib/routes";
import contract from "../../../../contracts/schema-contract.v1.json";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AiAssistantPanel } from "@/components/layout/AiAssistantPanel";
import { MapOverlayLegend } from "@/components/layout/MapOverlayLegend";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { cn } from "@/lib/utils";

interface Signal {
  label: string;
  value: number | string;
  tone: "ok" | "warn" | "crit" | "muted";
  href?: string;
}

async function safeCount(table: string, build?: (q: any) => any): Promise<number | null> {
  try {
    let q: any = supabase.from(table as never).select("*", { count: "exact", head: true });
    if (build) q = build(q);
    const { count, error } = await q;
    if (error) return null;
    return count ?? 0;
  } catch { return null; }
}

export default function OperationsCenter() {
  const [busy, setBusy] = useState(false);
  const [firstLoad, setFirstLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSync, setLastSync] = useState<Date>(new Date());
  const [platform, setPlatform] = useState<Record<string, number | null>>({});
  const [financial, setFinancial] = useState<Record<string, number | null>>({});
  const [security, setSecurity] = useState<Record<string, number | null>>({});
  const [ops, setOps] = useState<Record<string, number | null>>({});

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const since24h = new Date(Date.now() - 24 * 3600_000).toISOString();
      const [
        outboxDlq, alertDlq, deadLetters, breakersOpen, edgeFailures,
        reconMismatches, settlementFailures, walletFreezes, chargebacks,
        accessDenials, fraudCases, riskEvents, forbiddenUpdates,
        certRuns, chaosRuns, replaySims,
      ] = await Promise.all([
        safeCount("event_outbox_dlq"),
        safeCount("alert_dispatch_dlq"),
        safeCount("payment_dead_letters"),
        safeCount("payment_circuit_breakers", (q) => q.eq("state", "open")),
        safeCount("edge_function_invocations", (q) => q.gte("status_code", 400).gte("created_at", since24h)),
        safeCount("reconciliation_cases", (q) => q.eq("status", "open")),
        safeCount("settlement_failures"),
        safeCount("wallet_freezes", (q) => q.is("released_at", null)),
        safeCount("chargebacks"),
        safeCount("access_denials", (q) => q.gte("created_at", since24h)),
        safeCount("fraud_cases", (q) => q.eq("status", "open")),
        safeCount("payment_risk_events", (q) => q.gte("created_at", since24h)),
        safeCount("forbidden_update_attempts", (q) => q.gte("occurred_at", since24h)),
        safeCount("payment_certification_runs", (q) => q.gte("started_at", since24h)),
        safeCount("payment_chaos_runs", (q) => q.gte("started_at", since24h)),
        safeCount("payment_replay_simulations", (q) => q.gte("created_at", since24h)),
      ]);

      setPlatform({
        "Outbox DLQ": outboxDlq, "Alert DLQ": alertDlq,
        "Payment DLQ": deadLetters, "Open circuit breakers": breakersOpen,
        "Edge failures (24h)": edgeFailures,
      });
      setFinancial({
        "Open reconciliations": reconMismatches,
        "Settlement failures": settlementFailures,
        "Active wallet freezes": walletFreezes,
        "Chargebacks": chargebacks,
      });
      setSecurity({
        "Access denials (24h)": accessDenials,
        "Open fraud cases": fraudCases,
        "Risk events (24h)": riskEvents,
        "Forbidden updates (24h)": forbiddenUpdates,
      });
      setOps({
        "Certification runs (24h)": certRuns,
        "Chaos runs (24h)": chaosRuns,
        "Replay sims (24h)": replaySims,
      });
      setLastSync(new Date());
    } catch (e) {
      setError(e?.message ?? "Failed to load operational signals.");
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

  const platformSignals: Signal[] = toSignals(platform, {
    "Outbox DLQ": { warn: 1, crit: 10, href: "/dashboard/admin/outbox-dlq" },
    "Alert DLQ":  { warn: 1, crit: 10, href: "/dashboard/admin/alerts" },
    "Payment DLQ": { warn: 1, crit: 5, href: "/dashboard/admin/payment-dlq" },
    "Open circuit breakers": { warn: 1, crit: 3, href: "/dashboard/admin/payment-ops" },
    "Edge failures (24h)": { warn: 25, crit: 200, href: "/dashboard/admin/observability" },
  });
  const financialSignals: Signal[] = toSignals(financial, {
    "Open reconciliations": { warn: 1, crit: 20, href: "/dashboard/admin/reconciliation-mismatches" },
    "Settlement failures":  { warn: 1, crit: 10, href: "/dashboard/admin/payment-ops" },
    "Active wallet freezes": { warn: 1, crit: 20, href: "/dashboard/admin/fraud-cases" },
    "Chargebacks": { warn: 1, crit: 5, href: "/dashboard/admin/payment-ops" },
  });
  const securitySignals: Signal[] = toSignals(security, {
    "Access denials (24h)":     { warn: 25, crit: 250, href: "/dashboard/admin/access-denials" },
    "Open fraud cases":         { warn: 5,  crit: 25,  href: "/dashboard/admin/fraud-cases" },
    "Risk events (24h)":        { warn: 25, crit: 250, href: "/dashboard/admin/fraud-center" },
    "Forbidden updates (24h)":  { warn: 1,  crit: 10,  href: "/dashboard/admin/audit-log" },
  });
  const opsSignals: Signal[] = toSignals(ops, {
    "Certification runs (24h)": { warn: -1, crit: -1, href: "/dashboard/admin/payment-certification" },
    "Chaos runs (24h)":         { warn: -1, crit: -1, href: "/dashboard/admin/assurance" },
    "Replay sims (24h)":        { warn: -1, crit: -1, href: "/dashboard/admin/payment-ops" },
  });

  const govPassed = gov.passed;

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>Admin · Operations</span>}
        title={<span className="flex items-center gap-2"><Radar className="h-6 w-6" /> Operations Center</span>}
        subtitle="Unified SRE view — platform, financial, security, and workspace health from every existing certification and monitoring surface."
        actions={
          <div className="flex items-center gap-3">
            <Badge
              variant="outline"
              className={cn(
                "backdrop-blur bg-background/10 border-primary-foreground/30 text-primary-foreground",
              )}
            >
              <span
                className={cn(
                  "mr-2 inline-flex h-2 w-2 rounded-full",
                  govPassed ? "bg-status-success animate-pulse" : "bg-status-warning",
                )}
              />
              Governance {govPassed ? "green" : "attention"} · {gov.score}/100
            </Badge>
            <span className="text-xs text-primary-foreground/70">
              Last sync {lastSync.toLocaleTimeString()}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => void load()}
              disabled={busy}
              aria-label="Refresh operational signals"
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-2", busy && "animate-spin")} />
              Refresh
            </Button>
          </div>
        }
      />

      <AsyncState
        loading={firstLoad && busy}
        error={error}
        onRetry={() => void load()}
      >
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 grid gap-4 sm:grid-cols-2">
            <SectionErrorBoundary sectionName="Readiness">
              <ReadinessV2Card />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Governance Summary">
              <Card className="enterprise-surface">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base flex items-center gap-2">
                    {govPassed
                      ? <ShieldCheck className="h-4 w-4 text-status-success" />
                      : <ShieldAlert className="h-4 w-4 text-status-warning" />}
                    Workspace360 governance
                    <Badge
                      variant="outline"
                      className={cn(
                        "ml-auto",
                        govPassed
                          ? "bg-status-success/15 text-status-success border-status-success/30"
                          : "bg-status-warning/15 text-status-warning border-status-warning/30",
                      )}
                    >
                      {gov.score}/100
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm space-y-2">
                  <SummaryRow label="Certification"        value={`${gov.certification.score}/100`} passed={gov.certification.passed} />
                  <SummaryRow label="Health"               value={`${gov.health.platformScore}/100 · adoption ${gov.health.adoptionPct}%`} passed={gov.health.passed} />
                  <SummaryRow label="Cross-domain flows"   value={`${gov.workflows.score}/100`} passed={gov.workflows.passed} />
                  <SummaryRow label="Business consistency" value={`${gov.consistency.score}/100`} passed={gov.consistency.passed} />
                  <SummaryRow label="Operational qual."    value={`${gov.operations.score}/100`} passed={gov.operations.passed} />
                  {gov.failures.length > 0 && (
                    <div className="rounded-md border border-status-warning/30 bg-status-warning/10 p-2 text-xs space-y-1">
                      <div className="font-medium text-status-warning">Top failures</div>
                      {gov.failures.slice(0, 5).map((f, i) => (
                        <div key={i} className="font-mono text-[11px] text-muted-foreground">• {f}</div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </SectionErrorBoundary>
          </div>

          <div className="space-y-4">
            <SectionErrorBoundary sectionName="AI Assistant">
              <AiAssistantPanel
                title="Ops Copilot"
                subtitle="Reuses the platform AI service"
                suggestions={[
                  "Summarize open DLQs",
                  "Which circuit breaker tripped last?",
                  "Draft an incident postmortem",
                ]}
              />
            </SectionErrorBoundary>
            <SectionErrorBoundary sectionName="Map Legend">
              <MapOverlayLegend
                title="Fleet coverage"
                align="start"
                items={[
                  { id: "driver",   label: "Drivers online", swatchClass: "bg-map-driver" },
                  { id: "rider",    label: "Rider pickup",   swatchClass: "bg-map-rider" },
                  { id: "route",    label: "Active route",   swatchClass: "bg-map-route" },
                  { id: "idle",     label: "Idle",           swatchClass: "bg-map-idle" },
                  { id: "incident", label: "Incident",       swatchClass: "bg-map-incident" },
                ]}
              />
            </SectionErrorBoundary>
          </div>
        </div>

        <SectionErrorBoundary sectionName="Decision Engine">
          <DecisionEnginePanel
            title="Top Operational Priorities"
            limit={8}
            report={buildRecommendations({
              governance: gov,
              metrics: [],
              alerts: [],
              opsSignals: { ...platform, ...financial, ...security, ...ops },
            })}
          />
        </SectionErrorBoundary>

        <SignalGrid title="Platform health"     icon={Activity}     signals={platformSignals} />
        <SignalGrid title="Financial health"    icon={DollarSign}   signals={financialSignals} />
        <SignalGrid title="Security health"     icon={ShieldAlert}  signals={securitySignals} />
        <SignalGrid title="Operational activity" icon={Gauge}       signals={opsSignals} />

        <SectionErrorBoundary sectionName="Related surfaces">
          <Card className="enterprise-surface">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" /> Related operational surfaces
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
              {RELATED.map((r) => (
                <Link
                  key={r.href}
                  to={r.href}
                  className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 hover:bg-accent/10 hover:border-primary/40 transition-colors"
                >
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
    </div>
  );
}

const RELATED = [
  { label: "Executive Command Center", href: "/dashboard/admin/executive", icon: Gauge },
  { label: "NOC Console",              href: "/dashboard/admin/noc",       icon: Siren },
  { label: "Observability",            href: "/dashboard/admin/observability", icon: Activity },
  { label: "Payment Operations",       href: "/dashboard/admin/payment-ops",    icon: DollarSign },
  { label: "Assurance Dashboard",      href: "/dashboard/admin/assurance",      icon: ShieldCheck },
  { label: "Outbox DLQ",               href: "/dashboard/admin/outbox-dlq",     icon: Database },
  { label: "Fraud Cases",              href: "/dashboard/admin/fraud-cases",    icon: AlertTriangle },
  { label: "Access Denials",           href: "/dashboard/admin/access-denials", icon: ShieldAlert },
];

function toSignals(
  counts: Record<string, number | null>,
  thresholds: Record<string, { warn: number; crit: number; href?: string }>,
): Signal[] {
  return Object.entries(counts).map(([label, value]) => {
    const t = thresholds[label] ?? { warn: 1, crit: 10 };
    let tone: Signal["tone"] = "ok";
    if (value == null) tone = "muted";
    else if (t.crit >= 0 && value >= t.crit) tone = "crit";
    else if (t.warn >= 0 && value >= t.warn) tone = "warn";
    return { label, value: value ?? "—", tone, href: t.href };
  });
}

const TONE_RING: Record<Signal["tone"], string> = {
  crit:  "border-status-danger/40 ring-1 ring-status-danger/20",
  warn:  "border-status-warning/40 ring-1 ring-status-warning/20",
  ok:    "border-status-success/25",
  muted: "opacity-70",
};

const TONE_VALUE: Record<Signal["tone"], string> = {
  crit:  "text-status-danger",
  warn:  "text-status-warning",
  ok:    "text-status-success",
  muted: "text-muted-foreground",
};

function SignalGrid({
  title, icon: Icon, signals,
}: { title: string; icon: React.ComponentType<{ className?: string }>; signals: Signal[] }) {
  return (
    <SectionErrorBoundary sectionName={title}>
      <section aria-label={title}>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 flex items-center gap-2 text-primary">
          <Icon className="h-4 w-4" /> {title}
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {signals.map((s) => {
            const body = (
              <Card
                key={s.label}
                className={cn("enterprise-surface transition-shadow hover:shadow-enterprise-lg", TONE_RING[s.tone])}
              >
                <CardHeader className="pb-2">
                  <CardTitle className="text-xs font-medium text-muted-foreground">{s.label}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={cn("text-xl font-bold", TONE_VALUE[s.tone])}>
                    {typeof s.value === "number" ? s.value.toLocaleString() : s.value}
                  </div>
                </CardContent>
              </Card>
            );
            return s.href
              ? <Link key={s.label} to={s.href} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">{body}</Link>
              : body;
          })}
        </div>
      </section>
    </SectionErrorBoundary>
  );
}

function SummaryRow({ label, value, passed }: { label: string; value: string; passed: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn("font-mono text-xs", passed ? "text-foreground" : "text-status-warning")}>
        {value}{passed ? "" : " ⚠"}
      </span>
    </div>
  );
}
