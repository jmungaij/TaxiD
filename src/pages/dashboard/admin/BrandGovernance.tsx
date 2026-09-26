import * as React from "react";
import Layout from "@/components/layout/Layout";
import EnterpriseHeroBand from "@/components/layout/EnterpriseHeroBand";
import { Surface, BrandContext } from "@/components/design/Surface";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/marketing/Icon";
import report from "@/lib/design/brand-health.json";
import { releaseGates, photographyRules, surfaceRole, contextIntent, MOTION_CATEGORIES, SURFACE_LEVELS } from "@/lib/design/designSystem";

type PageAudit = { page: string; file: string; loc: number; overall: number; scores: Record<string, number>; defects: { id: string; sev: string; count: number }[] };

const platform = report.platform as Record<string, number>;

function scoreTone(v: number) {
  if (v >= 98) return "text-status-success";
  if (v >= 95) return "text-muted-foreground";
  return "text-status-danger";
}

function GateRow({ label, actual, threshold }: { label: string; actual: number; threshold: number }) {
  const pass = actual >= threshold;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border py-2.5 last:border-0">
      <span className="text-sm text-foreground">{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground tabular-nums">target ≥ {threshold}</span>
        <span className={`text-sm font-semibold tabular-nums ${scoreTone(actual)}`}>{actual}</span>
        <Badge variant={pass ? "secondary" : "destructive"} className="text-[10px]">{pass ? "PASS" : "FAIL"}</Badge>
      </div>
    </div>
  );
}

