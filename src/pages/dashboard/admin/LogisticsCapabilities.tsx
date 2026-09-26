/**
 * Capability Registry — Enterprise Logistics OS · Administration.
 *
 * Holds the capability inventory that previously lived on the Delivery
 * Operations overview page (pillars, capability cards, connected surfaces).
 * Composition-only: reuses frozen primitives and the ELOS registry.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import StatCard from "@/components/common/StatCard";
import { EnterpriseHeroBand } from "@/components/layout/EnterpriseHeroBand";
import { WORKSPACES } from "@/lib/workspaces/config";
import { ROUTE_BY_PATH } from "@/lib/routes";
import {
  ELOS_PILLARS,
  ELOS_CAPABILITIES,
  ELOS_SHORT_NAME,
  certifyElos,
  type ElosPillar,
} from "@/lib/logistics/elos";
import { ArrowRight, LayoutGrid, ShieldCheck, Gauge } from "lucide-react";

const STAGE_TONE: Record<string, string> = {
  operating: "bg-status-success/12 text-status-success border-status-success/25",
  piloting: "bg-status-warning/12 text-status-warning border-status-warning/25",
  designing: "bg-muted text-muted-foreground border-border",
};

export default function LogisticsCapabilities() {
  const cert = useMemo(() => certifyElos(), []);

  const surfaces = useMemo(() => {
    const ws = WORKSPACES.find((w) => w.key === "delivery_logistics");
    return (ws?.items ?? []).map((i) => ({
      path: i.path,
      label: i.label ?? ROUTE_BY_PATH.get(i.path)?.title ?? i.path,
      section: i.section ?? "Workspace",
    }));
  }, []);

  const pillars = useMemo(() => {
    const groups = new Map<ElosPillar, { operating: number; total: number }>();
    for (const c of ELOS_CAPABILITIES) {
      const g = groups.get(c.pillar) ?? { operating: 0, total: 0 };
      g.total += 1;
      if (c.stage === "operating") g.operating += 1;
      groups.set(c.pillar, g);
    }
    return Array.from(groups.entries()).map(([pillar, g]) => ({
      pillar,
      ...ELOS_PILLARS[pillar],
      ...g,
      pct: Math.round((g.operating / (g.total || 1)) * 100),
    }));
  }, []);

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={`${ELOS_SHORT_NAME} · Administration`}
        title={<h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Capability Registry</h1>}
        subtitle="Governed inventory of every logistics capability — pillar, owner, operating KPI and console surface."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Capabilities" value={cert.capabilities} icon={<LayoutGrid className="h-4 w-4" />} tone="primary" />
        <StatCard title="Pillars" value={cert.pillars} icon={<Gauge className="h-4 w-4" />} tone="default" />
        <StatCard title="Activation" value={`${cert.activationRate}%`} description={`${cert.operating} operating · ${cert.piloting} piloting`} tone="success" />
        <StatCard title="Maturity" value={`${cert.score}/100`} description={cert.passed ? "Certified" : `${cert.findings.length} findings`} icon={<ShieldCheck className="h-4 w-4" />} tone={cert.passed ? "success" : "warning"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3"><CardTitle className="text-base tracking-tight">Capability pillars</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {pillars.map((p) => (
              <div key={p.pillar} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium">{p.label}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{p.operating}/{p.total} operating</span>
                </div>
                <Progress value={p.pct} className="h-1.5" />
                <p className="text-xs leading-relaxed text-muted-foreground">{p.description}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base tracking-tight">Connected workspaces</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {surfaces.map((s) => (
              <Link
                key={s.path}
                to={s.path}
                className="flex items-center justify-between gap-3 rounded-lg border border-border/70 px-3 py-2.5 text-sm transition-colors hover:border-primary/40 hover:bg-accent/40"
              >
                <span className="min-w-0">
                  <span className="block truncate">{s.label}</span>
                  <span className="block text-[11px] uppercase tracking-wider text-muted-foreground">{s.section}</span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base tracking-tight">Capability inventory</CardTitle></CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {ELOS_CAPABILITIES.map((c) => (
            <div key={c.id} className="rounded-lg border border-border/70 p-3.5">
              <div className="flex items-start justify-between gap-2">
                <Link to={c.surface} className="text-sm font-medium leading-tight hover:text-primary">{c.label}</Link>
                <Badge variant="outline" className={STAGE_TONE[c.stage]}>{c.stage}</Badge>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{c.description}</p>
              <div className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground/80">{c.owner} · {c.kpi}</div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
