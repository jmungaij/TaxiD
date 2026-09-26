/**
 * TEAM LEADER OVERVIEW — one line per person, then the leads behind the line.
 *
 * Leads working, meetings held, quotes shared, contracts signed, won and the
 * revenue behind the wins, all read from the desk views. Click a person to see
 * their leads grouped by the step they are actually sitting at, with the date of
 * each step and the loss reason where a lead is closed.
 */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, ChevronRight, Search, Users } from "lucide-react";
import { KES, LOSS_REASON_LABEL, deskFigures, type DeskFigures } from "@/lib/sales/journey";
import {
  groupByStep,
  listLossByOwner,
  listStageDetail,
  type LossByOwnerRow,
  type StageDetailRow,
} from "@/lib/sales/teamOverview";

const day = (v: string | null) => (v ? new Date(v).toLocaleDateString("en-KE") : "—");

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border bg-card/60 p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function PersonDrillDown({
  row,
  leads,
  losses,
  onBack,
}: {
  row: DeskFigures;
  leads: StageDetailRow[];
  losses: LossByOwnerRow[];
  onBack: () => void;
}) {
  const groups = groupByStep(leads);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <Button size="sm" variant="ghost" onClick={onBack}>
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden /> Back to the team
          </Button>
          <h3 className="mt-1 text-lg font-semibold">{row.staff_name}</h3>
        </div>
        <Badge variant="outline">{leads.length} lead{leads.length === 1 ? "" : "s"} on record</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Leads working" value={String(row.leads_working)} />
        <Figure label="Meetings held" value={String(row.meetings_held)} />
        <Figure label="Quotes shared" value={String(row.quotes_shared)} />
        <Figure label="Contracts signed" value={String(row.contracts_signed)} />
        <Figure label="Won" value={String(row.won)} />
        <Figure label="Revenue won" value={KES(row.revenue_won_kes)} />
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="pt-6 text-sm text-muted-foreground">
            No lead is recorded against this person yet.
          </CardContent>
        </Card>
      ) : (
        groups.map((g) => (
          <Card key={g.step}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {g.step}
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  {g.rows.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {g.rows.map((l) => (
                <div key={l.lead_id} className="rounded-lg border p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium">{l.organisation_name}</p>
                    <span className="text-xs text-muted-foreground">{l.lead_ref}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {l.service_interest ?? "Service not recorded"}
                    {l.contact_name ? ` · ${l.contact_name}` : ""}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Meeting {day(l.meeting_held_at)} · Quote {day(l.quote_shared_at)} · Contract
                    shared {day(l.contract_shared_at)} · Signed {day(l.contract_signed_at)}
                  </p>
                  {l.stage === "CLOSED_WON" && (
                    <p className="mt-1 text-xs font-medium text-success">
                      Revenue recorded {l.won_revenue_kes ? KES(l.won_revenue_kes) : "NOT STATED"}
                    </p>
                  )}
                  {(l.stage === "CLOSED_LOST" || l.stage === "DISQUALIFIED") && (
                    <p className="mt-1 text-xs">
                      Lost: {LOSS_REASON_LABEL[l.lost_reason_code ?? "UNRECORDED"]}
                      {l.lost_competitor ? ` · to ${l.lost_competitor}` : ""}
                      {l.lost_expected_price_kes
                        ? ` · they expected ${KES(l.lost_expected_price_kes)}`
                        : ""}
                      {l.lost_revisit_date ? ` · revisit ${day(l.lost_revisit_date)}` : ""}
                      {l.lost_reason ? ` — ${l.lost_reason}` : ""}
                    </p>
                  )}
                  {l.waiting_on && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Waiting on {l.waiting_on === "CLIENT" ? "the client" : "us"}
                      {l.awaiting_item ? ` for ${l.awaiting_item}` : ""}
                      {l.awaiting_due_date ? ` by ${day(l.awaiting_due_date)}` : ""}
                    </p>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))
      )}

      {losses.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Why this person loses work</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {losses.map((l) => (
              <p key={l.reason_code}>
                {LOSS_REASON_LABEL[l.reason_code] ?? l.reason_code}: {l.leads_lost} lead
                {l.leads_lost === 1 ? "" : "s"}
                {l.value_lost_kes ? ` · ${KES(l.value_lost_kes)} of estimated value` : ""}
                {l.with_competitor_named ? ` · ${l.with_competitor_named} names a competitor` : ""}
              </p>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

export default function TeamLeaderOverview() {
  const [term, setTerm] = React.useState("");
  const [openStaff, setOpenStaff] = React.useState<string | null>(null);

  const figures = useQuery({ queryKey: ["sales-desk-figures"], queryFn: deskFigures });
  const detail = useQuery({ queryKey: ["sales-stage-detail"], queryFn: listStageDetail });
  const losses = useQuery({ queryKey: ["sales-loss-by-owner"], queryFn: listLossByOwner });

  if (figures.isLoading) return <Skeleton className="h-64 w-full" />;
  if (figures.error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">The team figures could not be read.</p>
          <p className="text-muted-foreground">{(figures.error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const rows = figures.data ?? [];
  const shown = rows.filter((r) =>
    r.staff_name.toLowerCase().includes(term.trim().toLowerCase()),
  );

  const person = openStaff ? rows.find((r) => r.sales_staff_id === openStaff) : null;
  if (person)
    return (
      <PersonDrillDown
        row={person}
        leads={(detail.data ?? []).filter((l) => l.sales_staff_id === person.sales_staff_id)}
        losses={(losses.data ?? []).filter((l) => l.sales_staff_id === person.sales_staff_id)}
        onBack={() => setOpenStaff(null)}
      />
    );

  const total = rows.reduce(
    (a, r) => ({
      leads_working: a.leads_working + r.leads_working,
      meetings_held: a.meetings_held + r.meetings_held,
      quotes_shared: a.quotes_shared + r.quotes_shared,
      contracts_signed: a.contracts_signed + r.contracts_signed,
      won: a.won + r.won,
      lost: a.lost + r.lost,
      revenue_won_kes: a.revenue_won_kes + Number(r.revenue_won_kes ?? 0),
    }),
    {
      leads_working: 0,
      meetings_held: 0,
      quotes_shared: 0,
      contracts_signed: 0,
      won: 0,
      lost: 0,
      revenue_won_kes: 0,
    },
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users className="h-4 w-4" aria-hidden /> The team, in one line each
          </CardTitle>
          <CardDescription>
            Leads working, meetings held, quotes shared and the revenue behind the wins. Open anyone
            to see the leads behind their numbers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Figure label="Leads working" value={String(total.leads_working)} />
            <Figure label="Meetings held" value={String(total.meetings_held)} />
            <Figure label="Quotes shared" value={String(total.quotes_shared)} />
            <Figure label="Contracts signed" value={String(total.contracts_signed)} />
            <Figure label="Won / lost" value={`${total.won} / ${total.lost}`} />
            <Figure label="Revenue won" value={KES(total.revenue_won_kes)} />
          </div>

          {rows.length > 4 && (
            <div className="relative max-w-sm">
              <Search
                className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground"
                aria-hidden
              />
              <Input
                className="pl-8"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                placeholder="Find a person"
                aria-label="Find a person"
              />
            </div>
          )}

          {shown.length === 0 ? (
            <p className="text-muted-foreground">
              {rows.length === 0
                ? "No lead is recorded against anyone yet."
                : "Nobody matches that search."}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                    <th className="py-2 pr-3 font-semibold">Person</th>
                    <th className="py-2 pr-3 font-semibold">Working</th>
                    <th className="py-2 pr-3 font-semibold">Meetings</th>
                    <th className="py-2 pr-3 font-semibold">Quotes</th>
                    <th className="py-2 pr-3 font-semibold">Signed</th>
                    <th className="py-2 pr-3 font-semibold">Won</th>
                    <th className="py-2 pr-3 font-semibold">Lost</th>
                    <th className="py-2 pr-3 font-semibold">Revenue won</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.sales_staff_id ?? r.staff_name} className="border-t">
                      <td className="py-2 pr-3 font-medium">{r.staff_name}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.leads_working}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.meetings_held}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.quotes_shared}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.contracts_signed}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.won}</td>
                      <td className="py-2 pr-3 tabular-nums">{r.lost}</td>
                      <td className="py-2 pr-3 tabular-nums">{KES(Number(r.revenue_won_kes ?? 0))}</td>
                      <td className="py-2 text-right">
                        {r.sales_staff_id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setOpenStaff(r.sales_staff_id)}
                          >
                            Stage detail
                            <ChevronRight className="ml-1 h-4 w-4" aria-hidden />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(detail.error || losses.error) && (
            <p className="text-xs text-muted-foreground">
              The drill-down could not be read:{" "}
              {((detail.error ?? losses.error) as Error).message}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
