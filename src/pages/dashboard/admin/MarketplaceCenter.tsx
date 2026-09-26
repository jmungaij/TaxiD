/**
 * Marketplace 360 — Enterprise Marketplace Command Center.
 *
 * Composition only. Every primitive (EnterpriseHeroBand, StatCard, Card,
 * Badge, AsyncState, SectionErrorBoundary, AiAssistantPanel) and every number
 * comes from frozen, certified sources — the intelligence is produced by
 * `runMarketplace360`, which itself reuses LCIF, BCRA, business certification
 * and the marketplace optimisation engine. No new primitive, token or service.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  LayoutGrid,
  Activity,
  Gauge,
  Sparkles,
  RefreshCw,
  TrendingUp,
  ShieldCheck,
  Lightbulb,
  Layers,
  AlertTriangle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { AiAssistantPanel } from "@/components/layout/AiAssistantPanel";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { SectionErrorBoundary } from "@/components/dashboard/SectionErrorBoundary";
import { useWorkspaceHealth, formatFreshness } from "@/lib/workspaces/health";
import { WORKSPACES } from "@/lib/workspaces/config";
import { ROUTE_BY_PATH } from "@/lib/routes";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { runMarketplace360, type MarketplaceMetric, type MetricRisk } from "@/lib/platform/marketplace360";

const RISK_TONE: Record<MetricRisk, "success" | "warning" | "danger"> = {
  low: "success",
  moderate: "warning",
  elevated: "warning",
  critical: "danger",
};

function formatMetric(m: MarketplaceMetric): string {
  if (m.value === null) return "—";
  if (m.unit === "kes") return `KES ${Math.round(m.value).toLocaleString()}`;
  if (m.unit === "pct") return `${m.value}%`;
  if (m.unit === "minutes") return `${m.value} min`;
  if (m.unit === "count") return `${m.value}`;
  return `${m.value}/100`;
}

function MetricCard({ m }: { m: MarketplaceMetric }) {
  return (
    <StatCard
      title={m.label}
      value={formatMetric(m)}
      tone={m.observed ? RISK_TONE[m.risk] : "default"}
      sparkline={m.sparkline.length > 1 ? m.sparkline : undefined}
      description={
        m.observed
          ? `Target ${m.unit === "kes" || m.unit === "count" ? "—" : m.target}${m.unit === "pct" ? "%" : ""} · confidence ${m.confidence}% · ${m.trend}`
          : "Unobserved — no telemetry"
      }
    />
  );
}

export default function MarketplaceCenter() {
  const { roles } = useAuth();
  const health = useWorkspaceHealth("marketplace");
  const mp = useMemo(() => runMarketplace360(), []);

  const workspace = useMemo(() => WORKSPACES.find((w) => w.key === "marketplace"), []);

  const items = useMemo(() => {
    const list = workspace?.items ?? [];
    return list
      .filter((i) => i.path !== workspace?.overviewPath)
      .map((i) => {
        const bare = i.path.split("?")[0];
        const r = ROUTE_BY_PATH.get(bare);
        const allowed =
          !r?.rolesAllowed || r.rolesAllowed.length === 0 || r.rolesAllowed.some((role) => roles.includes(role));
        return { ...i, allowed, title: r?.title ?? i.label };
      })
      .filter((i) => i.allowed);
  }, [workspace, roles]);

  const isFirstPaint = health.connectionState === "offline" || health.primaryKpi?.value === "—";
  const degraded = health.connectionState === "degraded";
  const cert = mp.certificate;
  const passed = cert.decision === "go";

  const kpiGroups = useMemo(() => {
    const groups = new Map<string, MarketplaceMetric[]>();
    for (const k of mp.kpis) groups.set(k.group, [...(groups.get(k.group) ?? []), k]);
    return [...groups.entries()];
  }, [mp.kpis]);

  return (
    <div className="space-y-8">
      <EnterpriseHeroBand
        eyebrow={<span>Admin · Marketplace 360</span>}
        title={
          <span className="flex items-center gap-2">
            <LayoutGrid className="h-6 w-6" /> Enterprise Marketplace Command Center
          </span>
        }
        subtitle="Ride, delivery, logistics, rental, corporate, merchant and fleet marketplaces — every metric is derived from the certified LCIF, BCRA and marketplace optimisation engines."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="backdrop-blur bg-background/10 border-primary-foreground/30 text-primary-foreground"
            >
              <span
                className={cn(
                  "mr-2 inline-flex h-2 w-2 rounded-full",
                  passed ? "bg-status-success animate-pulse" : "bg-status-warning",
                )}
                aria-hidden
              />
              Marketplace health {mp.healthScore}/100 · {cert.decision.replace("_", " ")}
            </Badge>
            <span className="text-xs text-primary-foreground/70">
              {degraded ? "Degraded" : "Live"} · updated {formatFreshness(health.lastUpdated)} · certificate {cert.fingerprint}
            </span>
            <Button size="sm" variant="secondary" onClick={() => window.location.reload()} aria-label="Refresh marketplace command center">
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      <AsyncState loading={isFirstPaint} error={null}>
        <SectionErrorBoundary sectionName="Marketplace Pulse">
          <section aria-labelledby="mp-pulse">
            <h2 id="mp-pulse" className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Marketplace pulse
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {mp.hero.map((m) => (
                <MetricCard key={m.id} m={m} />
              ))}
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Marketplace Segments">
          <section aria-labelledby="mp-segments" className="mt-8">
            <h2 id="mp-segments" className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Layers className="h-4 w-4" /> Marketplaces
            </h2>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {mp.segments.map((s) => (
                <Card key={s.segment} className="enterprise-surface">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{s.label}</span>
                      <Badge variant={s.status === "certified" ? "default" : "outline"} className="text-[10px] uppercase">
                        {s.status.replace("_", " ")}
                      </Badge>
                    </div>
                    <div className="mt-2 text-2xl font-semibold tabular-nums">{s.score}<span className="text-sm text-muted-foreground">/100</span></div>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Exposure KES {s.revenueExposureKes.toLocaleString()} · {s.slaBreaches} SLA breach(es)
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </SectionErrorBoundary>

        {kpiGroups.map(([group, metrics]) => (
          <SectionErrorBoundary key={group} sectionName={`Marketplace ${group}`}>
            <section aria-label={`Marketplace ${group} indicators`} className="mt-8">
              <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Marketplace {group.toLowerCase()}
              </h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                {metrics.map((m) => (
                  <MetricCard key={m.id} m={m} />
                ))}
              </div>
            </section>
          </SectionErrorBoundary>
        ))}

        <SectionErrorBoundary sectionName="Marketplace Health Engine">
          <section aria-labelledby="mp-health" className="mt-8">
            <h2 id="mp-health" className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Activity className="h-4 w-4" /> Marketplace health engine
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {mp.health.map((h) => (
                <Card key={h.dimension} className="enterprise-surface">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium">{h.label}</span>
                      <span
                        className={cn(
                          "text-lg font-semibold tabular-nums",
                          !h.observed ? "text-muted-foreground" : h.risk === "low" ? "text-status-success" : h.risk === "critical" ? "text-status-danger" : "text-status-warning",
                        )}
                      >
                        {h.observed ? h.score : "—"}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-1">{h.evidence}</p>
                    <p className="text-xs mt-2">{h.recommendation}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Marketplace Value Streams">
          <section aria-labelledby="mp-streams" className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="enterprise-surface">
              <CardHeader className="pb-3">
                <CardTitle id="mp-streams" className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Value stream certification
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {mp.valueStreams.map((v) => (
                  <div key={v.id} className="flex items-start justify-between gap-3 border-b border-border last:border-0 pb-2 last:pb-0">
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{v.name}</div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        Weakest link: {v.weakestCapability}
                        {v.blockers[0] ? ` · ${v.blockers[0]}` : ""}
                      </div>
                    </div>
                    <Badge variant={v.status === "certified" ? "default" : "outline"} className="text-[10px] uppercase whitespace-nowrap">
                      {v.score} · {v.status.replace("_", " ")}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="enterprise-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-primary" /> Marketplace readiness certificate
                  <Badge variant={passed ? "default" : "destructive"} className="ml-auto text-[10px] uppercase">
                    {cert.decision.replace("_", " ")}
                  </Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2 text-sm">
                  {([
                    ["Maturity", cert.maturity],
                    ["Business", cert.business],
                    ["Operational", cert.operational],
                    ["AI", cert.ai],
                    ["Financial", cert.financial],
                    ["Governance", cert.governance],
                    ["Integration", cert.integration],
                    ["Executive", cert.executive],
                    ["ROI", cert.roi],
                    ["Risk", cert.risk],
                    ["Health", cert.health],
                  ] as const).map(([label, value]) => (
                    <div key={label} className="flex items-baseline justify-between gap-2">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="tabular-nums font-medium">{value}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Deterministic fingerprint {cert.fingerprint} · grade {cert.grade.replace("_", " ")} · evidence from LCIF, BCRA and the marketplace optimisation engine.
                </p>
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Marketplace Insights">
          <section aria-labelledby="mp-insights" className="mt-8 grid gap-4 lg:grid-cols-2">
            <Card className="enterprise-surface">
              <CardHeader className="pb-3">
                <CardTitle id="mp-insights" className="text-base flex items-center gap-2">
                  <Lightbulb className="h-4 w-4 text-primary" /> Executive insights
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {mp.insights.length === 0 && <p className="text-sm text-muted-foreground">No grounded insights available.</p>}
                {mp.insights.map((i) => (
                  <div key={i.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] uppercase">{i.kind}</Badge>
                      <span className="text-sm font-medium">{i.headline}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{i.detail}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      Impact KES {i.businessImpactKes.toLocaleString()} · ROI {i.expectedRoiPct}% · confidence {i.confidence}% · cites {i.citations.join(", ")}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="enterprise-surface">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-primary" /> Marketplace alert center
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {mp.alerts.length === 0 && <p className="text-sm text-muted-foreground">No open marketplace alerts.</p>}
                {mp.alerts.map((a) => (
                  <div key={a.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={a.severity === "critical" ? "destructive" : "outline"}
                        className="text-[10px] uppercase"
                      >
                        {a.severity}
                      </Badge>
                      <span className="text-sm font-medium truncate">{a.title}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{a.impact}</p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {a.recommendedAction} · owner {a.owner} · ETA {a.etaMinutes} min · {a.source}
                    </p>
                  </div>
                ))}
                {mp.blindSpots.length > 0 && (
                  <p className="text-[11px] text-status-warning">
                    Blind spots: {mp.blindSpots.slice(0, 3).join("; ")}
                  </p>
                )}
              </CardContent>
            </Card>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Marketplace Modules">
          <section aria-labelledby="mp-modules" className="mt-8">
            <h2 id="mp-modules" className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Marketplace operations
            </h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {items.map((i) => (
                <Link key={i.path} to={i.path} className="group focus:outline-none">
                  <Card className="h-full transition-all hover:border-primary hover:shadow-enterprise-lg focus-visible:ring-2 focus-visible:ring-ring">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base flex items-center justify-between">
                        <span>{i.label}</span>
                        <ArrowRight className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-xs text-muted-foreground">{i.path}</CardContent>
                  </Card>
                </Link>
              ))}
              {items.length === 0 && (
                <div className="col-span-full text-sm text-muted-foreground">
                  No Marketplace modules are available for your role.
                </div>
              )}
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="Marketplace Copilot">
          <div className="mt-8">
            <AiAssistantPanel
              title="Marketplace Copilot"
              subtitle="Grounded in LCIF, BCRA, the capability registry and the event registry — every answer cites its evidence."
              suggestions={[
                "Which value stream is closest to losing certification?",
                "Where is demand outpacing supply right now?",
                "What is the highest-ROI marketplace investment this quarter?",
              ]}
            />
          </div>
        </SectionErrorBoundary>
      </AsyncState>
    </div>
  );
}
