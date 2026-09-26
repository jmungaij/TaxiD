/**
 * Recruitment 360 — Import Reconciliation Dashboard.
 *
 * One console over the import audit spine:
 *   Reconciliation — every uploaded letter/evaluation mapped, matched or flagged
 *                    per candidate and interviewer, with automatic slot suggestions
 *   Audit trail    — who uploaded, when extraction occurred, what was written
 *   Idempotency    — what a run created, updated, skipped and conflicted
 *   Completeness   — letters without evaluations, missing forms, open conflicts
 *   Adjudication   — AI HR-practitioner recommendation + final human decision
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity, AlertTriangle, ArrowRight, BadgeCheck, BrainCircuit, CheckCircle2, FileSearch,
  Fingerprint, Gavel, History, ListChecks, ListTodo, Play, RefreshCcw, Scale, ShieldAlert,
  ShieldCheck, UserCheck, XCircle,
} from "lucide-react";
import { toast } from "sonner";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

import * as rec from "@/lib/recruitment/api";
import * as recon from "@/lib/recruitment/importReconciliation";
import { bestSuggestion, matchIdentity } from "@/lib/recruitment/identityMatching";
import {
  completenessSummary, missingItems, readyForScoring, type CompletenessRow,
} from "@/lib/recruitment/completeness";
import { canResume, nextActionableStep, stepProgress, stepStateLabel } from "@/lib/recruitment/importJob";
import {
  auditActor, auditChangeSummary, defaultEnrichmentCandidate, enrichmentCompleteness, enrichmentFields, missingEnrichmentFields,
} from "@/lib/recruitment/enrichment";
import { cn } from "@/lib/utils";

const TONE: Record<string, string> = {
  success: "bg-success/10 text-success border-success/30",
  warning: "bg-warning/10 text-warning-foreground border-warning/30",
  danger: "bg-destructive/10 text-destructive border-destructive/30",
  info: "bg-primary/10 text-primary border-primary/30",
  neutral: "bg-muted text-muted-foreground border-border",
};

const OUTCOME_TONE: Record<string, string> = {
  created: TONE.success,
  updated: TONE.info,
  matched: TONE.neutral,
  skipped: TONE.neutral,
  conflict: TONE.danger,
  ambiguous: TONE.warning,
};

const humanise = (v: string) => v.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase());
const fmtDate = (v: string | null) => (v ? new Date(v).toLocaleString("en-KE", { dateStyle: "medium", timeStyle: "short" }) : "—");

export default function ImportReconciliation() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("reconciliation");
  const [runId, setRunId] = useState<string | null>(null);
  const [vacancyId, setVacancyId] = useState<string>("all");

  const runs = useQuery({ queryKey: ["rec", "import-runs"], queryFn: recon.listImportRuns });
  const candidates = useQuery({ queryKey: ["rec", "candidates"], queryFn: rec.listCandidates });
  const vacancies = useQuery({ queryKey: ["rec", "vacancies"], queryFn: () => rec.listVacancies() });
  const adjudications = useQuery({ queryKey: ["rec", "adjudications"], queryFn: recon.listAdjudications });
  const completeness = useQuery({
    queryKey: ["rec", "completeness", vacancyId],
    queryFn: () => recon.listCompleteness(vacancyId === "all" ? undefined : vacancyId),
  });

  const activeRunId = runId ?? runs.data?.[0]?.id ?? null;
  const report = useQuery({
    queryKey: ["rec", "import-report", activeRunId],
    queryFn: () => recon.loadIdempotencyReport(activeRunId!),
    enabled: !!activeRunId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["rec"] });

  return (
    <div className="p-6 lg:p-8">
      <StaffPageHeader
        title="Import Reconciliation"
        lede="Every uploaded document accounted for — mapped, matched or flagged, with full audit trail, idempotency and AI-assisted adjudication."
        actions={
          <Badge variant="outline" className={TONE.info}>
            <History className="mr-1.5 h-3.5 w-3.5" aria-hidden />
            {runs.data?.length ?? 0} governed run{(runs.data?.length ?? 0) === 1 ? "" : "s"}
          </Badge>
        }
      />

      <Tabs value={tab} onValueChange={setTab} className="mt-6">
        <TabsList className="flex flex-wrap">
          <TabsTrigger value="reconciliation"><FileSearch className="mr-1.5 h-4 w-4" aria-hidden />Reconciliation</TabsTrigger>
          <TabsTrigger value="jobs"><ListTodo className="mr-1.5 h-4 w-4" aria-hidden />Import jobs</TabsTrigger>
          <TabsTrigger value="enrichment"><UserCheck className="mr-1.5 h-4 w-4" aria-hidden />Enrichment</TabsTrigger>
          <TabsTrigger value="audit"><History className="mr-1.5 h-4 w-4" aria-hidden />Audit trail</TabsTrigger>
          <TabsTrigger value="idempotency"><RefreshCcw className="mr-1.5 h-4 w-4" aria-hidden />Idempotency</TabsTrigger>
          <TabsTrigger value="completeness"><ListChecks className="mr-1.5 h-4 w-4" aria-hidden />Completeness</TabsTrigger>
          <TabsTrigger value="adjudication"><Gavel className="mr-1.5 h-4 w-4" aria-hidden />Adjudication</TabsTrigger>
        </TabsList>
      </Tabs>

      {tab === "reconciliation" && (
        <ReconciliationTab
          report={report.data}
          loading={report.isLoading}
          candidates={(candidates.data ?? []).map((c) => ({ id: c.id, full_name: c.full_name }))}
          runs={runs.data ?? []}
          activeRunId={activeRunId}
          onRunChange={setRunId}
        />
      )}

      {tab === "jobs" && (
        <JobsTab
          runs={runs.data ?? []}
          activeRunId={activeRunId}
          onRunChange={setRunId}
          onChanged={invalidate}
        />
      )}

      {tab === "enrichment" && <EnrichmentTab onChanged={invalidate} />}

      {tab === "audit" && (
        <AuditTrailTab
          runs={runs.data ?? []}
          loading={runs.isLoading}
          activeRunId={activeRunId}
          onRunChange={setRunId}
          report={report.data}
          reportLoading={report.isLoading}
        />
      )}

      {tab === "idempotency" && (
        <IdempotencyTab
          runs={runs.data ?? []}
          activeRunId={activeRunId}
          onRunChange={setRunId}
          report={report.data}
          loading={report.isLoading}
        />
      )}

      {tab === "completeness" && (
        <CompletenessTab
          rows={completeness.data ?? []}
          loading={completeness.isLoading}
          vacancies={(vacancies.data ?? []).map((v) => ({ id: v.id, title: v.title }))}
          vacancyId={vacancyId}
          onVacancyChange={setVacancyId}
        />
      )}

      {tab === "adjudication" && (
        <AdjudicationTab
          adjudications={adjudications.data ?? []}
          loading={adjudications.isLoading}
          onChanged={invalidate}
        />
      )}
    </div>
  );
}

/* ------------------------------- run picker ------------------------------ */

