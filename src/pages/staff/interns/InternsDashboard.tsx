import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  AlertTriangle, ArrowRight, CalendarDays, CheckCircle2, ClipboardList, Coins, GraduationCap,
  Lock, RefreshCw, ShieldAlert, Sparkles, Target, TrendingUp, Users,
} from "lucide-react";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

import * as api from "@/lib/interns/api";
import { TALENT_LEVEL_LABEL, defaultPeriod, money, pct, talentTone } from "@/lib/interns/types";
import {
  buildDemoModel, buildLiveModel, type CockpitModel, type CockpitWork, type WorkLane,
} from "@/lib/interns/cockpit";
import {
  ENVIRONMENT_LABEL, ENVIRONMENT_NOTE, INTERNS_ENVIRONMENTS, useInternsEnvironment,
} from "@/lib/interns/environment";
import { NO_ACCESS, auditCockpitAction, fetchCockpitAccess } from "@/lib/interns/access";

const MODULES: { to: string; label: string; hint: string }[] = [
  { to: "/staff/recruitment/internships/new", label: "New programme", hint: "Learning, productivity and selection mandate" },
  { to: "/staff/interns/cohorts", label: "Cohorts", hint: "Intake, calendar and cohort health" },
  { to: "/staff/interns/recruitment", label: "Recruitment", hint: "Application → eligibility → offer → activation" },
  { to: "/staff/interns/register", label: "Intern register", hint: "Enrol, assign track and mentor" },
  { to: "/staff/interns/talent", label: "Talent discovery", hint: "Ranked talent, promotion and conversion" },
  { to: "/staff/interns/governance", label: "Integrity & audit", hint: "Anti-gaming flags and the decision trail" },
];

const LANES: { key: WorkLane; label: string }[] = [
  { key: "TODAY", label: "In flight" },
  { key: "REVIEW", label: "Awaiting review" },
  { key: "BLOCKED", label: "Blocked" },
  { key: "DONE", label: "Accepted" },
];

const PRIORITY_TONE: Record<CockpitWork["priority"], string> = {
  critical: "border-status-danger/40 text-status-danger",
  high: "border-status-warning/40 text-status-warning",
  medium: "border-status-info/40 text-status-info",
  low: "border-muted-foreground/30 text-muted-foreground",
};

const NoData = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-lg border border-dashed p-4 text-xs text-muted-foreground">
    <span className="font-semibold tracking-wide">NO LIVE DATA</span> — {children}
  </div>
);

/**
 * INTERNS 360 cockpit.
 *
 * One question per zone: what is the cohort producing, what needs a human now,
 * and who has earned progression. Every figure traces to a record; anything
 * without evidence renders as NO LIVE DATA rather than as a number.
 */
