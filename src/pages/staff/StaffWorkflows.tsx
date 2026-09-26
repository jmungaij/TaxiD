import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronRight, Route as RouteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  StaffPageHeader, StaffSection, ChipList, InfoCard, MetricTile,
} from "@/components/staff/primitives";
import { SavedViewsBar } from "@/components/staff/SavedViewsBar";
import { SEED_BATCH, pickMetric, useIntelligenceData } from "@/lib/staff/intelligenceData";
import { SeedBatchNotice } from "@/components/staff/SeedBatchNotice";
import {
  WORKFLOW_STAGES, WORKFLOW_SERVICE_LINES, WORKFLOW_INTEGRITY_CHECKS,
  type WorkflowStageId,
} from "@/lib/staff/marketplaceWorkflow";
import { buildWorkflowTrace, traceFromParams } from "@/lib/staff/workflowTrace";

/**
 * End-to-end marketplace workflow — the single connected value chain from
 * demand to customer lifetime value. Stage measures are named, never invented:
 * each renders DATA NOT AVAILABLE until its source is wired.
 *
 * A search result can enter the chain directly (`?stage=&entity=&record=`),
 * which pins the entry stage and shows the upstream/downstream chain plus the
 * integrity checks that must hold for that entry point.
 */
/** Stable metric key for a named stage measure. */
function measureKey(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export default function StaffWorkflows() {
  const intel = useIntelligenceData();
  const [params, setParams] = useSearchParams();
  const traced = useMemo(() => traceFromParams(params), [params]);
  const [active, setActive] = useState<WorkflowStageId>(traced.stage ?? "demand");
  const stage = useMemo(
    () => WORKFLOW_STAGES.find((s) => s.id === active) ?? WORKFLOW_STAGES[0],
    [active],
  );

  useEffect(() => {
    if (traced.stage) setActive(traced.stage);
  }, [traced.stage]);

  const trace = useMemo(
    () =>
      traced.entity
        ? buildWorkflowTrace(
            traced.entity,
            traced.recordId ? { id: traced.recordId, title: traced.recordLabel ?? traced.recordId } : undefined,
          )
        : undefined,
    [traced.entity, traced.recordId, traced.recordLabel],
  );

  const clearTrace = () => setParams(new URLSearchParams(), { replace: true });

  const applySaved = useCallback((config: Record<string, unknown>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(config)) {
      if (typeof v === "string" && v) next.set(k, v);
    }
    setParams(next, { replace: true });
    const s = config.stage as WorkflowStageId | undefined;
    if (s && WORKFLOW_STAGES.some((x) => x.id === s)) setActive(s);
  }, [setParams]);

  return (
    <>
      <StaffPageHeader
        eyebrow="Marketplace operating flow"
        title="End-to-end workflow"
        lede="Demand → Customer → Marketplace matching → Resource owner or operator → Service fulfilment → Payment → Customer lifetime value. One chain, seven stages, each with its records, measures, handoff and failure modes."
      />

      {intel.seeded && <SeedBatchNotice batch={SEED_BATCH} />}


      <SavedViewsBar
        kind="workflow"
        currentConfig={{
          stage: active,
          entity: traced.entity ?? "",
          record: traced.recordId ?? "",
          label: traced.recordLabel ?? "",
        }}
        onApply={applySaved}
        emptyHint="Save a stage or a traced record you monitor, then share it with the roles that own that handoff."
      />

      {trace && (
        <Card className="mb-6 border-primary">
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  <RouteIcon className="h-3.5 w-3.5" aria-hidden="true" /> Traced from search
                </div>
                <div className="mt-1 text-sm font-semibold">
                  {trace.target.recordLabel ?? trace.target.entityLabel}
                </div>
                <p className="text-xs text-muted-foreground">
                  {trace.target.entityLabel} entering the chain at {trace.entryStage.label}.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link to="/staff/search" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
                  Back to search
                </Link>
                <button type="button" onClick={clearTrace} className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                  Clear trace
                </button>
              </div>
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <InfoCard title="Upstream of this record">
                {trace.upstream.length ? (
                  <ChipList items={trace.upstream.map((s) => s.label)} />
                ) : (
                  <p className="text-xs text-muted-foreground">This record originates the chain.</p>
                )}
              </InfoCard>
              <InfoCard title="Downstream of this record">
                {trace.downstream.length ? (
                  <ChipList items={trace.downstream.map((s) => s.label)} />
                ) : (
                  <p className="text-xs text-muted-foreground">This record closes the chain.</p>
                )}
              </InfoCard>
              <InfoCard title="Integrity checks at this entry point">
                <ChipList items={trace.integrityChecks} />
              </InfoCard>
            </div>

            <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] text-muted-foreground">
              {trace.unproven.map((u) => <li key={u}>{u}</li>)}
            </ul>
          </CardContent>
        </Card>
      )}


      <nav aria-label="Workflow stages" className="mb-8 overflow-x-auto">
        <ol className="flex items-center gap-1.5">
          {WORKFLOW_STAGES.map((s, i) => (
            <li key={s.id} className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActive(s.id)}
                aria-current={active === s.id ? "step" : undefined}
                className={cn(
                  "whitespace-nowrap rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                <span className="mr-1.5 tabular-nums opacity-70">{i + 1}</span>
                {s.label}
              </button>
              {i < WORKFLOW_STAGES.length - 1 && (
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
      </nav>

      <StaffSection title={`${stage.label} — ${stage.question}`} description={stage.description}>
        <div className="grid gap-4 lg:grid-cols-3">
          <InfoCard title="Evidencing records"><ChipList items={stage.records} /></InfoCard>
          <InfoCard title="Handoff to next stage">
            <p>{stage.handoff}</p>
            <div className="mt-2">
              <Badge variant="outline" className="text-[10px]">Owner: {stage.owner}</Badge>
            </div>
          </InfoCard>
          <InfoCard title="Failure modes"><ChipList items={stage.failureModes} /></InfoCard>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stage.measures.map((m) => (
            <MetricTile
              key={m}
              metric={pickMetric(
                intel.index,
                "workflow",
                stage.id,
                measureKey(m),
                m,
                `Resolves once ${stage.label.toLowerCase()} telemetry is connected for your scope.`,
              )}
            />
          ))}
        </div>
      </StaffSection>

      <StaffSection title="The whole chain at a glance" description="Each stage hands a specific artefact to the next. A break at any stage is visible as an unmatched artefact downstream.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {WORKFLOW_STAGES.map((s, i) => (
            <Card key={s.id} className={cn(active === s.id && "border-primary")}>
              <CardContent className="pt-5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{i + 1}. {s.label}</div>
                  <Badge variant="secondary" className="text-[10px] font-normal">{s.owner}</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{s.question}</p>
                <p className="mt-2 text-xs"><span className="text-muted-foreground">Hands off:</span> {s.handoff}</p>
                <button
                  type="button"
                  onClick={() => setActive(s.id)}
                  className="mt-3 text-xs font-medium text-primary underline-offset-4 hover:underline"
                >
                  Inspect stage
                </button>
              </CardContent>
            </Card>
          ))}
        </div>
      </StaffSection>

      <StaffSection title="Service lines through the same chain">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW_SERVICE_LINES.map((l) => (
            <Card key={l.label}><CardContent className="pt-5">
              <div className="text-sm font-semibold">{l.label}</div>
              <p className="mt-1 text-xs text-muted-foreground">Fulfilment: {l.fulfilment}</p>
              <p className="text-xs text-muted-foreground">Payment: {l.payment}</p>
            </CardContent></Card>
          ))}
        </div>
      </StaffSection>

      <StaffSection title="Chain integrity checks" description="Assertions that must hold for the flow to be trustworthy end to end.">
        <ChipList items={WORKFLOW_INTEGRITY_CHECKS} />
      </StaffSection>
    </>
  );
}