function RunPicker({
  runs, activeRunId, onRunChange,
}: { runs: recon.ImportRun[]; activeRunId: string | null; onRunChange: (id: string) => void }) {
  return (
    <Select value={activeRunId ?? undefined} onValueChange={onRunChange}>
      <SelectTrigger className="w-full sm:w-[420px]" aria-label="Select import run">
        <SelectValue placeholder="Select an import run" />
      </SelectTrigger>
      <SelectContent>
        {runs.map((r) => (
          <SelectItem key={r.id} value={r.id}>
            {r.run_no} — {r.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ----------------------------- reconciliation ---------------------------- */

function ReconciliationTab({
  report, loading, candidates, runs, activeRunId, onRunChange,
}: {
  report?: recon.IdempotencyReport;
  loading: boolean;
  candidates: { id: string; full_name: string }[];
  runs: recon.ImportRun[];
  activeRunId: string | null;
  onRunChange: (id: string) => void;
}) {
  const items = report?.items ?? [];
  const candidateName = (id: string | null) =>
    candidates.find((c) => c.id === id)?.full_name ?? "—";

  const flagged = useMemo(
    () => items.filter((i) => i.match_outcome === "conflict" || i.match_outcome === "ambiguous"),
    [items],
  );

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <RunPicker runs={runs} activeRunId={activeRunId} onRunChange={onRunChange} />
        {report && (
          <Badge variant="outline" className={report.run.status === "completed_with_conflicts" ? TONE.warning : TONE.success}>
            {humanise(report.run.status)}
          </Badge>
        )}
      </div>

      {loading && <Skeleton className="h-64 w-full" />}

      {report && (
        <>
          {flagged.length > 0 && (
            <Card className="border-warning/40">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldAlert className="h-4 w-4 text-warning" aria-hidden />
                  Flagged documents — automatic slot suggestions
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {flagged.map((item) => {
                  const suggestions = matchIdentity(
                    { name: item.extracted_name, idNumber: item.extracted_id_number },
                    candidates,
                  );
                  const best = bestSuggestion(suggestions);
                  return (
                    <div key={item.id} className="rounded-lg border bg-muted/30 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <span className="font-mono text-xs text-muted-foreground">{item.item_no}</span>
                          <div className="text-sm font-medium">
                            Extracted: {item.extracted_name ?? "unnamed"}
                            {item.extracted_id_number ? ` · ID ${item.extracted_id_number}` : ""}
                          </div>
                        </div>
                        <Badge variant="outline" className={OUTCOME_TONE[item.match_outcome]}>
                          {humanise(item.match_outcome)}
                          {item.match_confidence != null ? ` · ${Math.round(item.match_confidence * 100)}%` : ""}
                        </Badge>
                      </div>
                      {item.notes && <p className="mt-2 text-xs text-muted-foreground">{item.notes}</p>}
                      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                        <ArrowRight className="h-4 w-4 text-muted-foreground" aria-hidden />
                        {best.band === "no_match" ? (
                          <span className="text-muted-foreground">No existing pipeline slot resembles this document — create a new candidate record.</span>
                        ) : (
                          <>
                            <span>Suggested slot:</span>
                            <Badge variant="outline" className={best.band === "ambiguous" ? TONE.warning : TONE.info}>
                              <Fingerprint className="mr-1 h-3 w-3" aria-hidden />
                              {best.candidateName} · {Math.round(best.confidence * 100)}%
                            </Badge>
                            <span className="text-xs text-muted-foreground">{best.reasons.join(" · ")}</span>
                          </>
                        )}
                      </div>
                      {suggestions.length > 1 && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Also considered: {suggestions.slice(1, 3).map((s) => `${s.candidateName} (${Math.round(s.confidence * 100)}%)`).join(", ")}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Document-to-pipeline mapping</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Extracted identity</TableHead>
                    <TableHead>Pipeline slot</TableHead>
                    <TableHead>Outcome</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono text-xs">{item.item_no}</TableCell>
                      <TableCell className="text-sm">{humanise(item.item_kind)}</TableCell>
                      <TableCell className="text-sm">
                        {item.extracted_name ?? "—"}
                        {item.extracted_id_number && (
                          <span className="block text-xs text-muted-foreground">ID {item.extracted_id_number}</span>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{candidateName(item.matched_candidate_id)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={OUTCOME_TONE[item.match_outcome]}>
                          {humanise(item.match_outcome)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------- audit trail ----------------------------- */

function AuditTrailTab({
  runs, loading, activeRunId, onRunChange, report, reportLoading,
}: {
  runs: recon.ImportRun[];
  loading: boolean;
  activeRunId: string | null;
  onRunChange: (id: string) => void;
  report?: recon.IdempotencyReport;
  reportLoading: boolean;
}) {
  const active = runs.find((r) => r.id === activeRunId);
  return (
    <div className="mt-6 space-y-6">
      <RunPicker runs={runs} activeRunId={activeRunId} onRunChange={onRunChange} />
      {loading && <Skeleton className="h-40 w-full" />}
      {active && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary" aria-hidden />
              Run metadata — {active.run_no}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Meta label="Uploaded by" value={active.initiated_by_label} />
            <Meta label="Extraction started" value={fmtDate(active.started_at)} />
            <Meta label="Completed" value={fmtDate(active.completed_at)} />
            <Meta label="Kind" value={humanise(active.kind)} />
            <div className="sm:col-span-2 lg:col-span-4">
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">Source</div>
              <p className="mt-1 text-sm">{active.source_description}</p>
            </div>
          </CardContent>
        </Card>
      )}
      {reportLoading && <Skeleton className="h-48 w-full" />}
      {report && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Records created or updated in the pipeline</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>Document</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Target record</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {report.items.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(item.created_at)}</TableCell>
                    <TableCell className="font-mono text-xs">{item.item_no}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={OUTCOME_TONE[item.match_outcome]}>
                        {humanise(item.match_outcome)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {item.target_table ? (
                        <span className="font-mono">{item.target_table}/{String(item.target_id ?? "").slice(0, 8)}…</span>
                      ) : "—"}
                    </TableCell>
                    <TableCell className="max-w-[320px] text-xs text-muted-foreground">{item.notes ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm font-medium">{value}</div>
    </div>
  );
}

/* ------------------------------- idempotency ----------------------------- */

function IdempotencyTab({
  runs, activeRunId, onRunChange, report, loading,
}: {
  runs: recon.ImportRun[];
  activeRunId: string | null;
  onRunChange: (id: string) => void;
  report?: recon.IdempotencyReport;
  loading: boolean;
}) {
  const s = report?.summary;
  const total = s ? s.created + s.updated + s.matched + s.skipped + s.conflicts + s.ambiguous : 0;
  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <RunPicker runs={runs} activeRunId={activeRunId} onRunChange={onRunChange} />
        <p className="text-xs text-muted-foreground">
          Re-running this import is safe: items are deduplicated by (run, document, kind) — a re-run records skips, not duplicates.
        </p>
      </div>
      {loading && <Skeleton className="h-56 w-full" />}
      {report && s && (
        <>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Created" value={s.created} tone={TONE.success} />
            <Stat label="Updated" value={s.updated} tone={TONE.info} />
            <Stat label="Matched existing" value={s.matched} tone={TONE.neutral} />
            <Stat label="Skipped" value={s.skipped} tone={TONE.neutral} />
            <Stat label="Conflicts" value={s.conflicts} tone={TONE.danger} />
            <Stat label="Ambiguous" value={s.ambiguous} tone={TONE.warning} />
          </div>
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-base">Change mix by document kind</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {Object.entries(report.by_kind).map(([kind, count]) => (
                <div key={kind}>
                  <div className="mb-1 flex justify-between text-xs">
                    <span>{humanise(kind)}</span>
                    <span className="tabular-nums text-muted-foreground">{count}</span>
                  </div>
                  <Progress value={total ? (count / total) * 100 : 0} className="h-1.5" aria-label={`${humanise(kind)} share`} />
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4 text-warning" aria-hidden />
                Constraint conflicts &amp; resolutions
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {report.constraint_conflicts.length === 0 && (
                <p className="text-sm text-muted-foreground">No constraint conflicts recorded for this run.</p>
              )}
              {report.constraint_conflicts.map((item) => (
                <div key={item.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs">{item.item_no}</span>
                    <Badge variant="outline" className={OUTCOME_TONE[item.match_outcome]}>{humanise(item.match_outcome)}</Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{item.notes}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className={cn("rounded-lg border p-3", tone)}>
      <div className="text-[11px] uppercase tracking-wide">{label}</div>
      <div className="mt-1 text-xl font-bold tabular-nums">{value}</div>
    </div>
  );
}

/* ------------------------------- completeness ---------------------------- */

function CompletenessTab({
  rows, loading, vacancies, vacancyId, onVacancyChange,
}: {
  rows: CompletenessRow[];
  loading: boolean;
  vacancies: { id: string; title: string }[];
  vacancyId: string;
  onVacancyChange: (id: string) => void;
}) {
  const summary = useMemo(() => completenessSummary(rows), [rows]);
  const flagged = useMemo(
    () => rows.filter((r) =>
      r.application_status === "active" &&
      !readyForScoring(r).ready &&
      missingItems(r).length > 0,
    ),
    [rows],
  );

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={vacancyId} onValueChange={onVacancyChange}>
          <SelectTrigger className="w-full sm:w-[320px]" aria-label="Filter by vacancy">
            <SelectValue placeholder="All vacancies" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All vacancies</SelectItem>
            {vacancies.map((v) => (
              <SelectItem key={v.id} value={v.id}>{v.title}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Badge variant="outline" className={TONE.success}>{summary.ready} ready for scoring</Badge>
        <Badge variant="outline" className={TONE.warning}>{flagged.length} flagged</Badge>
        <Badge variant="outline" className={TONE.danger}>{summary.missingEvaluations} missing evaluation forms</Badge>
        <Badge variant="outline" className={TONE.warning}>{summary.openConflicts} open conflicts</Badge>
      </div>

      {loading && <Skeleton className="h-56 w-full" />}

      {!loading && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Applications flagged before final scoring</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {flagged.length === 0 && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <BadgeCheck className="h-4 w-4 text-success" aria-hidden />
                Every active application has complete interview evidence.
              </div>
            )}
            {flagged.map((row) => {
              const gaps = missingItems(row);
              return (
                <div key={row.application_id} className="rounded-lg border bg-muted/30 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{row.candidate_name}</div>
                    <div className="flex gap-2 text-xs text-muted-foreground">
                      <span>{row.invitation_letters} letter{row.invitation_letters === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{row.interviews_completed} interview{row.interviews_completed === 1 ? "" : "s"}</span>
                      <span>·</span>
                      <span>{row.evaluations_submitted} evaluation{row.evaluations_submitted === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <ul className="mt-2 space-y-1">
                    {gaps.map((g) => (
                      <li key={g.key} className="flex items-center gap-2 text-xs">
                        {g.blocking ? (
                          <ShieldAlert className="h-3.5 w-3.5 text-destructive" aria-hidden />
                        ) : (
                          <AlertTriangle className="h-3.5 w-3.5 text-warning" aria-hidden />
                        )}
                        <span>{g.label}</span>
                        {g.blocking && (
                          <Badge variant="outline" className={cn(TONE.danger, "text-[10px]")}>Blocking</Badge>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ------------------------------- adjudication ---------------------------- */

function AdjudicationTab({
  adjudications, loading, onChanged,
}: {
  adjudications: recon.Adjudication[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [aiBusy, setAiBusy] = useState<string | null>(null);
  const [deciding, setDeciding] = useState<recon.Adjudication | null>(null);
  const [decision, setDecision] = useState("uphold_advance");
  const [rationale, setRationale] = useState("");
  const [decider, setDecider] = useState("");

  const ai = useMutation({
    mutationFn: (id: string) => recon.requestAiAdjudication(id),
    onSuccess: (data) => {
      toast.success(`AI recommendation: ${humanise(data.recommendation)} (${Math.round(data.confidence * 100)}% confidence)`);
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
    onSettled: () => setAiBusy(null),
  });

  const decide = useMutation({
    mutationFn: () => recon.decideAdjudication(deciding!.id, decision, rationale, decider || undefined),
    onSuccess: () => {
      toast.success("Adjudication decision recorded");
      setDeciding(null);
      setRationale("");
      setDecider("");
      onChanged();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-6 space-y-4">
      {loading && <Skeleton className="h-56 w-full" />}
      {!loading && adjudications.length === 0 && (
        <Card><CardContent className="p-6 text-sm text-muted-foreground">No evaluation conflicts on record.</CardContent></Card>
      )}
      {adjudications.map((a) => (
        <Card key={a.id} className={cn(a.status !== "decided" && "border-warning/40")}>
          <CardHeader className="pb-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {a.candidate_name ?? "Candidate"} — {humanise(a.subject)}
                </CardTitle>
                <p className="mt-1 max-w-3xl text-xs text-muted-foreground">{a.conflict_summary}</p>
              </div>
              <Badge
                variant="outline"
                className={a.status === "decided" ? TONE.success : a.status === "ai_recommended" ? TONE.info : TONE.warning}
              >
                {humanise(a.status)}
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {a.ai_recommendation && (
              <div className="rounded-lg border border-primary/30 bg-primary/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <BrainCircuit className="h-4 w-4 text-primary" aria-hidden />
                  <span className="text-sm font-semibold">AI HR-practitioner recommendation</span>
                  <Badge variant="outline" className={TONE.info}>{humanise(a.ai_recommendation)}</Badge>
                  {a.ai_confidence != null && (
                    <span className="text-xs text-muted-foreground">{Math.round(a.ai_confidence * 100)}% confidence</span>
                  )}
                  {a.ai_model && <span className="text-[11px] text-muted-foreground">· {a.ai_model}</span>}
                </div>
                <p className="mt-2 whitespace-pre-line text-sm text-muted-foreground">{a.ai_rationale}</p>
              </div>
            )}
            {a.hr_decision && (
              <div className="rounded-lg border border-success/30 bg-success/5 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-success" aria-hidden />
                  <span className="text-sm font-semibold">Final human decision: {humanise(a.hr_decision)}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.decided_by_label ?? "HR"} · {fmtDate(a.decided_at)}
                  </span>
                </div>
                {a.hr_rationale && <p className="mt-2 text-sm text-muted-foreground">{a.hr_rationale}</p>}
              </div>
            )}
            {a.status !== "decided" && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" asChild>
                  <Link to={`/staff/recruitment/conflicts/${a.id}`}>
                    <Scale className="mr-2 h-4 w-4" aria-hidden />
                    Open resolution screen
                  </Link>
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={aiBusy === a.id}
                  onClick={() => { setAiBusy(a.id); ai.mutate(a.id); }}
                >
                  <BrainCircuit className="mr-2 h-4 w-4" aria-hidden />
                  {a.ai_recommendation ? "Regenerate AI recommendation" : "Run AI adjudication"}
                </Button>
                <Button size="sm" onClick={() => { setDeciding(a); setDecision(a.ai_recommendation ?? "uphold_advance"); }}>
                  <Gavel className="mr-2 h-4 w-4" aria-hidden />
                  Record final decision
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!deciding} onOpenChange={(open) => !open && setDeciding(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Final adjudication — {deciding?.candidate_name}</DialogTitle>
            <DialogDescription>
              This decision is recorded append-only with your identity and closes the conflict.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="adj-decision">Decision</Label>
              <Select value={decision} onValueChange={setDecision}>
                <SelectTrigger id="adj-decision"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {recon.HR_DECISIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-decider">Decided by</Label>
              <Input id="adj-decider" value={decider} onChange={(e) => setDecider(e.target.value)} placeholder="e.g. Head of Talent" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="adj-rationale">Rationale</Label>
              <Textarea
                id="adj-rationale"
                value={rationale}
                onChange={(e) => setRationale(e.target.value)}
                rows={4}
                placeholder="Why this resolution is fair to the candidate and defensible on audit…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button disabled={!rationale.trim() || decide.isPending} onClick={() => decide.mutate()}>
              Record decision
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------ import jobs ------------------------------ */

const STEP_TONE: Record<string, string> = {
  completed: TONE.success,
  failed: TONE.danger,
  running: TONE.info,
  pending: TONE.neutral,
  skipped: TONE.neutral,
};

function JobsTab({
  runs, activeRunId, onRunChange, onChanged,
}: {
  runs: recon.ImportRun[];
  activeRunId: string | null;
  onRunChange: (id: string) => void;
  onChanged: () => void;
}) {
  const plan = useQuery({
    queryKey: ["rec", "resume-plan", activeRunId],
    queryFn: () => recon.loadResumePlan(activeRunId!),
    enabled: !!activeRunId,
  });

  const worker = useMutation({
    mutationFn: (resume: boolean) => recon.runImportWorker(activeRunId!, resume),
    onSuccess: (data) => {
      if (data.paused) toast.error("Run paused — the AI gateway denied a request. Resume explicitly once resolved.");
      else if (data.throttled) toast.warning("Rate limited — remaining steps parked with backoff.");
      else toast.success(`Worker processed ${data.processed} step${data.processed === 1 ? "" : "s"} · ${data.remaining} remaining`);
      onChanged();
      plan.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const retry = useMutation({
    mutationFn: () => recon.retryFailedSteps(activeRunId!),
    onSuccess: (d) => {
      toast.success(`${d.steps_reset} failed step${d.steps_reset === 1 ? "" : "s"} reset to pending`);
      onChanged();
      plan.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const steps = plan.data?.steps ?? [];
  const progress = stepProgress(steps);
  const next = nextActionableStep(steps);
  const pausedReason = plan.data?.run.paused_reason ?? null;
  const resumable = plan.data ? canResume(plan.data.run, steps) : false;

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <RunPicker runs={runs} activeRunId={activeRunId} onRunChange={onRunChange} />
        <p className="text-xs text-muted-foreground">
          Resumable: the worker continues from the last successful step — completed steps are never re-run.
        </p>
      </div>

      {plan.isLoading && <Skeleton className="h-64 w-full" />}

      {plan.data && (
        <>
          {pausedReason && (
            <Card className="border-destructive/40">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="flex items-center gap-2 text-sm">
                  <ShieldAlert className="h-4 w-4 text-destructive" aria-hidden />
                  <span><span className="font-semibold">Run paused.</span>{" "}<span className="text-muted-foreground">{pausedReason}</span></span>
                </div>
                <Button size="sm" variant="outline" disabled={worker.isPending} onClick={() => worker.mutate(true)}>
                  <Play className="mr-2 h-4 w-4" aria-hidden />
                  Resume run
                </Button>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">
                  {plan.data.run.run_no} — {plan.data.run.label}
                </CardTitle>
                <div className="flex flex-wrap gap-2">
                  {progress.failed > 0 && !pausedReason && (
                    <Button size="sm" variant="outline" disabled={retry.isPending} onClick={() => retry.mutate()}>
                      <RefreshCcw className="mr-2 h-4 w-4" aria-hidden />
                      Retry {progress.failed} failed step{progress.failed === 1 ? "" : "s"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    disabled={worker.isPending || !resumable}
                    onClick={() => worker.mutate(false)}
                  >
                    <Play className="mr-2 h-4 w-4" aria-hidden />
                    {worker.isPending ? "Worker running…" : next ? `Run worker — next: ${next.label}` : "No actionable steps"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                  <span>{progress.completed} of {progress.total} steps completed</span>
                  <span className="tabular-nums">{progress.pct}%</span>
                </div>
                <Progress value={progress.pct} className="h-2" aria-label="Run progress" />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline" className={TONE.success}>{progress.completed} completed</Badge>
                <Badge variant="outline" className={TONE.neutral}>{progress.pending} pending</Badge>
                {progress.failed > 0 && <Badge variant="outline" className={TONE.danger}>{progress.failed} failed</Badge>}
                {progress.running > 0 && <Badge variant="outline" className={TONE.info}>{progress.running} running</Badge>}
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Step</TableHead>
                    <TableHead>Handler</TableHead>
                    <TableHead>State</TableHead>
                    <TableHead>Completed</TableHead>
                    <TableHead>Error</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {steps.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell className="tabular-nums text-xs text-muted-foreground">{s.step_no}</TableCell>
                      <TableCell className="text-sm">{s.label}</TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">{s.handler}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STEP_TONE[s.status] ?? TONE.neutral}>
                          {stepStateLabel(s)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(s.completed_at)}</TableCell>
                      <TableCell className="max-w-[280px] text-xs text-muted-foreground">{s.last_error ?? "—"}</TableCell>
                    </TableRow>
                  ))}
                  {steps.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-sm text-muted-foreground">
                        No steps recorded for this run — pre-job-spine imports are listed under the audit trail instead.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

/* ------------------------------ enrichment ------------------------------- */

function EnrichmentTab({ onChanged }: { onChanged: () => void }) {
  const status = useQuery({ queryKey: ["rec", "enrichment-status"], queryFn: recon.listEnrichmentStatus });
  const [candidateId, setCandidateId] = useState<string | null>(null);

  const rows = status.data ?? [];
  const activeId = candidateId ?? defaultEnrichmentCandidate(rows)?.candidate_id ?? null;
  const active = rows.find((r) => r.candidate_id === activeId) ?? null;

  const audit = useQuery({
    queryKey: ["rec", "enrichment-audit", activeId],
    queryFn: () => recon.listEnrichmentAudit(activeId!),
    enabled: !!activeId,
  });

  const verify = useMutation({
    mutationFn: () => recon.markEnrichmentVerified(activeId!),
    onSuccess: () => {
      toast.success("Profile marked as verified");
      onChanged();
      status.refetch();
      audit.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="mt-6 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={activeId ?? undefined} onValueChange={setCandidateId}>
          <SelectTrigger className="w-full sm:w-[380px]" aria-label="Select candidate">
            <SelectValue placeholder="Select a candidate" />
          </SelectTrigger>
          <SelectContent>
            {rows.map((r) => (
              <SelectItem key={r.candidate_id} value={r.candidate_id}>
                {r.full_name} — {r.candidate_no}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {active && (
          <>
            <Badge variant="outline" className={enrichmentCompleteness(active) === 100 ? TONE.success : TONE.warning}>
              {enrichmentCompleteness(active)}% enriched
            </Badge>
            {active.enrichment_verified_at ? (
              <Badge variant="outline" className={TONE.success}>
                <BadgeCheck className="mr-1 h-3 w-3" aria-hidden />
                Verified {fmtDate(active.enrichment_verified_at)}
              </Badge>
            ) : (
              <Button size="sm" variant="outline" disabled={verify.isPending} onClick={() => verify.mutate()}>
                <BadgeCheck className="mr-2 h-4 w-4" aria-hidden />
                Mark as verified
              </Button>
            )}
          </>
        )}
      </div>

      {status.isLoading && <Skeleton className="h-56 w-full" />}

      {active && (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Field status — {active.full_name}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {enrichmentFields(active).map((f) => (
                  <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex items-center gap-2">
                      {f.present ? (
                        <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                      ) : (
                        <XCircle className="h-4 w-4 text-destructive" aria-hidden />
                      )}
                      {f.label}
                    </span>
                    {f.present ? (
                      <span className="text-xs text-muted-foreground">{f.detail ?? "Present"}</span>
                    ) : (
                      <Badge variant="outline" className={cn(TONE.danger, "text-[10px]")}>Missing</Badge>
                    )}
                  </div>
                ))}
                {missingEnrichmentFields(active).length > 0 && (
                  <p className="pt-2 text-xs text-muted-foreground">
                    Still missing: {missingEnrichmentFields(active).join(", ")}
                  </p>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Provenance</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-2">
                <Meta label="Last enriched" value={fmtDate(active.last_enriched_at)} />
                <Meta label="Last verified" value={fmtDate(active.enrichment_verified_at)} />
                <Meta label="Profile updated" value={fmtDate(active.profile_updated_at)} />
                <Meta label="Audit events" value={String(active.audit_events)} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Enrichment audit trail — who changed what, when</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(audit.data ?? []).length === 0 && !audit.isLoading && (
                <p className="text-sm text-muted-foreground">No enrichment activity recorded for this candidate yet.</p>
              )}
              {(audit.data ?? []).map((row) => (
                <div key={row.id} className="rounded-lg border bg-muted/30 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted-foreground">{fmtDate(row.created_at)}</span>
                    <Badge variant="outline" className={row.action === "insert" ? TONE.success : TONE.info}>
                      {row.action === "insert" ? "Created" : "Updated"}
                    </Badge>
                    <span className="font-mono text-xs">{row.table_name}</span>
                    <span className="text-xs text-muted-foreground">
                      by {auditActor(row)} · {row.source}
                      {row.step_key ? ` · step ${row.step_key}` : ""}
                    </span>
                  </div>
                  <ul className="mt-2 space-y-0.5">
                    {auditChangeSummary(row.changes).slice(0, 6).map((line, i) => (
                      <li key={i} className="text-xs text-muted-foreground">{line}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