export default function InternsDashboard() {
  const qc = useQueryClient();
  const period = useMemo(defaultPeriod, []);
  const [env, setEnv] = useInternsEnvironment();
  const [lane, setLane] = useState<WorkLane>("TODAY");
  const [open, setOpen] = useState<CockpitWork | null>(null);
  const [busyCohort, setBusyCohort] = useState<string | null>(null);
  const seeded = env !== "LIVE";

  const cohorts = useQuery({ queryKey: ["interns", "cohortHealth"], queryFn: api.listCohortHealth, enabled: !seeded });
  const board = useQuery({ queryKey: ["interns", "scoreboard"], queryFn: () => api.listScoreboard(), enabled: !seeded });
  const flags = useQuery({ queryKey: ["interns", "flags"], queryFn: () => api.listFlags(), enabled: !seeded });

  /** Server-resolved entitlements. The cockpit offers nothing beyond these. */
  const accessQuery = useQuery({ queryKey: ["interns", "cockpitAccess"], queryFn: fetchCockpitAccess });
  const access = accessQuery.data ?? NO_ACCESS;

  /** Cockpit actions are audited server-side before the UI reports success. */
  const audit = useMutation({
    mutationFn: auditCockpitAction,
    onError: (e: Error) => toast({ title: "Action not recorded", description: e.message, variant: "destructive" }),
  });

  const recompute = useMutation({
    mutationFn: (cohortId: string) => api.recomputeCohort(cohortId, period.start, period.end),
    onMutate: (id) => setBusyCohort(id),
    onSettled: () => setBusyCohort(null),
    onSuccess: (r, cohortId) => {
      toast({ title: "Performance recalculated", description: `${r.interns_computed} intern record(s) scored from evidence.` });
      audit.mutate({
        action: "PERFORMANCE_RECOMPUTED",
        entity: "intern_cohort",
        entityId: cohortId,
        detail: { interns_computed: r.interns_computed, period_start: period.start, period_end: period.end },
      });
      void qc.invalidateQueries({ queryKey: ["interns"] });
    },
    onError: (e: Error) => toast({ title: "Could not recalculate", description: e.message, variant: "destructive" }),
  });

  const loading = !seeded && (cohorts.isLoading || board.isLoading);

  const model: CockpitModel = useMemo(() => {
    if (seeded) return buildDemoModel(env);
    return buildLiveModel({
      rows: board.data ?? [],
      cohorts: cohorts.data ?? [],
      flags: flags.data ?? [],
      period,
    });
  }, [seeded, env, board.data, cohorts.data, flags.data, period]);

  const laneWork = model.work.filter((w) => w.lane === lane);

  /** Opening an evidence drawer is itself a reviewer action, so it is audited. */
  const openWork = (w: CockpitWork) => {
    setOpen(w);
    if (access.review_evidence && !seeded) {
      audit.mutate({
        action: "EVIDENCE_REVIEWED",
        entity: "intern_work_item",
        internId: w.internId ?? null,
        entityId: w.id.match(/^[0-9a-f-]{36}$/i) ? w.id : null,
        detail: { reference: w.ref, status: w.status, lane: w.lane },
      });
    }
  };

  const classifyTalent = (t: CockpitModel["talent"][number]) => {
    if (!t.internId) return;
    audit.mutate(
      {
        action: "TALENT_CLASSIFIED",
        entity: "intern_profile",
        internId: t.internId,
        entityId: t.internId,
        detail: { level: t.level, index: t.index, track: t.track },
      },
      {
        onSuccess: () =>
          toast({ title: "Talent review recorded", description: `${t.name} — ${TALENT_LEVEL_LABEL[t.level]} confirmed in the audit trail.` }),
      },
    );
  };

  const allKpis = [
    { icon: Users, label: "Active interns", value: String(model.totals.active), sub: `${model.totals.register} on the register`, show: true },
    { icon: TrendingUp, label: "Performance index", value: pct(model.performance.index), sub: `${model.performance.scored} scored this period`, show: access.view_performance },
    { icon: Target, label: "Work accepted", value: String(model.totals.acceptedWork), sub: "Reviewer-accepted deliverables", show: access.view_work_queue },
    { icon: Coins, label: "Verified revenue", value: money(model.commercial.verifiedRevenue), sub: "Authoritative sources only", show: access.view_commercial },
    { icon: Sparkles, label: "Yalla Talent", value: String(model.totals.talent), sub: "Cleared the 85 evidence bar", show: access.view_talent },
    { icon: ShieldAlert, label: "Integrity flags", value: String(model.totals.openFlags), sub: "Awaiting human review", show: access.view_integrity },
  ];
  const kpis = allKpis.filter((k) => k.show);

  const activitySummary = model.activity.length
    ? `Programme activity for ${model.periodLabel}. ` +
      model.activity
        .map((a) => `${a.label}: ${a.assigned} assigned, ${a.submitted} submitted, ${a.accepted} accepted.`)
        .join(" ")
    : "No programme activity recorded for this period.";

  const utilisationSummary = model.utilisation.length
    ? `Utilisation by week. ${model.utilisation.map((u) => `${u.label}: ${u.value} percent.`).join(" ")}`
    : "No utilisation recorded.";

  if (!accessQuery.isLoading && !access.view_kpis) {
    return (
      <div className="space-y-4">
        <StaffPageHeader eyebrow="Staff 360 · YMEITA" title="Interns 360" lede="Programme access is resolved on the server." />
        <Card>
          <CardContent className="flex items-start gap-3 pt-6 text-sm">
            <Lock className="mt-0.5 h-4 w-4 text-muted-foreground" aria-hidden />
            <div>
              <p className="font-semibold">Cockpit withheld</p>
              <p className="mt-1 text-muted-foreground">
                Your access resolves as “{access.role_label}”. Interns 360 panels are released to programme authority,
                and to the mentor or supervisor named on an intern record. Ask a programme administrator to assign you
                to a cohort, mentee or supervision line.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <StaffPageHeader
        eyebrow="Staff 360 · YMEITA"
        title="Interns 360"
        lede="Recruit, train, deploy and identify high-potential talent. Capability, productivity, verified commercial contribution and integrity — measured from evidence."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Tabs value={env} onValueChange={(v) => setEnv(v as typeof env)}>
              <TabsList aria-label="Data environment">
                {INTERNS_ENVIRONMENTS.map((e) => (
                  <TabsTrigger key={e} value={e} className="text-xs">
                    {ENVIRONMENT_LABEL[e]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Button asChild size="sm">
              <Link to="/staff/recruitment/internships/new">
                New internship programme
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
              </Link>
            </Button>
          </div>
        }
      />

      <div
        className={cn(
          "rounded-xl border px-4 py-3 text-xs",
          seeded ? "border-status-warning/40 bg-status-warning/5" : "border-primary/30 bg-primary/5",
        )}
        role="status"
      >
        <span className="font-semibold uppercase tracking-[0.14em]">
          {seeded ? `${ENVIRONMENT_LABEL[env]} environment` : "Live environment"}
        </span>
        <span className="ml-2 text-muted-foreground">{ENVIRONMENT_NOTE[env]}</span>
        {model.cohortLabel && <span className="ml-2 font-medium">· {model.cohortLabel}</span>}
      </div>

      {/* Module rail */}
      <nav aria-label="Interns 360 modules" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
        {MODULES.map((m) => (
          <Link
            key={m.to}
            to={m.to}
            className="group rounded-lg border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-muted/40"
          >
            <div className="flex items-center justify-between text-sm font-semibold">
              {m.label}
              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
            </div>
            <p className="mt-1 text-[11px] leading-snug text-muted-foreground">{m.hint}</p>
          </Link>
        ))}
      </nav>

      {/* KPI band */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="pt-5">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <k.icon className="h-3.5 w-3.5" aria-hidden /> {k.label}
              </div>
              <div className="mt-2 text-2xl font-semibold tracking-tight tabular-nums">
                {loading ? "—" : k.value}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{k.sub}</p>
              {seeded && <Badge variant="outline" className="mt-2 text-[10px]">DEMO</Badge>}
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* Activity + work queue */}
        <div className="space-y-4 xl:col-span-2">
          {access.view_activity && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Programme activity</CardTitle>
              <p className="text-xs text-muted-foreground">
                Work assigned, submitted and reviewer-accepted · {model.periodLabel}
              </p>
            </CardHeader>
            <CardContent>
              {model.activity.length === 0 ? (
                <NoData>
                  work-flow telemetry is only charted once intern work items exist for the period.
                  Assign work from the intern register, or switch to the demo environment to see the shape of this panel.
                </NoData>
              ) : (
                <figure className="h-56" role="group" aria-label={activitySummary}>
                  <figcaption className="sr-only">{activitySummary}</figcaption>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={model.activity} margin={{ top: 4, right: 8, left: -18, bottom: 0 }}>
                      <defs>
                        <linearGradient id="acc" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Area type="monotone" dataKey="assigned" stroke="hsl(var(--status-info))" fill="transparent" strokeWidth={1.5} />
                      <Area type="monotone" dataKey="submitted" stroke="hsl(var(--muted-foreground))" fill="transparent" strokeWidth={1.5} />
                      <Area type="monotone" dataKey="accepted" stroke="hsl(var(--primary))" fill="url(#acc)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                  <table className="sr-only">
                    <caption>Work assigned, submitted and accepted per period</caption>
                    <thead>
                      <tr><th scope="col">Period</th><th scope="col">Assigned</th><th scope="col">Submitted</th><th scope="col">Accepted</th></tr>
                    </thead>
                    <tbody>
                      {model.activity.map((a) => (
                        <tr key={a.label}>
                          <th scope="row">{a.label}</th>
                          <td>{a.assigned}</td>
                          <td>{a.submitted}</td>
                          <td>{a.accepted}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </figure>
              )}
            </CardContent>
          </Card>
          )}

          {access.view_work_queue && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Work queue</CardTitle>
              <p className="text-xs text-muted-foreground">
                Each item carries an objective, evidence and a named reviewer. Acceptance is a human decision.
              </p>
            </CardHeader>
            <CardContent>
              <Tabs value={lane} onValueChange={(v) => setLane(v as WorkLane)}>
                <TabsList className="mb-3 flex-wrap">
                  {LANES.map((l) => (
                    <TabsTrigger key={l.key} value={l.key} className="text-xs">
                      {l.label}
                      <span className="ml-1.5 tabular-nums text-muted-foreground">
                        {model.work.filter((w) => w.lane === l.key).length}
                      </span>
                    </TabsTrigger>
                  ))}
                </TabsList>
                {LANES.map((l) => (
                  <TabsContent key={l.key} value={l.key} className="space-y-2">
                    {loading && <Skeleton className="h-20 w-full" />}
                    {!loading && laneWork.length === 0 && (
                      <NoData>
                        no intern work items in this lane. Work appears here as supervisors assign and review deliverables.
                      </NoData>
                    )}
                    {laneWork.map((w) => (
                      <button
                        key={w.id}
                        type="button"
                        onClick={() => openWork(w)}
                        aria-haspopup="dialog"
                        aria-label={`Open evidence for ${w.title}, ${w.intern}, priority ${w.priority}${w.due ? `, due ${w.due}` : ""}`}
                        className="w-full rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-sm font-semibold">{w.title}</span>
                          <Badge variant="outline" className={cn("text-[10px]", PRIORITY_TONE[w.priority])}>
                            {w.priority}
                          </Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {w.ref} · {w.intern} · {w.track} · {w.due ? `due ${w.due}` : "no deadline"} · {w.status.split("_").join(" ").toLowerCase()}
                        </p>
                      </button>
                    ))}
                  </TabsContent>
                ))}
              </Tabs>
            </CardContent>
          </Card>
          )}

          {access.view_learning && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Capability built</CardTitle>
              <p className="text-xs text-muted-foreground">
                Validated competencies, not attendance. A module only counts once a mentor validates it.
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {model.learning.domains.length === 0 ? (
                <NoData>
                  learning validation is charted per competency domain once mentors validate modules for this cohort.
                </NoData>
              ) : (
                model.learning.domains.map((d) => (
                  <div key={d.label}>
                    <div className="flex items-center justify-between text-xs">
                      <span>{d.label}</span>
                      <span className="font-semibold tabular-nums">
                        {pct(d.value)} · {d.validated}/{d.total} validated
                      </span>
                    </div>
                    <Progress className="mt-1 h-1.5" value={Math.min(100, d.value)} />
                  </div>
                ))
              )}
            </CardContent>
          </Card>
          )}
        </div>

        {/* Right rail */}
        <div className="space-y-4">
          {access.view_performance && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Performance model</CardTitle>
              <p className="text-xs text-muted-foreground">
                Index {pct(model.performance.index)} · evidence confidence {pct(model.performance.evidenceConfidence)}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              {model.performance.dimensions.map((d) => (
                <div key={d.key}>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      {d.label} <span className="text-muted-foreground">· weight {d.weight}%</span>
                    </span>
                    <span className="font-semibold tabular-nums">{d.value === null ? "—" : pct(d.value)}</span>
                  </div>
                  <Progress className="mt-1 h-1.5" value={Math.min(100, d.value ?? 0)} />
                </div>
              ))}
            </CardContent>
          </Card>
          )}

          {access.view_integrity && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-status-warning" aria-hidden /> Needs a human now
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {model.attention.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  <CheckCircle2 className="mr-1 inline h-4 w-4 text-status-success" aria-hidden />
                  No integrity signal is awaiting review.
                </p>
              ) : (
                model.attention.map((a) => (
                  <Link
                    key={a.title}
                    to={a.to}
                    className="block rounded-md border px-3 py-2 text-xs hover:bg-muted/50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold capitalize">{a.title}</span>
                      <Badge variant="outline" className="text-[10px]">{a.severity}</Badge>
                    </div>
                    <p className="mt-1 text-muted-foreground">{a.detail}</p>
                  </Link>
                ))
              )}
            </CardContent>
          </Card>
          )}

          {access.view_calendar && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <CalendarDays className="h-4 w-4 text-muted-foreground" aria-hidden /> Programme calendar
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {model.calendar.length === 0 ? (
                <NoData>no cohort dates recorded. Calendar entries derive from cohort intake and review dates.</NoData>
              ) : (
                <ul className="space-y-2" aria-label={`Programme calendar, ${model.calendar.length} dated entries`}>
                  {model.calendar.map((e) => (
                    <li key={`${e.date}-${e.title}`} className="flex items-start gap-3 rounded-md border px-3 py-2 text-xs">
                      <time
                        dateTime={e.date}
                        className="shrink-0 rounded bg-primary/10 px-2 py-1 font-semibold text-primary tabular-nums"
                      >
                        {e.date.slice(5)}
                      </time>
                      <span>
                        <span className="font-semibold">{e.title}</span>
                        <span className="block text-muted-foreground">{e.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
          )}

          {access.view_commercial && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Commercial contribution</CardTitle>
              <p className="text-xs text-muted-foreground">Credited only when verified against a source system.</p>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-xs">
              <div>
                <div className="text-muted-foreground">Verified revenue</div>
                <div className="text-sm font-semibold">{money(model.commercial.verifiedRevenue)}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Attributed deals</div>
                <div className="text-sm font-semibold tabular-nums">{model.commercial.attributedDeals}</div>
              </div>
              <div>
                <div className="text-muted-foreground">Assisted pipeline</div>
                <div className="text-sm font-semibold">
                  {model.commercial.pipelineKes ? money(model.commercial.pipelineKes) : "—"}
                </div>
              </div>
              <div>
                <div className="text-muted-foreground">Sales assists</div>
                <div className="text-sm font-semibold tabular-nums">{model.commercial.assists || "—"}</div>
              </div>
            </CardContent>
          </Card>
          )}

          {access.view_activity && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Utilisation trend</CardTitle>
            </CardHeader>
            <CardContent>
              {model.utilisation.length === 0 ? (
                <NoData>utilisation is derived from assigned versus completed work hours per week.</NoData>
              ) : (
                <figure className="h-32" role="group" aria-label={utilisationSummary}>
                  <figcaption className="sr-only">{utilisationSummary}</figcaption>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={model.utilisation} margin={{ top: 4, right: 8, left: -22, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <YAxis tick={{ fontSize: 11 }} stroke="hsl(var(--muted-foreground))" />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--card))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="value" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </figure>
              )}
            </CardContent>
          </Card>
          )}
        </div>
      </div>

      {/* Talent + cohort health */}
      <div className="grid gap-4 lg:grid-cols-2">
        {access.view_talent && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Highest-potential talent</CardTitle>
            <p className="text-xs text-muted-foreground">
              Promotion requires a calculated index, validated learning and accepted work.
            </p>
          </CardHeader>
          <CardContent className="space-y-2">
            {loading && <Skeleton className="h-20 w-full" />}
            {!loading && model.talent.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No intern has yet cleared the Producer evidence bar.
              </p>
            )}
            {model.talent.map((t) => (
              <div key={t.name} className="rounded-md border px-3 py-2 text-sm">
                {t.internId ? (
                  <Link
                    to={`/staff/interns/${t.internId}`}
                    className="flex items-center justify-between rounded-sm hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    aria-label={`Open intern record for ${t.name}, index ${pct(t.index)}`}
                  >
                    <TalentRow {...t} />
                  </Link>
                ) : (
                  <div className="flex items-center justify-between">
                    <TalentRow {...t} />
                  </div>
                )}
                {access.classify_talent && t.internId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-1 h-7 px-2 text-xs"
                    disabled={audit.isPending}
                    onClick={() => classifyTalent(t)}
                  >
                    Record talent review
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
        )}

        {access.view_cohort_health && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cohort health</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {loading && <Skeleton className="h-24 w-full" />}
            {!loading && model.cohorts.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No cohorts yet. Create the first intake in{" "}
                <Link className="underline" to="/staff/interns/cohorts">Cohorts</Link>.
              </p>
            )}
            {model.cohorts.map((c) => (
              <div key={c.cohort_id} className="rounded-lg border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">{c.cohort_name}</div>
                    <p className="text-xs text-muted-foreground">
                      {c.start_date ?? "start TBC"} → {c.end_date ?? "end TBC"} · {c.enrolled} enrolled
                      {c.intake_size ? ` of ${c.intake_size} planned` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{c.status}</Badge>
                    {!seeded && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyCohort === c.cohort_id}
                        onClick={() => recompute.mutate(c.cohort_id)}
                      >
                        <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", busyCohort === c.cohort_id && "animate-spin")} aria-hidden />
                        Recalculate scores
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-3 text-xs sm:grid-cols-4">
                  <Metric label="Avg index" value={pct(c.avg_performance_index)} />
                  <Metric label="Evidence confidence" value={pct(c.avg_evidence_confidence)} />
                  <Metric label="Verified revenue" value={money(c.verified_revenue_kes)} />
                  <Metric label="Yalla Talent" value={String(c.yalla_talent)} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
        )}
      </div>

      <Sheet open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {open && (
            <>
              <SheetHeader>
                <SheetTitle className="text-base">{open.title}</SheetTitle>
                <SheetDescription>
                  {open.ref} · {open.intern} · {open.track}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-5 space-y-4 text-sm">
                <div className="flex flex-wrap gap-2">
                  <Badge variant="outline">{open.status.split("_").join(" ").toLowerCase()}</Badge>
                  <Badge variant="outline" className={PRIORITY_TONE[open.priority]}>{open.priority}</Badge>
                  {seeded && <Badge variant="outline">DEMO</Badge>}
                </div>
                <Field label="Objective it serves">{open.objective}</Field>
                <Field label="Deadline">{open.due ?? "No deadline recorded"}</Field>
                <Field label="Reviewer">{open.reviewer ?? "Not assigned"}</Field>
                <Field label="Deliverable">{open.deliverable ?? "Not submitted"}</Field>
                <Field label="Quality score">{open.quality === null ? "Not reviewed" : pct(open.quality)}</Field>
                <div>
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground" id="work-evidence-label">Evidence</div>
                  <ul className="mt-1.5 space-y-1" aria-labelledby="work-evidence-label">
                    {open.evidence.map((e) => (
                      <li key={e} className="flex items-start gap-2 text-xs">
                        <ClipboardList className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                        {e}
                      </li>
                    ))}
                  </ul>
                </div>
                {open.internId && (
                  <Button asChild variant="outline" size="sm">
                    <Link to={`/staff/interns/${open.internId}`}>Open intern record</Link>
                  </Button>
                )}
                {access.review_evidence && !seeded && (
                  <p className="text-[11px] text-muted-foreground">
                    This review was recorded in the intern audit trail as {access.role_label}.
                  </p>
                )}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function TalentRow({ name, level, index, track, revenue }: CockpitModel["talent"][number]) {
  return (
    <>
      <span className="flex items-center gap-2">
        <GraduationCap className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {name}
        <Badge variant={talentTone(level)}>{TALENT_LEVEL_LABEL[level]}</Badge>
      </span>
      <span className="text-xs text-muted-foreground">
        index {pct(index)} · {track}
        {revenue > 0 ? ` · ${money(revenue)}` : ""}
      </span>
    </>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
