import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Briefcase, Users, CalendarClock, FileSignature, GraduationCap, AlertTriangle, ArrowRight,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";

import * as rec from "@/lib/recruitment/api";
import { buildAttentionQueue } from "@/lib/recruitment/attention";
import { AskYallaRecruitment } from "@/components/staff/recruitment/AskYallaRecruitment";
import {
  APPLICATION_STAGES, STAGE_LABEL, STAGE_TONE, daysSince, titleise, vacancySlaState,
} from "@/lib/recruitment/types";

const MODULES: { to: string; label: string }[] = [
  { to: "/staff/recruitment/vacancies", label: "Vacancies" },
  { to: "/staff/recruitment/pipeline", label: "Pipeline" },
  { to: "/staff/recruitment/selection", label: "Selection console" },
  { to: "/staff/recruitment/screening", label: "Screening" },
  { to: "/staff/recruitment/shortlist", label: "Shortlist" },
  { to: "/staff/recruitment/candidates", label: "Candidates" },
  { to: "/staff/recruitment/interviews", label: "Interviews" },
  { to: "/staff/recruitment/evaluations", label: "Evaluations" },
  { to: "/staff/recruitment/role-applications", label: "Applications & candidate CVs" },
  { to: "/staff/recruitment/partner-leads", label: "Partner leads" },
  { to: "/staff/recruitment/suitability", label: "Role suitability & hiring approval" },
  { to: "/staff/recruitment/offers", label: "Offers" },
  { to: "/staff/recruitment/onboarding", label: "Onboarding" },
  { to: "/staff/recruitment/talent-pool", label: "Talent pool" },
  { to: "/staff/recruitment/communications", label: "Communications" },
  { to: "/staff/recruitment/letters", label: "Official letters" },
  { to: "/staff/recruitment/analytics", label: "Analytics" },
  { to: "/staff/recruitment/templates", label: "Templates" },
  { to: "/staff/recruitment/settings", label: "Settings" },
];

/**
 * Recruitment 360 command centre — demand, pipeline, and what needs a decision
 * today. Every tile links to the surface where the work is actually done.
 */
