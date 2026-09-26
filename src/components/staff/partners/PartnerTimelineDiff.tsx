/**
 * SAFARID PARTNERS 360 — timeline diff panel.
 *
 * Highlights exactly what moved between two consecutive lifecycle stage updates
 * across the four governed dimensions — stage, what they bring, partner category
 * and maturity level. Comparison is computed from the append-only lifecycle audit
 * trail by `buildTimelineDiffs`, so the panel never invents a transition.
 */
import { useEffect, useState } from "react";
import { ArrowRight, GitCompareArrows } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { listLifecycleAudit, type PartnerLifecycleAuditRow } from "@/lib/partners/history";
import { labelOf } from "@/lib/partners/journeyDrill";
import {
  buildTimelineDiffs,
  DIFF_FIELD_KEY,
  DIFF_FIELD_LABEL,
  type FieldDelta,
} from "@/lib/partners/timelineDiff";

const fmt = (iso: string) => new Date(iso).toLocaleString("en-KE");

const KIND_TONE: Record<FieldDelta["kind"], string> = {
  changed: "border-primary/40 bg-primary/5",
  set: "border-status-success/40 bg-status-success/5",
  cleared: "border-status-warning/40 bg-status-warning/5",
  unchanged: "border-border bg-muted/30",
};

const KIND_LABEL: Record<FieldDelta["kind"], string> = {
  changed: "Changed",
  set: "First declared",
  cleared: "Cleared",
  unchanged: "Unchanged",
};

function DeltaRow({ delta }: { delta: FieldDelta }) {
  const key = DIFF_FIELD_KEY[delta.field];
  const show = (v: string | null) => (v ? labelOf(key, v) : "not declared");

  return (
    <div className={`rounded-lg border p-3 ${KIND_TONE[delta.kind]}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {DIFF_FIELD_LABEL[delta.field]}
        </span>
        <Badge variant={delta.changed ? "default" : "outline"} className="text-[10px]">
          {KIND_LABEL[delta.kind]}
        </Badge>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
        <span className={delta.changed ? "text-muted-foreground line-through" : "font-medium"}>
          {show(delta.before)}
        </span>
        {delta.changed && (
          <>
            <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
            <span className="font-semibold">{show(delta.after)}</span>
          </>
        )}
      </div>
    </div>
  );
}

export interface PartnerTimelineDiffPanelProps {
  sessionId: string;
  /** Supply rows to skip the fetch (e.g. the parent already loaded them). */
  rows?: PartnerLifecycleAuditRow[];
}

export function PartnerTimelineDiffPanel({ sessionId, rows }: PartnerTimelineDiffPanelProps) {
  const [loaded, setLoaded] = useState<PartnerLifecycleAuditRow[] | null>(rows ?? null);

  useEffect(() => {
    if (rows) {
      setLoaded(rows);
      return;
    }
    let live = true;
    listLifecycleAudit(sessionId)
      .then((r) => { if (live) setLoaded(r); })
      .catch(() => { if (live) setLoaded([]); });
    return () => { live = false; };
  }, [sessionId, rows]);

  const diffs = loaded ? buildTimelineDiffs(loaded) : [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <GitCompareArrows className="h-4 w-4" aria-hidden /> Stage-to-stage diff
        </CardTitle>
        <CardDescription>
          What actually changed between each pair of consecutive lifecycle stage updates — stage, what they
          bring, partner category and maturity level. Newest comparison first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {loaded === null ? (
          <div className="space-y-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : diffs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            This session has fewer than two audited stage updates, so there is nothing to compare yet.
          </p>
        ) : (
          <ol className="space-y-3">
            {diffs.map((d) => (
              <li key={`${d.fromId}-${d.toId}`} className="rounded-xl border border-border bg-card p-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <span>{fmt(d.fromAt)}</span>
                  <ArrowRight className="h-3 w-3" aria-hidden />
                  <span>{fmt(d.toAt)}</span>
                  <Badge variant="outline">{d.gapMinutes} min apart</Badge>
                  {d.identical ? (
                    <Badge variant="outline">No governed change</Badge>
                  ) : (
                    <Badge variant="secondary">
                      {d.changedFields.length} field{d.changedFields.length === 1 ? "" : "s"} moved
                    </Badge>
                  )}
                </div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {d.deltas.map((delta) => (
                    <DeltaRow key={delta.field} delta={delta} />
                  ))}
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

export default PartnerTimelineDiffPanel;
