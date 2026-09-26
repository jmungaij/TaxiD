/**
 * Phase 4 · Wave 1 · Stage 2 — Platform Workspace Composition.
 *
 * Composed strictly from the certified Enterprise Composition Framework:
 *   EnterpriseHeroBand → StatCard grid → AsyncState/SectionErrorBoundary
 *   → sub-navigation cards → AiAssistantPanel.
 *
 * Reuse-only:
 *   - No new components, primitives, tokens, routes, hooks, or schemas.
 *   - Live KPIs sourced from the existing `useWorkspaceHealth("platform")`
 *     adapter (system health / jobs / queue depth).
 *   - Sub-navigation sourced from the frozen WORKSPACES config.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  ShieldCheck,
  ShieldAlert,
  Settings,
  Activity,
  Gauge,
  Sparkles,
  RefreshCw,
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

export default function PlatformCenter() {
  const { roles } = useAuth();
  const health = useWorkspaceHealth("platform");

  const workspace = useMemo(
    () => WORKSPACES.find((w) => w.key === "platform"),
    [],
  );

  const items = useMemo(() => {
    const list = workspace?.items ?? [];
    return list
      .filter((i) => i.path !== workspace?.overviewPath)
      .map((i) => {
        const r = ROUTE_BY_PATH.get(i.path);
        const allowed =
          !r?.rolesAllowed ||
          r.rolesAllowed.length === 0 ||
          r.rolesAllowed.some((role) => roles.includes(role));
        return { ...i, allowed, title: r?.title ?? i.label };
      })
      .filter((i) => i.allowed);
  }, [workspace, roles]);

  const isFirstPaint =
    health.connectionState === "offline" ||
    health.primaryKpi?.value === "—";
  const degraded = health.connectionState === "degraded";
  const passed = health.status === "healthy";

  return (
    <div className="space-y-6">
      <EnterpriseHeroBand
        eyebrow={<span>Admin · Platform</span>}
        title={
          <span className="flex items-center gap-2">
            <Settings className="h-6 w-6" /> Platform Workspace
          </span>
        }
        subtitle="System health, integrations, jobs, configuration, and developer tooling — all KPIs sourced from the certified Platform adapter."
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
                  passed
                    ? "bg-status-success animate-pulse"
                    : "bg-status-warning",
                )}
                aria-hidden
              />
              Platform health {passed ? "green" : health.status} · {health.healthScore}/100
            </Badge>
            <span className="text-xs text-primary-foreground/70">
              {degraded ? "Degraded" : "Live"} · updated {formatFreshness(health.lastUpdated)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.location.reload()}
              aria-label="Refresh platform workspace"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      <AsyncState loading={isFirstPaint} error={null}>
        {/* Platform Scorecard — sourced from the certified adapter */}
        <SectionErrorBoundary sectionName="Platform Scorecard">
          <section aria-label="Platform scorecard">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Platform Scorecard
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                title="Health score"
                value={`${health.healthScore}/100`}
                icon={
                  passed ? (
                    <ShieldCheck className="h-5 w-5 text-status-success" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-status-warning" />
                  )
                }
                description={passed ? "Within threshold" : "Attention required"}
              />
              <StatCard
                title={health.primaryKpi?.label ?? "System health"}
                value={health.primaryKpi?.value ?? "—"}
                icon={<Activity className="h-5 w-5 text-primary" />}
                description="Last hour"
                trend={
                  typeof health.trend === "number" && health.trend !== 0
                    ? { value: Math.abs(health.trend), isPositive: health.trend >= 0 }
                    : undefined
                }
              />
              <StatCard
                title={health.secondaryKpi?.label ?? "Queue depth"}
                value={health.secondaryKpi?.value ?? "—"}
                icon={<Settings className="h-5 w-5 text-primary" />}
                description="In-flight jobs / outbox"
              />
              <StatCard
                title="Active alerts"
                value={health.activeAlerts ?? 0}
                icon={
                  (health.activeAlerts ?? 0) === 0 ? (
                    <ShieldCheck className="h-5 w-5 text-status-success" />
                  ) : (
                    <ShieldAlert className="h-5 w-5 text-status-danger" />
                  )
                }
                description="High / critical, unresolved"
              />
            </div>
          </section>
        </SectionErrorBoundary>

        {/* Platform sub-navigation — composed from frozen workspace config */}
        <SectionErrorBoundary sectionName="Platform Modules">
          <section aria-label="Platform modules" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> Platform Modules
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
                    <CardContent className="text-xs text-muted-foreground">
                      {i.path}
                    </CardContent>
                  </Card>
                </Link>
              ))}
              {items.length === 0 && (
                <div className="col-span-full text-sm text-muted-foreground">
                  No Platform modules are available for your role.
                </div>
              )}
            </div>
          </section>
        </SectionErrorBoundary>

        {/* Platform AI Copilot — presentation shell only */}
        <SectionErrorBoundary sectionName="Platform Copilot">
          <div className="mt-6">
            <AiAssistantPanel
              title="Platform Copilot"
              subtitle="Ask about system health, job queues, outbox backlogs, alert rules, or configuration drift."
              suggestions={[
                "Are any background jobs failing right now?",
                "Show unresolved alert rules by severity.",
                "Is the outbox DLQ growing?",
              ]}
            />
          </div>
        </SectionErrorBoundary>
      </AsyncState>
    </div>
  );
}