export default function RecruitmentDashboard() {
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: rec.listVacancies });
  const applications = useQuery({ queryKey: ["rec", "applications"], queryFn: () => rec.listApplications() });
  const interviews = useQuery({ queryKey: ["rec", "interviews"], queryFn: rec.listInterviews });
  const offers = useQuery({ queryKey: ["rec", "offers"], queryFn: rec.listOffers });
  const cases = useQuery({ queryKey: ["rec", "onboarding"], queryFn: rec.listOnboardingCases });
  const slas = useQuery({ queryKey: ["rec", "slas"], queryFn: rec.listSlaPolicies });
  const audit = useQuery({ queryKey: ["rec", "audit"], queryFn: () => rec.listAuditEvents() });
  const pool = useQuery({ queryKey: ["rec", "talentPool"], queryFn: rec.listTalentPoolEntries });

  const loading =
    vacancies.isLoading || applications.isLoading || interviews.isLoading || offers.isLoading;

  const openVacancies = (vacancies.data ?? []).filter((v) => v.status === "open");
  const funnel = useMemo(() => {
    const rows = applications.data ?? [];
    return APPLICATION_STAGES.map((stage) => ({
      stage,
      count: rows.filter((a) => a.stage === stage).length,
    }));
  }, [applications.data]);

  const totalActive = (applications.data ?? []).filter((a) => a.status === "active").length;
  const upcoming = (interviews.data ?? []).filter(
    (i) => i.status === "scheduled" && i.scheduled_at && new Date(i.scheduled_at) >= new Date(),
  );
  const pendingOffers = (offers.data ?? []).filter((o) =>
    ["draft", "approval", "approved", "sent", "viewed"].includes(o.status),
  );
  const activeOnboarding = (cases.data ?? []).filter((c) => c.status !== "completed" && c.status !== "cancelled");

  const slaBreaches = openVacancies
    .map((v) => ({ vacancy: v, sla: vacancySlaState(v) }))
    .filter((r) => r.sla.state === "breached" || r.sla.state === "at_risk")
    .sort((a, b) => b.sla.daysOpen - a.sla.daysOpen);

  const stalled = (applications.data ?? [])
    .filter((a) => a.status === "active" && daysSince(a.stage_entered_at) >= 7)
    .sort((a, b) => daysSince(b.stage_entered_at) - daysSince(a.stage_entered_at))
    .slice(0, 6);

  const attention = useMemo(
    () =>
      buildAttentionQueue({
        vacancies: vacancies.data ?? [],
        applications: applications.data ?? [],
        interviews: interviews.data ?? [],
        offers: offers.data ?? [],
        slaPolicies: slas.data ?? [],
        auditEvents: (audit.data ?? []).map((e) => ({
          action: e.action,
          context: (e.context ?? {}) as Record<string, unknown>,
        })),
      }),
    [vacancies.data, applications.data, interviews.data, offers.data, slas.data, audit.data],
  );

  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        eyebrow="Recruitment 360"
        title="Talent acquisition command centre"
        lede="Hiring demand, live pipeline, decisions waiting on you, and onboarding in flight — one operating view."
        actions={
          <Button asChild>
            <Link to="/staff/recruitment/vacancies">Open vacancies</Link>
          </Button>
        }
      />

      <nav aria-label="Recruitment modules" className="mb-6 flex flex-wrap gap-1.5">
        {MODULES.map((m) => (
          <Link
            key={m.to}
            to={m.to}
            className="rounded-full border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            {m.label}
          </Link>
        ))}
      </nav>


      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricTile icon={Briefcase} label="Open vacancies" value={openVacancies.length} to="/staff/recruitment/vacancies" />
          <MetricTile icon={Users} label="Active applications" value={totalActive} to="/staff/recruitment/pipeline" />
          <MetricTile icon={CalendarClock} label="Interviews scheduled" value={upcoming.length} to="/staff/recruitment/interviews" />
          <MetricTile icon={FileSignature} label="Offers in motion" value={pendingOffers.length} to="/staff/recruitment/offers" />
          <MetricTile icon={GraduationCap} label="Onboarding in flight" value={activeOnboarding.length} to="/staff/recruitment/onboarding" />
        </div>
      )}

      <div className="mt-6">
        <AskYallaRecruitment
          vacancies={vacancies.data ?? []}
          applications={applications.data ?? []}
          interviews={interviews.data ?? []}
          offers={offers.data ?? []}
          attention={attention}
          talentPoolIdle={(pool.data ?? []).filter((p) => daysSince(p.last_engaged_at) > 90).length}
        />
      </div>



      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Pipeline funnel</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {funnel.every((f) => f.count === 0) ? (
              <p className="text-sm text-muted-foreground">
                No applications yet. Publish a vacancy and applications will appear here as they arrive.
              </p>
            ) : (
              funnel.map((f) => (
                <div key={f.stage} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{STAGE_LABEL[f.stage]}</span>
                    <span className="text-muted-foreground tabular-nums">{f.count}</span>
                  </div>
                  <Progress value={(f.count / maxFunnel) * 100} className="h-2" />
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" aria-hidden="true" />
              Time-to-fill risk
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {slaBreaches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Every open vacancy is inside its SLA window.</p>
            ) : (
              slaBreaches.slice(0, 6).map(({ vacancy, sla }) => (
                <Link
                  key={vacancy.id}
                  to={`/staff/recruitment/selection?vacancy=${vacancy.id}`}
                  className="block rounded-md border border-border p-3 hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{vacancy.title}</span>
                    <Badge variant="outline" className={sla.state === "breached"
                      ? "bg-destructive/10 text-destructive border-destructive/30"
                      : "bg-warning/10 text-warning-foreground border-warning/30"}>
                      {sla.state === "breached" ? "Breached" : "At risk"}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {sla.daysOpen} days open · {vacancy.sla_days}-day target
                  </p>
                </Link>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader><CardTitle className="text-base">Waiting on a decision</CardTitle></CardHeader>
        <CardContent>
          {stalled.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing has been sitting in one stage for a week or more. The pipeline is moving.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {stalled.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{a.application_no}</p>
                    <p className="text-xs text-muted-foreground">
                      {daysSince(a.stage_entered_at)} days in {titleise(a.stage)}
                      {a.next_action ? ` · next: ${a.next_action}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant="outline" className={STAGE_TONE[a.stage]}>{STAGE_LABEL[a.stage] ?? a.stage}</Badge>
                    <Button size="sm" variant="ghost" asChild>
                      <Link to={`/staff/recruitment/pipeline?vacancy=${a.vacancy_id}`} aria-label={`Open pipeline for ${a.application_no}`}>
                        <ArrowRight className="h-4 w-4" aria-hidden="true" />
                      </Link>
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function MetricTile({
  icon: Icon, label, value, to,
}: { icon: typeof Briefcase; label: string; value: number; to: string }) {
  return (
    <Link to={to} className="group">
      <Card className="h-full transition-colors group-hover:border-primary/40">
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="text-xs uppercase tracking-wide">{label}</span>
          </div>
          <p className="mt-2 text-3xl font-semibold tabular-nums">{value}</p>
        </CardContent>
      </Card>
    </Link>
  );
}
