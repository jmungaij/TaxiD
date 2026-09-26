/**
 * Phase 4 · Wave 1 · Stage 4 — People & Partners Workspace Composition.
 *
 * Composed strictly from the frozen Enterprise Composition Framework:
 *   EnterpriseHeroBand → StatCard grid → AsyncState/SectionErrorBoundary
 *   → sub-navigation cards → AiAssistantPanel.
 *
 * Reuse-only:
 *   - No new components, primitives, tokens, hooks, or schemas.
 *   - Live KPIs sourced from `useWorkspaceHealth("people_partners")`.
 *   - Sub-navigation sourced from the frozen WORKSPACES config.
 */
import { useMemo } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  Users,
  UserCheck,
  Activity,
  Gauge,
  Sparkles,
  RefreshCw,
  UserPlus,
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

export default function PeoplePartnersCenter() {
  const { roles } = useAuth();
  const health = useWorkspaceHealth("people_partners");

  const workspace = useMemo(
    () => WORKSPACES.find((w) => w.key === "people_partners"),
    [],
  );

  const items = useMemo(() => {
    const list = workspace?.items ?? [];
    return list
      .filter((i) => i.path !== workspace?.overviewPath)
      .map((i) => {
        const bare = i.path.split("?")[0];
        const r = ROUTE_BY_PATH.get(bare);
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
        eyebrow={<span>Admin · People &amp; Partners</span>}
        title={
          <span className="flex items-center gap-2">
            <Users className="h-6 w-6" /> People &amp; Partners Workspace
          </span>
        }
        subtitle="Riders, Corporate accounts, Drivers, and the Support Center — every KPI is sourced from the certified People & Partners adapter."
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
              Ecosystem health {passed ? "green" : health.status} · {health.healthScore}/100
            </Badge>
            <span className="text-xs text-primary-foreground/70">
              {degraded ? "Degraded" : "Live"} · updated {formatFreshness(health.lastUpdated)}
            </span>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => window.location.reload()}
              aria-label="Refresh people_partners workspace"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" /> Refresh
            </Button>
          </div>
        }
      />

      <AsyncState loading={isFirstPaint} error={null}>
        <SectionErrorBoundary sectionName="Ecosystem Scorecard">
          <section aria-label="People and partners scorecard">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Gauge className="h-4 w-4" /> Ecosystem Scorecard
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard
                title="Health score"
                value={`${health.healthScore}/100`}
                icon={<UserCheck className="h-5 w-5 text-primary" />}
                description={passed ? "Within threshold" : "Attention required"}
              />
              <StatCard
                title={health.primaryKpi?.label ?? "Active riders"}
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
                title={health.secondaryKpi?.label ?? "Drivers online"}
                value={health.secondaryKpi?.value ?? "—"}
                icon={<Users className="h-5 w-5 text-primary" />}
                description="Currently connected"
              />
              <StatCard
                title="Open cases"
                value={health.activeAlerts ?? 0}
                icon={<UserPlus className="h-5 w-5 text-primary" />}
                description="Support and onboarding"
              />
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="People Modules">
          <section aria-label="People and partners modules" className="mt-6">
            <h2 className="text-sm font-semibold uppercase tracking-wide mb-3 text-primary flex items-center gap-2">
              <Sparkles className="h-4 w-4" /> People &amp; Partners Modules
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
                  No People &amp; Partners modules are available for your role.
                </div>
              )}
            </div>
          </section>
        </SectionErrorBoundary>

        <SectionErrorBoundary sectionName="People Copilot">
          <div className="mt-6">
            <AiAssistantPanel
              title="People &amp; Partners Copilot"
              subtitle="Ask about rider growth, corporate onboarding, driver lifecycle, or partner invitations."
              suggestions={[
                "Show riders who signed up this week.",
                "List corporate partners pending KYB approval.",
                "How many driver invitations are outstanding?",
              ]}
            />
          </div>
        </SectionErrorBoundary>
      </AsyncState>
    </div>
  );
}
