/**
 * ROLE DASHBOARD — a premium workspace surface, one lens per discipline.
 *
 * Nothing on this page is computed in the browser from guesswork: figures, the
 * fourteen-day trend, the alert feed and the task list all arrive from
 * `staff_dashboard_snapshot(lens)`, which enforces the caller's role server-side
 * and returns only the caller's own tasks. Lenses the person cannot access are
 * not offered, and the database refuses them even if requested directly.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  PolarAngleAxis,
  RadialBar,
  RadialBarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AsyncState } from "@/components/dashboard/AsyncState";
import { useAuth } from "@/hooks/useAuth";
import { useStaffAccess } from "@/components/staff/StaffAccessProvider";
import CommercialKpiBand from "@/components/staff/CommercialKpiBand";
import SalesTargetHero from "@/components/staff/SalesTargetHero";
import PipelineValuePanel from "@/components/staff/commercial/PipelineValuePanel";
import {
  AlertTriangle,
  BadgeCheck,
  Banknote,
  Bell,
  CircleDot,
  Clock,
  Gauge,
  LayoutDashboard,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Target,
  Truck,
  UserRound,
  UserSearch,
} from "lucide-react";
import {
  buildBriefing,
  fetchDashboardSnapshot,
  lensesForRoles,
  type DashboardLens,
  type DashboardSnapshot,
  type LensDefinition,
  type TileTone,
} from "@/lib/staff/roleDashboard";

const LENS_ICON: Record<DashboardLens, typeof ShieldCheck> = {
  personal: UserRound,
  admin: ShieldCheck,
  finance: Banknote,
  logistics: Truck,
  recruitment: UserSearch,
};

const TONE_RING: Record<TileTone, string> = {
  neutral: "ring-border/70",
  positive: "ring-[hsl(var(--status-success)/0.45)]",
  warning: "ring-[hsl(var(--status-warning)/0.5)]",
  critical: "ring-destructive/50",
};

const TONE_TEXT: Record<TileTone, string> = {
  neutral: "text-foreground",
  positive: "text-[hsl(var(--status-success))]",
  warning: "text-[hsl(var(--status-warning))]",
  critical: "text-destructive",
};

const SEVERITY_STYLE = {
  critical: { dot: "bg-destructive", badge: "border-destructive/40 text-destructive" },
  warning: { dot: "bg-[hsl(var(--status-warning))]", badge: "border-[hsl(var(--status-warning)/0.45)] text-[hsl(var(--status-warning))]" },
  info: { dot: "bg-[hsl(var(--status-info))]", badge: "border-[hsl(var(--status-info)/0.45)] text-[hsl(var(--status-info))]" },
} as const;

const compact = (value: number, unit: string) => {
  if (unit === "KES") {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toLocaleString("en-KE");
  }
  return value.toLocaleString("en-KE");
};

const dayLabel = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short" });

const timeLabel = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
    : "—";

export default function RoleDashboard() {
  const { roles, rolesLoading } = useAuth();
  const { identity } = useStaffAccess();
  const available = useMemo(
    () => lensesForRoles(roles, !!identity?.staffId),
    [roles, identity?.staffId],
  );
  const [lens, setLens] = useState<DashboardLens | null>(null);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!lens && available.length) setLens(available[0].lens);
    if (!rolesLoading && !available.length) setLoading(false);
  }, [available, lens, rolesLoading]);

  const load = useCallback(
    async (target: DashboardLens) => {
      setLoading(true);
      setError(null);
      try {
        setSnapshot(await fetchDashboardSnapshot(target));
      } catch (e) {
        setSnapshot(null);
        setError(e instanceof Error ? e.message : "Could not load this dashboard");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (lens) void load(lens);
  }, [lens, load]);

  const active: LensDefinition | undefined = available.find((l) => l.lens === lens);
  const briefing = snapshot ? buildBriefing(snapshot) : [];
  const openTasks = snapshot?.myTasks ?? [];
  const overdueCount = openTasks.filter((t) => t.overdue).length;

  if (!rolesLoading && available.length === 0) {
    return (
      <div className="glass-panel rounded-2xl p-8 text-center">
        <ShieldCheck className="mx-auto h-8 w-8 text-primary" aria-hidden />
        <h1 className="mt-3 text-xl font-semibold">No dashboard can be shown yet</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          Your own performance view opens as soon as your login is linked to your employee record.
          Wider administration, finance, logistics and recruitment views need those roles.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---------- Cinematic command header ---------- */}
      <header className="relative overflow-hidden rounded-2xl border border-border/60 shadow-[var(--shadow-elegant,0_18px_50px_-24px_hsl(var(--executive-midnight)/0.45))]">
        <div className="absolute inset-0" style={{ background: "var(--gradient-executive)" }} aria-hidden />
        <div
          className="absolute inset-0 opacity-70"
          aria-hidden
          style={{
            background:
              "radial-gradient(120% 90% at 12% 8%, hsl(var(--royal-azure)/0.55) 0%, transparent 58%), radial-gradient(90% 80% at 92% 100%, hsl(var(--sapphire-blue)/0.45) 0%, transparent 60%)",
          }}
        />
        <div className="relative p-6 sm:p-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl text-primary-foreground">
              <div className="flex flex-wrap items-center gap-3">
                {identity?.fullName && (
                  <span
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/40 bg-primary-foreground/15 text-xs font-semibold backdrop-blur"
                    aria-hidden
                  >
                    {identity.fullName
                      .split(" ")
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((p) => p[0])
                      .join("")}
                  </span>
                )}
                <span className="text-[11px] font-semibold uppercase tracking-[0.24em] text-primary-foreground/75">
                  {identity?.fullName
                    ? `${identity.fullName}${identity.position ? ` · ${identity.position}` : ""}`
                    : "SAFARID executive workspace"}
                </span>
              </div>
              <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
                <LayoutDashboard className="h-7 w-7" aria-hidden />
                {active ? `${active.label} dashboard` : "Role dashboard"}
              </h1>
              <p className="mt-2 text-sm text-primary-foreground/85">
                {active?.strapline ??
                  "Your discipline, your figures, your tasks — read live from the platform record."}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {snapshot && (
                <span className="hidden text-xs text-primary-foreground/75 sm:inline">
                  Read {timeLabel(snapshot.generatedAt)}
                </span>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => lens && void load(lens)}
                disabled={loading || !lens}
              >
                <RefreshCw className={`mr-2 h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
                Refresh
              </Button>
            </div>
          </div>

          {/* ---------- Lens switcher: iconic, interactive, role-filtered ---------- */}
          <nav className="mt-6 flex flex-wrap gap-2" aria-label="Dashboard lens">
            {available.map((l) => {
              const Icon = LENS_ICON[l.lens];
              const on = l.lens === lens;
              return (
                <button
                  key={l.lens}
                  type="button"
                  onClick={() => setLens(l.lens)}
                  aria-current={on ? "page" : undefined}
                  className={`group inline-flex items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-medium backdrop-blur transition-all duration-300 ${
                    on
                      ? "border-primary-foreground/70 bg-primary-foreground/20 text-primary-foreground shadow-lg"
                      : "border-primary-foreground/25 bg-primary-foreground/5 text-primary-foreground/80 hover:-translate-y-0.5 hover:bg-primary-foreground/15"
                  }`}
                >
                  <Icon className="h-4 w-4 transition-transform duration-300 group-hover:scale-110" aria-hidden />
                  {l.label}
                </button>
              );
            })}
          </nav>
        </div>
      </header>

      <AsyncState
        loading={loading}
        error={error}
        isEmpty={!!snapshot && snapshot.tiles.length === 0}
        emptyMessage="No figures are recorded for this dashboard yet."
        onRetry={() => lens && void load(lens)}
      >
        {snapshot && active && (
          <div className="space-y-6">
            {/* ---------- Headline figures ---------- */}
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {snapshot.tiles.map((t, i) => (
                <div
                  key={t.key}
                  className={`glass-panel group relative overflow-hidden rounded-2xl p-5 ring-1 ${TONE_RING[t.tone]} transition-transform duration-300 hover:-translate-y-1`}
                  style={{ animation: `fade-in 420ms ease-out ${i * 70}ms both` }}
                >
                  <div
                    className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full opacity-25 blur-2xl transition-opacity duration-300 group-hover:opacity-45"
                    style={{ background: "var(--gradient-ai)" }}
                    aria-hidden
                  />
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    {t.label}
                  </div>
                  <div className={`mt-2 flex items-baseline gap-2 ${TONE_TEXT[t.tone]}`}>
                    <span className="text-3xl font-semibold tabular-nums">{compact(t.value, t.unit)}</span>
                    <span className="text-xs font-medium text-muted-foreground">{t.unit}</span>
                  </div>
                  {t.tone === "critical" && t.value > 0 && (
                    <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Needs action
                    </div>
                  )}
                  {t.tone === "positive" && (
                    <div className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--status-success))]">
                      <BadgeCheck className="h-3.5 w-3.5" aria-hidden /> On record
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* ---------- Focus ring: completion measured from the figures above ---------- */}
            {(() => {
              const done = snapshot.tiles.find((t) => t.tone === "positive")?.value ?? 0;
              const open = snapshot.tiles.find((t) => t.key.includes("open"))?.value ?? openTasks.length;
              const total = done + open;
              const pct = total > 0 ? Math.round((done / total) * 100) : 0;
              const busiest = [...snapshot.series].sort((a, b) => b.value - a.value)[0];
              return (
                <section className="glass-panel relative overflow-hidden rounded-2xl p-5">
                  <div
                    className="pointer-events-none absolute -left-16 -top-20 h-56 w-56 rounded-full opacity-20 blur-3xl"
                    style={{ background: "var(--gradient-executive)" }}
                    aria-hidden
                  />
                  <div className="relative grid gap-6 md:grid-cols-[200px_1fr] md:items-center">
                    <div className="relative h-[180px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadialBarChart
                          data={[{ name: "done", value: pct }]}
                          innerRadius="72%"
                          outerRadius="100%"
                          startAngle={90}
                          endAngle={-270}
                        >
                          <PolarAngleAxis type="number" domain={[0, 100]} tick={false} />
                          <RadialBar dataKey="value" cornerRadius={12} fill="hsl(var(--chart-2))" background />
                        </RadialBarChart>
                      </ResponsiveContainer>
                      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                        <span className="text-3xl font-semibold tabular-nums">{pct}%</span>
                        <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          Cleared
                        </span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <h2 className="flex items-center gap-2 text-base font-semibold">
                        <Target className="h-4 w-4 text-primary" aria-hidden /> Momentum
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        {total > 0
                          ? `${done} finished against ${open} still open on this desk.`
                          : "Nothing is recorded on this desk yet, so there is no share to show."}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant="outline" className="gap-1">
                          <Gauge className="h-3 w-3" aria-hidden /> {open} open
                        </Badge>
                        <Badge variant="outline" className="gap-1 border-destructive/40 text-destructive">
                          <AlertTriangle className="h-3 w-3" aria-hidden /> {overdueCount} past due
                        </Badge>
                        {busiest && busiest.value > 0 && (
                          <Badge variant="outline" className="gap-1">
                            <CircleDot className="h-3 w-3" aria-hidden /> Busiest day {dayLabel(busiest.day)} ({busiest.value})
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </section>
              );
            })()}

            {/* Sales target — the commercial north star, server-computed. */}
            <SalesTargetHero />

            {/* Commercial performance — server-computed, mine or my reporting line. */}
            <CommercialKpiBand />

            {/* Pipeline value — probability-weighted value driving priority and workload. */}
            <PipelineValuePanel compact />



            <div className="grid gap-6 lg:grid-cols-3">
              {/* ---------- Trend ---------- */}
              <section className="glass-panel rounded-2xl p-5 lg:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="text-base font-semibold">{active.seriesLabel}</h2>
                    <p className="text-xs text-muted-foreground">
                      Last fourteen days, {active.seriesUnit}. Counted from the records themselves.
                    </p>
                  </div>
                  <Badge variant="outline" className="gap-1">
                    <CircleDot className="h-3 w-3" aria-hidden /> Live
                  </Badge>
                </div>
                <div className="mt-4 h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={snapshot.series} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
                      <defs>
                        <linearGradient id="lensArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="hsl(var(--chart-2))" stopOpacity={0.55} />
                          <stop offset="100%" stopColor="hsl(var(--chart-2))" stopOpacity={0.04} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis
                        dataKey="day"
                        tickFormatter={dayLabel}
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        stroke="hsl(var(--border))"
                      />
                      <YAxis
                        tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                        stroke="hsl(var(--border))"
                        allowDecimals={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--popover))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 12,
                          fontSize: 12,
                          color: "hsl(var(--popover-foreground))",
                        }}
                        labelFormatter={(v) => dayLabel(String(v))}
                      />
                      <Area
                        type="monotone"
                        dataKey="value"
                        name={active.seriesLabel}
                        stroke="hsl(var(--chart-1))"
                        strokeWidth={2}
                        fill="url(#lensArea)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* ---------- Derived briefing ---------- */}
              <section className="glass-panel relative overflow-hidden rounded-2xl p-5">
                <div
                  className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full opacity-25 blur-3xl"
                  style={{ background: "var(--gradient-ai)" }}
                  aria-hidden
                />
                <h2 className="flex items-center gap-2 text-base font-semibold">
                  <Sparkles className="h-4 w-4 text-[hsl(var(--ai-accent))]" aria-hidden /> Intelligence briefing
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Every line restates a figure shown on this page. Nothing is predicted or invented.
                </p>
                <ul className="mt-4 space-y-3">
                  {briefing.map((line, i) => (
                    <li key={i} className="flex gap-2 text-sm leading-relaxed">
                      <span
                        className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                        style={{ background: "hsl(var(--ai-accent))" }}
                        aria-hidden
                      />
                      {line}
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              {/* ---------- Alerts ---------- */}
              <section className="glass-panel rounded-2xl p-5">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <Bell className="h-4 w-4 text-primary" aria-hidden /> Alerts on this desk
                  </h2>
                  <Badge variant="outline">{snapshot.alerts.length}</Badge>
                </div>
                {snapshot.alerts.length === 0 ? (
                  <p className="mt-6 text-sm text-muted-foreground">
                    Nothing is waiting on this desk right now.
                  </p>
                ) : (
                  <ul className="mt-4 divide-y divide-border/70">
                    {snapshot.alerts.map((a) => {
                      const s = SEVERITY_STYLE[a.severity];
                      return (
                        <li key={a.id} className="flex gap-3 py-3 transition-colors hover:bg-accent/40">
                          <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${s.dot}`} aria-hidden />
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="truncate text-sm font-medium">{a.title}</span>
                              <Badge variant="outline" className={`text-[10px] uppercase ${s.badge}`}>
                                {a.severity}
                              </Badge>
                            </div>
                            {a.detail && (
                              <p className="mt-0.5 text-xs text-muted-foreground">{a.detail}</p>
                            )}
                            <p className="mt-0.5 text-[11px] text-muted-foreground">{timeLabel(a.at)}</p>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>

              {/* ---------- The caller's own tasks ---------- */}
              <section className="glass-panel rounded-2xl p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="flex items-center gap-2 text-base font-semibold">
                    <Clock className="h-4 w-4 text-primary" aria-hidden /> My tasks
                  </h2>
                  <div className="flex items-center gap-2">
                    {overdueCount > 0 && (
                      <Badge variant="outline" className="border-destructive/40 text-destructive">
                        {overdueCount} overdue
                      </Badge>
                    )}
                    <Button size="sm" variant="outline" asChild>
                      <Link to="/staff/workspace">Open workspace</Link>
                    </Button>
                  </div>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Only work assigned to you. Colleagues' queues are never shown here.
                </p>
                {openTasks.length === 0 ? (
                  <p className="mt-6 text-sm text-muted-foreground">
                    {snapshot.staffId
                      ? "No open task is assigned to you."
                      : "Your login is not yet linked to an employee record, so no task list can be shown."}
                  </p>
                ) : (
                  <>
                    <ul className="mt-4 space-y-2">
                      {openTasks.map((t) => (
                        <li
                          key={t.id}
                          className={`rounded-xl border p-3 transition-all duration-300 hover:-translate-y-0.5 ${
                            t.overdue ? "border-destructive/40 bg-destructive/5" : "border-border/70 bg-card/60"
                          }`}
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium">{t.title}</span>
                            <span className={`text-xs ${t.overdue ? "font-semibold text-destructive" : "text-muted-foreground"}`}>
                              {t.due ? `Due ${timeLabel(t.due)}` : "No due time"}
                            </span>
                          </div>
                          {t.nextAction && (
                            <p className="mt-1 text-xs text-muted-foreground">Next: {t.nextAction}</p>
                          )}
                        </li>
                      ))}
                    </ul>
                    <div className="mt-4 h-[120px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={openTasks.slice(0, 8).map((t, i) => ({
                            name: `#${i + 1}`,
                            value: t.overdue ? 2 : 1,
                            overdue: t.overdue,
                          }))}
                          margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
                        >
                          <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} stroke="hsl(var(--border))" />
                          <YAxis hide />
                          <Tooltip
                            formatter={(_v, _n, p) => [p?.payload?.overdue ? "Overdue" : "On time", "Status"]}
                            contentStyle={{
                              background: "hsl(var(--popover))",
                              border: "1px solid hsl(var(--border))",
                              borderRadius: 12,
                              fontSize: 12,
                            }}
                          />
                          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
                            {openTasks.slice(0, 8).map((t, i) => (
                              <Cell key={i} fill={t.overdue ? "hsl(var(--status-danger))" : "hsl(var(--chart-2))"} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Each bar is one of your tasks — red means past its due time.
                    </p>
                  </>
                )}
              </section>
            </div>
          </div>
        )}
      </AsyncState>
    </div>
  );
}
