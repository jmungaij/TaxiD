import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { AlertTriangle, Database, ScrollText, Flag, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { DataStateBadge } from "@/components/staff/primitives";
import type { DataState } from "@/lib/staff/dataState";
import { RECOMMENDATION_CONTRACT } from "@/lib/staff/intelligence";
import {
  FEEDBACK_ISSUE_LABEL, listInsightFeedback, recalculateConfidence, recordRecalculation,
  submitInsightFeedback, type FeedbackIssue, type InsightFeedback, type Recalculation,
} from "@/lib/staff/insightFeedback";
import { EvidencePanel } from "@/components/staff/EvidencePanel";
import {
  computeConfidence, factorsFromFields, parseFieldLine,
  type EvidenceBundle, type EvidenceField,
} from "@/lib/staff/evidence";

/** A declared data source behind an insight or contract explanation. */
export interface ExplainedSource {
  label: string;
  /** Table, view, configured rule or document the reasoning reads. */
  origin: string;
  state: DataState;
  updatedAt?: string;
}

export interface ExplainedInsight {
  /** Stable key used to record evaluation feedback against the insight. */
  key?: string;
  title: string;
  /** The conclusion. Absent when no source resolves — never invented. */
  conclusion?: string;
  /** Why this conclusion follows. */
  why?: string;
  sources: ExplainedSource[];
  assumptions: string[];
  /** 0–1. Omitted when there is nothing to be confident about. */
  confidence?: number;
  expectedImpact?: string;
  recommendedAction?: string;
  owner?: string;
  /** Explicit reason the insight cannot be produced yet. */
  blockedReason?: string;
  /** Pre-built evidence bundle. When omitted it is derived from the sources. */
  evidence?: EvidenceBundle;
}


function confidenceLabel(c: number) {
  if (c >= 0.8) return "High";
  if (c >= 0.5) return "Moderate";
  return "Low";
}

/**
 * Explained-AI panel.
 *
 * Every insight must disclose its data sources, its assumptions and its
 * confidence. When a source is unavailable, the panel states that the insight
 * cannot be produced instead of presenting an estimate as TaxiD performance.
 */
export function ExplainedAiPanel({
  insight,
  footer,
}: {
  insight: ExplainedInsight;
  footer?: ReactNode;
}) {
  const insightKey = insight.key ?? insight.title;
  const [feedback, setFeedback] = useState<InsightFeedback[]>([]);
  const [recalc, setRecalc] = useState<Recalculation | null>(null);
  const [open, setOpen] = useState(false);
  const [issue, setIssue] = useState<FeedbackIssue>("incorrect_source");
  const [sourceLabel, setSourceLabel] = useState(insight.sources[0]?.label ?? "");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);

  const loadFeedback = useCallback(async () => {
    const res = await listInsightFeedback(insightKey);
    if (res.ok) setFeedback(res.data ?? []);
  }, [insightKey]);

  useEffect(() => {
    void loadFeedback();
  }, [loadFeedback]);

  const submit = async () => {
    setBusy(true);
    const res = await submitInsightFeedback({
      insightKey,
      insightTitle: insight.title,
      issue,
      sourceLabel: issue === "wrong_conclusion" ? undefined : sourceLabel,
      comment,
      confidenceBefore: insight.confidence,
    });
    setBusy(false);
    if (!res.ok) {
      toast.error("Feedback not recorded", { description: res.reason });
      return;
    }
    toast.success("Flag recorded", { description: "Confidence will be recalculated from the evidence base." });
    setOpen(false);
    setComment("");
    await loadFeedback();
  };

  const runRecalculation = async () => {
    const next = recalculateConfidence(insight, feedback);
    setRecalc(next);
    const res = await recordRecalculation(insightKey, next, insight.confidence);
    if (!res.ok) toast.warning("Recalculated for this session", { description: res.reason });
    else toast.success("Confidence recalculated", { description: next.rationale });
    await loadFeedback();
  };

  const openFlags = feedback.filter((f) => f.status === "open").length;
  const effectiveConfidence = recalc ? recalc.confidence : insight.confidence;
  const unresolved = insight.sources.filter((s) => s.state === "unavailable");
  const producible =
    Boolean(insight.conclusion) && unresolved.length === 0 && !(recalc?.blocked ?? false);

  /** Evidence bundle: exact fields, provenance tables and confidence factors. */
  const evidenceFields: EvidenceField[] = insight.sources.map((s) => {
    const parsed = parseFieldLine(s.origin);
    return {
      table: parsed?.table ?? s.origin,
      column: parsed?.column ?? s.label,
      value: parsed?.value,
      recordRef: parsed ? s.label : undefined,
      readAt: s.updatedAt,
      state: s.state,
    };
  });
  const derivedFactors = factorsFromFields(evidenceFields);
  const derived = computeConfidence(derivedFactors);
  const evidenceBundle: EvidenceBundle = insight.evidence ?? {
    key: insightKey,
    title: insight.title,
    fields: evidenceFields,
    confidence:
      effectiveConfidence == null
        ? { confidence: null, rationale: recalc?.rationale ?? derived.rationale, factors: derivedFactors }
        : {
            confidence: effectiveConfidence,
            rationale: `${recalc ? "Recalculated from recorded feedback. " : ""}${derived.rationale}`,
            factors: derivedFactors,
          },
    provenanceTables: Array.from(new Set(evidenceFields.map((f) => f.table))),
    limitations: insight.assumptions.length
      ? insight.assumptions.map((a) => `Assumption held constant: ${a}`)
      : undefined,
  };

  return (
    <Card className="h-full">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <CardTitle className="text-base">{insight.title}</CardTitle>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px] tracking-wide">
              {producible ? "EXPLAINED INSIGHT" : "INSIGHT NOT AVAILABLE"}
            </Badge>
            <EvidencePanel bundle={evidenceBundle} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {producible ? (
          <p className="font-medium text-foreground">{insight.conclusion}</p>
        ) : (
          <div className="flex gap-2 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              {insight.blockedReason ??
                `No conclusion is offered: ${unresolved.length || "the required"} data source${
                  unresolved.length === 1 ? "" : "s"
                } have not resolved. TaxiD does not present a modelled figure as measured performance.`}
            </span>
          </div>
        )}

        {insight.why && (
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Why</div>
            <p className="mt-1 text-muted-foreground">{insight.why}</p>
          </div>
        )}

        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <Database className="h-3.5 w-3.5" aria-hidden="true" /> Data sources
          </div>
          <ul className="mt-2 space-y-1.5">
            {insight.sources.map((s) => (
              <li key={`${s.label}-${s.origin}`} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium">{s.label}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{s.origin}</div>
                </div>
                <DataStateBadge state={s.state} />
              </li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <ScrollText className="h-3.5 w-3.5" aria-hidden="true" /> Assumptions
          </div>
          <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-muted-foreground">
            {insight.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>

        <div>
          <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            <span>Confidence{recalc ? " (recalculated)" : ""}</span>
            <span>
              {effectiveConfidence == null
                ? "Withheld"
                : `${confidenceLabel(effectiveConfidence)} · ${Math.round(effectiveConfidence * 100)}%`}
            </span>
          </div>
          <Progress value={effectiveConfidence == null ? 0 : effectiveConfidence * 100} className="mt-2 h-1.5" />
          {effectiveConfidence == null && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Confidence is withheld rather than guessed while sources are unresolved.
            </p>
          )}
          {recalc && (
            <p className="mt-1 text-[11px] text-muted-foreground">{recalc.rationale}</p>
          )}
        </div>

        <dl className="grid gap-2 sm:grid-cols-3">
          {[
            ["Expected impact", insight.expectedImpact],
            ["Recommended action", insight.recommendedAction],
            ["Owner", insight.owner],
          ].map(([k, v]) => (
            <div key={k as string} className="rounded-md border p-2">
              <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{k}</dt>
              <dd className="mt-0.5 text-xs">{v ?? "Not stated"}</dd>
            </div>
          ))}
        </dl>

        {/* Evaluation & feedback: flag a wrong or missing source, then recalculate. */}
        <div className="rounded-md border border-dashed p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Evaluate this insight
            </div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}>
                <Flag className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Flag a source
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={runRecalculation}
                disabled={feedback.length === 0}
              >
                <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Recalculate confidence
              </Button>
            </div>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            {feedback.length === 0
              ? "No feedback recorded. Recalculation becomes available once a source is flagged."
              : `${feedback.length} report${feedback.length === 1 ? "" : "s"} recorded · ${openFlags} open. Recalculation can only lower confidence or withhold it.`}
          </p>
          {feedback.length > 0 && (
            <ul className="mt-2 space-y-1">
              {feedback.slice(0, 4).map((f) => (
                <li key={f.id} className="text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">{FEEDBACK_ISSUE_LABEL[f.issue_type]}</span>
                  {f.source_label ? ` — ${f.source_label}` : ""} · {f.status}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>Flag an evidence problem</DialogTitle>
              <DialogDescription>
                Your report is recorded against this insight and feeds the confidence recalculation. Nothing
                is re-estimated: recalculation can only lower confidence or withhold it.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <fieldset>
                <legend className="text-sm font-medium">What is wrong</legend>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(Object.keys(FEEDBACK_ISSUE_LABEL) as FeedbackIssue[]).map((k) => (
                    <Button
                      key={k}
                      size="sm"
                      variant={issue === k ? "default" : "outline"}
                      className="h-7 rounded-full px-3 text-xs"
                      aria-pressed={issue === k}
                      onClick={() => setIssue(k)}
                    >
                      {FEEDBACK_ISSUE_LABEL[k]}
                    </Button>
                  ))}
                </div>
              </fieldset>
              {issue !== "wrong_conclusion" && (
                <fieldset>
                  <legend className="text-sm font-medium">Which source</legend>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {insight.sources.map((s) => (
                      <Button
                        key={s.label}
                        size="sm"
                        variant={sourceLabel === s.label ? "default" : "outline"}
                        className="h-7 rounded-full px-3 text-xs"
                        aria-pressed={sourceLabel === s.label}
                        onClick={() => setSourceLabel(s.label)}
                      >
                        {s.label}
                      </Button>
                    ))}
                  </div>
                </fieldset>
              )}
              <div>
                <Label htmlFor={`fb-${insightKey}`}>What should it read instead?</Label>
                <Textarea
                  id={`fb-${insightKey}`}
                  rows={3}
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Recognised revenue should exclude voided invoices; the current source includes them."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit} disabled={busy}>{busy ? "Recording…" : "Record flag"}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {footer}

      </CardContent>
    </Card>
  );
}

/** The disclosure contract every explained insight is held to. */
export function ExplainedContractLegend() {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RECOMMENDATION_CONTRACT.map((c) => (
        <Badge key={c} variant="secondary" className="font-normal">{c}</Badge>
      ))}
    </div>
  );
}

export default ExplainedAiPanel;
