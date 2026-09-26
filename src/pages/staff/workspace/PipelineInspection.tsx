/**
 * PIPELINE INSPECTION.
 *
 * Your opportunities, but answering what changed, whether each deal is still
 * moving, and whether it is ready for its next stage. Everything on this page is
 * read from the records themselves — where a fact is not recorded, it says so.
 */
import * as React from "react";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowRight, ArrowUp, Clock, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { WorkspaceEmptyState } from "@/components/staff/workspace/WorkspaceEmptyState";
import { moneyFromCents } from "@/lib/workspace/commercialBook";
import {
  INDICATOR_LABEL,
  MOMENTUM_LABEL,
  deriveDealSignals,
  emitSignals,
  inspectionTotals,
  loadInspection,
  movementNarrative,
  openRows,
  type InspectionRow,
  type MomentumBand,
} from "@/lib/intelligence";
import { cn } from "@/lib/utils";

const MOMENTUM_TONE: Record<MomentumBand, string> = {
  accelerating: "border-l-primary",
  progressing: "border-l-primary/60",
  stable: "border-l-border",
  slowing: "border-l-secondary",
  stalled: "border-l-destructive",
};

function ValueDelta({ cents }: { cents: number }) {
  if (cents === 0) return null;
  const up = cents > 0;
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", up ? "text-primary" : "text-destructive")}>
      {up ? <ArrowUp className="h-3 w-3" aria-hidden /> : <ArrowDown className="h-3 w-3" aria-hidden />}
      {moneyFromCents(Math.abs(cents))}
    </span>
  );
}