export default function BrandGovernance() {
  const [q, setQ] = React.useState("");
  const pages = report.pages as PageAudit[];
  const filtered = React.useMemo(
    () => pages.filter((p) => p.page.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60),
    [pages, q],
  );

  const axes = Object.entries(platform).filter(([k]) => k !== "brand_health");

  return (
    <Layout>
      <BrandContext context="analytics" className="space-y-6">
        <EnterpriseHeroBand
          eyebrow="Design Governance"
          title="Enterprise Brand Intelligence"
          subtitle={`Brand health is measured, not debated. ${pages.length} audited surfaces • generated ${new Date(report.generated_at).toLocaleString()}`}
          actions={
            <Badge variant={report.production_ready ? "secondary" : "destructive"} className="text-xs">
              {report.production_ready ? "Production ready" : "Gate blocked"}
            </Badge>
          }
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <Surface level={4} className="p-5">
              <div className="text-xs uppercase tracking-wider text-primary-foreground/70">Brand health score</div>
              <div className="mt-1 text-4xl font-semibold tabular-nums">{platform.brand_health}</div>
              <Progress value={platform.brand_health} className="mt-3 h-1.5" />
            </Surface>
            <Surface level={4} className="p-5">
              <div className="text-xs uppercase tracking-wider text-primary-foreground/70">Design debt</div>
              <div className="mt-1 text-4xl font-semibold tabular-nums">{report.design_debt}</div>
              <div className="mt-3 text-xs text-primary-foreground/70">token, colour, motion and density violations</div>
            </Surface>
            <Surface level={4} className="p-5">
              <div className="text-xs uppercase tracking-wider text-primary-foreground/70">P0 / P1 brand defects</div>
              <div className="mt-1 text-4xl font-semibold tabular-nums">{report.p0_defects} / {report.p1_defects}</div>
              <div className="mt-3 text-xs text-primary-foreground/70">banned colours, bypassed tokens</div>
            </Surface>
          </div>
        </EnterpriseHeroBand>

        <div className="grid gap-6 lg:grid-cols-3">
          <Surface level={2} className="p-6 lg:col-span-2">
            <h2 className="section-title">Platform axes</h2>
            <p className="section-subtitle">Averaged across every audited surface.</p>
            <div className="mt-4 grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {axes.map(([k, v]) => (
                <div key={k}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="capitalize text-foreground">{k.replace(/_/g, " ")}</span>
                    <span className={`font-semibold tabular-nums ${scoreTone(v)}`}>{v}</span>
                  </div>
                  <Progress value={v} className="mt-1.5 h-1" />
                </div>
              ))}
            </div>
          </Surface>

          <Surface level={2} className="p-6">
            <h2 className="section-title">Release gates</h2>
            <p className="section-subtitle">A build ships only when every gate passes.</p>
            <div className="mt-3">
              <GateRow label="Brand health" actual={platform.brand_health} threshold={releaseGates.brandHealth} />
              <GateRow label="Accessibility" actual={platform.accessibility} threshold={releaseGates.accessibility} />
              <GateRow label="Performance" actual={platform.performance} threshold={releaseGates.performance} />
              <GateRow label="Token compliance" actual={platform.token_compliance} threshold={releaseGates.tokenCompliance} />
              <GateRow label="Zero P0/P1 defects" actual={report.p0_defects + report.p1_defects === 0 ? 100 : 0} threshold={100} />
            </div>
          </Surface>
        </div>

        <Surface level={2} className="p-6">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="section-title">Per-surface brand health</h2>
              <p className="section-subtitle">Lowest scoring surfaces first — this is the design debt backlog.</p>
            </div>
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter surfaces…"
              aria-label="Filter audited surfaces"
              className="max-w-xs"
            />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Brand health score per audited surface</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-2 pr-4 font-medium">Surface</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Score</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Colour</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Tokens</th>
                  <th scope="col" className="py-2 pr-4 font-medium">A11y</th>
                  <th scope="col" className="py-2 font-medium">Violations</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.file} className="row-hover border-t border-border">
                    <td className="py-2 pr-4 font-mono text-xs text-foreground">{p.page}</td>
                    <td className={`py-2 pr-4 font-semibold tabular-nums ${scoreTone(p.overall)}`}>{p.overall}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">{p.scores.color_consistency ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">{p.scores.token_compliance ?? "—"}</td>
                    <td className="py-2 pr-4 tabular-nums text-muted-foreground">{p.scores.accessibility ?? "—"}</td>
                    <td className="py-2 text-xs text-muted-foreground">
                      {p.defects.length === 0 ? "—" : p.defects.map((d) => `${d.id}×${d.count}`).join(", ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Surface>

        <div className="grid gap-6 lg:grid-cols-3">
          <Surface level={2} className="p-6">
            <h2 className="section-title">Surface hierarchy</h2>
            <p className="section-subtitle">Importance is read from elevation alone.</p>
            <ul className="mt-3 space-y-2">
              {SURFACE_LEVELS.map((l) => (
                <li key={l} className="flex items-center gap-3 text-sm">
                  <span className="w-14 shrink-0 font-mono text-xs text-muted-foreground">L{l}</span>
                  <span className="text-foreground">{surfaceRole[l]}</span>
                </li>
              ))}
            </ul>
          </Surface>

          <Surface level={2} className="p-6">
            <h2 className="section-title">Motion grammar</h2>
            <p className="section-subtitle">Every animation belongs to exactly one category.</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {MOTION_CATEGORIES.map((m) => (
                <Badge key={m} variant="outline" className="text-[11px] capitalize">{m}</Badge>
              ))}
            </div>
            <h3 className="section-title mt-6 text-base">Contextual colour</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              {Object.entries(contextIntent).map(([k, v]) => (
                <li key={k}><span className="text-foreground capitalize">{k}</span> — {v}</li>
              ))}
            </ul>
          </Surface>

          <Surface level={2} className="p-6">
            <h2 className="section-title">Photography governance</h2>
            <p className="section-subtitle">Imagery is brand-critical, not decoration.</p>
            <ul className="mt-3 space-y-2">
              {photographyRules.map((r) => (
                <li key={r} className="flex gap-2 text-sm text-foreground">
                  <Icon name="CheckCircle2" tone="success" className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Surface>
        </div>
      </BrandContext>
    </Layout>
  );
}
