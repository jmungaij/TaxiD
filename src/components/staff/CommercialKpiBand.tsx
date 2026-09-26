/**
 * COMMERCIAL KPI BAND on My Dashboard.
 *
 * Revenue, win rate, lead-to-close time and average deal value, read from the
 * commercial records under the caller's own identity. A manager can switch to
 * their reporting line; the database decides whether that switch is allowed.
 * A figure with nothing behind it is shown as "no decided business yet" rather
 * than as a zero.
 */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Banknote, Clock, Percent, Target, TrendingUp } from "lucide-react";
import { fetchCommercialKpis, KES0, type KpiScope } from "@/lib/staff/commercialKpis";

function Tile({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Banknote;
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border bg-card/60 p-4">
      <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" aria-hidden /> {label}
      </p>
      <p className="mt-1.5 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{note}</p>
    </div>
  );
}

export default function CommercialKpiBand() {
  const [scope, setScope] = React.useState<KpiScope>("mine");
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ["commercial-kpis", scope],
    queryFn: () => fetchCommercialKpis(scope),
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    retry: false,
  });

  // Figures follow the records: any change to commercial business recomputes them.
  React.useEffect(() => {
    const invalidate = () => void qc.invalidateQueries({ queryKey: ["commercial-kpis"] });
    const channel = supabase
      .channel("commercial-kpis-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "sales_leads" }, invalidate)
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);


  if (isLoading) return <Skeleton className="h-32 w-full rounded-2xl" />;
  if (error || !data) return null; // no commercial identity — nothing to claim

  return (
    <section className="glass-panel rounded-2xl p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <TrendingUp className="h-4 w-4 text-primary" aria-hidden /> Commercial performance
          </h2>
          <p className="text-xs text-muted-foreground">
            Last {Math.round(data.window_days / 30)} months, from the commercial records themselves
            {data.scope === "team" ? ` · ${data.people} people in your line` : ""}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {data.can_view_team && (
            <div className="inline-flex rounded-lg border p-0.5">
              <Button
                size="sm"
                variant={scope === "mine" ? "secondary" : "ghost"}
                onClick={() => setScope("mine")}
              >
                Mine
              </Button>
              <Button
                size="sm"
                variant={scope === "team" ? "secondary" : "ghost"}
                onClick={() => setScope("team")}
              >
                My team
              </Button>
            </div>
          )}
          <Button asChild size="sm" variant="outline">
            <Link to="/staff/workspace/book">Commercial Book</Link>
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Tile
          icon={Banknote}
          label="Revenue won"
          value={KES0(Number(data.revenue_kes ?? 0))}
          note={`${data.won_count} closed won`}
        />
        <Tile
          icon={Percent}
          label="Win rate"
          value={data.win_rate_pct === null ? "—" : `${data.win_rate_pct}%`}
          note={
            data.win_rate_pct === null
              ? "No decided business yet"
              : `${data.won_count} won of ${data.won_count + data.lost_count} decided`
          }
        />
        <Tile
          icon={Clock}
          label="Lead to close"
          value={data.avg_days_to_close === null ? "—" : `${data.avg_days_to_close} days`}
          note={data.avg_days_to_close === null ? "No closed business yet" : "Average on won business"}
        />
        <Tile
          icon={Target}
          label="Average deal"
          value={data.avg_deal_value_kes === null ? "—" : KES0(Number(data.avg_deal_value_kes))}
          note={
            data.avg_deal_value_kes === null
              ? "No value recorded on won business"
              : "Average value of won business"
          }
        />
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Badge variant="outline">{data.open_count} open</Badge>
        <Badge variant="outline">Open pipeline {KES0(Number(data.open_pipeline_kes ?? 0))}</Badge>
      </div>
    </section>
  );
}
