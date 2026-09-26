/**
 * MY DAY — the specialist's first screen.
 *
 * One place for the four things a specialist needs: what to do next, how the
 * month is going against target, what has been promised to customers, and how
 * much work is sitting on the desk. Everything is read from the records; nothing
 * is estimated in the browser.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import KpiCascadeBand from "@/components/sales/KpiCascadeBand";
import { fetchSalesDayClose, KES } from "@/lib/sales/dayClose";

const when = (iso: string | null | undefined) =>
  !iso
    ? "no date set"
    : new Date(iso).toLocaleString("en-KE", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      });

export default function MyDayView() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-my-day"],
    queryFn: () => fetchSalesDayClose(null, false),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Your day could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );

  const actions = data?.next_actions ?? [];
  const clocks = data?.sla.clocks ?? [];
  const waiting = data?.contracts?.waiting ?? [];
  const m = data?.month.figures;

  return (
    <div className="space-y-6">
      <KpiCascadeBand />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Do these next</CardTitle>
            <CardDescription>
              {actions.length === 0
                ? "NOTHING WAITING ON YOU RIGHT NOW"
                : "Ordered by what is most worth your time today."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {actions.slice(0, 10).map((a) => (
              <div key={a.lead_id} className="rounded-md border p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-medium">{a.organisation ?? a.lead_ref ?? "Unnamed lead"}</p>
                  {a.breached ? (
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                      Past its date
                    </Badge>
                  ) : (
                    <Badge variant="outline">{a.stage.split("_").join(" ")}</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{a.why}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {a.value_kes ? KES(a.value_kes) : "Value not stated"}
                  {a.idle_days !== null && a.idle_days !== undefined
                    ? ` · untouched ${a.idle_days} day${a.idle_days === 1 ? "" : "s"}`
                    : ""}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Promised to customers</CardTitle>
            <CardDescription>
              {clocks.length === 0 && waiting.length === 0
                ? "NO OPEN COMMITMENTS RECORDED"
                : "Replies owed and contracts still waiting on someone."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {clocks.slice(0, 8).map((c) => (
              <div key={`${c.process}-${c.entity_ref}`} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{c.organisation ?? c.entity_ref ?? c.process}</span>
                  {c.breached ? (
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                      Overdue
                    </Badge>
                  ) : (
                    <Badge variant="outline">Due {when(c.due_at)}</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {c.process.split("_").join(" ")}
                  {c.escalation_level > 0 ? ` · escalated (${c.escalation_level})` : ""}
                </p>
              </div>
            ))}
            {waiting.slice(0, 8).map((w) => (
              <div key={w.contract_id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{w.organisation ?? w.contract_number ?? "Contract"}</span>
                  <Badge variant="outline">{w.waiting_on.split("_").join(" ")}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {w.value_kes ? KES(w.value_kes) : "Value not stated"}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">What is on the desk</CardTitle>
          <CardDescription>Open work behind this month's figures.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { label: "Open leads", value: String(m?.open_count ?? 0) },
            { label: "Open value", value: KES(m?.open_pipeline_kes ?? 0) },
            { label: "Likely value", value: KES(m?.weighted_pipeline_kes ?? 0) },
            { label: "Waiting on customers", value: String(m?.awaiting_customer_count ?? 0) },
            { label: "Untouched a week", value: String(m?.stale_count ?? 0) },
            {
              label: "Win rate",
              value: m?.win_rate_pct === null || m?.win_rate_pct === undefined
                ? "NOTHING DECIDED YET"
                : `${m.win_rate_pct}%`,
            },
          ].map((k) => (
            <div key={k.label} className="rounded-md border p-3">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {k.label}
              </p>
              <p className="mt-1 text-lg font-semibold tracking-tight">{k.value}</p>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