function Row({ row }: { row: InspectionRow }) {
  const o = row.opportunity;
  return (
    <Card className={cn("border-l-4", MOMENTUM_TONE[row.momentum.band])}>
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={row.momentum.band === "stalled" ? "destructive" : "secondary"} className="text-[10px]">
            {MOMENTUM_LABEL[row.momentum.band]}
          </Badge>
          <Badge variant="outline" className="text-[10px] capitalize">
            {o.stage.replace(/_/g, " ")}
          </Badge>
          {o.customer_label && (
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{o.customer_label}</span>
          )}
          {row.momentum.idleDays != null && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" aria-hidden /> idle {row.momentum.idleDays}d / {row.momentum.idleThresholdDays}d
            </span>
          )}
          <span className="ml-auto text-sm font-semibold tabular-nums">
            {moneyFromCents(o.expected_value_cents, o.currency ?? "KES")}
          </span>
        </div>

        <div>
          <p className="font-semibold leading-snug">{o.title}</p>
          <p className="text-sm text-muted-foreground">{row.momentum.headline}</p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {row.movement.indicators.map((i) => (
            <Badge key={i} variant="outline" className="text-[10px]">
              {INDICATOR_LABEL[i]}
            </Badge>
          ))}
          <ValueDelta cents={row.movement.netValueDeltaCents} />
        </div>

        {row.readiness && !row.readiness.ready && (
          <div className="rounded-md border border-secondary/40 bg-secondary/10 p-2.5 text-xs">
            <p className="inline-flex items-center gap-1.5 font-semibold">
              <TriangleAlert className="h-3.5 w-3.5" aria-hidden /> {row.readiness.headline}
            </p>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {row.readiness.missing.map((m) => (
                <li key={m.key}>
                  · <span className="font-medium text-foreground">{m.label}</span> — {m.why}
                </li>
              ))}
            </ul>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">Why it reads this way</summary>
          <ul className="mt-1.5 space-y-1">
            {row.momentum.reasons.map((r, i) => (
              <li key={i}>· {r}</li>
            ))}
            {row.movement.lines.map((l, i) => (
              <li key={`m${i}`}>· {l}</li>
            ))}
          </ul>
        </details>

        <Button size="sm" variant="outline" asChild>
          <Link to="/staff/workspace/opportunities">
            Open the deal <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}

export default function PipelineInspection() {
  const [rows, setRows] = React.useState<InspectionRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [changesAvailable, setChangesAvailable] = React.useState(true);
  const [publishing, setPublishing] = React.useState(false);
  const [published, setPublished] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await loadInspection(7);
      setRows(res.rows);
      setChangesAvailable(res.changesAvailable);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Your pipeline could not be read.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const totals = React.useMemo(() => inspectionTotals(rows), [rows]);
  const open = React.useMemo(() => openRows(rows), [rows]);
  const moved = open.filter((r) => !r.movement.indicators.includes("no_change"));
  const idle = open.filter((r) => r.momentum.idle);
  const notReady = open.filter((r) => r.readiness && !r.readiness.ready);
  const narrative = React.useMemo(() => movementNarrative(open.map((r) => r.movement)), [open]);

  const publishSignals = async () => {
    setPublishing(true);
    try {
      const result = await emitSignals(deriveDealSignals(rows));
      setPublished(
        result.failed === 0
          ? `${result.written} signal(s) recorded for the team.`
          : `${result.written} recorded, ${result.failed} could not be recorded.`,
      );
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Pipeline inspection</h1>
          <p className="text-sm text-muted-foreground">
            What changed in the last 7 days, what stopped moving, and what is genuinely ready to advance.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            Refresh
          </Button>
          <Button size="sm" onClick={() => void publishSignals()} disabled={publishing || rows.length === 0}>
            {publishing ? "Recording…" : "Record signals"}
          </Button>
        </div>
      </header>

      {published && <p className="text-sm text-muted-foreground">{published}</p>}

      {error && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-4 text-sm">{error}</CardContent>
        </Card>
      )}

      {!changesAvailable && (
        <Card className="border-secondary/40 bg-secondary/10">
          <CardContent className="py-4 text-sm">
            Change history is not released to your account, so movement is shown as unknown rather than estimated.
          </CardContent>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          { label: "Open deals", value: String(totals.openCount) },
          { label: "Open value", value: moneyFromCents(totals.openValueCents) },
          { label: "Weighted", value: moneyFromCents(Math.round(totals.weightedValueCents)) },
          { label: "Gone quiet", value: String(totals.idleCount) },
        ].map((k) => (
          <Card key={k.label}>
            <CardContent className="py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{k.label}</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{k.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">This week</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {narrative.map((n, i) => (
              <li key={i}>· {n}</li>
            ))}
            {totals.valuelessCount > 0 && (
              <li>· {totals.valuelessCount} open deal(s) carry no expected value, so they cannot be weighed.</li>
            )}
          </ul>
        </CardContent>
      </Card>

      {loading && rows.length === 0 ? (
        <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Reading your pipeline…
        </div>
      ) : (
        <Tabs defaultValue="all">
          <TabsList>
            <TabsTrigger value="all">
              All open <span className="ml-1.5 text-xs text-muted-foreground">{open.length}</span>
            </TabsTrigger>
            <TabsTrigger value="moved">
              Moved <span className="ml-1.5 text-xs text-muted-foreground">{moved.length}</span>
            </TabsTrigger>
            <TabsTrigger value="idle">
              Gone quiet <span className="ml-1.5 text-xs text-muted-foreground">{idle.length}</span>
            </TabsTrigger>
            <TabsTrigger value="notready">
              Not ready <span className="ml-1.5 text-xs text-muted-foreground">{notReady.length}</span>
            </TabsTrigger>
          </TabsList>

          {(
            [
              ["all", open, "No open deal is recorded in your book."],
              ["moved", moved, "Nothing moved in the last 7 days."],
              ["idle", idle, "Every open deal is inside its own quiet-period allowance."],
              ["notready", notReady, "Every open deal meets the conditions for its next stage."],
            ] as const
          ).map(([key, items, empty]) => (
            <TabsContent key={key} value={key} className="mt-4 space-y-3">
              {items.length === 0 ? (
                <WorkspaceEmptyState
                  title={empty}
                  message="Nothing is hidden here — this view reads the same records as your opportunity list."
                  actions={[{ label: "Open my opportunities", to: "/staff/workspace/opportunities" }]}
                />
              ) : (
                items.map((r) => <Row key={r.opportunity.id} row={r} />)
              )}
            </TabsContent>
          ))}
        </Tabs>
      )}
    </div>
  );
}
