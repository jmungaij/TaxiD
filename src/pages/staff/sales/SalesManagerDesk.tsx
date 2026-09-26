/**
 * SALES MANAGER DESK — the whole department on one page.
 *
 * Every specialist reporting to the sales manager, with the target on the
 * register, the book they hold, what they have won, what has been invoiced and
 * collected, what is outstanding, and the service issues open against their
 * customers. Every figure is read from the same records the specialists work in,
 * so the manager and the team can never be looking at different numbers.
 */
import * as React from "react";
import { AlertTriangle, ArrowRight, Loader2, RefreshCw, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { gapKes, loadManagerDesk, type ManagerDesk } from "@/lib/sales/managerDesk";
import {
  loadManagerOperationsBoard,
  ROLE_LABELS,
  SERVICE_LABELS,
  type ManagerOperationsBoard,
} from "@/lib/sales/managerOperations";
import DailyMoneyFlow from "@/components/staff/sales/DailyMoneyFlow";
import ProviderEscalationPanel from "@/components/staff/sales/ProviderEscalationPanel";
import MeetingScheduler from "@/components/staff/meetings/MeetingScheduler";

const KES = (n: number | null | undefined) =>
  n === null || n === undefined
    ? "Not stated"
    : new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES", maximumFractionDigits: 0 }).format(n);

export default function SalesManagerDesk() {
  const [desk, setDesk] = React.useState<ManagerDesk | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [ops, setOps] = React.useState<ManagerOperationsBoard | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const [deskRes, opsRes] = await Promise.allSettled([loadManagerDesk(), loadManagerOperationsBoard()]);
    if (deskRes.status === "fulfilled") {
      setDesk(deskRes.value);
      setError(null);
    } else {
      setError(
        deskRes.reason instanceof Error ? deskRes.reason.message : "The sales desk could not be read.",
      );
    }
    setOps(opsRes.status === "fulfilled" ? opsRes.value : null);
    setLoading(false);
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const collectedTeam = (desk?.people ?? []).reduce((s, p) => s + p.collected_month_cents / 100, 0);
  const wonTeam = (desk?.people ?? []).reduce((s, p) => s + p.won_month_kes, 0);
  const recognised = collectedTeam + wonTeam;
  const teamTarget = desk?.team_target_kes ?? 0;

  return (
    <div className="space-y-5">
      <header className="hero-band px-6 py-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] opacity-80">Sales department</p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Sales manager desk</h1>
        <p className="mt-1 max-w-2xl text-sm opacity-85">
          Every corporate sales specialist reporting to you, their target, their book, what they have won and collected,
          and the customer issues waiting on them.
        </p>
      </header>

      {loading && !desk && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading the department…
        </div>
      )}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-semibold">This desk is not available for your account</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      )}

      {desk && !error && (
        <>
          <Card>
            <CardContent className="space-y-2 pt-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Department against target this month
                  </p>
                  <p className="mt-1 text-2xl font-semibold tracking-tight">
                    {KES(recognised)} {teamTarget > 0 && <span className="text-sm text-muted-foreground">of {KES(teamTarget)}</span>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {KES(wonTeam)} won and signed · {KES(collectedTeam)} collected ·{" "}
                    {teamTarget > 0 ? `${KES(Math.max(0, teamTarget - recognised))} still to find` : "no team target registered"}
                  </p>
                </div>
                <Button size="sm" variant="outline" onClick={() => void load()}>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Refresh
                </Button>
              </div>
              {teamTarget > 0 && <Progress value={Math.min(100, (recognised / teamTarget) * 100)} />}
              <div className="grid gap-2 border-t pt-3 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div>
                  <p className="text-muted-foreground">My own target</p>
                  <p className="font-semibold">{KES(desk.my_kpis.own_target_kes)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Specialists</p>
                  <p className="font-semibold">{desk.my_kpis.team_size}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Open customers</p>
                  <p className="font-semibold">{desk.my_kpis.team_leads_open}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Contacted today</p>
                  <p className="font-semibold">
                    {desk.my_kpis.team_outreach_today}
                    <span className="ml-1 font-normal text-muted-foreground">
                      +{desk.my_kpis.team_new_customers_today} new
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Service done today</p>
                  <p className="font-semibold">{desk.my_kpis.team_services_completed_today}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Issues open</p>
                  <p className="font-semibold">{desk.my_kpis.team_exceptions_open}</p>
                </div>
              </div>
              <div className="grid gap-2 border-t pt-3 text-xs sm:grid-cols-3">
                <div>
                  <p className="text-muted-foreground">Days closed by the team this month</p>
                  <p className="font-semibold">{desk.my_kpis.team_day_closes_month}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Closed today</p>
                  <p className="font-semibold">
                    {desk.my_kpis.team_closes_today} of {desk.my_kpis.team_size}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Revenue recorded in their closes</p>
                  <p className="font-semibold">{KES(desk.my_kpis.team_closed_revenue_month_kes)}</p>
                </div>
              </div>

              {desk.my_kpis.team_contracts_awaiting_signature > 0 && (
                <p className="text-xs text-muted-foreground">
                  {desk.my_kpis.team_contracts_awaiting_signature} contract(s) are with customers awaiting signature —
                  they are not revenue until the signed copy is returned.
                </p>
              )}
            </CardContent>
          </Card>

          <div className="grid gap-3 lg:grid-cols-3">
            <Card className={ops && ops.exceptions.length > 0 ? "border-destructive/40" : undefined}>
              <CardContent className="space-y-2 pt-5">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> Customer issues from operations
                </p>
                {!ops ? (
                  <p className="text-xs text-muted-foreground">Reading the operations board…</p>
                ) : ops.exceptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No open service issues. Any delay, failure or cancellation raised by operations lands here before it
                    reaches the specialist's account page.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {ops.exceptions.slice(0, 8).map((x) => (
                      <li key={x.signal_id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                        <p className="font-semibold">{x.customer_label ?? "Customer not stated"}</p>
                        <p className="text-muted-foreground">{x.headline ?? "No detail recorded"}</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {x.severity ?? "severity not stated"} · {x.owner_name ?? "owner not assigned"} ·{" "}
                          {new Date(x.created_at).toLocaleString()}
                        </p>
                        {x.account_id && (
                          <Link
                            className="mt-1 inline-flex items-center text-[11px] font-semibold underline"
                            to={`/staff/workspace/accounts/${x.account_id}`}
                          >
                            Open the account page <ArrowRight className="ml-1 h-3 w-3" aria-hidden />
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 pt-5">
                <p className="text-sm font-semibold">Service today</p>
                {!ops ? (
                  <p className="text-xs text-muted-foreground">Reading the service feed…</p>
                ) : ops.services_today.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No trips, transfers or parcels recorded for today yet. Daily close figures follow this feed.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {ops.services_today.slice(0, 8).map((s) => (
                      <li key={s.execution_id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                        <p className="font-semibold">
                          {SERVICE_LABELS[s.service_type] ?? s.service_type} · {s.status.toLowerCase()}
                        </p>
                        <p className="text-muted-foreground">
                          {s.execution_ref ?? "no reference"} · {s.owner_name ?? "owner not assigned"}
                          {s.value_kes ? ` · ${KES(Number(s.value_kes))}` : ""}
                        </p>
                        {s.exception_reason && <p className="text-muted-foreground">{s.exception_reason}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardContent className="space-y-2 pt-5">
                <p className="text-sm font-semibold">Activation plan</p>
                {!ops ? (
                  <p className="text-xs text-muted-foreground">Reading the activation board…</p>
                ) : ops.activation.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Nobody is committed to a live contract yet. People, vehicles and dates appear here as specialists
                    plan each activation.
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {ops.activation.slice(0, 8).map((a) => (
                      <li key={a.assignment_id} className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                        <p className="font-semibold">
                          {ROLE_LABELS[a.assignment_role] ?? a.assignment_role} ·{" "}
                          {a.person_label ?? a.vehicle_label ?? "not named yet"}
                        </p>
                        <p className="text-muted-foreground">
                          {a.start_date ?? "start not set"} → {a.end_date ?? "open ended"} · {a.status.toLowerCase()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>

          <DailyMoneyFlow />

          <ProviderEscalationPanel issues={ops?.exceptions ?? []} />

          {desk.people.length === 0 ? (
            <Card>
              <CardContent className="py-10 text-center">
                <p className="text-sm font-semibold">Nobody reports to you yet</p>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  Once specialists are placed under you in the staff register, their book appears here.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {desk.people.map((p) => {
                const gap = gapKes(p);
                return (
                  <Card key={p.staff_id}>
                    <CardContent className="space-y-3 pt-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="flex items-center gap-1.5 truncate text-sm font-semibold">
                            <Users className="h-3.5 w-3.5" aria-hidden /> {p.full_name ?? "Unnamed colleague"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {p.position ?? "Position not stated"} · target {KES(p.target_kes)}
                            {p.last_activity_at
                              ? ` · last worked ${new Date(p.last_activity_at).toLocaleDateString()}`
                              : " · no activity recorded yet"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant={p.closed_today ? "default" : "outline"} className="text-[10px]">
                            {p.closed_today ? "Day closed" : "Day not closed yet"}
                          </Badge>
                          {p.service_exceptions_open > 0 && (
                            <Badge variant="destructive" className="text-[10px]">
                              <AlertTriangle className="mr-1 h-3 w-3" aria-hidden /> {p.service_exceptions_open} customer
                              issue{p.service_exceptions_open === 1 ? "" : "s"}
                            </Badge>
                          )}
                          {p.leads_untouched > 0 && (
                            <Badge variant="secondary" className="text-[10px]">
                              {p.leads_untouched} never contacted
                            </Badge>
                          )}
                        </div>
                      </div>

                      <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
                        <p className="font-semibold">Their day so far</p>
                        <p className="mt-0.5 text-muted-foreground">
                          {p.today.new_customers} new customer(s) · {p.today.outreach} contacted ·{" "}
                          {p.today.replies} replied · {p.today.services_completed} service(s) completed ·{" "}
                          {p.today.won_kes > 0 ? `${KES(p.today.won_kes)} won` : "nothing won yet"} ·{" "}
                          {p.today.collected_cents > 0 ? `${KES(p.today.collected_cents / 100)} collected` : "nothing collected"}
                          {p.today.service_issues > 0 ? ` · ${p.today.service_issues} service issue(s)` : ""}
                        </p>
                        <p className="mt-0.5 text-muted-foreground">
                          {p.closed_today ? "Day closed." : "Day not closed yet."} {p.day_closes_month} day(s) closed this
                          month
                          {p.last_close_on ? `, last on ${p.last_close_on}` : ""} ·{" "}
                          {p.closed_revenue_month_kes > 0
                            ? `${KES(p.closed_revenue_month_kes)} recorded in those closes`
                            : "no revenue recorded in those closes"}
                        </p>
                        {p.contracts_awaiting_signature > 0 && (
                          <p className="mt-0.5 text-muted-foreground">
                            {p.contracts_awaiting_signature} contract(s) sent and waiting on the customer's signature.
                          </p>
                        )}
                      </div>

                      <div className="grid gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                        <div>
                          <p className="text-muted-foreground">Book</p>
                          <p className="font-semibold">{p.leads_total} customers</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Open pipeline</p>
                          <p className="font-semibold">{KES(p.open_pipeline_kes)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Won this month</p>
                          <p className="font-semibold">{KES(p.won_month_kes)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Collected</p>
                          <p className="font-semibold">{KES(p.collected_month_cents / 100)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Outstanding</p>
                          <p className="font-semibold">{KES(p.outstanding_cents / 100)}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Still to find</p>
                          <p className="font-semibold">{gap === null ? "No target" : KES(gap)}</p>
                        </div>
                      </div>

                      {p.target_kes ? (
                        <Progress
                          value={Math.min(100, ((p.won_month_kes + p.collected_month_cents / 100) / p.target_kes) * 100)}
                        />
                      ) : null}

                      <Button asChild size="sm" variant="outline">
                        <Link to={`/staff/workspace/accounts?owner=${p.staff_id}`}>
                          Open their book <ArrowRight className="ml-1.5 h-3.5 w-3.5" aria-hidden />
                        </Link>
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </>
      )}

      <MeetingScheduler />
    </div>
  );
}
