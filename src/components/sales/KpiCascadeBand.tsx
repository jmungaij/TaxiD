/**
 * KPI CASCADE BAND — the same revenue figure read at five lengths of time.
 *
 * Day and week roll into the month, the month into the quarter, the quarter into
 * the year. Targets come from the target register; a period with no target says
 * so instead of showing a percentage that means nothing.
 */
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchKpiCascade,
  GRAIN_LABEL,
  KES,
  shortDateTime,
  type KpiGrainRow,
} from "@/lib/sales/kpi";

function GrainCard({ row }: { row: KpiGrainRow }) {
  const pct = row.attainment_pct;
  return (
    <Card>
      <CardContent className="pt-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {GRAIN_LABEL[row.grain]}
        </p>
        <p className="mt-1 text-xl font-semibold tracking-tight">{KES(row.revenue_kes)}</p>
        {row.target_kes === null ? (
          <p className="mt-1 text-xs text-muted-foreground">NO TARGET ON THE REGISTER</p>
        ) : (
          <>
            <Progress value={Math.min(pct ?? 0, 100)} className="mt-2 h-1.5" />
            <p className="mt-1 text-xs text-muted-foreground">
              {pct}% of {KES(row.target_kes)}
              {row.remaining_kes !== null && row.remaining_kes > 0
                ? ` · ${KES(row.remaining_kes)} to go`
                : " · target met"}
            </p>
          </>
        )}
        <p className="mt-1 text-[11px] text-muted-foreground">
          Frozen {shortDateTime(row.last_close_at)}
        </p>
      </CardContent>
    </Card>
  );
}

export default function KpiCascadeBand({ staffId }: { staffId?: string | null }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ["sales-kpi-cascade", staffId ?? "me"],
    queryFn: () => fetchKpiCascade(staffId),
  });

  if (isLoading) return <Skeleton className="h-28 w-full" />;
  if (error)
    return (
      <Card className="border-destructive/40">
        <CardContent className="pt-6 text-sm">
          <p className="font-medium">Your progress could not be read.</p>
          <p className="text-muted-foreground">{(error as Error).message}</p>
        </CardContent>
      </Card>
    );
  if (!data)
    return (
      <Card>
        <CardContent className="pt-6 text-sm text-muted-foreground">
          NO SALES DESK RECORD FOR THIS ACCOUNT. Nothing has been counted on your behalf.
        </CardContent>
      </Card>
    );

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {data.grains.map((g) => (
          <GrainCard key={g.grain} row={g} />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        Revenue counted when it is {data.revenue_basis === "CLOSED_WON" ? "won" : "recognised"}.
        Figures freeze every evening at 7 PM Kenya time; the week closes on Saturday and the month at
        month end, rolling into the quarter and the year.
      </p>
    </div>
  );
}
