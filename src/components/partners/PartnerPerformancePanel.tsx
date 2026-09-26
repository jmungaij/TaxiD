/**
 * Explainable Partner Performance Index.
 *
 * The total is never the record: each of the five weighted components is stored
 * with the evidence that produced it (orders, SLA breaches, document validity,
 * margin, quote response). Recalculation is a server routine that also writes
 * the partner's trust score and an audit entry.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import {
  COMPONENT_LABEL, classifyPerformance, fetchPerformanceComponents, recomputeScore,
} from "@/lib/partners/marketplace";

export function PartnerPerformancePanel({ partnerId }: { partnerId: string }) {
  const qc = useQueryClient();
  const components = useQuery({
    queryKey: ["yp-performance", partnerId],
    queryFn: () => fetchPerformanceComponents(partnerId),
  });

  const recompute = useMutation({
    mutationFn: () => recomputeScore(partnerId),
    onSuccess: () => {
      toast.success("Performance recalculated from recorded activity.");
      void qc.invalidateQueries({ queryKey: ["yp-performance", partnerId] });
      void qc.invalidateQueries({ queryKey: ["yp-partner", partnerId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : "Recalculation failed."),
  });

  const rows = components.data ?? [];
  const total = rows.reduce((s, r) => s + Number(r.score), 0);

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-3">
        <CardTitle className="text-base">Performance index</CardTitle>
        <div className="flex items-center gap-2">
          {rows.length > 0 ? (
            <>
              <Badge variant="outline" className="tabular-nums">{total.toFixed(1)} / 100</Badge>
              <Badge variant="outline" className="text-[10px] uppercase">{classifyPerformance(total)}</Badge>
            </>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => recompute.mutate()} disabled={recompute.isPending}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Recalculate
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {components.isLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No score has been computed for this partner yet. Recalculate to score reliability, service quality,
            compliance, commercial contribution and responsiveness from recorded activity.
          </p>
        ) : (
          rows.map((c) => (
            <div key={c.component} className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium">{COMPONENT_LABEL[c.component] ?? c.component}</span>
                <span className="tabular-nums text-muted-foreground">
                  {Number(c.score).toFixed(1)} / {Number(c.weight).toFixed(0)}
                </span>
              </div>
              <Progress value={(Number(c.score) / Math.max(1, Number(c.weight))) * 100} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {Object.entries(c.evidence ?? {}).map(([k, v]) => `${k.replace(/_/g, " ")}: ${String(v)}`).join(" · ") || "No evidence recorded"}
              </p>
            </div>
          ))
        )}
        {rows[0]?.computed_at ? (
          <p className="text-xs text-muted-foreground">
            Computed {new Date(rows[0].computed_at).toLocaleString()} over the last {rows[0].window_days ?? 90} days.
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default PartnerPerformancePanel;
