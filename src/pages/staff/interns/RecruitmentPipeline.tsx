import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { StaffPageHeader } from "@/components/staff/primitives";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/hooks/use-toast";

import * as api from "@/lib/interns/api";
import * as rec from "@/lib/interns/recruitment";

/**
 * Internship Recruitment Command Board.
 *
 * The funnel from application to a live Interns 360 identity. Stage moves,
 * scoring, track recommendation and activation are all server decisions — this
 * screen states the evidence behind each one and refuses to imply authority it
 * does not have.
 */
export default function RecruitmentPipeline() {
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [cohortId, setCohortId] = useState<string>("");
  const [query, setQuery] = useState("");
  const [slaOnly, setSlaOnly] = useState(false);
  const [eligibility, setEligibility] = useState<string>("all");
  // Triage view: pipelines whose academic profile has an undeclared field.
  const [gapsOnly, setGapsOnly] = useState(false);

  const pipelines = useQuery({ queryKey: ["internRec", "pipelines"], queryFn: rec.listPipeline });
  const rows = pipelines.data ?? [];

  const candidates = useQuery({
    queryKey: ["internRec", "candidates", rows.map((r) => r.candidate_id).join(",")],
    queryFn: () => rec.listCandidateBriefs(rows.map((r) => r.candidate_id)),
    enabled: rows.length > 0,
  });
  const academicGaps = useQuery({
    queryKey: ["internRec", "academicGaps"],
    queryFn: rec.listAcademicProfileGaps,
  });
  const gapByApplication = useMemo(
    () => new Map((academicGaps.data ?? []).map((g) => [g.application_id, g])),
    [academicGaps.data],
  );

  const cohorts = useQuery({ queryKey: ["interns", "cohorts"], queryFn: api.listCohorts });
  const tracks = useQuery({ queryKey: ["interns", "tracks"], queryFn: api.listTracks });

  const selected = rows.find((r) => r.id === openId) ?? null;
  const transitions = useQuery({
    queryKey: ["internRec", "transitions", openId],
    queryFn: () => rec.listTransitions(openId as string),
    enabled: !!openId,
  });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ["internRec"] });
  const fail = (e: Error) => toast({ title: "Refused by the server", description: e.message, variant: "destructive" });

  const advance = useMutation({
    mutationFn: (v: { id: string; to: rec.AnyStage; reason: string }) =>
      rec.transitionPipeline(v.id, v.to, v.reason),
    onSuccess: (r) => {
      toast({ title: "Stage recorded", description: `Now at ${rec.STAGE_LABEL[r.stage] ?? r.stage}.` });
      setReason("");
      invalidate();
    },
    onError: fail,
  });

  const evaluate = useMutation({
    mutationFn: (id: string) => rec.evaluatePipeline(id),
    onSuccess: (r) =>
      toast({
        title: `Eligibility: ${r.eligibility}`,
        description: `Match score ${Number(r.match_score ?? 0).toFixed(1)} — every dimension carries its evidence.`,
      }),
    onError: fail,
  });

  const recommend = useMutation({
    mutationFn: (id: string) => rec.recommendTracks(id),
    onSuccess: (r) => {
      toast({
        title: r.primary_track_id ? "Tracks recommended" : "No track met the evidence bar",
        description: r.primary_track_id
          ? "Derived from matched course and evidence signals, not the degree title."
          : "Record verified course or evidence claims first.",
        variant: r.primary_track_id ? undefined : "destructive",
      });
      invalidate();
    },
    onError: fail,
  });

  const decide = useMutation({
    mutationFn: (v: { id: string; decision: "SELECT" | "REJECT" | "HOLD" | "TALENT_POOL"; reason: string }) =>
      rec.decidePipeline(v.id, v.decision, v.reason),
    onSuccess: () => {
      toast({ title: "Decision recorded with its reason" });
      setReason("");
      invalidate();
    },
    onError: fail,
  });

  const activate = useMutation({
    mutationFn: (v: { id: string; cohort: string }) => rec.activatePipeline(v.id, v.cohort),
    onSuccess: (r) => {
      toast({ title: "Handed over to Interns 360", description: "One intern identity, fully audited." });
      setOpenId(null);
      invalidate();
      if (r.intern_id) window.location.assign(`/staff/interns/${r.intern_id}`);
    },
    onError: fail,
  });

  const briefFor = (candidateId: string) => candidates.data?.[candidateId];

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (slaOnly && !rec.slaBreached(r)) return false;
      if (gapsOnly && !gapByApplication.has(r.application_id)) return false;
      if (eligibility !== "all" && (r.eligibility_status ?? "UNSCORED") !== eligibility) return false;
      if (!q) return true;
      const b = candidates.data?.[r.candidate_id];
      return `${b?.full_name ?? ""} ${b?.candidate_no ?? ""}`.toLowerCase().includes(q);
    });
  }, [rows, query, slaOnly, gapsOnly, eligibility, candidates.data, gapByApplication]);

  const columns = useMemo(
    () =>
      rec.BOARD_STAGES.map((stage) => ({
        stage,
        items: visible.filter((r) => r.stage === stage),
      })).filter((c) => c.items.length > 0 || rec.BOARD_STAGES.indexOf(c.stage) < 6),
    [visible],
  );

  const terminal = visible.filter((r) => rec.isTerminal(r.stage));
  const breached = rows.filter((r) => rec.slaBreached(r));

  const nameFor = (candidateId: string) =>
    candidates.data?.[candidateId]?.full_name ?? candidates.data?.[candidateId]?.candidate_no ?? "Candidate";

  const trackName = (id: string | null) =>
    id ? tracks.data?.find((t) => t.id === id)?.name ?? tracks.data?.find((t) => t.id === id)?.code ?? "—" : "—";

  return (
    <div className="space-y-6">
      <StaffPageHeader
        title="Internship recruitment"
        lede="Application to live intern identity. Eligibility, scoring, track fit and activation are governed server decisions with an append-only audit trail."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        {[
          { label: "In the funnel", value: rows.length - terminal.length },
          { label: "SLA breached", value: breached.length },
          { label: "Closed outcomes", value: terminal.length },
        ].map((s) => (
          <Card key={s.label}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{s.label}</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-semibold">
              {pipelines.isLoading ? <Skeleton className="h-8 w-12" /> : s.value}
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-5">
          <div className="min-w-[16rem] flex-1 space-y-1">
            <Label htmlFor="pipeline-search">Find a candidate</Label>
            <Input
              id="pipeline-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name or candidate number"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="pipeline-eligibility">Eligibility</Label>
            <Select value={eligibility} onValueChange={setEligibility}>
              <SelectTrigger id="pipeline-eligibility" className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="ELIGIBLE">Eligible</SelectItem>
                <SelectItem value="NOT_ELIGIBLE">Not eligible</SelectItem>
                <SelectItem value="UNSCORED">Not yet evaluated</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            variant={slaOnly ? "default" : "outline"}
            onClick={() => setSlaOnly((v) => !v)}
            aria-pressed={slaOnly}
          >
            SLA breached only
          </Button>
          <Button
            variant={gapsOnly ? "default" : "outline"}
            onClick={() => setGapsOnly((v) => !v)}
            aria-pressed={gapsOnly}
          >
            Incomplete academic profile
            {academicGaps.data?.length ? ` (${academicGaps.data.length})` : ""}
          </Button>
          {(query || slaOnly || gapsOnly || eligibility !== "all") && (
            <Button
              variant="ghost"
              onClick={() => {
                setQuery("");
                setSlaOnly(false);
                setGapsOnly(false);
                setEligibility("all");
              }}
            >
              Clear filters
            </Button>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            Showing {visible.length} of {rows.length} pipelines
          </span>
        </CardContent>
      </Card>


      {pipelines.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No internship pipelines are open yet. Open one from an application in{" "}
            <Link className="underline" to="/staff/recruitment/pipeline">
              Recruitment 360
            </Link>
            .
          </CardContent>
        </Card>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {columns.map((col) => (
            <section key={col.stage} className="w-72 shrink-0 space-y-3">
              <header className="flex items-center justify-between rounded-md border bg-card/60 px-3 py-2">
                <span className="text-sm font-medium">{rec.STAGE_LABEL[col.stage]}</span>
                <Badge variant="secondary">{col.items.length}</Badge>
              </header>
              <div className="space-y-2">
                {col.items.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => setOpenId(row.id)}
                    className="w-full rounded-md border bg-card p-3 text-left transition-colors hover:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <p className="truncate text-sm font-medium">{nameFor(row.candidate_id)}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {briefFor(row.candidate_id)?.candidate_no ?? "—"} ·{" "}
                      {trackName(row.primary_track_id)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rec.hoursInStage(row)}h in stage
                      {row.sla_target_hours ? ` · target ${row.sla_target_hours}h` : ""}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1">
                      {row.eligibility_status && (
                        <Badge variant={row.eligibility_status === "ELIGIBLE" ? "default" : "outline"}>
                          {row.eligibility_status}
                        </Badge>
                      )}
                      {row.match_score !== null && (
                        <Badge variant="secondary">Match {Number(row.match_score).toFixed(0)}</Badge>
                      )}
                      {rec.slaBreached(row) && <Badge variant="destructive">SLA</Badge>}
                      {gapByApplication.get(row.application_id)?.gaps.map((g) => (
                        <Badge key={g} variant="outline">{rec.ACADEMIC_GAP_LABEL[g]}</Badge>
                      ))}
                    </div>
                  </button>
                ))}
                {col.items.length === 0 && (
                  <p className="rounded-md border border-dashed px-3 py-4 text-xs text-muted-foreground">
                    Nothing at this stage.
                  </p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}

      {terminal.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Closed outcomes</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {terminal.map((row) => (
              <div key={row.id} className="flex items-center justify-between gap-3 border-b pb-2 text-sm last:border-0">
                <span className="truncate">{nameFor(row.candidate_id)}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{rec.STAGE_LABEL[row.stage] ?? row.stage}</Badge>
                  <Button variant="ghost" size="sm" onClick={() => setOpenId(row.id)}>
                    Open trail
                  </Button>
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{selected ? nameFor(selected.candidate_id) : "Pipeline"}</DialogTitle>
          </DialogHeader>

          {selected && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge>{rec.STAGE_LABEL[selected.stage] ?? selected.stage}</Badge>
                <span className="text-muted-foreground">{rec.hoursInStage(selected)}h in stage</span>
                {selected.eligibility_status && (
                  <Badge variant="outline">Eligibility: {selected.eligibility_status}</Badge>
                )}
              </div>

              {selected.eligibility_reasons?.length ? (
                <div className="rounded-md border p-3 text-sm">
                  <p className="font-medium">Why eligibility is not yet met</p>
                  <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                    {selected.eligibility_reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Score, with its evidence</p>
                {selected.score_breakdown && Object.keys(selected.score_breakdown).length ? (
                  <table className="mt-2 w-full text-sm">
                    <tbody>
                      {Object.entries(selected.score_breakdown).map(([dim, d]) => (
                        <tr key={dim} className="border-b last:border-0">
                          <td className="py-1 pr-3 align-top capitalize">{dim.replace(/_/g, " ")}</td>
                          <td className="py-1 pr-3 align-top tabular-nums">{Number(d.score ?? 0).toFixed(1)}</td>
                          <td className="py-1 align-top text-xs text-muted-foreground">
                            {d.evidence ?? "—"}
                            {d.source ? ` · ${d.source}` : ""}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Not scored yet — run the evaluation to compute it from recorded evidence.
                  </p>
                )}
              </div>

              <div className="grid gap-2 rounded-md border p-3 text-sm sm:grid-cols-3">
                <p>
                  <span className="text-muted-foreground">Primary track</span>
                  <br />
                  {trackName(selected.primary_track_id)}
                </p>
                <p>
                  <span className="text-muted-foreground">Secondary</span>
                  <br />
                  {trackName(selected.secondary_track_id)}
                </p>
                <p>
                  <span className="text-muted-foreground">Development</span>
                  <br />
                  {trackName(selected.development_track_id)}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="pipeline-reason">Reason (required for a move back or a closed outcome)</Label>
                <Textarea
                  id="pipeline-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="State the evidence behind this decision."
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => evaluate.mutate(selected.id)}
                  disabled={evaluate.isPending}
                  variant="secondary"
                >
                  Evaluate eligibility & score
                </Button>
                <Button
                  onClick={() => recommend.mutate(selected.id)}
                  disabled={recommend.isPending}
                  variant="secondary"
                >
                  Recommend tracks
                </Button>
                {rec.nextStage(selected.stage) && (
                  <Button
                    onClick={() =>
                      advance.mutate({
                        id: selected.id,
                        to: rec.nextStage(selected.stage) as rec.AnyStage,
                        reason: reason || "advanced after review",
                      })
                    }
                    disabled={advance.isPending}
                  >
                    Advance to {rec.STAGE_LABEL[rec.nextStage(selected.stage) as string]}
                  </Button>
                )}
                {rec.previousStage(selected.stage) && (
                  <Button
                    variant="outline"
                    onClick={() =>
                      advance.mutate({
                        id: selected.id,
                        to: rec.previousStage(selected.stage) as rec.AnyStage,
                        reason,
                      })
                    }
                    disabled={advance.isPending || !reason.trim()}
                  >
                    Send back one stage
                  </Button>
                )}
                <Button
                  variant="outline"
                  onClick={() => decide.mutate({ id: selected.id, decision: "SELECT", reason })}
                  disabled={decide.isPending || !reason.trim()}
                >
                  Record selection
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => decide.mutate({ id: selected.id, decision: "REJECT", reason })}
                  disabled={decide.isPending || !reason.trim()}
                >
                  Reject with reason
                </Button>
              </div>

              {selected.stage === "ONBOARDING" && (
                <div className="space-y-2 rounded-md border p-3">
                  <Label htmlFor="pipeline-cohort">Activate into cohort</Label>
                  <div className="flex flex-wrap gap-2">
                    <Select value={cohortId} onValueChange={setCohortId}>
                      <SelectTrigger id="pipeline-cohort" className="w-64">
                        <SelectValue placeholder="Choose a cohort" />
                      </SelectTrigger>
                      <SelectContent>
                        {(cohorts.data ?? []).map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      onClick={() => activate.mutate({ id: selected.id, cohort: cohortId })}
                      disabled={!cohortId || activate.isPending}
                    >
                      Activate in Interns 360
                    </Button>
                  </div>
                </div>
              )}

              {selected.intern_id && (
                <p className="text-sm">
                  Live intern record:{" "}
                  <Link className="underline" to={`/staff/interns/${selected.intern_id}`}>
                    open Intern 360
                  </Link>
                </p>
              )}

              <div className="rounded-md border p-3">
                <p className="text-sm font-medium">Institutional documentation</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Required by the placing institution before activation. Each artefact is issued, signed
                  and sealed in Document OS — this panel states the requirement, not its completion.
                </p>
                <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                  <li>Internship contract / agreement — firm details, working hours, duties, signatures</li>
                  <li>Intern daily diary — dated log of hours worked and job assignments</li>
                  <li>Supervisor evaluation form — qualities assessment with graded comments</li>
                </ul>
              </div>

              <div>
                <p className="text-sm font-medium">Transition trail (append-only)</p>
                {transitions.isLoading ? (
                  <Skeleton className="mt-2 h-20 w-full" />
                ) : (
                  <ol className="mt-2 space-y-2">
                    {(transitions.data ?? []).map((t) => (
                      <li key={t.id} className="border-b pb-2 text-sm last:border-0">
                        <p>
                          {t.from_stage ? `${rec.STAGE_LABEL[t.from_stage] ?? t.from_stage} → ` : ""}
                          <span className="font-medium">{rec.STAGE_LABEL[t.to_stage] ?? t.to_stage}</span>
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {new Date(t.created_at).toLocaleString("en-KE")}
                          {t.reason ? ` · ${t.reason}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

    </div>
  );
}
